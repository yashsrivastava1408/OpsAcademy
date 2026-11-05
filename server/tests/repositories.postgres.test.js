const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { migrate } = require('../lib/migrator');
const { createPostgresRepos } = require('../repositories/postgres');
const { runContract } = require('./contract/repositories.contract');

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  test.skip('postgres repositories need TEST_DATABASE_URL', () => {});
} else {
  const pool = new Pool({ connectionString: url, max: 10 });
  const repos = createPostgresRepos({ pool });

  beforeAll(async () => {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'tests', 'bootstrap.sql'), 'utf8'));
    await migrate(pool);
  });
  afterAll(() => pool.end());

  runContract('postgres', async () => {
    await pool.query('truncate users, colleges cascade');
    return repos;
  });
}
