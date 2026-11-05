/**
 * Migration runner for supabase/migrations/NNNN_name.sql (see docs/adr/0001).
 *
 * - Files are applied in filename order, each in its own transaction.
 * - Applied files are recorded in public.schema_migrations with a checksum;
 *   editing an applied file is refused (add a new migration instead).
 * - A Postgres advisory lock stops two deploys from migrating at once.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
// Arbitrary constant: "opsacademy migrations" as an int, shared by every runner.
const LOCK_KEY = 7_265_501;

class MigrationError extends Error {}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

/** Read and validate the migration files. @returns [{ version, name, file, sql, checksum }] in order. */
function loadMigrations(dir = DEFAULT_DIR) {
  const migrations = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (file.endsWith('.md')) continue;
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new MigrationError(`Migration file "${file}" must be named NNNN_snake_case.sql`);
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    migrations.push({ version: match[1], name: match[2], file, sql, checksum: checksum(sql) });
  }
  const seen = new Set();
  for (const m of migrations) {
    if (seen.has(m.version)) throw new MigrationError(`Duplicate migration version ${m.version}`);
    seen.add(m.version);
  }
  return migrations;
}

async function ensureTable(client) {
  await client.query(`
    create table if not exists public.schema_migrations (
      version    text primary key,
      name       text        not null,
      checksum   text        not null,
      applied_at timestamptz not null default now()
    )`);
  // Migrations are server-only metadata.
  await client.query('alter table public.schema_migrations enable row level security');
}

async function appliedMap(client) {
  const { rows } = await client.query('select version, name, checksum from public.schema_migrations order by version');
  return new Map(rows.map((r) => [r.version, r]));
}

/**
 * @param {import('pg').Pool|import('pg').Client} db  a pg Pool (a client is checked out) or a connected Client
 * @param {{ dir?: string, dryRun?: boolean, log?: (msg: string) => void }} options
 * @returns {{ applied: string[], pending: string[] }}
 */
async function migrate(db, { dir = DEFAULT_DIR, dryRun = false, log = () => {} } = {}) {
  const migrations = loadMigrations(dir);
  // A Pool hands out a dedicated client (the advisory lock is per connection); a Client is used as is.
  const isPool = typeof db.totalCount === 'number';
  const client = isPool ? await db.connect() : db;
  const release = isPool ? () => client.release() : () => {};

  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await ensureTable(client);
      const done = await appliedMap(client);

      // Applied history must match the files on disk.
      for (const [version, row] of done) {
        const file = migrations.find((m) => m.version === version);
        if (!file) throw new MigrationError(`Database has migration ${version} (${row.name}) that is missing from the repo`);
        if (file.checksum !== row.checksum) {
          throw new MigrationError(`Migration ${version} (${row.name}) was edited after it was applied. Add a new migration instead.`);
        }
      }
      const maxApplied = [...done.keys()].sort().pop();
      const pending = migrations.filter((m) => !done.has(m.version));
      if (maxApplied && pending.some((m) => m.version < maxApplied)) {
        throw new MigrationError('A new migration has a lower number than one already applied; renumber it.');
      }

      const applied = [];
      for (const m of pending) {
        if (dryRun) {
          log(`would apply ${m.file}`);
          continue;
        }
        log(`applying ${m.file}`);
        try {
          await client.query('begin');
          await client.query(m.sql);
          await client.query(
            'insert into public.schema_migrations (version, name, checksum) values ($1, $2, $3)',
            [m.version, m.name, m.checksum],
          );
          await client.query('commit');
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw new MigrationError(`Migration ${m.file} failed and was rolled back: ${err.message}`);
        }
        applied.push(m.version);
      }
      return { applied, pending: pending.map((m) => m.version) };
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  } finally {
    release();
  }
}

/** @returns [{ version, name, status: 'applied'|'pending'|'edited' }] */
async function status(db, { dir = DEFAULT_DIR } = {}) {
  const migrations = loadMigrations(dir);
  await ensureTable(db);
  const done = await appliedMap(db);
  return migrations.map((m) => {
    const row = done.get(m.version);
    return { version: m.version, name: m.name, status: !row ? 'pending' : row.checksum === m.checksum ? 'applied' : 'edited' };
  });
}

module.exports = { migrate, status, loadMigrations, checksum, MigrationError, DEFAULT_DIR };
