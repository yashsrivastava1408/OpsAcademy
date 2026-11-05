const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { migrate, status, loadMigrations, MigrationError } = require('../lib/migrator');

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

function tmpMigrations(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

describe('loadMigrations', () => {
  test('orders files, ignores markdown and rejects bad names or duplicate versions', () => {
    const dir = tmpMigrations({ '0002_b.sql': 'select 2', '0001_a.sql': 'select 1', 'README.md': '#' });
    expect(loadMigrations(dir).map((m) => m.file)).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(() => loadMigrations(tmpMigrations({ 'init.sql': 'x' }))).toThrow(MigrationError);
    expect(() => loadMigrations(tmpMigrations({ '0001_a.sql': 'x', '0001_b.sql': 'y' }))).toThrow(/Duplicate/);
  });

  test('the repository migrations are valid and numbered without gaps', () => {
    const versions = loadMigrations().map((m) => Number(m.version));
    expect(versions.length).toBeGreaterThan(0);
    versions.forEach((v, i) => expect(v).toBe(i + 1));
  });
});

describeDb('migrate (real Postgres)', () => {
  let pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 4 });
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await pool.query('drop schema public cascade; create schema public; grant all on schema public to public');
  });

  test('applies pending files in order and records them; a second run does nothing', async () => {
    const dir = tmpMigrations({
      '0001_a.sql': 'create table a (id int primary key);',
      '0002_b.sql': 'create table b (id int references a(id));',
    });
    const first = await migrate(pool, { dir });
    expect(first.applied).toEqual(['0001', '0002']);
    const second = await migrate(pool, { dir });
    expect(second.applied).toEqual([]);
    expect((await status(pool, { dir })).map((s) => s.status)).toEqual(['applied', 'applied']);
  });

  test('a failing migration rolls back completely and later files are not applied', async () => {
    const dir = tmpMigrations({
      '0001_ok.sql': 'create table ok (id int);',
      '0002_bad.sql': 'create table half (id int); select 1/0;',
      '0003_later.sql': 'create table later (id int);',
    });
    await expect(migrate(pool, { dir })).rejects.toThrow(/0002_bad.sql failed and was rolled back/);
    const tables = (await pool.query("select table_name from information_schema.tables where table_schema='public'")).rows.map((r) => r.table_name);
    expect(tables).toContain('ok');
    expect(tables).not.toContain('half');
    expect(tables).not.toContain('later');
    expect((await status(pool, { dir })).map((s) => s.status)).toEqual(['applied', 'pending', 'pending']);
  });

  test('refuses to run when an applied migration was edited', async () => {
    const dir = tmpMigrations({ '0001_a.sql': 'create table a (id int);' });
    await migrate(pool, { dir });
    fs.writeFileSync(path.join(dir, '0001_a.sql'), 'create table a (id int, extra int);');
    await expect(migrate(pool, { dir })).rejects.toThrow(/edited after it was applied/);
    expect((await status(pool, { dir }))[0].status).toBe('edited');
  });

  test('refuses an out-of-order new migration and a database ahead of the repo', async () => {
    const dir = tmpMigrations({ '0001_a.sql': 'select 1', '0003_c.sql': 'select 1' });
    await migrate(pool, { dir });
    fs.writeFileSync(path.join(dir, '0002_b.sql'), 'select 1');
    await expect(migrate(pool, { dir })).rejects.toThrow(/lower number/);
    fs.rmSync(path.join(dir, '0003_c.sql'));
    fs.rmSync(path.join(dir, '0002_b.sql'));
    await expect(migrate(pool, { dir })).rejects.toThrow(/missing from the repo/);
  });

  test('dry run lists without applying', async () => {
    const dir = tmpMigrations({ '0001_a.sql': 'create table a (id int);' });
    const logs = [];
    const result = await migrate(pool, { dir, dryRun: true, log: (m) => logs.push(m) });
    expect(result.applied).toEqual([]);
    expect(logs).toEqual(['would apply 0001_a.sql']);
    expect((await status(pool, { dir }))[0].status).toBe('pending');
  });

  test('two runners at once apply each migration exactly once', async () => {
    const dir = tmpMigrations({ '0001_slow.sql': 'create table t (id int); select pg_sleep(0.3);' });
    const [a, b] = await Promise.all([migrate(pool, { dir }), migrate(pool, { dir })]);
    expect(a.applied.length + b.applied.length).toBe(1);
  });

  test('applies the repository migrations on a Supabase-like database', async () => {
    const bootstrap = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'tests', 'bootstrap.sql'), 'utf8');
    await pool.query(bootstrap);
    const result = await migrate(pool);
    expect(result.applied.length).toBeGreaterThan(0);
    expect((await migrate(pool)).applied).toEqual([]);
  });
});
