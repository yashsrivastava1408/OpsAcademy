const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { migrate } = require('../lib/migrator');

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('schema constraints (real Postgres)', () => {
  let pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    await pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'tests', 'bootstrap.sql'), 'utf8'));
    await migrate(pool);
  });
  afterAll(() => pool.end());

  const q = (sql, params) => pool.query(sql, params);
  const rejects = (sql, params, pattern) => expect(q(sql, params)).rejects.toThrow(pattern);

  test('users: emails are unique and lower-case; a registered account needs an email', async () => {
    await q("insert into users (id, name, email) values ('u1', 'Ada', 'ada@example.com')");
    await rejects("insert into users (id, name, email) values ('u2', 'Ada2', 'ada@example.com')", [], /users_email_key/);
    await rejects("insert into users (id, name, email) values ('u3', 'X', 'Upper@Example.com')", [], /check/);
    await rejects("insert into users (id, name) values ('u4', 'No email')", [], /users_registered_has_email/);
    await q("insert into users (id, name, guest) values ('g1', 'Guest-1', true), ('g2', 'Guest-2', true)");
  });

  test('users: profile slugs are unique and well formed', async () => {
    await q("update users set profile_slug = 'ada-1a2b3c' where id = 'u1'");
    await q("insert into users (id, name, guest, profile_slug) values ('g3', 'G', true, 'taken-slug')");
    await rejects("update users set profile_slug = 'taken-slug' where id = 'g1'", [], /users_profile_slug_key/);
    await rejects("update users set profile_slug = 'Bad Slug!' where id = 'g1'", [], /check/);
  });

  test('users: updated_at moves on update', async () => {
    const before = (await q("select updated_at from users where id = 'u1'")).rows[0].updated_at;
    await new Promise((r) => setTimeout(r, 15));
    await q("update users set name = 'Ada L' where id = 'u1'");
    const after = (await q("select updated_at from users where id = 'u1'")).rows[0].updated_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  test('memberships: a section must belong to the same college; platform admin has no college', async () => {
    await q("insert into colleges (id, name, slug) values ('c1', 'SRM', 'srm'), ('c2', 'Other', 'other')");
    await q("insert into sections (id, college_id, name) values ('s1', 'c1', 'CSE-A')");
    await q("insert into memberships (user_id, college_id, section_id, role) values ('u1', 'c1', 's1', 'student')");
    await rejects("insert into memberships (user_id, college_id, section_id, role) values ('g1', 'c2', 's1', 'student')", [], /memberships_section_same_college/);
    await rejects("insert into memberships (user_id, college_id, role) values ('g1', null, 'student')", [], /memberships_college_iff_not_platform/);
    await rejects("insert into memberships (user_id, college_id, role) values ('g1', 'c1', 'platform_admin')", [], /memberships_college_iff_not_platform/);
    await rejects("insert into memberships (user_id, college_id, role) values ('u1', 'c1', 'student')", [], /memberships_user_college_role_key/);
    await q("insert into memberships (user_id, college_id, role) values ('u1', null, 'platform_admin')");
    await rejects("insert into memberships (user_id, college_id, role) values ('u1', null, 'platform_admin')", [], /memberships_platform_admin_key/);
    await rejects("insert into memberships (user_id, college_id, role) values ('g1', 'c1', 'superuser')", [], /check/);
  });

  test('progress: xp cannot go negative and the row follows its user', async () => {
    await q("insert into progress (user_id, xp) values ('u1', 20)");
    await rejects("update progress set xp = -1 where user_id = 'u1'", [], /check/);
    await rejects("insert into progress (user_id) values ('nobody')", [], /foreign key/);
  });

  test('certificates: one per learner and unit; ids have a fixed format', async () => {
    const insert = (id) => q(
      "insert into certificates (id, user_id, student_name, unit_id, unit_title, score, issued_at, signature) values ($1, 'u1', 'Ada', 'linux', 'Linux', 90, now(), 'sig')",
      [id],
    );
    await insert('OPS-0123456789AB');
    await rejects("insert into certificates (id, user_id, student_name, unit_id, unit_title, score, issued_at, signature) values ('OPS-FFFFFFFFFFFF', 'u1', 'Ada', 'linux', 'Linux', 90, now(), 's')", [], /certificates_user_id_unit_id_key/);
    await expect(insert('bad-id')).rejects.toThrow(/check/);
  });

  test('lab queue: a learner waits at most once; slots end after they start', async () => {
    await q("insert into lab_queue (user_id) values ('u1')");
    await rejects("insert into lab_queue (user_id) values ('u1')", [], /lab_queue_one_waiting_key/);
    await q("update lab_queue set status = 'admitted' where user_id = 'u1'");
    // an admitted learner still holds their one open place; once they start (or give up) they can queue again
    await rejects("insert into lab_queue (user_id) values ('u1')", [], /lab_queue_one_open_key/);
    await rejects("update lab_queue set status = 'bogus' where user_id = 'u1'", [], /lab_queue_status_check/);
    await q("update lab_queue set status = 'started' where user_id = 'u1'");
    await q("insert into lab_queue (user_id) values ('u1')");
    await rejects("insert into lab_slots (college_id, starts_at, ends_at, capacity) values ('c1', now(), now() - interval '1 hour', 10)", [], /lab_slots_ends_after_start/);
    await rejects("insert into lab_slots (college_id, starts_at, ends_at, capacity) values ('c1', now(), now() + interval '1 hour', 0)", [], /check/);
  });

  test('audit log is append-only unless a retention job opts in', async () => {
    await q("insert into audit_log (actor_id, action) values ('u1', 'login')");
    await rejects("update audit_log set action = 'x'", [], /append-only/);
    await rejects('delete from audit_log', [], /append-only/);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("set local app.audit_purge = 'on'");
      await client.query('delete from audit_log');
      await client.query('commit');
    } finally {
      client.release();
    }
    expect((await q('select count(*)::int as n from audit_log')).rows[0].n).toBe(0);
  });

  test('every table has row-level security on', async () => {
    const { rows } = await q("select tablename from pg_tables where schemaname = 'public' and not rowsecurity");
    expect(rows).toEqual([]);
  });

  test('deleting a user removes their dependent rows', async () => {
    await q("delete from users where id = 'u1'");
    expect((await q("select count(*)::int as n from progress where user_id = 'u1'")).rows[0].n).toBe(0);
    expect((await q("select count(*)::int as n from certificates where user_id = 'u1'")).rows[0].n).toBe(0);
  });
});
