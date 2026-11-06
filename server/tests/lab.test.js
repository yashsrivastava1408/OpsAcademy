/**
 * Phase 4: lab accounts, who may enter the lab (policy), slots, the queue and capacity planning.
 */
const request = require('supertest');
const config = require('../config');
const { createApp } = require('../app');
const { install, fakeEngine } = require('./helpers');
const { getRepos } = require('../repositories');
const labAccountService = require('../services/labAccountService');
const labService = require('../services/labService');
const slotService = require('../services/slotService');
const { dropCached } = require('../routes/labPortalRoutes');

const MIN = 60000;
let app;
let ctx;

function setup(limits = {}) {
  ctx = install({ engine: fakeEngine(), limits: { maxPerUser: 3, ...limits } });
  app = createApp();
}
beforeEach(() => { config.labPolicy = 'open'; setup(); });
afterEach(async () => { config.labPolicy = 'open'; await ctx.manager.shutdown(); });

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function registered() {
  const email = `t${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ name: 'Theory Learner', email, password: 'correct-horse' });
  return { user: res.body.user, auth: bearer(res.body.token) };
}
async function guest() {
  const res = await request(app).post('/api/auth/guest');
  return { user: res.body.user, auth: bearer(res.body.token) };
}
async function admin() {
  const who = await registered();
  await getRepos().memberships.add({ userId: who.user.id, collegeId: null, role: 'platform_admin' });
  return who;
}
/** Make a lab account and sign it in with its ID and password, like the Lab login screen. */
async function labStudent(prefix = 'lab', extra = {}) {
  const [made] = await labAccountService.generate({ prefix, count: 1 });
  const login = await request(app).post('/api/auth/login').send({ id: made.username, password: made.password });
  return { ...made, user: login.body.user, auth: bearer(login.body.token), loginStatus: login.status, ...extra };
}
const start = (who, labId = 'linux-basics') => request(app).post('/api/sandbox/start').set(who.auth).send({ labId });

async function college(name = 'SRM', slug = 'srm') {
  const c = await getRepos().colleges.create({ name, slug });
  const s = await getRepos().sections.ensure({ collegeId: c.id, name: 'CSE-A' });
  return { college: c, section: s };
}
async function member(who, collegeId, sectionId, role = 'student') {
  await getRepos().memberships.add({ userId: who.user.id, collegeId, sectionId, role });
}
async function slotNow(collegeId, { sectionId = null, capacity = 5, startOffset = -10 * MIN, length = 60 * MIN, makeup = false } = {}) {
  const startsAt = Date.now() + startOffset;
  await getRepos().slots.createSlots([{ collegeId, sectionId, startsAt, endsAt: startsAt + length, capacity, makeup }]);
  return (await getRepos().slots.listSlots({ collegeId, from: startsAt - 1, to: startsAt + length + 1 })).find((s) => s.startsAt === startsAt);
}

describe('lab accounts', () => {
  test('only a platform admin generates accounts; passwords come back once and are never stored or listed in the clear', async () => {
    const student = await registered();
    expect((await request(app).post('/api/admin/lab-accounts').set(student.auth).send({ prefix: 'srm', count: 2 })).status).toBe(403);
    const boss = await admin();
    const res = await request(app).post('/api/admin/lab-accounts').set(boss.auth).send({ prefix: 'SRM-CSE', count: 3 });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.map((a) => a.username)).toEqual(['srm-cse-0001', 'srm-cse-0002', 'srm-cse-0003']);
    expect(res.body.data[0].password).toMatch(/^[A-HJ-KM-NP-Za-km-np-z2-9]{12}$/);
    expect(new Set(res.body.data.map((a) => a.password)).size).toBe(3);

    const stored = await getRepos().users.getByUsername('srm-cse-0001');
    expect(stored.password).toMatch(/^\$2[aby]\$/);
    expect(stored.password).not.toContain(res.body.data[0].password);
    const list = await request(app).get('/api/admin/lab-accounts').set(boss.auth);
    expect(list.body.data.total).toBe(3);
    expect(JSON.stringify(list.body)).not.toMatch(/password|\$2[aby]\$/);

    // numbering continues after the highest existing number; names can be given
    const more = await request(app).post('/api/admin/lab-accounts').set(boss.auth).send({ prefix: 'srm-cse', names: ['Asha Rao', 'Bob Nair'] });
    expect(more.body.data.map((a) => [a.username, a.name])).toEqual([['srm-cse-0004', 'Asha Rao'], ['srm-cse-0005', 'Bob Nair']]);
    expect((await request(app).get('/api/admin/lab-accounts?search=asha').set(boss.auth)).body.data.accounts.map((a) => a.name)).toEqual(['Asha Rao']);

    const trail = (await request(app).get('/api/admin/audit').set(boss.auth)).body.data;
    expect(trail.filter((r) => r.action === 'lab_accounts.generate')).toHaveLength(2);
    expect(JSON.stringify(trail)).not.toContain(res.body.data[0].password);
  });

  test('bad requests are refused', async () => {
    const boss = await admin();
    const post = (body) => request(app).post('/api/admin/lab-accounts').set(boss.auth).send(body);
    expect((await post({ prefix: 'x', count: 2 })).status).toBe(400);
    expect((await post({ prefix: 'bad prefix!', count: 2 })).status).toBe(400);
    expect((await post({ prefix: 'srm', count: 0 })).status).toBe(400);
    expect((await post({ prefix: 'srm', count: 101 })).status).toBe(400);
    expect((await post({ prefix: 'srm', names: 'nope' })).status).toBe(400);
  });

  test('a lab account signs in with its ID, not an email; wrong passwords and unknown IDs get the same refusal', async () => {
    const lab = await labStudent('srm');
    expect(lab.loginStatus).toBe(200);
    expect(lab.user).toMatchObject({ username: lab.username, labAccess: true, guest: false, email: null });
    const wrong = await request(app).post('/api/auth/login').send({ id: lab.username, password: 'not-the-password' });
    const unknown = await request(app).post('/api/auth/login').send({ id: 'nobody-0001', password: lab.password });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body.error).toBe(unknown.body.error);
    expect((await request(app).post('/api/auth/login').send({ id: lab.username.toUpperCase(), password: lab.password })).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(lab.auth)).body.user.username).toBe(lab.username);
  });

  test('resetting a password gives a new one once; the old one and old sessions stop working', async () => {
    const boss = await admin();
    const lab = await labStudent('srm');
    const reset = await request(app).post(`/api/admin/lab-accounts/${lab.user.id}/reset-password`).set(boss.auth);
    expect(reset.status).toBe(200);
    expect(reset.body.data.password).not.toBe(lab.password);
    expect((await request(app).post('/api/auth/login').send({ id: lab.username, password: lab.password })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ id: lab.username, password: reset.body.data.password })).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(lab.auth)).status).toBe(401); // the old session is gone
    expect((await request(app).post('/api/admin/lab-accounts/nope/reset-password').set(boss.auth)).status).toBe(404);
    expect((await request(app).post(`/api/admin/lab-accounts/${(await registered()).user.id}/reset-password`).set(boss.auth)).status).toBe(404); // not a lab account
  });

  test('disabling an account blocks sign-in, ends its session and sandboxes, and can be undone', async () => {
    const boss = await admin();
    const lab = await labStudent('srm');
    const sandbox = await start(lab);
    expect(sandbox.status).toBe(201);
    const off = await request(app).post(`/api/admin/lab-accounts/${lab.user.id}/disable`).set(boss.auth);
    expect(off.body).toMatchObject({ success: true, sandboxesClosed: 1, data: { disabled: true } });
    expect(await ctx.manager.getSession(sandbox.body.data.sessionId)).toBeNull();
    expect((await request(app).get('/api/auth/me').set(lab.auth)).status).toBe(401);
    const again = await request(app).post('/api/auth/login').send({ id: lab.username, password: lab.password });
    expect(again.status).toBe(403);
    expect(again.body.error).toMatch(/disabled/);
    await request(app).post(`/api/admin/lab-accounts/${lab.user.id}/enable`).set(boss.auth);
    expect((await request(app).post('/api/auth/login').send({ id: lab.username, password: lab.password })).status).toBe(200);
  });

  test('generated passwords are random and unambiguous', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const p = labAccountService.generatePassword();
      expect(p).toMatch(/^[A-HJ-KM-NP-Za-km-np-z2-9]{12}$/);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe('who may start a lab (policy)', () => {
  test('open (the default): guests, theory accounts and lab accounts can all start', async () => {
    expect((await start(await guest())).status).toBe(201);
    expect((await start(await registered())).status).toBe(201);
    expect((await start(await labStudent())).status).toBe(201);
    expect((await request(app).get('/api/lab/availability').set((await guest()).auth)).body.data.state).toBe('open');
  });

  test('accounts: only lab accounts and platform admins; the refusal says why', async () => {
    config.labPolicy = 'accounts';
    const g = await start(await guest());
    expect(g.status).toBe(403);
    expect(g.body).toMatchObject({ code: 'lab_account_required', error: expect.stringMatching(/Lab ID/), state: { state: 'blocked', reason: 'lab_account_required' } });
    expect((await start(await registered())).status).toBe(403);
    expect((await start(await labStudent())).status).toBe(201);
    expect((await start(await admin())).status).toBe(201);
    const avail = await request(app).get('/api/lab/availability').set((await registered()).auth);
    expect(avail.body.data).toMatchObject({ state: 'blocked', reason: 'lab_account_required' });
  });

  test('an account that is switched off is refused even with a valid session', async () => {
    config.labPolicy = 'accounts';
    const lab = await labStudent();
    await getRepos().users.update(lab.user.id, { disabled: true });
    require('../middleware/rbac').forgetAccess(lab.user.id);
    const res = await start(lab);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_disabled');
  });

  test('a lab account that already has a sandbox simply resumes it', async () => {
    config.labPolicy = 'accounts';
    const lab = await labStudent();
    const first = await start(lab);
    const again = await start(lab);
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ resumed: true, sessionId: first.body.data.sessionId });
    expect((await request(app).get('/api/lab/availability').set(lab.auth)).body.data).toMatchObject({ state: 'running', sessionId: first.body.data.sessionId });
  });
});

describe('the queue', () => {
  beforeEach(async () => {
    await ctx.manager.shutdown();
    setup({ maxTotal: 2, maxPerUser: 3 });
    config.labPolicy = 'accounts';
  });

  test('when the lab is full learners wait in order with a position, and are admitted as seats free up', async () => {
    const [a, b, c, d] = [await labStudent(), await labStudent(), await labStudent(), await labStudent()];
    expect((await start(a)).status).toBe(201);
    expect((await start(b)).status).toBe(201);

    const full = await request(app).get('/api/lab/availability').set(c.auth);
    expect(full.body.data).toMatchObject({ state: 'full', queue: { position: 1, waiting: 0 } });
    const joined = await start(c);
    expect(joined.status).toBe(409);
    expect(joined.body).toMatchObject({ code: 'queued', state: { state: 'queued', queue: { position: 1 } } });
    expect((await start(d)).body.state.queue.position).toBe(2);
    expect((await request(app).get('/api/lab/availability').set(c.auth)).body.data).toMatchObject({ state: 'queued', queue: { position: 1, waiting: 2, estimatedWaitMinutes: expect.any(Number) } });

    // nobody is admitted while the lab is full
    expect(await labService.admitWaiting()).toMatchObject({ admitted: 0 });
    // a seat frees up: the first in line is admitted, not the second
    await request(app).delete(`/api/sandbox/${(await ctx.manager.listSessions())[0].sessionId}`).set(a.auth);
    expect(await labService.admitWaiting()).toMatchObject({ admitted: 1 });
    dropCached(c.user.id); dropCached(d.user.id); // (the one-second cache lapses)
    expect((await request(app).get('/api/lab/availability').set(c.auth)).body.data).toMatchObject({ state: 'ready', reservedUntil: expect.any(Number) });
    expect((await request(app).get('/api/lab/availability').set(d.auth)).body.data.queue.position).toBe(1);

    // the admitted learner starts; the seat becomes a session and the next learner still waits
    expect((await start(c)).status).toBe(201);
    expect(await labService.admitWaiting()).toMatchObject({ admitted: 0 });
    expect((await start(d)).status).toBe(409);
  });

  test('a seat held for an admitted learner cannot be taken by someone arriving later', async () => {
    const [a, b, late] = [await labStudent(), await labStudent(), await labStudent()];
    await start(a);
    const queued = await start(b);
    expect(queued.status).toBe(201); // one seat was still free
    await ctx.manager.destroySession((await ctx.manager.listSessions())[0].sessionId);
    const holder = await labStudent();
    expect((await request(app).post('/api/lab/enter').set(holder.auth)).body.data.state).toBe('ready'); // holds the last seat
    expect((await start(late)).status).toBe(409);
    expect((await request(app).get('/api/lab/availability').set(late.auth)).body.data.state).toBe('queued');
  });

  test('leaving the queue gives up the place; an unclaimed seat is given back', async () => {
    const [a, b, c] = [await labStudent(), await labStudent(), await labStudent()];
    await start(a);
    await start(b);
    await start(c);
    expect((await request(app).get('/api/lab/availability').set(c.auth)).body.data.state).toBe('queued');
    expect((await request(app).delete('/api/lab/queue').set(c.auth)).body.left).toBe(true);
    expect((await request(app).delete('/api/lab/queue').set(c.auth)).body.left).toBe(false);
    expect((await request(app).get('/api/lab/availability').set(c.auth)).body.data.state).toBe('full');

    await start(c); // back in line
    await ctx.manager.destroySession((await ctx.manager.listSessions())[0].sessionId);
    await labService.admitWaiting();
    dropCached(c.user.id);
    expect((await request(app).get('/api/lab/availability').set(c.auth)).body.data.state).toBe('ready');
    // c never opens the lab: after the hold passes the seat is free again for the next person
    const result = await labService.admitWaiting({ now: Date.now() + config.lab.admitTtlMs + 1000 });
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(await getRepos().queue.getOpen(c.user.id)).toBeNull();
  });

  test('a waiter who stops checking in loses their place', async () => {
    const [a, b, c, d] = [await labStudent(), await labStudent(), await labStudent(), await labStudent()];
    await start(a);
    await start(b);
    await start(c); // queued, position 1
    await start(d); // queued, position 2
    await labService.admitWaiting({ now: Date.now() + config.lab.waitingStaleMs + 1000 }); // nobody has checked in since
    expect(await getRepos().queue.getOpen(c.user.id)).toBeNull();
    expect(await getRepos().queue.getOpen(d.user.id)).toBeNull();
  });

  test('platform admins skip the queue (the hardware limit still applies)', async () => {
    await ctx.manager.shutdown();
    setup({ maxTotal: 3, maxPerUser: 3 });
    config.labPolicy = 'accounts';
    await start(await labStudent());
    await start(await labStudent());
    const boss = await admin();
    expect((await start(boss)).status).toBe(201); // the lab has a seat for them without queueing
    expect((await request(app).get('/api/lab/availability').set(boss.auth)).body.data.state).toBe('running');
    const second = await start(await admin());
    expect(second.status).toBe(503); // full: told so, never put in the queue
    expect(second.body.state).toBeUndefined();
  });

  test('a failed start hands the seat back', async () => {
    const lab = await labStudent();
    ctx.engine.failCreate = true;
    const res = await start(lab);
    expect(res.status).toBe(500);
    ctx.engine.failCreate = false;
    expect(await getRepos().queue.getOpen(lab.user.id)).toBeNull();
    expect((await start(lab)).status).toBe(201);
  });
});

describe('slots', () => {
  beforeEach(() => { config.labPolicy = 'slots'; });

  test('with no slot a learner is told when the next one is; inside their slot they start and the session knows its slot', async () => {
    const { college: c, section } = await college();
    const lab = await labStudent();
    await member(lab, c.id, section.id);

    const none = await start(lab);
    expect(none.status).toBe(403);
    expect(none.body).toMatchObject({ code: 'no_slot', state: { state: 'no_slot', nextSlot: null } });

    const later = await slotNow(c.id, { sectionId: section.id, startOffset: 3 * 60 * MIN });
    const waiting = await request(app).get('/api/lab/availability').set(lab.auth);
    expect(waiting.body.data).toMatchObject({ state: 'no_slot', nextSlot: { id: later.id, startsAt: later.startsAt } });

    const current = await slotNow(c.id, { sectionId: section.id, startOffset: -5 * MIN });
    const ok = await start(lab);
    expect(ok.status).toBe(201);
    expect((await getRepos().sessions.get(ok.body.data.sessionId)).slotId).toBe(current.id);
    expect((await request(app).get('/api/lab/my-slots').set(lab.auth)).body.data.map((s) => s.id)).toEqual([current.id, later.id]);
  });

  test('a slot for one section is not usable by another section or another college', async () => {
    const { college: c, section } = await college();
    const other = await getRepos().sections.ensure({ collegeId: c.id, name: 'ECE-B' });
    const { college: c2 } = await college('IIT', 'iit');
    const mine = await labStudent();
    const theirs = await labStudent();
    const elsewhere = await labStudent();
    await member(mine, c.id, section.id);
    await member(theirs, c.id, other.id);
    await member(elsewhere, c2.id, null);
    await slotNow(c.id, { sectionId: section.id });
    expect((await start(mine)).status).toBe(201);
    expect((await start(theirs)).status).toBe(403);
    expect((await start(elsewhere)).status).toBe(403);
  });

  test('a slot never lets in more than its seats; the rest wait and are admitted when someone leaves', async () => {
    const { college: c } = await college();
    await slotNow(c.id, { capacity: 2 });
    const students = [];
    for (let i = 0; i < 3; i += 1) { const s = await labStudent(); await member(s, c.id, null); students.push(s); }
    expect((await start(students[0])).status).toBe(201);
    expect((await start(students[1])).status).toBe(201);
    const third = await start(students[2]);
    expect(third.status).toBe(409);
    expect(third.body.state).toMatchObject({ state: 'queued', slot: { capacity: 2 }, queue: { position: 1 } });
    await ctx.manager.destroySession((await ctx.manager.listSessions())[0].sessionId);
    await labService.admitWaiting();
    expect((await start(students[2])).status).toBe(201);
    expect(await ctx.manager.listSessions()).toHaveLength(2);
  });

  test('sandboxes of a slot that has ended are closed after the grace period', async () => {
    const { college: c } = await college();
    const slot = await slotNow(c.id, { startOffset: -50 * MIN, length: 60 * MIN });
    const lab = await labStudent();
    await member(lab, c.id, null);
    const res = await start(lab);
    expect(res.status).toBe(201);
    expect(await labService.closeEndedSlots(ctx.manager, { now: slot.endsAt + MIN })).toEqual([]); // inside the grace period
    expect(await labService.closeEndedSlots(ctx.manager, { now: slot.endsAt + (config.lab.slotEndGraceMinutes + 1) * MIN })).toEqual([res.body.data.sessionId]);
    expect(await ctx.manager.getSession(res.body.data.sessionId)).toBeNull();
  });

  test('a trainer can add a student to a slot, or remove one from their section\'s slot', async () => {
    const { college: c, section } = await college();
    const other = await getRepos().sections.ensure({ collegeId: c.id, name: 'ECE-B' });
    const slot = await slotNow(c.id, { sectionId: section.id });
    const trainer = await registered();
    await member(trainer, c.id, null, 'trainer');
    const inSection = await labStudent();
    const outside = await labStudent();
    await member(inSection, c.id, section.id);
    await member(outside, c.id, other.id);

    const put = (userId, kind) => request(app).put(`/api/colleges/${c.id}/slots/${slot.id}/students/${userId}`).set(trainer.auth).send({ kind });
    expect((await start(outside)).status).toBe(403);
    expect((await put(outside.user.id, 'add')).status).toBe(200);
    expect((await start(outside)).status).toBe(201);
    expect((await put(inSection.user.id, 'remove')).status).toBe(200);
    expect((await start(inSection)).status).toBe(403);
    expect((await request(app).delete(`/api/colleges/${c.id}/slots/${slot.id}/students/${inSection.user.id}`).set(trainer.auth)).status).toBe(200);
    expect((await start(inSection)).status).toBe(201);

    const stranger = await labStudent();
    expect((await put(stranger.user.id, 'add')).status).toBe(404); // not in this college
    expect((await put(outside.user.id, 'maybe')).status).toBe(400);
    expect((await request(app).put(`/api/colleges/${c.id}/slots/${slot.id}/students/${outside.user.id}`).set((await registered()).auth).send({})).status).toBe(404); // not staff here
    const trail = (await request(app).get(`/api/colleges/${c.id}/audit`).set((await collegeAdmin(c.id)).auth)).body.data;
    expect(trail.map((r) => r.action)).toEqual(expect.arrayContaining(['slot.student_add', 'slot.student_remove', 'slot.student_clear']));
  });

  test('a makeup slot is for students who missed their regular slot that day (or were added by a trainer)', async () => {
    const { college: c, section } = await college();
    const lab = await labStudent();
    await member(lab, c.id, section.id);
    const now = Date.now();
    // earlier today a regular slot ended; the student never came
    const regular = await slotNow(c.id, { sectionId: section.id, startOffset: -120 * MIN, length: 60 * MIN });
    const makeup = await slotNow(c.id, { startOffset: -5 * MIN, makeup: true });
    const eligible = await slotService.eligibleSlots(lab.user.id, { from: now, to: now + 60 * MIN, now });
    expect(eligible.map((s) => s.id)).toEqual([makeup.id]);
    expect((await start(lab)).status).toBe(201);

    // a student who attended the regular slot has no makeup
    await getRepos().queue.reserve({ userId: (await labStudent()).user.id, slotId: regular.id, ttlMs: 1000 }); // (noise)
    const attendee = await labStudent();
    await member(attendee, c.id, section.id);
    const held = await getRepos().queue.reserve({ userId: attendee.user.id, slotId: regular.id, ttlMs: 1000 });
    await getRepos().queue.markStarted(held.id, 'old-session');
    expect(await slotService.eligibleSlots(attendee.user.id, { from: now, to: now + 60 * MIN, now })).toEqual([]);
  });
});

async function collegeAdmin(collegeId) {
  const who = await registered();
  await getRepos().memberships.add({ userId: who.user.id, collegeId, role: 'college_admin' });
  return who;
}

describe('slot templates and generation', () => {
  test('a college admin makes a weekly template and a semester of slots in one action, skipping blackout dates, and repeating changes nothing', async () => {
    const { college: c, section } = await college();
    const boss = await collegeAdmin(c.id);
    const api = (method, path, body) => request(app)[method](`/api/colleges/${c.id}${path}`).set(boss.auth).send(body);

    expect((await api('post', '/slot-templates', { weekday: 6, startTime: '25:00', durationMinutes: 90, seats: 40 })).status).toBe(400);
    expect((await api('post', '/slot-templates', { weekday: 9, startTime: '10:00', durationMinutes: 90, seats: 40 })).status).toBe(400);
    const tpl = (await api('post', '/slot-templates', { weekday: 6, startTime: '10:00', durationMinutes: 90, seats: 40, sectionId: section.id })).body.data;
    await api('post', '/slot-templates', { weekday: 6, startTime: '16:00', durationMinutes: 60, seats: 20, makeup: true });
    expect((await api('post', '/blackouts', { onDate: '2026-11-21', reason: 'Exam week' })).status).toBe(201);
    expect((await api('post', '/blackouts', { onDate: '2026-02-30' })).status).toBe(400);

    const gen = await api('post', '/slots/generate', { from: '2026-11-01', to: '2026-11-30' });
    expect(gen.status).toBe(201);
    // Saturdays: 7, 14, 21 (blackout), 28 -> 3 each for two templates
    expect(gen.body.data).toMatchObject({ created: 6, skippedBlackout: 2, templates: 2 });
    expect((await api('post', '/slots/generate', { from: '2026-11-01', to: '2026-11-30' })).body.data.created).toBe(0);

    const slots = (await api('get', `/slots?from=${Date.UTC(2026, 10, 1)}&to=${Date.UTC(2026, 11, 1)}`)).body.data;
    expect(slots).toHaveLength(6);
    const first = slots.find((s) => s.templateId === tpl.id);
    expect(new Date(first.startsAt).toISOString()).toBe('2026-11-07T04:30:00.000Z'); // 10:00 in India
    expect(first).toMatchObject({ capacity: 40, sectionId: section.id, makeup: false });
    expect(slots.filter((s) => s.makeup)).toHaveLength(3);

    expect((await api('post', '/slots/generate', { from: '2026-11-30', to: '2026-11-01' })).status).toBe(400);
    expect((await api('post', '/slots/generate', { from: '2026-01-01', to: '2027-12-31' })).status).toBe(400);

    await api('post', `/slot-templates/${tpl.id}/deactivate`);
    expect((await api('post', '/slots/generate', { from: '2026-12-01', to: '2026-12-31' })).body.data.templates).toBe(1);
  });

  test('the admin gives a slot to a section and sets its seats; over-capacity and clashes are warned about', async () => {
    const { college: c, section } = await college();
    const boss = await collegeAdmin(c.id);
    const api = (method, path, body) => request(app)[method](`/api/colleges/${c.id}${path}`).set(boss.auth).send(body);
    const slot = await slotNow(c.id, { capacity: 1, startOffset: 60 * MIN });
    const a = await labStudent();
    const b = await labStudent();
    await member(a, c.id, section.id);
    await member(b, c.id, section.id);

    const updated = await api('patch', `/slots/${slot.id}`, { sectionId: section.id, capacity: 1 });
    expect(updated.body.data).toMatchObject({ sectionId: section.id, eligible: 2, warnings: [{ code: 'over_capacity' }] });
    expect((await api('patch', `/slots/${slot.id}`, { capacity: 0 })).status).toBe(400);
    expect((await api('patch', `/slots/${slot.id}`, { sectionId: 'nope' })).status).toBe(400);
    expect((await api('patch', `/slots/${slot.id}`, { capacity: 5 })).body.data.warnings).toEqual([]);

    // a second slot at the same time: adding a student who already has one is a warning, not an error
    const clash = await slotNow(c.id, { startOffset: 70 * MIN });
    const put = await api('put', `/slots/${clash.id}/students/${a.user.id}`, { kind: 'add' });
    expect(put.status).toBe(200);
    expect(put.body.data.warnings.map((w) => w.code)).toContain('overlap');
    expect((await api('delete', `/slots/${slot.id}`)).status).toBe(200);
    expect((await api('get', `/slots/${slot.id}/assignments`)).status).toBe(404);
  });

  test('slot management is limited to the college\'s own staff', async () => {
    const { college: c } = await college();
    const { college: other } = await college('IIT', 'iit');
    const boss = await collegeAdmin(c.id);
    const otherBoss = await collegeAdmin(other.id);
    const trainer = await registered();
    await member(trainer, c.id, null, 'trainer');
    const body = { weekday: 6, startTime: '10:00', durationMinutes: 60, seats: 10 };
    expect((await request(app).post(`/api/colleges/${c.id}/slot-templates`).set(otherBoss.auth).send(body)).status).toBe(404);
    expect((await request(app).post(`/api/colleges/${c.id}/slot-templates`).set(trainer.auth).send(body)).status).toBe(403); // trainers cannot make templates
    expect((await request(app).get(`/api/colleges/${c.id}/slot-templates`).set(trainer.auth)).status).toBe(200);
    expect((await request(app).post(`/api/colleges/${c.id}/slot-templates`).set(boss.auth).send(body)).status).toBe(201);
    expect((await request(app).post(`/api/colleges/${c.id}/slots/generate`).set(otherBoss.auth).send({ from: '2026-11-01', to: '2026-11-30' })).status).toBe(404);
  });
});

describe('capacity plan, analytics and events', () => {
  test('the capacity plan adds up the seats of slots that run together and says how many lab servers that needs', async () => {
    const boss = await admin();
    const { college: a } = await college('Alpha', 'aa');
    const { college: b } = await college('Beta', 'bb');
    const base = Date.now() + 2 * 24 * 60 * MIN;
    await getRepos().slots.createSlots([
      { collegeId: a.id, startsAt: base, endsAt: base + 90 * MIN, capacity: 60 },
      { collegeId: b.id, startsAt: base + 30 * MIN, endsAt: base + 120 * MIN, capacity: 50 }, // overlaps the first
      { collegeId: a.id, startsAt: base + 4 * 60 * MIN, endsAt: base + 5 * 60 * MIN, capacity: 30 }, // later, alone
    ]);
    const res = await request(app).get('/api/admin/capacity-plan?days=7').set(boss.auth);
    expect(res.status).toBe(200);
    const day = res.body.data.days[0];
    expect(day.slots).toHaveLength(3);
    expect(day.peakSeats).toBe(110);
    expect(day.serversNeeded).toBe(Math.ceil(110 / config.lab.learnersPerServer));
    expect(res.body.data.learnersPerServer).toBe(config.lab.learnersPerServer);
    expect((await request(app).get('/api/admin/capacity-plan').set((await registered()).auth)).status).toBe(403);
  });

  test('events are validated and cleaned; the drop-off dashboard counts each transition step', async () => {
    const boss = await admin();
    const user = await guest();
    const post = (body) => request(app).post('/api/lab/events').set(user.auth).send(body);
    expect((await post({ name: 'hack', props: {} })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await request(app).post('/api/lab/events').send({ name: 'switch_to_lab' })).status).toBe(401);
    await post({ name: 'switch_to_lab', props: { from: 'theory', evil: '<script>' } });
    for (let i = 0; i < 3; i += 1) await post({ name: 'transition_step', props: { step: 'slot_check', ok: true } });
    await post({ name: 'transition_step', props: { step: 'reserve', ok: true } });
    await post({ name: 'transition_step', props: { step: 'reserve', ok: false, reason: 'full' } });
    await post({ name: 'transition_step', props: { step: 'connect', ok: false, reason: 'x'.repeat(500) } });
    const res = await request(app).get('/api/admin/lab-funnel?days=1').set(boss.auth);
    expect(res.body.data.switchesToLab).toBe(1);
    const step = (name) => res.body.data.steps.find((s) => s.step === name);
    expect(step('slot_check')).toMatchObject({ ok: 3, failed: 0, dropOffPercent: 0 });
    expect(step('reserve')).toMatchObject({ ok: 1, failed: 1, dropOffPercent: 50 });
    expect(step('connect')).toMatchObject({ ok: 0, failed: 1, dropOffPercent: 100 });
    expect(labService.cleanProps({ step: 'a', evil: 1, reason: 'y'.repeat(200) }).reason).toHaveLength(64);
    expect(labService.cleanProps({ step: 'a', evil: 1 })).toEqual({ step: 'a' });
  });
});

describe('Lab IDs on Supabase Auth', () => {
  const labIdentity = require('../lib/labIdentity');
  const calls = [];
  const realFetch = global.fetch;
  let legacy;
  let url;
  let secret;

  beforeEach(() => {
    legacy = config.legacyAuth; url = config.supabaseUrl; secret = config.supabaseSecretKey;
    config.legacyAuth = false; config.supabaseUrl = 'https://x.supabase.test'; config.supabaseSecretKey = 'secret';
    calls.length = 0;
    global.fetch = async (u, init) => {
      calls.push({ u, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, json: async () => ({ id: 'sub-1' }) };
    };
  });
  afterEach(() => { global.fetch = realFetch; config.legacyAuth = legacy; config.supabaseUrl = url; config.supabaseSecretKey = secret; });

  test('the address matches what the browser builds', () => {
    expect(labIdentity.labEmail(' SRM-CSE-0007 ')).toBe('srm-cse-0007@lab.opsacademy.invalid');
  });

  test('generate creates the Supabase user, keeps no password hash and links the identity', async () => {
    const [made] = await labAccountService.generate({ prefix: 'demo', count: 1 });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toMatchObject({ email: 'demo-0001@lab.opsacademy.invalid', password: made.password, email_confirm: true });
    const stored = await getRepos().users.getById(made.id);
    expect(stored.password).toBeFalsy();
    expect(await getRepos().identities.getSubject('supabase', made.id)).toBe('sub-1');
  });

  test('reset and disable go to Supabase', async () => {
    const [made] = await labAccountService.generate({ prefix: 'demo', count: 1 });
    calls.length = 0;
    const reset = await labAccountService.resetPassword(made.id);
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { password: reset.password } });
    await labAccountService.setDisabled(made.id, true);
    expect(calls[1].body).toEqual({ ban_duration: '876000h' });
  });

  test('a failed Supabase call leaves no half-made account', async () => {
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(labAccountService.generate({ prefix: 'demo', count: 1 })).rejects.toThrow();
    expect(await getRepos().users.getByUsername('demo-0001')).toBeNull();
  });
});
