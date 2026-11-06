/**
 * Used with TEST_REPOS=postgres: one shared pool, migrations applied once, and every
 * test starts from empty tables. Run with --runInBand (one database, one worker).
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { migrate } = require('../lib/migrator');
const { createPostgresRepos } = require('../repositories/postgres');

let pool;
let repos;
let ready;

function postgresRepos() {
  if (!repos) {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 10 });
    repos = createPostgresRepos({ pool });
  }
  return repos;
}

if (process.env.TEST_REPOS === 'postgres') {
  beforeAll(async () => {
    postgresRepos();
    if (!ready) {
      ready = (async () => {
        await pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'tests', 'bootstrap.sql'), 'utf8'));
        await migrate(pool);
      })();
    }
    await ready;
  });
  beforeEach(async () => {
    await pool.query('truncate users, colleges, lab_nodes, rate_limit_hits cascade');
  });
  afterAll(async () => {
    await pool.end();
    repos = null;
    pool = null;
    ready = null;
  });
}

module.exports = { postgresRepos };
