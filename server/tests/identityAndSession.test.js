/**
 * Supabase Auth in the gateway (ADR 0003): linking Supabase users to app users, guest upgrade and the
 * refresh-token cookie. Token verification is mocked here; tests/supabaseAuth.test.js covers the real thing.
 */
const request = require('supertest');

const mockTokens = {};
jest.mock('../lib/supabaseAuth', () => ({
  verifySupabaseToken: (token) => mockTokens[token] || null,
  refreshJwks: jest.fn(),
  ready: () => Promise.resolve(),
}));

const config = require('../config');
const { createApp } = require('../app');
const { getRepos } = require('../repositories');
const { fakeEngine, install } = require('./helpers');

let app;
let ctx;
const savedAuth = { url: config.supabaseUrl, key: config.supabasePublishableKey };

beforeEach(() => {
  ctx = install({ engine: fakeEngine() });
  app = createApp();
  for (const k of Object.keys(mockTokens)) delete mockTokens[k];
});
afterEach(async () => {
  await ctx.manager.shutdown();
  config.supabaseUrl = savedAuth.url;
  config.supabasePublishableKey = savedAuth.key;
  jest.restoreAllMocks();
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const supabaseUser = (sub, extra = {}) => ({ id: sub, name: 'Ada', email: 'ada@example.com', guest: false, emailVerified: true, supabase: true, ...extra });

describe('who a request is', () => {
  test('only Supabase sessions are accepted; the gateway has no sign-in endpoints of its own', async () => {
    for (const [path, body] of [['/guest'], ['/register', { name: 'A', email: 'a@x.com', password: 'longenough' }], ['/login', { email: 'a@x.com', password: 'x' }], ['/forgot', { email: 'a@x.com' }], ['/reset', { token: 'x', password: 'longenough' }], ['/verify-email', { token: 'x' }]]) {
      expect([path, (await request(app).post(`/api/auth${path}`).send(body)).status]).toEqual([path, 404]);
    }
    mockTokens['sb-ok'] = supabaseUser('sb-1');
    expect((await request(app).post('/api/auth/session').set(bearer('sb-ok'))).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer('sb-ok'))).body.user).toMatchObject({ id: 'sb-1', email: 'ada@example.com' });
  });
});

describe('linking Supabase users to app users', () => {
  test('an existing account is claimed by the same confirmed email, keeping its id and progress', async () => {
    await ctx.repos.users.create({ id: 'u_legacy', name: 'Ada', email: 'ada@example.com', guest: false, emailVerified: false, createdAt: '2026-01-01T00:00:00.000Z' });
    await ctx.repos.progress.mutate('u_legacy', (d) => { d.xp = 70; });
    mockTokens['sb-ada'] = supabaseUser('sb-uuid-1');

    const res = await request(app).post('/api/auth/session').set(bearer('sb-ada'));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'u_legacy', emailVerified: true });
    expect(await ctx.repos.identities.getUserId('supabase', 'sb-uuid-1')).toBe('u_legacy');
    expect(await ctx.repos.users.getById('sb-uuid-1')).toBeNull();

    // Later requests act as the existing user.
    expect((await request(app).get('/api/progress').set(bearer('sb-ada'))).body.data.xp).toBe(70);
  });

  test('an unconfirmed Supabase email never takes over an existing account', async () => {
    await ctx.repos.users.create({ id: 'u_legacy', name: 'Ada', email: 'ada@example.com', guest: false, emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z' });
    mockTokens['sb-imposter'] = supabaseUser('sb-uuid-2', { emailVerified: false });
    const res = await request(app).post('/api/auth/session').set(bearer('sb-imposter'));
    expect(await ctx.repos.identities.getUserId('supabase', 'sb-uuid-2')).toBeNull();
    expect(res.body.user?.id).not.toBe('u_legacy');
  });

  test('a guest (anonymous sign-in) keeps the same id and progress when they add and confirm an email', async () => {
    mockTokens['sb-guest'] = { id: 'anon-1', name: 'Learner', email: null, guest: true, emailVerified: false, supabase: true };
    const guest = await request(app).post('/api/auth/session').set(bearer('sb-guest'));
    expect(guest.body.user).toMatchObject({ id: 'anon-1', guest: true });
    await getRepos().progress.mutate('anon-1', (d) => { d.xp = 40; });

    mockTokens['sb-guest'] = { id: 'anon-1', name: 'Ada', email: 'ada@example.com', guest: false, emailVerified: true, supabase: true };
    const upgraded = await request(app).post('/api/auth/session').set(bearer('sb-guest'));
    expect(upgraded.body.user).toMatchObject({ id: 'anon-1', guest: false, email: 'ada@example.com', name: 'Ada' });
    expect((await request(app).get('/api/progress').set(bearer('sb-guest'))).body.data.xp).toBe(40);
  });
});

describe('refresh-token cookie', () => {
  const ajax = { 'X-Requested-With': 'opsacademy' };
  let upstream;

  beforeEach(() => {
    config.supabaseUrl = 'https://proj.supabase.co';
    config.supabasePublishableKey = 'sb_publishable_x';
    upstream = jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('grant_type=refresh_token')) {
        const sent = JSON.parse(init.body).refresh_token;
        if (sent === 'bad') return { status: 400, ok: false, json: async () => ({}) };
        return { status: 200, ok: true, json: async () => ({ access_token: `access-for-${sent}`, refresh_token: `${sent}+`, expires_in: 900 }) };
      }
      return { status: 204, ok: true, json: async () => ({}) };
    });
  });

  test('POST /cookie keeps the rotated refresh token only in an HttpOnly cookie', async () => {
    const res = await request(app).post('/api/auth/cookie').set(ajax).send({ refreshToken: 'r1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessToken: 'access-for-r1' });
    expect(JSON.stringify(res.body)).not.toContain('r1+');
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^oa_rt=r1%2B;/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(upstream.mock.calls[0][1].headers.apikey).toBe('sb_publishable_x');
  });

  test('POST /refresh reads the cookie and rotates it again', async () => {
    const res = await request(app).post('/api/auth/refresh').set(ajax).set('Cookie', 'oa_rt=r2%2B');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('access-for-r2+');
    expect(res.headers['set-cookie'][0]).toMatch(/^oa_rt=r2%2B%2B;/);
  });

  test('no cookie, a refused token, or a missing header are all rejected; a refused token clears the cookie', async () => {
    expect((await request(app).post('/api/auth/refresh').set(ajax)).status).toBe(401);
    const refused = await request(app).post('/api/auth/refresh').set(ajax).set('Cookie', 'oa_rt=bad');
    expect(refused.status).toBe(401);
    expect(refused.headers['set-cookie'][0]).toMatch(/Max-Age=0/);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', 'oa_rt=r2')).status).toBe(400);
    expect((await request(app).post('/api/auth/cookie').set(ajax).send({})).status).toBe(400);
    expect((await request(app).post('/api/auth/cookie').set(ajax).send({ refreshToken: 'bad' })).status).toBe(401);
  });

  test('POST /logout clears the cookie and revokes the session upstream', async () => {
    const res = await request(app).post('/api/auth/logout').set(ajax).set(bearer('sb-token')).send({ scope: 'global' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/oa_rt=;.*Max-Age=0/);
    const call = upstream.mock.calls.find(([url]) => String(url).includes('/logout'));
    expect(String(call[0])).toContain('scope=global');
    expect(call[1].headers.authorization).toBe('Bearer sb-token');
  });

  test('the cookie is Secure in production settings', async () => {
    const savedSecure = config.authCookie.secure;
    config.authCookie.secure = true;
    try {
      const res = await request(app).post('/api/auth/cookie').set(ajax).send({ refreshToken: 'r1' });
      expect(res.headers['set-cookie'][0]).toMatch(/; Secure/);
    } finally {
      config.authCookie.secure = savedSecure;
    }
  });
});
