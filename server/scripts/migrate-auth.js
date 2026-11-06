#!/usr/bin/env node
/**
 * Move existing accounts to Supabase Auth with their password hashes. Dry run by default.
 *
 *   node scripts/migrate-auth.js            list what would move
 *   node scripts/migrate-auth.js --apply    create the Supabase users and link them
 *
 * Needs DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY (the secret key, never the publishable one).
 * Take a backup first (docs/BACKUP_AND_RESTORE.md). See ADR 0003 for the whole cutover.
 */
require('dotenv').config({ quiet: true });
const { getRepos } = require('../repositories');
const { migrateAccounts, adminClient } = require('../lib/authMigration');

async function main() {
  const apply = process.argv.includes('--apply');
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secretKey } = process.env;
  if (!process.env.DATABASE_URL || (apply && (!url || !secretKey))) {
    console.error('Set DATABASE_URL, and for --apply also SUPABASE_URL and SUPABASE_SECRET_KEY.');
    process.exit(2);
  }
  const repos = getRepos();
  try {
    const report = await migrateAccounts({ repos, supabase: apply ? adminClient({ url, secretKey }) : null, apply, log: console.log });
    console.log(`\n${apply ? 'Moved' : 'Would move'} ${report.created} of ${report.total} account(s).`);
    if (report.alreadyInSupabase.length) console.log(`Already in Supabase (not touched): ${report.alreadyInSupabase.join(', ')}`);
    if (report.failed.length) {
      console.log(`Failed: ${report.failed.length}`);
      process.exitCode = 1;
    }
    if (!apply) console.log('Dry run. Add --apply to write.');
  } finally {
    await repos.close();
  }
}

main();
