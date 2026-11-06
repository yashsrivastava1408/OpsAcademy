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
