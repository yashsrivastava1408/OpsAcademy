const request = require('supertest');

jest.mock('../lib/supabaseAuth', () => ({
  verifySupabaseToken: (token) =>
    token === 'sb-token'
      ? { id: 'sb-user-1', name: 'Ada', email: 'ada@example.com', guest: false, emailVerified: true, supabase: true }
      : null,
  refreshJwks: jest.fn(),
  ready: () => Promise.resolve(),
}));

const { createMemoryRepos, setRepos } = require('../repositories');
const { createApp } = require('../app');
const { fakeEngine, install } = require('./helpers');

let app;
let repos;
let writes;

beforeEach(() => {
  install({ engine: fakeEngine() });
  repos = createMemoryRepos();
  writes = 0;
  for (const method of ['create', 'createIfAbsent', 'update']) {
    const original = repos.users[method].bind(repos.users);
    repos.users[method] = (...args) => {
      writes += 1;
      return original(...args);
    };
  }
  setRepos(repos);
  app = createApp();
});

const auth = { Authorization: 'Bearer sb-token' };

describe('Supabase sign-in (#56)', () => {
  test('verifying a token on read requests never writes to the store', async () => {
    await request(app).get('/api/auth/me').set(auth);
    await request(app).get('/api/progress/summary').set(auth);
    await request(app).get('/api/units').set(auth);
    expect(writes).toBe(0);
    expect(await repos.users.getById('sb-user-1')).toBeNull();
  });

  test('/me says the account does not exist until /session creates it', async () => {
    expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(401);

    const created = await request(app).post('/api/auth/session').set(auth);
    expect(created.status).toBe(200);
    expect(created.body.user).toMatchObject({ id: 'sb-user-1', name: 'Ada', email: 'ada@example.com' });
    expect(await repos.users.getById('sb-user-1')).toMatchObject({ id: 'sb-user-1' });

    const me = await request(app).get('/api/auth/me').set(auth);
    expect(me.status).toBe(200);
  });

  test('/session is idempotent and keeps the existing record', async () => {
    await request(app).post('/api/auth/session').set(auth);
    const again = await request(app).post('/api/auth/session').set(auth);
    expect(again.status).toBe(200);
    // The second call is an insert-if-absent that finds the row: it never replaces it.
    expect((await repos.users.getById('sb-user-1')).name).toBe('Ada');
  });

  test('/session requires a valid token', async () => {
    expect((await request(app).post('/api/auth/session')).status).toBe(401);
    expect((await request(app).post('/api/auth/session').set({ Authorization: 'Bearer nope' })).status).toBe(401);
  });
});
