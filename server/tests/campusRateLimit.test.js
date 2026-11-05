const request = require('supertest');

function appWith(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  let app;
  let mod;
  jest.isolateModules(() => {
    app = require('../app').createApp();
    mod = require('../middleware/rateLimit');
  });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return { app, mod };
}

const login = (app) => request(app).post('/api/auth/login').send({ email: 'a@example.com', password: 'x' });

describe('campus-friendly rate limits (#61)', () => {
  test('matches single addresses, CIDR ranges and IPv4-mapped IPv6', () => {
    const { mod } = appWith({ CAMPUS_IPS: '203.0.113.7, 198.51.100.0/24, 2001:db8::/32, not-an-ip' });
    expect(mod.isCampus('203.0.113.7')).toBe(true);
    expect(mod.isCampus('::ffff:203.0.113.7')).toBe(true);
    expect(mod.isCampus('198.51.100.99')).toBe(true);
    expect(mod.isCampus('2001:db8::1')).toBe(true);
    expect(mod.isCampus('203.0.113.8')).toBe(false);
    expect(mod.isCampus('198.51.101.1')).toBe(false);
    expect(mod.isCampus(undefined)).toBe(false);
  });

  test('without CAMPUS_IPS nobody gets the higher limit', () => {
    const { mod } = appWith({ CAMPUS_IPS: '' });
    expect(mod.isCampus('127.0.0.1')).toBe(false);
  });

  test('a campus address gets a multiplied sign-in limit, others keep the base limit', async () => {
    const base = appWith({ RATE_LIMIT_AUTH: '3', CAMPUS_IPS: '' });
    const baseStatuses = [];
    for (let i = 0; i < 6; i += 1) baseStatuses.push((await login(base.app)).status);
    expect(baseStatuses).toEqual([401, 401, 401, 429, 429, 429]);

    // supertest connects from loopback; treat it as the campus.
    const campus = appWith({ RATE_LIMIT_AUTH: '3', CAMPUS_IPS: '127.0.0.1,::1', CAMPUS_RATE_MULTIPLIER: '4' });
    const campusStatuses = [];
    for (let i = 0; i < 14; i += 1) campusStatuses.push((await login(campus.app)).status);
    expect(campusStatuses.slice(0, 12).every((s) => s === 401)).toBe(true); // 3 x 4 = 12 allowed
    expect(campusStatuses.slice(12)).toEqual([429, 429]);
  });

  test('300 students behind one campus address can sign in within a minute without 429s', async () => {
    const { app } = appWith({ RATE_LIMIT_AUTH: '20', CAMPUS_IPS: '127.0.0.1,::1' }); // production default 20 x 15 = 300
    let tooMany = 0;
    for (let i = 0; i < 300; i += 1) {
      if ((await login(app)).status === 429) tooMany += 1;
    }
    expect(tooMany).toBe(0);
    // ...and the 301st attempt in the same minute is still limited.
    expect((await login(app)).status).toBe(429);
  }, 60000);
});
