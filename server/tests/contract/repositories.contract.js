/**
 * The behaviour every repository implementation must have. Run against the
 * in-memory repositories always, and against Postgres when TEST_DATABASE_URL is set.
 */
const { RepoError } = require('../../repositories/errors');

const user = (id, extra = {}) => ({ id, name: `User ${id}`, guest: false, emailVerified: false, createdAt: '2026-01-01T00:00:00.000Z', email: `${id}@example.com`, ...extra });
const guest = (id, createdAt = '2026-01-01T00:00:00.000Z') => ({ id, name: `Guest-${id}`, guest: true, createdAt });

function runContract(label, setup) {
  describe(`${label} repositories`, () => {
    let repos;
    beforeEach(async () => { repos = await setup(); });

    describe('users', () => {
      test('create, read back by id, email and slug', async () => {
        await repos.users.create(user('u1', { profileSlug: 'ada-abc123', profilePublic: true }));
        const byId = await repos.users.getById('u1');
        expect(byId).toMatchObject({ id: 'u1', name: 'User u1', email: 'u1@example.com', guest: false, profileSlug: 'ada-abc123', profilePublic: true });
        expect((await repos.users.getByEmail('u1@example.com')).id).toBe('u1');
        expect((await repos.users.getBySlug('ada-abc123')).id).toBe('u1');
        expect(await repos.users.getById('nope')).toBeNull();
        expect(await repos.users.getByEmail('nobody@example.com')).toBeNull();
      });

      test('emails and profile slugs are unique; ids cannot be reused', async () => {
        await repos.users.create(user('u1', { profileSlug: 'taken-slug' }));
        await expect(repos.users.create(user('u2', { email: 'u1@example.com' }))).rejects.toMatchObject({ code: 'email_taken' });
        await expect(repos.users.create(user('u3', { profileSlug: 'taken-slug' }))).rejects.toMatchObject({ code: 'slug_taken' });
        await expect(repos.users.create(user('u1', { email: 'other@example.com' }))).rejects.toMatchObject({ code: 'user_exists' });
      });

      test('update merges fields, upgrades a guest in place and reports unknown users', async () => {
        await repos.users.create(guest('g1'));
        const upgraded = await repos.users.update('g1', { name: 'Ada', email: 'ada@example.com', password: 'hash', guest: false, registeredAt: '2026-02-01T00:00:00.000Z' });
        expect(upgraded).toMatchObject({ id: 'g1', name: 'Ada', email: 'ada@example.com', password: 'hash', guest: false });
        expect(upgraded.createdAt).toBe('2026-01-01T00:00:00.000Z');
        const changed = await repos.users.update('g1', { passwordChangedAt: 1_800_000_000_000, emailVerified: true });
        expect(changed).toMatchObject({ passwordChangedAt: 1_800_000_000_000, emailVerified: true });
        expect(await repos.users.update('missing', { name: 'x' })).toBeNull();
        await repos.users.create(user('u2'));
        await expect(repos.users.update('u2', { email: 'ada@example.com' })).rejects.toMatchObject({ code: 'email_taken' });
      });

      test('createIfAbsent keeps an existing user untouched', async () => {
        const first = await repos.users.createIfAbsent({ id: 'sb1', name: 'Ada', email: 'sb1@example.com', guest: false, emailVerified: true });
        expect(first).toMatchObject({ id: 'sb1', name: 'Ada', emailVerified: true });
        const again = await repos.users.createIfAbsent({ id: 'sb1', name: 'Different', email: 'x@example.com', guest: true });
        expect(again.name).toBe('Ada');
      });

      test('namesByIds returns names for the ids that exist', async () => {
        await repos.users.create(user('u1'));
        await repos.users.create(user('u2'));
        expect(await repos.users.namesByIds(['u1', 'u2', 'ghost'])).toEqual({ u1: 'User u1', u2: 'User u2' });
        expect(await repos.users.namesByIds([])).toEqual({});
      });

      test('counts registered accounts and guests', async () => {
        await repos.users.create(user('u1'));
        await repos.users.create(guest('g1'));
        await repos.users.create(guest('g2'));
        expect(await repos.users.counts()).toEqual({ registered: 1, guests: 2 });
      });

      test('pruneGuests removes old guests and everything they own, never registered users', async () => {
        await repos.users.create(guest('old', '2020-01-01T00:00:00.000Z'));
        await repos.users.create(guest('new', '2026-06-01T00:00:00.000Z'));
        await repos.users.create(user('u1', { createdAt: '2020-01-01T00:00:00.000Z' }));
        await repos.progress.mutate('old', (doc) => { doc.xp = 10; });
        await repos.tokens.issue({ hash: 'h1', userId: 'old', kind: 'verify', expiresAt: Date.now() + 60_000 });
        const removed = await repos.users.pruneGuests(Date.parse('2026-01-01T00:00:00.000Z'));
        expect(removed).toBe(1);
        expect(await repos.users.getById('old')).toBeNull();
        expect(await repos.progress.get('old')).toBeNull();
        expect(await repos.tokens.redeem('h1', 'verify')).toBeNull();
        expect(await repos.users.getById('new')).not.toBeNull();
        expect(await repos.users.getById('u1')).not.toBeNull();
      });
    });

    describe('tokens', () => {
      beforeEach(() => repos.users.create(user('u1')));

      test('a token works once, for its own kind only', async () => {
        await repos.tokens.issue({ hash: 'a', userId: 'u1', kind: 'reset', expiresAt: Date.now() + 60_000 });
        expect(await repos.tokens.redeem('a', 'verify')).toBeNull();
        expect(await repos.tokens.redeem('a', 'reset')).toBe('u1');
        expect(await repos.tokens.redeem('a', 'reset')).toBeNull();
      });

      test('an expired token is refused (and consumed)', async () => {
        await repos.tokens.issue({ hash: 'a', userId: 'u1', kind: 'reset', expiresAt: 1000 });
        expect(await repos.tokens.redeem('a', 'reset', 2000)).toBeNull();
        expect(await repos.tokens.redeem('a', 'reset', 500)).toBeNull();
      });

      test('a newer token replaces older ones of the same kind only', async () => {
        const exp = Date.now() + 60_000;
        await repos.tokens.issue({ hash: 'r1', userId: 'u1', kind: 'reset', expiresAt: exp });
        await repos.tokens.issue({ hash: 'v1', userId: 'u1', kind: 'verify', expiresAt: exp });
        await repos.tokens.issue({ hash: 'r2', userId: 'u1', kind: 'reset', expiresAt: exp });
        expect(await repos.tokens.redeem('r1', 'reset')).toBeNull();
        expect(await repos.tokens.redeem('r2', 'reset')).toBe('u1');
        expect(await repos.tokens.redeem('v1', 'verify')).toBe('u1');
      });

      test('pruneExpired removes only expired tokens; unknown users are refused', async () => {
        await repos.tokens.issue({ hash: 'old', userId: 'u1', kind: 'reset', expiresAt: 1000 });
        await repos.tokens.issue({ hash: 'fresh', userId: 'u1', kind: 'verify', expiresAt: Date.now() + 60_000 });
        expect(await repos.tokens.pruneExpired(Date.now())).toBe(1);
        expect(await repos.tokens.redeem('fresh', 'verify')).toBe('u1');
        await expect(repos.tokens.issue({ hash: 'x', userId: 'ghost', kind: 'reset', expiresAt: 1 })).rejects.toBeInstanceOf(Error);
      });
    });

    describe('progress', () => {
      beforeEach(async () => {
        await repos.users.create(user('u1'));
        await repos.users.create(user('u2'));
      });

      test('mutate starts from an empty document and persists every field', async () => {
        const result = await repos.progress.mutate('u1', (doc) => {
          expect(doc).toMatchObject({ userId: 'u1', xp: 0, completedUnits: {}, interviews: [], activeDays: [] });
          doc.xp = 70;
          doc.completedUnits.linux = 1_800_000_000_000;
          doc.steps['linux:1'] = { attempts: 2, fails: 1, passedAt: 1_800_000_000_001 };
          doc.hints['linux:1'] = 2;
          doc.quizzes['linux:q1'] = 1_800_000_000_002;
          doc.cards['linux:c1'] = { ease: 2.5, interval: 1, due: 5 };
          doc.interviews.push({ unitId: 'linux', questionId: 'q', score: 80, at: 1 });
          doc.activeDays.push('2026-11-04', '2026-11-05');
          doc.daily['2026-11-05'] = 'linux';
          return 'done';
        });
        expect(result).toBe('done');
        expect(await repos.progress.get('u1')).toEqual({
          userId: 'u1', xp: 70, completedUnits: { linux: 1_800_000_000_000 },
          steps: { 'linux:1': { attempts: 2, fails: 1, passedAt: 1_800_000_000_001 } },
          hints: { 'linux:1': 2 }, quizzes: { 'linux:q1': 1_800_000_000_002 },
          cards: { 'linux:c1': { ease: 2.5, interval: 1, due: 5 } },
          interviews: [{ unitId: 'linux', questionId: 'q', score: 80, at: 1 }],
          activeDays: ['2026-11-04', '2026-11-05'], daily: { '2026-11-05': 'linux' },
        });
        expect(await repos.progress.get('u2')).toBeNull();
      });

      test('concurrent mutations of one learner never lose an update', async () => {
        await Promise.all(Array.from({ length: 25 }, () => repos.progress.mutate('u1', (doc) => { doc.xp += 10; })));
        expect((await repos.progress.get('u1')).xp).toBe(250);
      });

      test('a failing mutation leaves the stored progress unchanged', async () => {
        await repos.progress.mutate('u1', (doc) => { doc.xp = 5; });
        await expect(repos.progress.mutate('u1', (doc) => { doc.xp = 999; throw new Error('boom'); })).rejects.toThrow('boom');
        expect((await repos.progress.get('u1')).xp).toBe(5);
      });

      test('progress for an unknown user is refused', async () => {
        await expect(repos.progress.mutate('ghost', (doc) => { doc.xp = 1; })).rejects.toMatchObject({ code: 'user_missing' });
        expect(await repos.progress.get('ghost')).toBeNull();
      });

      test('leaderboard ranks by XP, skips zero, breaks ties by id and honours the limit', async () => {
        await repos.users.create(user('u3'));
        await repos.users.create(user('u4'));
        await repos.progress.mutate('u1', (d) => { d.xp = 50; d.completedUnits = { a: 1, b: 2 }; d.activeDays = ['2026-11-05']; });
        await repos.progress.mutate('u2', (d) => { d.xp = 80; });
        await repos.progress.mutate('u3', (d) => { d.xp = 50; });
        await repos.progress.mutate('u4', (d) => { d.xp = 0; });
        const board = await repos.progress.leaderboard(10);
        expect(board.map((r) => r.userId)).toEqual(['u2', 'u1', 'u3']);
        expect(board[1]).toMatchObject({ xp: 50, completedUnits: 2, activeDays: ['2026-11-05'] });
        expect((await repos.progress.leaderboard(1)).map((r) => r.userId)).toEqual(['u2']);
        expect(await repos.progress.totals()).toEqual({ learnersWithXp: 3, totalXp: 180 });
      });

      test('remove deletes a learner\'s progress', async () => {
        await repos.progress.mutate('u1', (d) => { d.xp = 5; });
        expect(await repos.progress.remove('u1')).toBe(true);
        expect(await repos.progress.remove('u1')).toBe(false);
        expect(await repos.progress.get('u1')).toBeNull();
      });
    });

    describe('college leaderboard', () => {
      test('lists only that college\'s students after a refresh', async () => {
        for (const id of ['s1', 's2', 's3']) await repos.users.create(user(id));
        if (repos.driver === 'postgres') {
          await repos.pool.query("insert into colleges (id, name, slug) values ('c1', 'SRM', 'srm'), ('c2', 'Other', 'other')");
        }
        await repos.memberships.add({ userId: 's1', collegeId: 'c1', role: 'student' });
        await repos.memberships.add({ userId: 's2', collegeId: 'c1', role: 'student' });
        await repos.memberships.add({ userId: 's3', collegeId: 'c2', role: 'student' });
        await repos.progress.mutate('s1', (d) => { d.xp = 30; });
        await repos.progress.mutate('s2', (d) => { d.xp = 60; });
        await repos.progress.mutate('s3', (d) => { d.xp = 90; });
        await repos.jobs.refreshLeaderboards();
        expect((await repos.progress.leaderboard(10, { collegeId: 'c1' })).map((r) => r.userId)).toEqual(['s2', 's1']);
        expect((await repos.progress.leaderboard(10, { collegeId: 'c2' })).map((r) => r.userId)).toEqual(['s3']);
        expect(await repos.progress.leaderboard(10, { collegeId: 'nope' })).toEqual([]);
      });
    });

    describe('colleges, sections, memberships and audit', () => {
      test('colleges are unique by slug and sections by name within a college', async () => {
        const srm = await repos.colleges.create({ name: 'SRM', slug: 'srm' });
        expect(srm).toMatchObject({ name: 'SRM', slug: 'srm', timezone: 'Asia/Kolkata', active: true });
        await expect(repos.colleges.create({ name: 'Other', slug: 'srm' })).rejects.toMatchObject({ code: 'college_slug_taken' });
        expect((await repos.colleges.getBySlug('srm')).id).toBe(srm.id);
        expect((await repos.colleges.getById(srm.id)).slug).toBe('srm');
        expect(await repos.colleges.getBySlug('none')).toBeNull();

        const a = await repos.sections.ensure({ collegeId: srm.id, name: 'CSE-A', academicYear: 2026 });
        const again = await repos.sections.ensure({ collegeId: srm.id, name: 'CSE-A' });
        expect(again.id).toBe(a.id);
        const other = await repos.colleges.create({ name: 'Other', slug: 'other' });
        const b = await repos.sections.ensure({ collegeId: other.id, name: 'CSE-A' });
        expect(b.id).not.toBe(a.id);
        expect((await repos.sections.listByCollege(srm.id)).map((s) => s.name)).toEqual(['CSE-A']);
        await expect(repos.sections.ensure({ collegeId: 'missing', name: 'X' })).rejects.toMatchObject({ code: 'college_missing' });
      });

      test('memberships can be listed by college and role, and removed', async () => {
        const c1 = await repos.colleges.create({ name: 'One', slug: 'one' });
        const c2 = await repos.colleges.create({ name: 'Two', slug: 'two' });
        for (const id of ['u1', 'u2', 'u3']) await repos.users.create(user(id));
        await repos.memberships.add({ userId: 'u1', collegeId: c1.id, role: 'student' });
        await repos.memberships.add({ userId: 'u2', collegeId: c1.id, role: 'trainer' });
        await repos.memberships.add({ userId: 'u3', collegeId: c2.id, role: 'student' });
        await repos.memberships.add({ userId: 'u1', collegeId: null, role: 'platform_admin' });
        expect((await repos.memberships.listByCollege(c1.id)).map((m) => m.userId).sort()).toEqual(['u1', 'u2']);
        expect((await repos.memberships.listByCollege(c1.id, { role: 'trainer' })).map((m) => m.name)).toEqual(['User u2']);
        expect(await repos.memberships.remove({ userId: 'u1', collegeId: null, role: 'platform_admin' })).toBe(true);
        expect(await repos.memberships.remove({ userId: 'u1', collegeId: null, role: 'platform_admin' })).toBe(false);
        expect((await repos.memberships.forUser('u1')).map((m) => m.role)).toEqual(['student']);
      });

      test('the audit log records and filters entries, newest first', async () => {
        const c1 = await repos.colleges.create({ name: 'One', slug: 'one' });
        await repos.audit.record({ actorId: 'a1', actorRole: 'college_admin', action: 'college.import', collegeId: c1.id, meta: { rows: 3 } });
        await repos.audit.record({ actorId: 'a2', actorRole: 'platform_admin', action: 'college.create', entityType: 'college', entityId: c1.id });
        const all = await repos.audit.list();
        expect(all.map((r) => r.action)).toEqual(['college.create', 'college.import']);
        expect(all[1]).toMatchObject({ actorId: 'a1', collegeId: c1.id, meta: { rows: 3 } });
        expect((await repos.audit.list({ collegeId: c1.id })).map((r) => r.action)).toEqual(['college.import']);
        expect((await repos.audit.list({ actorId: 'a2' })).map((r) => r.action)).toEqual(['college.create']);
        expect(await repos.audit.list({ limit: 1 })).toHaveLength(1);
      });
    });

    describe('lab nodes and terminal tickets', () => {
      test('heartbeats create and refresh nodes; only recent, non-draining ones are healthy', async () => {
        await repos.nodes.heartbeat({ nodeId: 'a', baseUrl: 'http://a:7000', capacity: 50, running: 3, version: '1' });
        await repos.nodes.heartbeat({ nodeId: 'b', baseUrl: 'http://b:7000', capacity: 50, draining: true });
        await repos.nodes.heartbeat({ nodeId: 'a', baseUrl: 'http://a2:7000', capacity: 60, running: 5 });
        expect(await repos.nodes.get('a')).toMatchObject({ nodeId: 'a', baseUrl: 'http://a2:7000', capacity: 60, running: 5, draining: false });
        expect((await repos.nodes.get('a')).lastSeenAt).toBeGreaterThan(Date.now() - 5000);
        expect(await repos.nodes.get('zzz')).toBeNull();
        expect((await repos.nodes.list()).map((n) => n.nodeId)).toEqual(['a', 'b']);
        expect((await repos.nodes.listHealthy(60000)).map((n) => n.nodeId)).toEqual(['a']);
        await new Promise((r) => setTimeout(r, 30));
        expect(await repos.nodes.listHealthy(10)).toEqual([]);
        expect(await repos.nodes.remove('a')).toBe(true);
        expect(await repos.nodes.remove('a')).toBe(false);
      });

      test('a terminal ticket works once and only before it expires; deleting the session removes it', async () => {
        await repos.users.create(user('u1'));
        const s = { sessionId: 's1', engineId: 'e1', userId: 'u1', labId: 'x', createdAt: 1, lastActiveAt: 1, fromPool: false, history: [], strikes: 0 };
        await repos.sessions.upsert(s);
        await repos.tickets.create({ hash: 'h1', sessionId: 's1', userId: 'u1', expiresAt: Date.now() + 30000 });
        expect(await repos.tickets.redeem('h1')).toEqual({ sessionId: 's1', userId: 'u1' });
        expect(await repos.tickets.redeem('h1')).toBeNull();
        expect(await repos.tickets.redeem('never-issued')).toBeNull();

        await repos.tickets.create({ hash: 'h2', sessionId: 's1', userId: 'u1', expiresAt: Date.now() - 1000 });
        expect(await repos.tickets.redeem('h2')).toBeNull(); // expired tickets are consumed but refused
        await repos.tickets.create({ hash: 'h3', sessionId: 's1', userId: 'u1', expiresAt: Date.now() - 1000 });
        expect(await repos.tickets.prune()).toBe(1);

        await repos.tickets.create({ hash: 'h4', sessionId: 's1', userId: 'u1', expiresAt: Date.now() + 30000 });
        await repos.sessions.delete('s1');
        expect(await repos.tickets.redeem('h4')).toBeNull();
        await expect(repos.tickets.create({ hash: 'h5', sessionId: 'gone', userId: 'u1', expiresAt: Date.now() + 1000 })).rejects.toMatchObject({ code: 'session_missing' });
      });

      test('concurrent redemptions of one ticket: exactly one wins', async () => {
        await repos.users.create(user('u1'));
        await repos.sessions.upsert({ sessionId: 's1', engineId: 'e1', userId: 'u1', labId: 'x', createdAt: 1, lastActiveAt: 1, fromPool: false, history: [], strikes: 0 });
        await repos.tickets.create({ hash: 'race', sessionId: 's1', userId: 'u1', expiresAt: Date.now() + 30000 });
        const results = await Promise.all(Array.from({ length: 8 }, () => repos.tickets.redeem('race')));
        expect(results.filter(Boolean)).toHaveLength(1);
      });
    });

    describe('lab accounts', () => {
      const lab = (id, username, extra = {}) => ({ id, name: `Lab ${id}`, guest: false, emailVerified: false, createdAt: `2026-01-01T00:00:0${id.length % 9}.000Z`, username, labAccess: true, password: '$2a$10$hash', ...extra });

      test('an account with a lab ID needs no email; lab IDs are unique and case-insensitive', async () => {
        await repos.users.create(lab('l1', 'srm-001'));
        expect(await repos.users.getByUsername('srm-001')).toMatchObject({ id: 'l1', username: 'srm-001', labAccess: true });
        expect(await repos.users.getByUsername('SRM-001')).toMatchObject({ id: 'l1' });
        expect(await repos.users.getByUsername('nobody')).toBeNull();
        await expect(repos.users.create(lab('l2', 'srm-001'))).rejects.toMatchObject({ code: 'username_taken' });
        const updated = await repos.users.update('l1', { disabled: true, labAccess: false });
        expect(updated).toMatchObject({ disabled: true });
        expect(updated.labAccess).toBeFalsy();
      });

      test('lists lab accounts with a search, and finds the next number for a prefix', async () => {
        await repos.users.create(user('t1')); // a theory account: not a lab account
        for (const n of [1, 2, 10]) await repos.users.create(lab(`id${n}`, `srm-${String(n).padStart(3, '0')}`));
        await repos.users.create(lab('other', 'iit-007'));
        const all = await repos.users.listLabAccounts({});
        expect(all.total).toBe(4);
        expect(all.rows.map((u) => u.username).sort()).toEqual(['iit-007', 'srm-001', 'srm-002', 'srm-010']);
        expect((await repos.users.listLabAccounts({ search: 'srm' })).total).toBe(3);
        expect((await repos.users.listLabAccounts({ search: 'srm', limit: 2, offset: 2 })).rows).toHaveLength(1);
        expect(await repos.users.maxUsernameSequence('srm')).toBe(10);
        expect(await repos.users.maxUsernameSequence('iit')).toBe(7);
        expect(await repos.users.maxUsernameSequence('new')).toBe(0);
      });
    });

    describe('slots, assignments and blackouts', () => {
      let college;
      let section;
      const HOUR = 3600000;
      const t0 = Date.UTC(2026, 10, 7, 4, 30); // a Saturday, 10:00 IST
      beforeEach(async () => {
        college = await repos.colleges.create({ name: 'SRM', slug: 'srm' });
        section = await repos.sections.ensure({ collegeId: college.id, name: 'CSE-A' });
      });

      test('templates are stored, changed and removed; blackout dates are unique per college', async () => {
        const tpl = await repos.slots.createTemplate({ collegeId: college.id, sectionId: section.id, weekday: 6, startTime: '10:00', durationMinutes: 90, seats: 40, makeup: false });
        expect(tpl).toMatchObject({ weekday: 6, startTime: '10:00', durationMinutes: 90, seats: 40, active: true, sectionId: section.id });
        expect((await repos.slots.listTemplates(college.id)).map((t) => t.id)).toEqual([tpl.id]);
        expect(await repos.slots.updateTemplate(tpl.id, { active: false, seats: 30 })).toMatchObject({ active: false, seats: 30 });
        expect(await repos.slots.updateTemplate('nope', { active: false })).toBeNull();

        const first = await repos.slots.addBlackout({ collegeId: college.id, onDate: '2026-12-25', reason: 'Holiday' });
        const again = await repos.slots.addBlackout({ collegeId: college.id, onDate: '2026-12-25', reason: 'Christmas' });
        expect(again.id).toBe(first.id);
        expect((await repos.slots.listBlackouts(college.id)).map((b) => [b.onDate, b.reason])).toEqual([['2026-12-25', 'Christmas']]);
        expect(await repos.slots.removeBlackout('other-college', first.id)).toBe(false);
        expect(await repos.slots.removeBlackout(college.id, first.id)).toBe(true);
        expect(await repos.slots.deleteTemplate(tpl.id)).toBe(true);
      });

      test('generating slots twice from one template creates each slot once; slots can be listed by time', async () => {
        const tpl = await repos.slots.createTemplate({ collegeId: college.id, weekday: 6, startTime: '10:00', durationMinutes: 90, seats: 40 });
        const rows = [0, 7].map((d) => ({ collegeId: college.id, startsAt: t0 + d * 24 * HOUR, endsAt: t0 + d * 24 * HOUR + 1.5 * HOUR, capacity: 40, templateId: tpl.id }));
        expect(await repos.slots.createSlots(rows)).toBe(2);
        expect(await repos.slots.createSlots(rows)).toBe(0);
        const slots = await repos.slots.listSlots({ collegeId: college.id, from: t0 - HOUR, to: t0 + 2 * HOUR });
        expect(slots).toHaveLength(1);
        expect(slots[0]).toMatchObject({ collegeId: college.id, capacity: 40, templateId: tpl.id, startsAt: t0, endsAt: t0 + 1.5 * HOUR, makeup: false });
        expect(await repos.slots.listSlots({ from: t0, to: t0 + 30 * 24 * HOUR })).toHaveLength(2);
        expect(await repos.slots.listSlots({ collegeId: 'other', from: t0, to: t0 + 30 * 24 * HOUR })).toEqual([]);
        expect(await repos.slots.getSlot(slots[0].id)).toMatchObject({ id: slots[0].id });
        expect(await repos.slots.getSlot('nope')).toBeNull();
      });

      test('assignments add or remove a student from a slot and can be listed', async () => {
        await repos.users.create(user('s1'));
        await repos.slots.createSlots([{ collegeId: college.id, startsAt: t0, endsAt: t0 + HOUR, capacity: 5 }]);
        const [slot] = await repos.slots.listSlots({ from: t0 - HOUR, to: t0 + 2 * HOUR });
        await repos.slots.setAssignment({ slotId: slot.id, userId: 's1', kind: 'add' });
        await repos.slots.setAssignment({ slotId: slot.id, userId: 's1', kind: 'remove' });
        expect(await repos.slots.listAssignments(slot.id)).toMatchObject([{ userId: 's1', kind: 'remove', name: 'User s1' }]);
        expect(await repos.slots.assignmentsForUser('s1')).toMatchObject([{ slotId: slot.id, kind: 'remove' }]);
        expect(await repos.slots.removeAssignment(slot.id, 's1')).toBe(true);
        expect(await repos.slots.removeAssignment(slot.id, 's1')).toBe(false);
        expect(await repos.slots.deleteSlot(slot.id)).toBe(true);
      });

      test('sessions remember their slot', async () => {
        await repos.users.create(user('s1'));
        await repos.slots.createSlots([{ collegeId: college.id, startsAt: t0, endsAt: t0 + HOUR, capacity: 5 }]);
        const [slot] = await repos.slots.listSlots({ from: t0 - HOUR, to: t0 + 2 * HOUR });
        await repos.sessions.upsert({ sessionId: 'x1', engineId: 'e1', userId: 's1', labId: 'l', slotId: slot.id, createdAt: 1, lastActiveAt: 1, fromPool: false, history: [], strikes: 0 });
        await repos.sessions.upsert({ sessionId: 'x2', engineId: 'e2', userId: 's1', labId: 'l', createdAt: 1, lastActiveAt: 1, fromPool: false, history: [], strikes: 0 });
        expect(await repos.sessions.countBySlot(slot.id)).toBe(1);
        expect((await repos.sessions.get('x1')).slotId).toBe(slot.id);
      });
    });

    describe('the lab queue', () => {
      let slot;
      beforeEach(async () => {
        for (const id of ['a', 'b', 'c', 'd']) await repos.users.create(user(id));
        const college = await repos.colleges.create({ name: 'SRM', slug: 'srm' });
        await repos.slots.createSlots([{ collegeId: college.id, startsAt: 1_800_000_000_000, endsAt: 1_800_003_600_000, capacity: 2 }]);
        [slot] = await repos.slots.listSlots({ from: 1_700_000_000_000, to: 1_900_000_000_000 });
      });

      test('waiters get positions in order; a person waits only once; leaving frees the place', async () => {
        const a = await repos.queue.enqueue({ userId: 'a', slotId: slot.id });
        const b = await repos.queue.enqueue({ userId: 'b', slotId: slot.id });
        const g = await repos.queue.enqueue({ userId: 'c' }); // a different scope: anywhere
        expect([await repos.queue.position(a), await repos.queue.position(b), await repos.queue.position(g)]).toEqual([1, 2, 1]);
        await expect(repos.queue.enqueue({ userId: 'a', slotId: slot.id })).rejects.toMatchObject({ code: 'already_queued' });
        expect(await repos.queue.waitingCount(slot.id)).toBe(2);
        expect(await repos.queue.getOpen('a')).toMatchObject({ status: 'waiting', slotId: slot.id });
        expect(await repos.queue.cancel('a')).toBe(true);
        expect(await repos.queue.cancel('a')).toBe(false);
        expect(await repos.queue.position(b)).toBe(1);
        expect(await repos.queue.getOpen('a')).toBeNull();
        await repos.queue.enqueue({ userId: 'a', slotId: slot.id }); // can join again
      });

      test('admission takes the longest-waiting first, holds the seat, and lets go of unclaimed seats', async () => {
        await repos.queue.enqueue({ userId: 'a', slotId: slot.id });
        await repos.queue.enqueue({ userId: 'b', slotId: slot.id });
        await repos.queue.enqueue({ userId: 'c', slotId: slot.id });
        const admitted = await repos.queue.admit({ slotId: slot.id, limit: 2, ttlMs: 60000 });
        expect(admitted.map((r) => r.userId)).toEqual(['a', 'b']);
        expect(admitted[0]).toMatchObject({ status: 'admitted' });
        expect(admitted[0].expiresAt).toBeGreaterThan(Date.now());
        expect(await repos.queue.countHeld(slot.id)).toBe(2);
        expect(await repos.queue.admit({ slotId: slot.id, limit: 0, ttlMs: 1 })).toEqual([]);

        const started = await repos.queue.getOpen('a');
        await repos.queue.markStarted(started.id, 'sess-1');
        expect(await repos.queue.getOpen('a')).toBeNull();
        expect(await repos.queue.attendedSlots('a', [slot.id])).toEqual([slot.id]);
        expect(await repos.queue.attendedSlots('b', [slot.id])).toEqual([]);
        expect(await repos.queue.countHeld(slot.id)).toBe(1);

        // b never claims its seat
        expect(await repos.queue.expire({ now: Date.now() + 120000, waitingStaleMs: 10 * 60000 })).toBeGreaterThanOrEqual(1);
        expect(await repos.queue.countHeld(slot.id)).toBe(0);
        expect(await repos.queue.getOpen('b')).toBeNull();
      });

      test('waiters who stop checking in expire; reserve takes a seat at once', async () => {
        const w = await repos.queue.enqueue({ userId: 'a', slotId: slot.id });
        await new Promise((r) => setTimeout(r, 20));
        await repos.queue.touch(w.id);
        expect(await repos.queue.expire({ now: Date.now(), waitingStaleMs: 5000 })).toBe(0);
        expect(await repos.queue.expire({ now: Date.now() + 10000, waitingStaleMs: 5000 })).toBe(1);
        const r = await repos.queue.reserve({ userId: 'b', slotId: slot.id, ttlMs: 30000 });
        expect(r).toMatchObject({ status: 'admitted', userId: 'b' });
        expect(await repos.queue.countHeld(slot.id)).toBe(1);
        await expect(repos.queue.reserve({ userId: 'b', slotId: slot.id, ttlMs: 30000 })).rejects.toMatchObject({ code: 'already_queued' });
        expect(await repos.queue.scopesWaiting()).toEqual([]);
      });

      test('concurrent admissions never admit the same waiter twice or exceed the limit', async () => {
        for (const id of ['a', 'b', 'c', 'd']) await repos.queue.enqueue({ userId: id, slotId: slot.id });
        const results = await Promise.all([1, 2, 3].map(() => repos.queue.admit({ slotId: slot.id, limit: 2, ttlMs: 60000 })));
        const users = results.flat().map((r) => r.userId);
        expect(new Set(users).size).toBe(users.length);
        expect(users.length).toBeLessThanOrEqual(4);
        expect(await repos.queue.countHeld(slot.id)).toBe(users.length);
      });
    });

    describe('seat accounting', () => {
      let slot;
      beforeEach(async () => {
        for (const id of ['a', 'b', 'c', 'd', 'e']) await repos.users.create(user(id));
        const college = await repos.colleges.create({ name: 'SRM', slug: 'srm' });
        await repos.slots.createSlots([{ collegeId: college.id, startsAt: 1_800_000_000_000, endsAt: 1_800_003_600_000, capacity: 2 }]);
        [slot] = await repos.slots.listSlots({ from: 1_700_000_000_000, to: 1_900_000_000_000 });
      });
      const take = (userId, extra = {}) => repos.queue.reserveSeat({ userId, slotId: slot.id, slotCapacity: 2, clusterCapacity: 10, ttlMs: 60000, ...extra });

      test('a slot never hands out more seats than it has, counting running sessions and held seats', async () => {
        expect(await take('a')).toMatchObject({ status: 'admitted' });
        await repos.sessions.upsert({ sessionId: 's1', engineId: 'e1', userId: 'b', labId: 'l', slotId: slot.id, createdAt: 1, lastActiveAt: 1, fromPool: false, history: [], strikes: 0 });
        expect(await repos.queue.seatUsage(slot.id)).toEqual({ slot: 2, cluster: 2 });
        expect(await take('c')).toBeNull(); // 1 held + 1 running = the slot's 2 seats
        await repos.queue.cancel('a');
        expect(await take('c')).toMatchObject({ userId: 'c' });
      });

      test('the whole cluster is also a limit', async () => {
        expect(await take('a', { clusterCapacity: 1 })).not.toBeNull();
        expect(await take('b', { clusterCapacity: 1 })).toBeNull();
        expect(await repos.queue.reserveSeat({ userId: 'b', slotId: null, clusterCapacity: 1, ttlMs: 1000 })).toBeNull();
        expect(await repos.queue.reserveSeat({ userId: 'b', slotId: null, clusterCapacity: 2, ttlMs: 1000 })).not.toBeNull();
      });

      test('simultaneous requests for the last seats never exceed the limit', async () => {
        const results = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => take(id)));
        expect(results.filter(Boolean)).toHaveLength(2);
        expect(await repos.queue.seatUsage(slot.id)).toEqual({ slot: 2, cluster: 2 });
      });

      test('admission fills only the seats that are free, oldest first', async () => {
        for (const id of ['a', 'b', 'c', 'd']) await repos.queue.enqueue({ userId: id, slotId: slot.id });
        const first = await repos.queue.admitSeats({ slotId: slot.id, slotCapacity: 2, clusterCapacity: 10, ttlMs: 60000 });
        expect(first.map((r) => r.userId)).toEqual(['a', 'b']);
        expect(await repos.queue.admitSeats({ slotId: slot.id, slotCapacity: 2, clusterCapacity: 10, ttlMs: 60000 })).toEqual([]);
        await repos.queue.cancel('a');
        const next = await repos.queue.admitSeats({ slotId: slot.id, slotCapacity: 2, clusterCapacity: 10, ttlMs: 60000 });
        expect(next.map((r) => r.userId)).toEqual(['c']);
        // a smaller cluster limit holds the rest back too
        await repos.queue.cancel('b');
        expect(await repos.queue.admitSeats({ slotId: slot.id, slotCapacity: 2, clusterCapacity: 1, ttlMs: 60000 })).toEqual([]);
      });

      test('concurrent admitters (several gateways) never admit past the limit or the same person twice', async () => {
        for (const id of ['a', 'b', 'c', 'd', 'e']) await repos.queue.enqueue({ userId: id, slotId: slot.id });
        const runs = await Promise.all([1, 2, 3, 4].map(() => repos.queue.admitSeats({ slotId: slot.id, slotCapacity: 2, clusterCapacity: 10, ttlMs: 60000 })));
        const ids = runs.flat().map((r) => r.userId);
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
      });
    });

    describe('lab analytics events', () => {
      test('counts events per name and step', async () => {
        const now = Date.now();
        await repos.events.record({ name: 'transition_step', userId: 'u', props: { step: 'slot_check', ok: true } });
        await repos.events.record({ name: 'transition_step', userId: 'u', props: { step: 'slot_check', ok: true } });
        await repos.events.record({ name: 'transition_step', userId: 'u', props: { step: 'reserve', ok: false } });
        await repos.events.record({ name: 'switch_to_lab' });
        const rows = await repos.events.funnel({ from: now - 1000, to: now + 60000 });
        const pick = (name, step) => rows.find((r) => r.name === name && r.step === step);
        expect(pick('transition_step', 'slot_check')).toMatchObject({ ok: 'true', count: 2 });
        expect(pick('transition_step', 'reserve')).toMatchObject({ ok: 'false', count: 1 });
        expect(rows.find((r) => r.name === 'switch_to_lab').count).toBe(1);
        expect(await repos.events.funnel({ from: now + 60000, to: now + 120000 })).toEqual([]);
      });
    });

    describe('identities', () => {
      test('links an external identity to an app user and finds it again', async () => {
        await repos.users.create(user('u1'));
        expect(await repos.identities.getUserId('supabase', 'sub-1')).toBeNull();
        await repos.identities.link({ subject: 'sub-1', userId: 'u1' });
        await repos.identities.link({ subject: 'sub-1', userId: 'u1' }); // idempotent
        expect(await repos.identities.getUserId('supabase', 'sub-1')).toBe('u1');
        await expect(repos.identities.link({ subject: 'sub-2', userId: 'nobody' })).rejects.toBeTruthy();
      });

      test('lists the accounts that still need moving to Supabase', async () => {
        await repos.users.create(user('with-pw', { password: '$2a$10$hash' }));
        await repos.users.create(user('linked', { password: '$2a$10$hash2' }));
        await repos.users.create(user('no-pw'));
        await repos.users.create(guest('g1'));
        await repos.identities.link({ subject: 'sub-x', userId: 'linked' });
        expect((await repos.users.listForAuthMigration()).map((u) => u.id)).toEqual(['with-pw']);
      });
    });

    describe('invites and shared rate limits', () => {
      test('an invite becomes a membership when the invited email signs in, once', async () => {
        const college = await repos.colleges.create({ name: 'One', slug: 'one' });
        const section = await repos.sections.ensure({ collegeId: college.id, name: 'CSE-A' });
        await repos.invites.add({ collegeId: college.id, sectionId: section.id, email: 'ada@example.com' });
        await repos.invites.add({ collegeId: college.id, sectionId: null, email: 'ada@example.com' }); // same invite, updated
        await repos.invites.add({ collegeId: college.id, email: 'bob@example.com' });
        expect(await repos.invites.listByCollege(college.id)).toHaveLength(2);

        await repos.users.create(user('u1', { email: 'ada@example.com' }));
        expect(await repos.invites.claim('u1', 'ada@example.com')).toBe(1);
        expect(await repos.invites.claim('u1', 'ada@example.com')).toBe(0);
        expect(await repos.memberships.forUser('u1')).toMatchObject([{ collegeId: college.id, role: 'student' }]);
        expect(await repos.invites.listByCollege(college.id)).toHaveLength(1);
      });

      test('rate-limit counters count within a window and start over after it', async () => {
        expect((await repos.rateLimits.hit('ip:1', 60000)).hits).toBe(1);
        const second = await repos.rateLimits.hit('ip:1', 60000);
        expect(second.hits).toBe(2);
        expect(second.resetAt).toBeGreaterThan(Date.now());
        expect((await repos.rateLimits.hit('ip:2', 60000)).hits).toBe(1);
        await repos.rateLimits.decrement('ip:1');
        expect((await repos.rateLimits.hit('ip:1', 60000)).hits).toBe(2);
        await repos.rateLimits.reset('ip:1');
        expect((await repos.rateLimits.hit('ip:1', 60000)).hits).toBe(1);
        await new Promise((r) => setTimeout(r, 30));
        expect((await repos.rateLimits.hit('short', 10)).hits).toBe(1);
        await new Promise((r) => setTimeout(r, 30));
        expect(await repos.rateLimits.prune()).toBeGreaterThanOrEqual(1);
        expect((await repos.rateLimits.hit('short', 10)).hits).toBe(1);
      });
    });

    describe('certificates', () => {
      const cert = (id, extra = {}) => ({ id, userId: 'u1', studentName: 'Ada', unitId: 'linux', unitTitle: 'Linux', score: 90, issuedAt: '2026-11-05T10:20:30.123Z', signature: 'sig', ...extra });
      beforeEach(() => repos.users.create(user('u1')));

      test('stores a certificate and returns it intact (including the signed timestamp)', async () => {
        expect(await repos.certificates.create(cert('OPS-0123456789AB'))).toEqual(cert('OPS-0123456789AB'));
        expect(await repos.certificates.getById('OPS-0123456789AB')).toEqual(cert('OPS-0123456789AB'));
        expect(await repos.certificates.getById('OPS-FFFFFFFFFFFF')).toBeNull();
      });

      test('one certificate per learner and unit: a second create returns the first', async () => {
        await repos.certificates.create(cert('OPS-0123456789AB'));
        const again = await repos.certificates.create(cert('OPS-AAAAAAAAAAAA', { score: 10 }));
        expect(again.id).toBe('OPS-0123456789AB');
        expect(await repos.certificates.count()).toBe(1);
        expect((await repos.certificates.getForUnit('u1', 'linux')).id).toBe('OPS-0123456789AB');
        expect(await repos.certificates.getForUnit('u1', 'docker')).toBeNull();
      });

      test('lists a learner\'s certificates and refuses unknown users', async () => {
        await repos.certificates.create(cert('OPS-0123456789AB'));
        await repos.certificates.create(cert('OPS-BBBBBBBBBBBB', { unitId: 'docker', issuedAt: '2026-11-06T00:00:00.000Z' }));
        expect((await repos.certificates.listForUser('u1')).map((c) => c.unitId)).toEqual(['linux', 'docker']);
        await expect(repos.certificates.create(cert('OPS-CCCCCCCCCCCC', { userId: 'ghost' }))).rejects.toBeInstanceOf(Error);
      });
    });

    describe('sessions', () => {
      beforeEach(() => repos.users.create(user('u1')));
      const session = (id, extra = {}) => ({ sessionId: id, engineId: `eng-${id}`, userId: 'u1', labId: 'linux-basics', createdAt: 1_800_000_000_000, lastActiveAt: 1_800_000_001_000, fromPool: true, claimMs: 12.5, history: [{ command: 'ls', at: 1 }], strikes: 1, ...extra });

      test('upsert inserts then updates activity, history and strikes', async () => {
        await repos.sessions.upsert(session('s1'));
        await repos.sessions.upsert(session('s1', { lastActiveAt: 1_800_000_009_000, history: [{ command: 'ls', at: 1 }, { command: 'pwd', at: 2 }], strikes: 2 }));
        const all = await repos.sessions.all();
        expect(all).toHaveLength(1);
        expect(all[0]).toMatchObject({ sessionId: 's1', engineId: 'eng-s1', userId: 'u1', labId: 'linux-basics', createdAt: 1_800_000_000_000, lastActiveAt: 1_800_000_009_000, fromPool: true, claimMs: 12.5, strikes: 2 });
        expect(all[0].history).toHaveLength(2);
      });

      test('the registry answers by id, owner, node and count', async () => {
        await repos.users.create(user('u2'));
        await repos.sessions.upsert(session('s1', { nodeId: 'node-a' }));
        await repos.sessions.upsert(session('s2', { nodeId: 'node-b', createdAt: 1_800_000_000_500 }));
        await repos.sessions.upsert(session('s3', { userId: 'u2' }));
        expect(await repos.sessions.get('s1')).toMatchObject({ sessionId: 's1', engineId: 'eng-s1', nodeId: 'node-a', userId: 'u1' });
        expect(await repos.sessions.get('nope')).toBeNull();
        expect((await repos.sessions.listByUser('u1')).map((s) => s.sessionId).sort()).toEqual(['s1', 's2']);
        expect((await repos.sessions.listByNode('node-b')).map((s) => s.sessionId)).toEqual(['s2']);
        expect(await repos.sessions.count()).toBe(3);
        expect(await repos.sessions.countByUser('u1')).toBe(2);
        expect(await repos.sessions.countByUser('ghost')).toBe(0);
      });

      test('activity moves forward only; commands append to a capped list; strikes count atomically', async () => {
        await repos.sessions.upsert(session('s1', { history: [], strikes: 0 }));
        await repos.sessions.touch('s1', 1_800_000_005_000);
        await repos.sessions.touch('s1', 1_800_000_002_000);
        expect((await repos.sessions.get('s1')).lastActiveAt).toBe(1_800_000_005_000);

        for (const c of ['a', 'b', 'c', 'd']) await repos.sessions.appendCommand('s1', { command: c, at: 1 }, 3);
        expect((await repos.sessions.get('s1')).history.map((h) => h.command)).toEqual(['b', 'c', 'd']);
        await repos.sessions.clearHistory('s1');
        expect((await repos.sessions.get('s1')).history).toEqual([]);

        expect(await Promise.all([repos.sessions.addStrike('s1'), repos.sessions.addStrike('s1')]).then((r) => r.sort())).toEqual([1, 2]);
        expect(await repos.sessions.addStrike('nope')).toBe(0);
        // an upsert from a stale writer cannot lower activity or strikes
        await repos.sessions.upsert(session('s1', { lastActiveAt: 1_800_000_000_001, strikes: 0, history: [] }));
        expect(await repos.sessions.get('s1')).toMatchObject({ lastActiveAt: 1_800_000_005_000, strikes: 2 });
      });

      test('lists sessions past their age or idle limit', async () => {
        await repos.sessions.upsert(session('old', { createdAt: 1000, lastActiveAt: 1_800_000_900_000 }));
        await repos.sessions.upsert(session('idle', { createdAt: 1_800_000_000_000, lastActiveAt: 2000 }));
        await repos.sessions.upsert(session('fresh', { createdAt: 1_800_000_000_000, lastActiveAt: 1_800_000_900_000 }));
        const expired = await repos.sessions.listExpired({ createdBefore: 5000, activeBefore: 5000 });
        expect(expired.map((s) => s.sessionId).sort()).toEqual(['idle', 'old']);
      });

      test('delete reports whether a session existed; unknown users are refused', async () => {
        await repos.sessions.upsert(session('s1'));
        expect(await repos.sessions.delete('s1')).toBe(true);
        expect(await repos.sessions.delete('s1')).toBe(false);
        await expect(repos.sessions.upsert(session('s2', { userId: 'ghost' }))).rejects.toBeInstanceOf(Error);
      });
    });

    test('ping works and RepoError carries a code', async () => {
      expect(await repos.ping()).toBe(true);
      expect(new RepoError('x', 'y').code).toBe('x');
    });

    test('jobs.withLock runs the function', async () => {
      const out = await repos.jobs.withLock('test-job', async () => 42);
      expect(out.ran === undefined ? out : out.result).toBe(42);
    });
  });
}

module.exports = { runContract };
