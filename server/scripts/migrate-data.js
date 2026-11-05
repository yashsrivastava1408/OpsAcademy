#!/usr/bin/env node
/**
 * Import the old document stores into Postgres. Dry run by default.
 *
 *   node scripts/migrate-data.js --from json:./.data/store.json
 *   node scripts/migrate-data.js --from sqlite:/data/store.db
 *   node scripts/migrate-data.js --from supabase              (SUPABASE_URL + SUPABASE_SECRET_KEY)
 *   add --apply to write (only commits if verification passes)
 *
 * Target: MIGRATION_DATABASE_URL or DATABASE_URL. Run `npm run migrate` first.
 */
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { readJson, readSqlite, readSupabase, importLegacy } = require('../lib/legacyImport');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const from = argValue('--from');
  const apply = process.argv.includes('--apply');
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!from || !url) {
    console.error('Usage: node scripts/migrate-data.js --from json:<file>|sqlite:<file>|supabase [--apply]\nSet DATABASE_URL (or MIGRATION_DATABASE_URL).');
    process.exit(2);
  }

  let data;
  if (from.startsWith('json:')) data = readJson(from.slice(5));
  else if (from.startsWith('sqlite:')) data = readSqlite(from.slice(7));
  else if (from === 'supabase') {
    data = await readSupabase({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY });
  } else {
    console.error(`Unknown source "${from}"`);
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url, max: 2, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    const report = await importLegacy(pool, data, { apply });
    console.log(JSON.stringify(report, null, 2));
    if (!report.verification.ok) {
      console.error('\nVerification FAILED: nothing was written.');
      process.exitCode = 1;
    } else if (apply) {
      console.log('\nImport committed.');
    } else {
      console.log('\nDry run only: nothing was written. Re-run with --apply.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`Data migration failed: ${err.message}`);
  process.exit(1);
});
