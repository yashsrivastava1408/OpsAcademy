const request = require('supertest');
const express = require('express');
const { createMemoryRepos, setRepos } = require('../repositories');
const { pruneExpired, runJob, startJobs } = require('../jobs/maintenance');
const asyncHandler = require('../middleware/asyncHandler');
const errorHandler = require('../middleware/errorHandler');
const { RepoError } = require('../repositories/errors');

const DAY = 24 * 60 * 60 * 1000;

describe('maintenance jobs (#78, #79)', () => {
  let repos;
  beforeEach(() => { repos = setRepos(createMemoryRepos()); });

  test('pruneExpired removes old guests and expired tokens and reports the counts', async () => {
    await repos.users.create({ id: 'old', name: 'Old', guest: true, createdAt: new Date(Date.now() - 60 * DAY).toISOString() });
    await repos.users.create({ id: 'new', name: 'New', guest: true, createdAt: new Date().toISOString() });
    await repos.tokens.issue({ hash: 'dead', userId: 'new', kind: 'reset', expiresAt: 1 });
    expect(await pruneExpired()).toEqual({ guests: 1, tokens: 1 });
    expect(await repos.users.getById('old')).toBeNull();
    expect(await pruneExpired()).toEqual({ guests: 0, tokens: 0 });
  });

  test('a failing job is logged and does not throw; a locked job is skipped', async () => {
    expect(await runJob({ name: 'boom', run: async () => { throw new Error('nope'); } })).toBeNull();
    repos.jobs.withLock = async () => ({ ran: false });
    await expect(runJob({ name: 'locked', run: async () => 1 })).resolves.toEqual({ ran: false });
  });

  test('startJobs runs each job once immediately and again on its timer, and can be stopped', async () => {
    jest.useFakeTimers();
    try {
      let runs = 0;
      const stop = startJobs([{ name: 'tick', everyMs: 1000, run: async () => { runs += 1; } }]);
      await jest.advanceTimersByTimeAsync(0);
      expect(runs).toBe(1);
      await jest.advanceTimersByTimeAsync(2500);
      expect(runs).toBe(3);
      stop();
      await jest.advanceTimersByTimeAsync(5000);
      expect(runs).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('async handler and repository errors', () => {
  const app = express();
  app.get('/boom', asyncHandler(async () => { throw new Error('async failure'); }));
  app.get('/missing', asyncHandler(async () => { throw new RepoError('user_missing'); }));
  app.get('/taken', asyncHandler(async () => { throw new RepoError('email_taken'); }));
  app.get('/ok', asyncHandler(async (req, res) => res.json({ ok: true })));
  app.use(errorHandler);

  test('a rejected promise reaches the error middleware instead of hanging the request', async () => {
    expect((await request(app).get('/boom')).status).toBe(500);
    expect((await request(app).get('/ok')).body).toEqual({ ok: true });
  });

  test('repository errors become meaningful HTTP statuses', async () => {
    const missing = await request(app).get('/missing');
    expect(missing.status).toBe(401);
    expect(missing.body.error).toMatch(/sign in again/i);
    expect((await request(app).get('/taken')).status).toBe(409);
  });
});
