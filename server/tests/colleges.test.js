/**
 * Roles, tenant isolation, roster import, invites, audit and the shared rate-limit store (Phase 2).
 */
const request = require('supertest');
const { createApp } = require('../app');
const { install } = require('./helpers');
const { parseCsv } = require('../lib/csv');
const { SharedRateLimitStore } = require('../lib/rateLimitStore');
const { getRepos } = require('../repositories');

let app;
let ctx;

beforeEach(() => {
  ctx = install({});
  app = createApp();
});
afterEach(async () => { await ctx.manager.shutdown(); });

async function registered(overrides = {}) {
  const body = { name: 'Asha Rao', email: `asha${Math.random().toString(36).slice(2)}@example.com`, password: 'correct-horse', ...overrides };
  const res = await request(app).post('/api/auth/register').send(body);
  return { ...body, user: res.body.user, devVerifyLink: res.body.devVerifyLink, auth: { Authorization: `Bearer ${res.body.token}` } };
}

async function verify(who) {
  const token = new URL(who.devVerifyLink).searchParams.get('token');
  await request(app).post('/api/auth/verify-email').send({ token });
}

async function withRole(role, collegeId) {
  const who = await registered();
  await getRepos().memberships.add({ userId: who.user.id, collegeId, role });
  return who;
}

async function twoColleges() {
  const repos = getRepos();
  const a = await repos.colleges.create({ name: 'College A', slug: 'college-a' });
  const b = await repos.colleges.create({ name: 'College B', slug: 'college-b' });
  return { a, b };
}

describe('csv reader', () => {
  test('handles quotes, commas, blank lines, CRLF and a BOM', () => {
    expect(parseCsv('﻿name,email\r\n"Rao, Asha","a@x.com"\r\n\r\n"say ""hi""",b@x.com\n')).toEqual([
      ['name', 'email'], ['Rao, Asha', 'a@x.com'], ['say "hi"', 'b@x.com'],
    ]);
  });
});

describe('colleges and roles', () => {
  test('only a platform admin creates colleges; slugs are validated and unique', async () => {
    const admin = await withRole('platform_admin', null);
    const student = await registered();
    expect((await request(app).post('/api/colleges').send({ name: 'SRM', slug: 'srm' })).status).toBe(401);
    expect((await request(app).post('/api/colleges').set(student.auth).send({ name: 'SRM', slug: 'srm' })).status).toBe(403);
    expect((await request(app).post('/api/colleges').set(admin.auth).send({ name: 'SRM', slug: 'Bad Slug' })).status).toBe(400);
    const ok = await request(app).post('/api/colleges').set(admin.auth).send({ name: 'SRM', slug: 'srm' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ name: 'SRM', slug: 'srm', timezone: 'Asia/Kolkata' });
    expect((await request(app).post('/api/colleges').set(admin.auth).send({ name: 'SRM 2', slug: 'srm' })).status).toBe(409);
    expect((await request(app).get('/api/colleges').set(admin.auth)).body.data).toHaveLength(1);

    const trail = (await request(app).get('/api/admin/audit').set(admin.auth)).body.data;
    expect(trail[0]).toMatchObject({ action: 'college.create', actorId: admin.user.id, collegeId: ok.body.data.id });
  });

  test('"mine" lists the caller\'s colleges and roles', async () => {
    const { a, b } = await twoColleges();
    const who = await withRole('student', a.id);
    await getRepos().memberships.add({ userId: who.user.id, collegeId: b.id, role: 'trainer' });
    const res = await request(app).get('/api/colleges/mine').set(who.auth);
    expect(res.body.data.map((c) => [c.slug, c.roles])).toEqual([['college-a', ['student']], ['college-b', ['trainer']]]);
    expect((await request(app).get('/api/colleges/mine').set((await registered()).auth)).body.data).toEqual([]);
  });
});

describe('tenant isolation', () => {
  test('staff of one college cannot see or change another college (404, not 403)', async () => {
    const { a, b } = await twoColleges();
    const adminA = await withRole('college_admin', a.id);
    const csv = 'name,email\nAda,ada@example.com';
    for (const [method, path, body] of [
      ['get', `/api/colleges/${b.id}`], ['get', `/api/colleges/${b.id}/members`], ['get', `/api/colleges/${b.id}/sections`],
      ['get', `/api/colleges/${b.id}/leaderboard`], ['get', `/api/colleges/${b.id}/audit`], ['post', `/api/colleges/${b.id}/roster`, { csv }],
    ]) {
      const res = await request(app)[method](path).set(adminA.auth).send(body);
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
    expect(await getRepos().invites.listByCollege(b.id)).toEqual([]);
    expect((await request(app).get(`/api/colleges/${a.id}/members`).set(adminA.auth)).status).toBe(200);
  });

  test('a platform admin reaches every college', async () => {
    const { a, b } = await twoColleges();
    const admin = await withRole('platform_admin', null);
    for (const college of [a, b]) {
      expect((await request(app).get(`/api/colleges/${college.id}/members`).set(admin.auth)).status).toBe(200);
    }
  });

  test('inside a college, a role limits what a member can do', async () => {
    const { a } = await twoColleges();
    const student = await withRole('student', a.id);
    const trainer = await withRole('trainer', a.id);
    expect((await request(app).get(`/api/colleges/${a.id}`).set(student.auth)).status).toBe(200);
    expect((await request(app).get(`/api/colleges/${a.id}/leaderboard`).set(student.auth)).status).toBe(200);
    expect((await request(app).get(`/api/colleges/${a.id}/members`).set(student.auth)).status).toBe(403);
    expect((await request(app).post(`/api/colleges/${a.id}/roster`).set(student.auth).send({ csv: 'x@y.com' })).status).toBe(403);
    expect((await request(app).get(`/api/colleges/${a.id}/members`).set(trainer.auth)).status).toBe(200);
    expect((await request(app).post(`/api/colleges/${a.id}/roster`).set(trainer.auth).send({ csv: 'x@y.com' })).status).toBe(403);
    expect((await request(app).get(`/api/colleges/${a.id}/audit`).set(trainer.auth)).status).toBe(403);
  });

  test('guests and signed-out callers get nothing', async () => {
    const { a } = await twoColleges();
    expect((await request(app).get(`/api/colleges/${a.id}`)).status).toBe(401);
    const guest = await request(app).post('/api/auth/guest');
    expect((await request(app).get(`/api/colleges/${a.id}`).set({ Authorization: `Bearer ${guest.body.token}` })).status).toBe(404);
  });

  test('the college leaderboard ranks only that college\'s members', async () => {
    const { a, b } = await twoColleges();
    const inA = await withRole('student', a.id);
    const inB = await withRole('student', b.id);
    await getRepos().progress.mutate(inA.user.id, (d) => { d.xp = 50; });
    await getRepos().progress.mutate(inB.user.id, (d) => { d.xp = 90; });
    await getRepos().jobs.refreshLeaderboards();
    const res = await request(app).get(`/api/colleges/${a.id}/leaderboard`).set(inA.auth);
    expect(res.body.data.map((r) => [r.name, r.xp])).toEqual([['Asha Rao', 50]]);
  });
});

describe('roster import', () => {
  const csv = [
    'name,email,section,role',
    'Ada,ada@example.com,CSE-A,student',
    'Bob,BOB@example.com,CSE-A,',
    'Cy,not-an-email,CSE-B,student',
    'Di,di@example.com,CSE-B,principal',
    'Ada again,ada@example.com,CSE-A,student',
    'Tara,tara@example.com,,trainer',
  ].join('\n');

  test('a dry run reports without writing', async () => {
    const { a } = await twoColleges();
    const admin = await withRole('college_admin', a.id);
    const res = await request(app).post(`/api/colleges/${a.id}/roster`).set(admin.auth).send({ csv, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ dryRun: true, total: 6, invited: 3, added: 0, sectionsCreated: 1 });
    expect(res.body.data.errors.map((e) => e.line)).toEqual([4, 5, 6]);
    expect(await getRepos().invites.listByCollege(a.id)).toEqual([]);
    expect(await getRepos().sections.listByCollege(a.id)).toEqual([]);
  });

  test('imports sections and invites, then applies each invite when that verified email signs in', async () => {
    const { a } = await twoColleges();
    const admin = await withRole('college_admin', a.id);
    const res = await request(app).post(`/api/colleges/${a.id}/roster`).set(admin.auth).send({ csv });
    expect(res.body.data).toMatchObject({ invited: 3, added: 0, sectionsCreated: 1 });
    expect((await request(app).get(`/api/colleges/${a.id}/sections`).set(admin.auth)).body.data.map((s) => s.name)).toEqual(['CSE-A']);

    // Ada registers: an unverified account gets nothing yet…
    const ada = await registered({ name: 'Ada', email: 'ada@example.com' });
    expect(await getRepos().memberships.forUser(ada.user.id)).toEqual([]);
    // …until the address is confirmed.
    await verify(ada);
    expect(await getRepos().memberships.forUser(ada.user.id)).toMatchObject([{ collegeId: a.id, role: 'student' }]);
    expect((await getRepos().sections.listByCollege(a.id))[0].id).toBe((await getRepos().memberships.forUser(ada.user.id))[0].sectionId);
    expect((await request(app).get(`/api/colleges/${a.id}/leaderboard`).set(ada.auth)).status).toBe(200);

    const trail = (await request(app).get(`/api/colleges/${a.id}/audit`).set(admin.auth)).body.data;
    expect(trail[0]).toMatchObject({ action: 'roster.import', actorRole: 'college_admin', meta: { invited: 3, rejected: 3 } });
  });

  test('a person with a verified account is added at once, and re-importing changes nothing', async () => {
    const { a } = await twoColleges();
    const admin = await withRole('college_admin', a.id);
    const ada = await registered({ name: 'Ada', email: 'ada@example.com' });
    await verify(ada);
    const first = await request(app).post(`/api/colleges/${a.id}/roster`).set(admin.auth).send({ csv: 'Ada,ada@example.com,CSE-A' });
    expect(first.body.data).toMatchObject({ added: 1, invited: 0 });
    const again = await request(app).post(`/api/colleges/${a.id}/roster`).set(admin.auth).send({ csv: 'Ada,ada@example.com,CSE-A' });
    expect(again.body.data).toMatchObject({ added: 0, invited: 0, alreadyMembers: 1, sectionsCreated: 0 });
  });

  test('rejects an empty body and too many rows', async () => {
    const { a } = await twoColleges();
    const admin = await withRole('college_admin', a.id);
    expect((await request(app).post(`/api/colleges/${a.id}/roster`).set(admin.auth).send({})).status).toBe(400);
    const many = Array.from({ length: 1001 }, (_, i) => `n,u${i}@example.com`).join('\n');
    expect((await request(app).post(`/api/colleges/${a.id}/roster`).set(admin.auth).send({ csv: many })).status).toBe(413);
  });
});

describe('shared rate-limit store', () => {
  test('counts through the repositories under its own prefix', async () => {
    const store = new SharedRateLimitStore(getRepos, 'auth');
    store.init({ windowMs: 60000 });
    expect((await store.increment('1.2.3.4')).totalHits).toBe(1);
    const second = await store.increment('1.2.3.4');
    expect(second.totalHits).toBe(2);
    expect(second.resetTime.getTime()).toBeGreaterThan(Date.now());
    const other = new SharedRateLimitStore(getRepos, 'guest');
    other.init({ windowMs: 60000 });
    expect((await other.increment('1.2.3.4')).totalHits).toBe(1);
    await store.decrement('1.2.3.4');
    expect((await store.increment('1.2.3.4')).totalHits).toBe(2);
    await store.resetKey('1.2.3.4');
    expect((await store.increment('1.2.3.4')).totalHits).toBe(1);
  });
});
