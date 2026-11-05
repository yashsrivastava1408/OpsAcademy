#!/usr/bin/env node
/**
 * Apply pending database migrations.
 *
 *   DATABASE_URL=postgres://… node scripts/migrate.js            apply pending
 *   DATABASE_URL=postgres://… node scripts/migrate.js --status   show applied/pending
 *   DATABASE_URL=postgres://… node scripts/migrate.js --dry-run  list what would run
 *
 * Use the direct (non-pooled) connection string for migrations.
 */
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { migrate, status } = require('../lib/migrator');

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_URL (or MIGRATION_DATABASE_URL) to the Postgres connection string.');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url, max: 2, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    if (process.argv.includes('--status')) {
      for (const row of await status(pool)) console.log(`${row.version}  ${row.status.padEnd(8)}  ${row.name}`);
      return;
    }
    const result = await migrate(pool, { dryRun: process.argv.includes('--dry-run'), log: (m) => console.log(m) });
    console.log(result.applied.length ? `Applied ${result.applied.length} migration(s).` : 'Database is up to date.');
  } catch (err) {
    console.error(`Migration failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
