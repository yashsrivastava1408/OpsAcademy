/**
 * Postgres repositories (see docs/adr/0001). Every method is a short query or
 * transaction; none of them hold a connection across unrelated work.
 */

const { Pool } = require('pg');
const { RepoError } = require('./errors');
const { emptyProgress } = require('./memory');
const logger = require('../lib/logger');

const toDate = (ms) => new Date(ms);
const iso = (d) => (d ? d.toISOString() : undefined);

function mapError(err) {
  if (err instanceof RepoError) return err;
  if (err && err.code === '23505') {
    if (/users_email_key/.test(err.constraint || '')) return new RepoError('email_taken', 'User with this email already exists');
    if (/users_profile_slug_key/.test(err.constraint || '')) return new RepoError('slug_taken', 'Profile address is taken');
    if (/users_username_key/.test(err.constraint || '')) return new RepoError('username_taken', 'That lab ID is taken');
    if (/lab_queue_one_(waiting|open)_key/.test(err.constraint || '')) return new RepoError('already_queued', 'Already waiting for a lab seat');
    if (/users_pkey/.test(err.constraint || '')) return new RepoError('user_exists', 'User already exists');
  }
  if (err && err.code === '23503' && /user_id_fkey/.test(err.constraint || '')) {
    return new RepoError('user_missing', 'User does not exist');
  }
  return err;
}

// ── row mappers (database shape <-> the shape the services already use) ──

async function nodeRows(q, tail, params = []) {
  const { rows } = await q(
    `select node_id, base_url, capacity, running, draining, version,
            (extract(epoch from last_seen_at) * 1000)::float8 as seen_ms from lab_nodes ${tail}`, params);
  return rows.map((r) => ({
    nodeId: r.node_id, baseUrl: r.base_url, capacity: r.capacity, running: r.running,
    draining: r.draining, version: r.version, lastSeenAt: r.seen_ms,
  }));
}

const templateRow = (r) => ({
  id: r.id, collegeId: r.college_id, sectionId: r.section_id, weekday: r.weekday, startTime: String(r.start_time).slice(0, 5),
  durationMinutes: r.duration_minutes, seats: r.seats, unitId: r.unit_id, makeup: r.makeup, active: r.active, createdBy: r.created_by,
});
const slotRow = (r) => ({
  id: r.id, collegeId: r.college_id, sectionId: r.section_id, startsAt: r.starts_ms, endsAt: r.ends_ms, capacity: r.capacity,
  unitId: r.unit_id, makeup: r.makeup, templateId: r.template_id, createdBy: r.created_by,
});
const SLOT_COLUMNS = `id, college_id, section_id, capacity, unit_id, makeup, template_id, created_by,
  (extract(epoch from starts_at) * 1000)::float8 as starts_ms, (extract(epoch from ends_at) * 1000)::float8 as ends_ms`;
const queueRow = (r) => ({
  id: Number(r.id), userId: r.user_id, collegeId: r.college_id, slotId: r.slot_id, unitId: r.unit_id, status: r.status,
  enqueuedAt: r.enq_ms, lastSeenAt: r.seen_ms, admittedAt: r.adm_ms, expiresAt: r.exp_ms, sessionId: r.session_id,
});
const QUEUE_COLUMNS = `id, user_id, college_id, slot_id, unit_id, status, session_id,
  (extract(epoch from enqueued_at) * 1000)::float8 as enq_ms, (extract(epoch from last_seen_at) * 1000)::float8 as seen_ms,
  (extract(epoch from admitted_at) * 1000)::float8 as adm_ms, (extract(epoch from expires_at) * 1000)::float8 as exp_ms`;

const collegeRow = (r) => ({ id: r.id, name: r.name, slug: r.slug, timezone: r.timezone, active: r.active, createdAt: r.created_at.toISOString() });
const sectionRow = (r) => ({ id: r.id, collegeId: r.college_id, name: r.name, academicYear: r.academic_year });

function userFromRow(r) {
  const u = { id: r.id, name: r.name, guest: r.guest, emailVerified: r.email_verified, createdAt: iso(r.created_at) };
  if (r.email) u.email = r.email;
  if (r.profile_public) u.profilePublic = true;
  if (r.profile_slug) u.profileSlug = r.profile_slug;
  if (r.registered_at) u.registeredAt = iso(r.registered_at);
  if (r.username) u.username = r.username;
  if (r.lab_access) u.labAccess = true;
  if (r.disabled) u.disabled = true;
  return u;
}

const USER_PATCH_COLUMNS = {
  name: ['name', (v) => v],
  email: ['email', (v) => v],
  guest: ['guest', Boolean],
  emailVerified: ['email_verified', Boolean],
  profilePublic: ['profile_public', Boolean],
  profileSlug: ['profile_slug', (v) => v],
  registeredAt: ['registered_at', (v) => (v == null ? null : new Date(v))],
  username: ['username', (v) => (v == null ? null : String(v).toLowerCase())],
  labAccess: ['lab_access', Boolean],
  disabled: ['disabled', Boolean],
};

function progressFromRow(r) {
  return {
    userId: r.user_id, xp: r.xp, completedUnits: r.completed_units, steps: r.steps, hints: r.hints,
    quizzes: r.quizzes, cards: r.cards, interviews: r.interviews, activeDays: r.active_days, daily: r.daily,
  };
}

const PROGRESS_SELECT = `user_id, xp, completed_units, steps, hints, quizzes, cards, interviews, daily,
  active_days::text[] as active_days`;

function certFromRow(r) {
  return {
    id: r.id, userId: r.user_id, studentName: r.student_name, unitId: r.unit_id, unitTitle: r.unit_title,
    score: r.score, issuedAt: iso(r.issued_at), signature: r.signature,
  };
}

async function sessionRows(q, where, params = []) {
  const { rows } = await q(
    `select session_id, engine_id, user_id, lab_id, node_id, slot_id, from_pool, claim_ms, history, strikes,
            (extract(epoch from created_at) * 1000)::float8 as created_ms,
            (extract(epoch from last_active_at) * 1000)::float8 as active_ms
       from sandbox_sessions ${where}`, params);
  return rows.map(sessionFromRow);
}

function sessionFromRow(r) {
  return {
    sessionId: r.session_id, engineId: r.engine_id, userId: r.user_id, labId: r.lab_id, nodeId: r.node_id || undefined, slotId: r.slot_id || undefined,
    createdAt: r.created_ms, lastActiveAt: r.active_ms, fromPool: r.from_pool,
    claimMs: r.claim_ms === null ? undefined : Number(r.claim_ms), history: r.history, strikes: r.strikes,
  };
}

function createPostgresRepos({ connectionString, pool: injected = null, max = 10, ssl } = {}) {
  const pool = injected || new Pool({
    connectionString,
    max,
    ssl,
    idleTimeoutMillis: 30_000,
    // A new connection to a remote database takes ~1 s (TLS + auth + distance); allow generously.
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
  });
  if (!injected) pool.on('error', (err) => logger.error({ err: err.message }, '[postgres] idle client error'));

  /** Run `fn(client)` in a transaction. */
  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw mapError(err);
    } finally {
      client.release();
    }
  }

  /** One transaction under a cluster-wide lock, so counting seats and taking one cannot interleave between gateways. */
  async function seatTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select pg_advisory_xact_lock(hashtext('opsacademy:lab-seats'))");
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw mapError(err);
    } finally {
      client.release();
    }
  }
  async function seatUsageOn(client, slotId) {
    const { rows } = await client.query(
      `select
         (select count(*)::int from sandbox_sessions where slot_id = $1) + (select count(*)::int from lab_queue where status = 'admitted' and slot_id = $1 and expires_at > now()) as slot_used,
         (select count(*)::int from sandbox_sessions) + (select count(*)::int from lab_queue where status = 'admitted' and expires_at > now()) as cluster_used`,
      [slotId]
    );
    return { slot: slotId == null ? 0 : rows[0].slot_used, cluster: rows[0].cluster_used };
  }

  const q = async (sql, params) => {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      throw mapError(err);
    }
  };

  return {
    driver: 'postgres',
    pool,

    async ping() {
      await pool.query('select 1');
      return true;
    },
    async close() {
      await pool.end();
    },

    users: {
      async create(user) {
        const { rows } = await q(
          `insert into users (id, name, email, guest, email_verified, profile_public, profile_slug,
                              created_at, registered_at, username, lab_access, disabled)
           values ($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz, now()),$9,$10,$11,$12) returning *`,
          [user.id, user.name, user.email || null, Boolean(user.guest), Boolean(user.emailVerified),
            Boolean(user.profilePublic), user.profileSlug || null, user.createdAt || null,
            user.registeredAt || null, user.username ? String(user.username).toLowerCase() : null,
            Boolean(user.labAccess), Boolean(user.disabled)],
        );
        return userFromRow(rows[0]);
      },
      async createIfAbsent(user) {
        const { rows } = await q(
          `insert into users (id, name, email, guest, email_verified, created_at)
           values ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()))
           on conflict (id) do nothing returning *`,
          [user.id, user.name, user.email || null, Boolean(user.guest), Boolean(user.emailVerified), user.createdAt || null],
        );
        if (rows[0]) return userFromRow(rows[0]);
        return this.getById(user.id);
      },
      async getById(id) {
        const { rows } = await q('select * from users where id = $1', [id]);
        return rows[0] ? userFromRow(rows[0]) : null;
      },
      async getByEmail(email) {
        const { rows } = await q('select * from users where email = $1', [email]);
        return rows[0] ? userFromRow(rows[0]) : null;
      },
      async getBySlug(slug) {
        const { rows } = await q('select * from users where profile_slug = $1', [slug]);
        return rows[0] ? userFromRow(rows[0]) : null;
      },
      async getByUsername(username) {
        const { rows } = await q('select * from users where username = $1', [String(username).toLowerCase()]);
        return rows[0] ? userFromRow(rows[0]) : null;
      },
      async listLabAccounts({ search = '', limit = 50, offset = 0 } = {}) {
        const like = `%${search.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const where = "username is not null and ($1 = '%%' or username like $1 or lower(name) like $1)";
        const total = await q(`select count(*)::int as n from users where ${where}`, [like]);
        const { rows } = await q(`select * from users where ${where} order by created_at, username limit $2 offset $3`, [like, limit, offset]);
        return { total: total.rows[0].n, rows: rows.map(userFromRow) };
      },
      async maxUsernameSequence(prefix) {
        const { rows } = await q("select coalesce(max(substring(username from '-([0-9]+)$')::bigint), 0)::float8 as n from users where username like $1 and username ~ $2",
          [`${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}-%`, `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[0-9]+$`]);
        return Number(rows[0].n);
      },
      async update(id, patch) {
        const sets = [];
        const params = [id];
        for (const [key, value] of Object.entries(patch)) {
          const spec = USER_PATCH_COLUMNS[key];
          if (!spec) throw new RepoError('bad_patch', `Cannot update user field "${key}"`);
          params.push(spec[1](value));
          sets.push(`${spec[0]} = $${params.length}`);
        }
        if (sets.length === 0) return this.getById(id);
        const { rows } = await q(`update users set ${sets.join(', ')} where id = $1 returning *`, params);
        return rows[0] ? userFromRow(rows[0]) : null;
      },
      async namesByIds(ids) {
        if (ids.length === 0) return {};
        const { rows } = await q('select id, name from users where id = any($1::text[])', [ids]);
        return Object.fromEntries(rows.map((r) => [r.id, r.name]));
      },
      async counts() {
        const { rows } = await q('select count(*) filter (where guest)::int as guests, count(*) filter (where not guest)::int as registered from users');
        return { registered: rows[0].registered, guests: rows[0].guests };
      },
      async pruneGuests(cutoffMs) {
        const { rowCount } = await q('delete from users where guest and created_at < $1', [toDate(cutoffMs)]);
        return rowCount;
      },
    },

    progress: {
      async get(userId) {
        const { rows } = await q(`select ${PROGRESS_SELECT} from progress where user_id = $1`, [userId]);
        return rows[0] ? progressFromRow(rows[0]) : null;
      },
      /** Atomic read-modify-write under a row lock. `fn` must not start another progress.mutate for the same learner. */
      async mutate(userId, fn) {
        return tx(async (c) => {
          await c.query('insert into progress (user_id) values ($1) on conflict (user_id) do nothing', [userId]);
          const { rows } = await c.query(`select ${PROGRESS_SELECT} from progress where user_id = $1 for update`, [userId]);
          const doc = rows[0] ? progressFromRow(rows[0]) : emptyProgress(userId);
          const result = await fn(doc);
          await c.query(
            `update progress set xp = $2, completed_unit_count = $3, active_days = $4::date[],
               completed_units = $5::jsonb, steps = $6::jsonb, hints = $7::jsonb, quizzes = $8::jsonb,
               cards = $9::jsonb, interviews = $10::jsonb, daily = $11::jsonb
             where user_id = $1`,
            [userId, doc.xp, Object.keys(doc.completedUnits).length, doc.activeDays,
              JSON.stringify(doc.completedUnits), JSON.stringify(doc.steps), JSON.stringify(doc.hints),
              JSON.stringify(doc.quizzes), JSON.stringify(doc.cards), JSON.stringify(doc.interviews), JSON.stringify(doc.daily || {})],
          );
          return result;
        });
      },
      async leaderboard(limit = 20, { collegeId = null } = {}) {
        const { rows } = collegeId
          ? await q(
            `select user_id, xp, completed_unit_count, active_days::text[] as active_days from college_leaderboard
             where college_id = $1 order by xp desc, user_id asc limit $2`, [collegeId, limit])
          : await q(
            `select user_id, xp, completed_unit_count, active_days::text[] as active_days from progress
             where xp > 0 order by xp desc, user_id asc limit $1`, [limit]);
        return rows.map((r) => ({ userId: r.user_id, xp: r.xp, completedUnits: r.completed_unit_count, activeDays: r.active_days }));
      },
      async totals() {
        const { rows } = await q('select count(*) filter (where xp > 0)::int as n, coalesce(sum(xp), 0)::float8 as xp from progress');
        return { learnersWithXp: rows[0].n, totalXp: rows[0].xp };
      },
      async remove(userId) {
        const { rowCount } = await q('delete from progress where user_id = $1', [userId]);
        return rowCount > 0;
      },
    },

    memberships: {
      async add({ userId, collegeId, sectionId = null, role }) {
        await q('insert into memberships (user_id, college_id, section_id, role) values ($1,$2,$3,$4)', [userId, collegeId, sectionId, role]);
      },
      async forUser(userId) {
        const { rows } = await q('select user_id, college_id, section_id, role from memberships where user_id = $1', [userId]);
        return rows.map((r) => ({ userId: r.user_id, collegeId: r.college_id, sectionId: r.section_id, role: r.role }));
      },
      async remove({ userId, collegeId = null, role }) {
        const { rowCount } = await q('delete from memberships where user_id = $1 and college_id is not distinct from $2 and role = $3', [userId, collegeId, role]);
        return rowCount > 0;
      },
      async listByCollege(collegeId, { role = null } = {}) {
        const { rows } = await q(
          `select m.user_id, m.college_id, m.section_id, m.role, u.name, u.email
             from memberships m join users u on u.id = m.user_id
            where m.college_id = $1 and ($2::text is null or m.role = $2) order by u.name, m.user_id`,
          [collegeId, role]
        );
        return rows.map((r) => ({ userId: r.user_id, collegeId: r.college_id, sectionId: r.section_id, role: r.role, name: r.name, email: r.email }));
      },
    },

    colleges: {
      async create({ name, slug, timezone = 'Asia/Kolkata' }) {
        try {
          const { rows } = await q('insert into colleges (name, slug, timezone) values ($1,$2,$3) returning *', [name, slug, timezone]);
          return collegeRow(rows[0]);
        } catch (err) {
          if (err.code === '23505') throw new RepoError('college_slug_taken', 'A college with this address already exists');
          throw err;
        }
      },
      async getById(id) {
        const { rows } = await q('select * from colleges where id = $1', [id]);
        return rows[0] ? collegeRow(rows[0]) : null;
      },
      async getBySlug(slug) {
        const { rows } = await q('select * from colleges where slug = $1', [slug]);
        return rows[0] ? collegeRow(rows[0]) : null;
      },
      async list() {
        const { rows } = await q('select * from colleges order by name');
        return rows.map(collegeRow);
      },
    },

    sections: {
      async ensure({ collegeId, name, academicYear = null }) {
        try {
          const { rows } = await q(
            `insert into sections (college_id, name, academic_year) values ($1,$2,$3)
             on conflict (college_id, name) do update set name = excluded.name returning *`,
            [collegeId, name, academicYear]
          );
          return sectionRow(rows[0]);
        } catch (err) {
          if (err.code === '23503') throw new RepoError('college_missing', `College ${collegeId} does not exist`);
          throw err;
        }
      },
      async listByCollege(collegeId) {
        const { rows } = await q('select * from sections where college_id = $1 order by name', [collegeId]);
        return rows.map(sectionRow);
      },
    },

    identities: {
      async link({ provider = 'supabase', subject, userId }) {
        await q(
          `insert into identities (provider, subject, user_id) values ($1,$2,$3)
           on conflict (provider, subject) do update set user_id = excluded.user_id`,
          [provider, subject, userId]
        );
      },
      async getUserId(provider, subject) {
        const { rows } = await q('select user_id from identities where provider = $1 and subject = $2', [provider, subject]);
        return rows[0] ? rows[0].user_id : null;
      },
      async getSubject(provider, userId) {
        const { rows } = await q('select subject from identities where provider = $1 and user_id = $2 limit 1', [provider, userId]);
        return rows[0] ? rows[0].subject : null;
      },
    },

    invites: {
      async add({ collegeId, sectionId = null, email, role = 'student' }) {
        await q(
          `insert into college_invites (college_id, section_id, email, role) values ($1,$2,$3,$4)
           on conflict (college_id, email, role) do update set section_id = excluded.section_id`,
          [collegeId, sectionId, email, role]
        );
      },
      async listByCollege(collegeId) {
        const { rows } = await q('select college_id, section_id, email, role from college_invites where college_id = $1 order by email', [collegeId]);
        return rows.map((r) => ({ collegeId: r.college_id, sectionId: r.section_id, email: r.email, role: r.role }));
      },
      async claim(userId, email) {
        const { rowCount } = await q(
          `with claimed as (delete from college_invites where email = $1 returning college_id, section_id, role)
           insert into memberships (user_id, college_id, section_id, role)
           select $2, college_id, section_id, role from claimed
           on conflict do nothing`,
          [email, userId]
        );
        return rowCount;
      },
    },

    rateLimits: {
      async hit(key, windowMs) {
        const { rows } = await q(
          `insert into rate_limit_hits (key, hits, reset_at) values ($1, 1, now() + ($2 || ' milliseconds')::interval)
           on conflict (key) do update set
             hits = case when rate_limit_hits.reset_at <= now() then 1 else rate_limit_hits.hits + 1 end,
             reset_at = case when rate_limit_hits.reset_at <= now() then now() + ($2 || ' milliseconds')::interval else rate_limit_hits.reset_at end
           returning hits, (extract(epoch from reset_at) * 1000)::bigint as reset_ms`,
          [key, String(windowMs)]
        );
        return { hits: rows[0].hits, resetAt: Number(rows[0].reset_ms) };
      },
      async decrement(key) { await q('update rate_limit_hits set hits = hits - 1 where key = $1 and hits > 0', [key]); },
      async reset(key) { await q('delete from rate_limit_hits where key = $1', [key]); },
      async prune() {
        const { rowCount } = await q('delete from rate_limit_hits where reset_at <= now()');
        return rowCount;
      },
    },

    nodes: {
      async heartbeat({ nodeId, baseUrl, capacity, running = 0, draining = false, version = null }) {
        await q(
          `insert into lab_nodes (node_id, base_url, capacity, running, draining, version, last_seen_at)
           values ($1,$2,$3,$4,$5,$6, now())
           on conflict (node_id) do update set base_url = excluded.base_url, capacity = excluded.capacity,
             running = excluded.running, draining = excluded.draining, version = excluded.version, last_seen_at = now()`,
          [nodeId, baseUrl, capacity, running, draining, version]
        );
      },
      async get(nodeId) { return (await nodeRows(q, 'where node_id = $1', [nodeId]))[0] || null; },
      async list() { return nodeRows(q, 'order by node_id'); },
      async listHealthy(maxAgeMs) {
        return nodeRows(q, "where not draining and last_seen_at >= now() - ($1 || ' milliseconds')::interval order by node_id", [String(maxAgeMs)]);
      },
      async remove(nodeId) {
        const { rowCount } = await q('delete from lab_nodes where node_id = $1', [nodeId]);
        return rowCount > 0;
      },
    },

    tickets: {
      async create({ hash, sessionId, userId, expiresAt }) {
        try {
          await q('insert into terminal_tickets (hash, session_id, user_id, expires_at) values ($1,$2,$3,$4)', [hash, sessionId, userId, toDate(expiresAt)]);
        } catch (err) {
          if (err.code === '23503') throw new RepoError('session_missing', 'Session does not exist');
          throw err;
        }
      },
      async redeem(hash) {
        // One statement: the ticket is consumed by whoever deletes it, and only if it has not expired.
        const { rows } = await q('delete from terminal_tickets where hash = $1 returning session_id, user_id, expires_at > now() as valid', [hash]);
        return rows[0] && rows[0].valid ? { sessionId: rows[0].session_id, userId: rows[0].user_id } : null;
      },
      async prune() {
        const { rowCount } = await q('delete from terminal_tickets where expires_at <= now()');
        return rowCount;
      },
    },

    slots: {
      async createTemplate(t) {
        const { rows } = await q(
          `insert into slot_templates (college_id, section_id, weekday, start_time, duration_minutes, seats, unit_id, makeup, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
          [t.collegeId, t.sectionId || null, t.weekday, t.startTime, t.durationMinutes, t.seats, t.unitId || null, Boolean(t.makeup), t.createdBy || null]
        );
        return templateRow(rows[0]);
      },
      async getTemplate(id) {
        const { rows } = await q('select * from slot_templates where id = $1', [id]);
        return rows[0] ? templateRow(rows[0]) : null;
      },
      async listTemplates(collegeId) {
        const { rows } = await q('select * from slot_templates where college_id = $1 order by weekday, start_time, id', [collegeId]);
        return rows.map(templateRow);
      },
      async updateTemplate(id, patch) {
        const columns = { active: 'active', seats: 'seats', durationMinutes: 'duration_minutes', startTime: 'start_time', weekday: 'weekday', makeup: 'makeup', unitId: 'unit_id' };
        const sets = [];
        const params = [id];
        for (const [key, value] of Object.entries(patch)) {
          if (!columns[key]) throw new RepoError('bad_patch', `Cannot update template field "${key}"`);
          params.push(value);
          sets.push(`${columns[key]} = $${params.length}`);
        }
        if (!sets.length) return this.getTemplate(id);
        const { rows } = await q(`update slot_templates set ${sets.join(', ')} where id = $1 returning *`, params);
        return rows[0] ? templateRow(rows[0]) : null;
      },
      async deleteTemplate(id) {
        const { rowCount } = await q('delete from slot_templates where id = $1', [id]);
        return rowCount > 0;
      },
      async addBlackout({ collegeId, onDate, reason = null }) {
        const { rows } = await q(
          `insert into blackout_dates (college_id, on_date, reason) values ($1,$2,$3)
           on conflict (college_id, on_date) do update set reason = excluded.reason returning id, college_id, to_char(on_date, 'YYYY-MM-DD') as on_date, reason`,
          [collegeId, onDate, reason]
        );
        return { id: rows[0].id, collegeId: rows[0].college_id, onDate: rows[0].on_date, reason: rows[0].reason };
      },
      async listBlackouts(collegeId) {
        const { rows } = await q("select id, college_id, to_char(on_date, 'YYYY-MM-DD') as on_date, reason from blackout_dates where college_id = $1 order by on_date", [collegeId]);
        return rows.map((r) => ({ id: r.id, collegeId: r.college_id, onDate: r.on_date, reason: r.reason }));
      },
      async removeBlackout(collegeId, id) {
        const { rowCount } = await q('delete from blackout_dates where id = $1 and college_id = $2', [id, collegeId]);
        return rowCount > 0;
      },
      async createSlots(rows) {
        let created = 0;
        for (const r of rows) {
          const { rowCount } = await q(
            `insert into lab_slots (college_id, section_id, starts_at, ends_at, capacity, unit_id, makeup, template_id, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (template_id, starts_at) where template_id is not null do nothing`,
            [r.collegeId, r.sectionId || null, toDate(r.startsAt), toDate(r.endsAt), r.capacity, r.unitId || null, Boolean(r.makeup), r.templateId || null, r.createdBy || null]
          );
          created += rowCount;
        }
        return created;
      },
      async getSlot(id) {
        const { rows } = await q(`select ${SLOT_COLUMNS} from lab_slots where id = $1`, [id]);
        return rows[0] ? slotRow(rows[0]) : null;
      },
      async listSlots({ collegeId = null, from, to }) {
        const { rows } = await q(
          `select ${SLOT_COLUMNS} from lab_slots where ($1::text is null or college_id = $1) and ends_at > $2 and starts_at < $3 order by starts_at, id`,
          [collegeId, toDate(from), toDate(to)]
        );
        return rows.map(slotRow);
      },
      async updateSlot(id, patch) {
        const columns = { sectionId: 'section_id', capacity: 'capacity', unitId: 'unit_id' };
        const sets = [];
        const params = [id];
        for (const [key, value] of Object.entries(patch)) {
          if (!columns[key]) throw new RepoError('bad_patch', `Cannot update slot field "${key}"`);
          params.push(value);
          sets.push(`${columns[key]} = $${params.length}`);
        }
        if (!sets.length) return this.getSlot(id);
        await q(`update lab_slots set ${sets.join(', ')} where id = $1`, params);
        return this.getSlot(id);
      },
      async deleteSlot(id) {
        const { rowCount } = await q('delete from lab_slots where id = $1', [id]);
        return rowCount > 0;
      },
      async setAssignment({ slotId, userId, kind = 'add' }) {
        await q(
          `insert into slot_assignments (slot_id, user_id, kind) values ($1,$2,$3)
           on conflict (slot_id, user_id) do update set kind = excluded.kind`,
          [slotId, userId, kind]
        );
      },
      async removeAssignment(slotId, userId) {
        const { rowCount } = await q('delete from slot_assignments where slot_id = $1 and user_id = $2', [slotId, userId]);
        return rowCount > 0;
      },
      async listAssignments(slotId) {
        const { rows } = await q(
          'select a.slot_id, a.user_id, a.kind, u.name from slot_assignments a join users u on u.id = a.user_id where a.slot_id = $1 order by u.name, a.user_id', [slotId]);
        return rows.map((r) => ({ slotId: r.slot_id, userId: r.user_id, kind: r.kind, name: r.name }));
      },
      async assignmentsForUser(userId) {
        const { rows } = await q('select slot_id, user_id, kind from slot_assignments where user_id = $1', [userId]);
        return rows.map((r) => ({ slotId: r.slot_id, userId: r.user_id, kind: r.kind }));
      },
    },

    queue: {
      async enqueue({ userId, collegeId = null, slotId = null, unitId = null }) {
        const { rows } = await q(
          `insert into lab_queue (user_id, college_id, slot_id, unit_id) values ($1,$2,$3,$4) returning ${QUEUE_COLUMNS}`,
          [userId, collegeId, slotId, unitId]
        );
        return queueRow(rows[0]);
      },
      async reserve({ userId, collegeId = null, slotId = null, unitId = null, ttlMs }) {
        const { rows } = await q(
          `insert into lab_queue (user_id, college_id, slot_id, unit_id, status, admitted_at, expires_at)
           values ($1,$2,$3,$4,'admitted', now(), now() + ($5 || ' milliseconds')::interval) returning ${QUEUE_COLUMNS}`,
          [userId, collegeId, slotId, unitId, String(ttlMs)]
        );
        return queueRow(rows[0]);
      },
      async getOpen(userId) {
        const { rows } = await q(`select ${QUEUE_COLUMNS} from lab_queue where user_id = $1 and status in ('waiting','admitted')`, [userId]);
        return rows[0] ? queueRow(rows[0]) : null;
      },
      async position(entry) {
        const { rows } = await q("select count(*)::int as n from lab_queue where status = 'waiting' and slot_id is not distinct from $1 and id <= $2", [entry.slotId, entry.id]);
        return rows[0].n;
      },
      async waitingCount(slotId) {
        const { rows } = await q("select count(*)::int as n from lab_queue where status = 'waiting' and slot_id is not distinct from $1", [slotId]);
        return rows[0].n;
      },
      async countHeldAll() {
        const { rows } = await q("select count(*)::int as n from lab_queue where status = 'admitted' and expires_at > now()");
        return rows[0].n;
      },
      async countHeld(slotId) {
        const { rows } = await q("select count(*)::int as n from lab_queue where status = 'admitted' and slot_id is not distinct from $1 and expires_at > now()", [slotId]);
        return rows[0].n;
      },
      async touch(id) { await q('update lab_queue set last_seen_at = now() where id = $1', [id]); },
      async cancel(userId) {
        const { rowCount } = await q("update lab_queue set status = 'cancelled' where user_id = $1 and status in ('waiting','admitted')", [userId]);
        return rowCount > 0;
      },
      async admit({ slotId = null, limit, ttlMs }) {
        // One statement: rows another worker has locked are skipped, so two workers never admit the same person.
        const { rows } = await q(
          `with next as (
             select id from lab_queue where status = 'waiting' and slot_id is not distinct from $1 order by id limit $2 for update skip locked)
           update lab_queue q set status = 'admitted', admitted_at = now(), expires_at = now() + ($3 || ' milliseconds')::interval
             from next where q.id = next.id returning q.id, q.user_id, q.college_id, q.slot_id, q.unit_id, q.status, q.session_id,
             (extract(epoch from q.enqueued_at) * 1000)::float8 as enq_ms, (extract(epoch from q.last_seen_at) * 1000)::float8 as seen_ms,
             (extract(epoch from q.admitted_at) * 1000)::float8 as adm_ms, (extract(epoch from q.expires_at) * 1000)::float8 as exp_ms`,
          [slotId, Math.max(0, limit), String(ttlMs)]
        );
        return rows.map(queueRow).sort((a, b) => a.id - b.id);
      },
      async expire({ now = Date.now(), waitingStaleMs }) {
        const { rowCount } = await q(
          `update lab_queue set status = 'expired'
            where (status = 'admitted' and expires_at <= $1) or (status = 'waiting' and last_seen_at < $2)`,
          [toDate(now), toDate(now - waitingStaleMs)]
        );
        return rowCount;
      },
      async markStarted(id, sessionId) {
        await q("update lab_queue set status = 'started', session_id = $2 where id = $1", [id, sessionId]);
      },
      async attendedSlots(userId, slotIds) {
        if (!slotIds.length) return [];
        const { rows } = await q("select distinct slot_id from lab_queue where user_id = $1 and status = 'started' and slot_id = any($2::text[])", [userId, slotIds]);
        return rows.map((r) => r.slot_id);
      },
      /** Seats in use: running sessions plus seats held for admitted entries, in a slot and across the cluster. */
      async seatUsage(slotId) {
        const { rows } = await q(
          `select
             (select count(*)::int from sandbox_sessions where slot_id = $1) + (select count(*)::int from lab_queue where status = 'admitted' and slot_id = $1 and expires_at > now()) as slot_used,
             (select count(*)::int from sandbox_sessions) + (select count(*)::int from lab_queue where status = 'admitted' and expires_at > now()) as cluster_used`,
          [slotId]
        );
        return { slot: slotId == null ? 0 : rows[0].slot_used, cluster: rows[0].cluster_used };
      },
      async reserveSeat({ userId, collegeId = null, slotId = null, unitId = null, ttlMs, slotCapacity = null, clusterCapacity }) {
        return seatTransaction(async (client) => {
          const used = await seatUsageOn(client, slotId);
          if (used.cluster >= clusterCapacity || (slotId != null && slotCapacity != null && used.slot >= slotCapacity)) return null;
          const { rows } = await client.query(
            `insert into lab_queue (user_id, college_id, slot_id, unit_id, status, admitted_at, expires_at)
             values ($1,$2,$3,$4,'admitted', now(), now() + ($5 || ' milliseconds')::interval) returning ${QUEUE_COLUMNS}`,
            [userId, collegeId, slotId, unitId, String(ttlMs)]
          );
          return queueRow(rows[0]);
        });
      },
      async admitSeats({ slotId = null, slotCapacity = null, clusterCapacity, ttlMs }) {
        return seatTransaction(async (client) => {
          const used = await seatUsageOn(client, slotId);
          let free = clusterCapacity - used.cluster;
          if (slotId != null && slotCapacity != null) free = Math.min(free, slotCapacity - used.slot);
          if (free <= 0) return [];
          const { rows } = await client.query(
            `with next as (
               select id from lab_queue where status = 'waiting' and slot_id is not distinct from $1 order by id limit $2 for update skip locked)
             update lab_queue q set status = 'admitted', admitted_at = now(), expires_at = now() + ($3 || ' milliseconds')::interval
               from next where q.id = next.id returning q.id, q.user_id, q.college_id, q.slot_id, q.unit_id, q.status, q.session_id,
               (extract(epoch from q.enqueued_at) * 1000)::float8 as enq_ms, (extract(epoch from q.last_seen_at) * 1000)::float8 as seen_ms,
               (extract(epoch from q.admitted_at) * 1000)::float8 as adm_ms, (extract(epoch from q.expires_at) * 1000)::float8 as exp_ms`,
            [slotId, free, String(ttlMs)]
          );
          return rows.map(queueRow).sort((a, b) => a.id - b.id);
        });
      },
      async scopesWaiting() {
        const { rows } = await q("select distinct slot_id from lab_queue where status = 'waiting'");
        return rows.map((r) => r.slot_id);
      },
    },

    events: {
      async record({ name, userId = null, collegeId = null, props = {} }) {
        await q('insert into analytics_events (name, user_id, college_id, props) values ($1,$2,$3,$4)', [name, userId, collegeId, JSON.stringify(props)]);
      },
      async funnel({ from, to }) {
        const { rows } = await q(
          `select name, props->>'step' as step, props->>'ok' as ok, count(*)::int as count from analytics_events
            where at >= $1 and at < $2 group by 1, 2, 3 order by name, step`,
          [toDate(from), toDate(to)]
        );
        return rows.map((r) => ({ name: r.name, step: r.step, ok: r.ok, count: r.count }));
      },
    },

    audit: {
      async record({ actorId = null, actorRole = null, action, entityType = null, entityId = null, collegeId = null, ip = null, meta = {} }) {
        await q(
          'insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, college_id, ip, meta) values ($1,$2,$3,$4,$5,$6,$7,$8)',
          [actorId, actorRole, action, entityType, entityId, collegeId, ip, JSON.stringify(meta)]
        );
      },
      async list({ collegeId, actorId, limit = 100 } = {}) {
        const { rows } = await q(
          `select * from audit_log
            where ($1::boolean = false or college_id is not distinct from $2) and ($3::text is null or actor_id = $3)
            order by id desc limit $4`,
          [collegeId !== undefined, collegeId === undefined ? null : collegeId, actorId || null, limit]
        );
        return rows.map((r) => ({
          id: Number(r.id), at: r.at.toISOString(), actorId: r.actor_id, actorRole: r.actor_role, action: r.action,
          entityType: r.entity_type, entityId: r.entity_id, collegeId: r.college_id, ip: r.ip, meta: r.meta,
        }));
      },
    },

    certificates: {
      async create(cert) {
        const { rows } = await q(
          `insert into certificates (id, user_id, student_name, unit_id, unit_title, score, issued_at, signature)
           values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (user_id, unit_id) do nothing returning *`,
          [cert.id, cert.userId, cert.studentName, cert.unitId, cert.unitTitle, cert.score, cert.issuedAt, cert.signature],
        );
        return rows[0] ? certFromRow(rows[0]) : this.getForUnit(cert.userId, cert.unitId);
      },
      async getById(id) {
        const { rows } = await q('select * from certificates where id = $1', [id]);
        return rows[0] ? certFromRow(rows[0]) : null;
      },
      async getForUnit(userId, unitId) {
        const { rows } = await q('select * from certificates where user_id = $1 and unit_id = $2', [userId, unitId]);
        return rows[0] ? certFromRow(rows[0]) : null;
      },
      async listForUser(userId) {
        const { rows } = await q('select * from certificates where user_id = $1 order by issued_at', [userId]);
        return rows.map(certFromRow);
      },
      async count() {
        const { rows } = await q('select count(*)::int as n from certificates');
        return rows[0].n;
      },
    },

    sessions: {
      async upsert(s) {
        await q(
          `insert into sandbox_sessions (session_id, engine_id, user_id, lab_id, node_id, slot_id, from_pool, claim_ms, history, strikes, created_at, last_active_at)
           values ($1,$2,$3,$4,$5,$12,$6,$7,$8::jsonb,$9,$10,$11)
           on conflict (session_id) do update set last_active_at = greatest(sandbox_sessions.last_active_at, excluded.last_active_at),
             history = excluded.history, strikes = greatest(sandbox_sessions.strikes, excluded.strikes)`,
          [s.sessionId, s.engineId, s.userId, s.labId || null, s.nodeId || null, Boolean(s.fromPool), s.claimMs ?? null,
            JSON.stringify(s.history || []), s.strikes || 0, toDate(s.createdAt), toDate(s.lastActiveAt), s.slotId || null],
        );
      },
      async delete(sessionId) {
        const { rowCount } = await q('delete from sandbox_sessions where session_id = $1', [sessionId]);
        return rowCount > 0;
      },
      async all() { return sessionRows(q, ''); },
      async get(sessionId) { return (await sessionRows(q, 'where session_id = $1', [sessionId]))[0] || null; },
      async countBySlot(slotId) {
        const { rows } = await q('select count(*)::int as n from sandbox_sessions where slot_id = $1', [slotId]);
        return rows[0].n;
      },
      async listByUser(userId) { return sessionRows(q, 'where user_id = $1 order by created_at', [userId]); },
      async count() {
        const { rows } = await q('select count(*)::int as n from sandbox_sessions');
        return rows[0].n;
      },
      async countByUser(userId) {
        const { rows } = await q('select count(*)::int as n from sandbox_sessions where user_id = $1', [userId]);
        return rows[0].n;
      },
      async listByNode(nodeId) { return sessionRows(q, 'where node_id = $1', [nodeId]); },
      async touch(sessionId, atMs = Date.now()) {
        await q('update sandbox_sessions set last_active_at = greatest(last_active_at, $2) where session_id = $1', [sessionId, toDate(atMs)]);
      },
      async appendCommand(sessionId, entry, cap) {
        // One statement: append, then keep only the newest `cap` entries.
        await q(
          `update sandbox_sessions set history = coalesce((
             select jsonb_agg(e order by ord) from (
               select e, ord from jsonb_array_elements(history || $2::jsonb) with ordinality as t(e, ord)
               order by ord desc limit $3) newest), '[]'::jsonb)
           where session_id = $1`,
          [sessionId, JSON.stringify([entry]), cap]
        );
      },
      async clearHistory(sessionId) {
        await q("update sandbox_sessions set history = '[]'::jsonb where session_id = $1", [sessionId]);
      },
      async addStrike(sessionId) {
        const { rows } = await q('update sandbox_sessions set strikes = strikes + 1 where session_id = $1 returning strikes', [sessionId]);
        return rows[0] ? rows[0].strikes : 0;
      },
      async listExpired({ createdBefore, activeBefore }) {
        return sessionRows(q, 'where created_at < $1 or last_active_at < $2', [toDate(createdBefore), toDate(activeBefore)]);
      },
    },

    jobs: {
      /** Run `fn` only if no other process holds the named lock. @returns { ran, result } */
      async withLock(name, fn) {
        const client = await pool.connect();
        try {
          const { rows } = await client.query('select pg_try_advisory_lock(hashtext($1)) as ok', [`opsacademy:${name}`]);
          if (!rows[0].ok) return { ran: false };
          try {
            return { ran: true, result: await fn() };
          } finally {
            await client.query('select pg_advisory_unlock(hashtext($1))', [`opsacademy:${name}`]).catch(() => {});
          }
        } finally {
          client.release();
        }
      },
      async refreshLeaderboards() {
        await pool.query('refresh materialized view concurrently public.college_leaderboard');
      },
    },
  };
}

module.exports = { createPostgresRepos };
