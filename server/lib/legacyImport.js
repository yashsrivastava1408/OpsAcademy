/**
 * One-shot import of the old document stores (store.json, SQLite store.db, the Supabase
 * `documents` table) into the relational schema. See docs/runbooks/DATA_MIGRATION.md.
 *
 *  - It is idempotent: rows that already exist are left alone, so it can be re-run.
 *  - It runs in one transaction. A dry run does everything and then rolls back, so its
 *    report is exactly what a real run would do. A real run commits only if verification passes.
 *  - Records it cannot import (orphans, duplicates, malformed) are counted by reason, never silently dropped.
 */

const fs = require('fs');

const ID_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9-]{3,48}$/;
const CERT_ID = /^OPS-[0-9A-F]{12}$/;

// ── readers: each returns { users: [], emails: [], tokens: [], progress: [], certificates: [] } ──

const COLLECTIONS = ['users', 'tokens', 'progress', 'certificates'];

function fromCollections(byName) {
  const out = {};
  for (const name of COLLECTIONS) out[name] = Object.values(byName[name] || {});
  return out;
}

function readJson(filePath) {
  return fromCollections(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function readSqlite(filePath) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const byName = {};
    for (const row of db.prepare('select collection, id, doc from documents').all()) {
      (byName[row.collection] ||= {})[row.id] = JSON.parse(row.doc);
    }
    return fromCollections(byName);
  } finally {
    db.close();
  }
}

async function readSupabase({ url, key }) {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const byName = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('documents').select('collection, id, doc')
      .order('collection').order('id').range(from, from + 999);
    if (error) throw new Error(`Could not read Supabase documents: ${error.message}`);
    for (const row of data) (byName[row.collection] ||= {})[row.id] = row.doc;
    if (data.length < 1000) break;
  }
  return fromCollections(byName);
}

// ── cleaning ──────────────────────────────────────────────────

const validDate = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

function cleanUser(doc) {
  if (!doc || typeof doc.id !== 'string' || !doc.id) return null;
  const guest = Boolean(doc.guest);
  const email = typeof doc.email === 'string' && doc.email.trim() ? doc.email.trim().toLowerCase() : null;
  const name = String(doc.name || '').trim().slice(0, 80) || (guest ? 'Guest' : 'Learner');
  return {
    id: doc.id,
    name,
    email,
    password: doc.password || null,
    guest,
    emailVerified: Boolean(doc.emailVerified),
    profilePublic: Boolean(doc.profilePublic),
    profileSlug: SLUG.test(doc.profileSlug || '') ? doc.profileSlug : null,
    passwordChangedAt: Number.isFinite(doc.passwordChangedAt) ? new Date(doc.passwordChangedAt) : null,
    createdAt: validDate(doc.createdAt) || new Date(),
    registeredAt: doc.registeredAt ? validDate(doc.registeredAt) : null,
  };
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function cleanProgress(doc) {
  if (!doc || typeof doc.userId !== 'string') return null;
  const completedUnits = obj(doc.completedUnits);
  return {
    userId: doc.userId,
    xp: Number.isInteger(doc.xp) && doc.xp > 0 ? doc.xp : 0,
    completedUnits,
    steps: obj(doc.steps),
    hints: obj(doc.hints),
    quizzes: obj(doc.quizzes),
    cards: obj(doc.cards),
    interviews: Array.isArray(doc.interviews) ? doc.interviews : [],
    activeDays: (Array.isArray(doc.activeDays) ? doc.activeDays : []).filter((d) => typeof d === 'string' && ID_DAY.test(d)),
    daily: obj(doc.daily),
  };
}

// ── import ────────────────────────────────────────────────────

const bump = (counter, key) => {
  counter[key] = (counter[key] || 0) + 1;
};

/**
 * @param {import('pg').Pool} pool
 * @param {{ users, tokens, progress, certificates }} data  from a reader
 * @param {{ apply?: boolean, now?: number }} options
 * @returns the report; `report.committed` says whether anything was written
 */
async function importLegacy(pool, data, { apply = false, now = Date.now() } = {}) {
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    users: { source: data.users.length, imported: 0, skipped: {} },
    tokens: { source: data.tokens.length, imported: 0, skipped: {} },
    progress: { source: data.progress.length, imported: 0, skipped: {} },
    certificates: { source: data.certificates.length, imported: 0, skipped: {} },
    verification: { ok: true, checks: [] },
    committed: false,
  };

  const client = await pool.connect();
  try {
    await client.query('begin');

    // 1. users, oldest first so that on a duplicate email the original account wins
    const users = data.users.map(cleanUser);
    const sorted = users.filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
    report.users.skipped.malformed = users.length - sorted.length;
    const expectedUserIds = new Set();
    for (const u of sorted) {
      if (!u.guest && !u.email) {
        bump(report.users.skipped, 'registered_without_email');
        continue;
      }
      const { rowCount } = await client.query(
        `insert into users (id, name, email, password_hash, guest, email_verified, profile_public, profile_slug,
                            password_changed_at, created_at, registered_at, auth_provider)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'local') on conflict do nothing`,
        [u.id, u.name, u.email, u.password, u.guest, u.emailVerified, u.profilePublic, u.profileSlug,
          u.passwordChangedAt, u.createdAt, u.registeredAt],
      );
      if (rowCount === 1) {
        report.users.imported += 1;
        expectedUserIds.add(u.id);
      } else {
        const { rows } = await client.query('select 1 from users where id = $1', [u.id]);
        if (rows.length) {
          bump(report.users.skipped, 'already_present');
          expectedUserIds.add(u.id);
        } else {
          bump(report.users.skipped, 'email_or_slug_conflict');
        }
      }
    }

    // 2. tokens: only unexpired ones for users that exist
    for (const t of data.tokens) {
      if (!t || typeof t.hash !== 'string' || !['reset', 'verify'].includes(t.kind) || typeof t.userId !== 'string') {
        bump(report.tokens.skipped, 'malformed');
      } else if (!(t.expiresAt > now)) {
        bump(report.tokens.skipped, 'expired');
      } else if (!expectedUserIds.has(t.userId)) {
        bump(report.tokens.skipped, 'unknown_user');
      } else {
        const { rowCount } = await client.query(
          'insert into one_time_tokens (hash, user_id, kind, expires_at) values ($1,$2,$3,$4) on conflict do nothing',
          [t.hash, t.userId, t.kind, new Date(t.expiresAt)],
        );
        if (rowCount === 1) report.tokens.imported += 1;
        else bump(report.tokens.skipped, 'already_present');
      }
    }

    // 3. progress
    let expectedXp = 0;
    for (const raw of data.progress) {
      const p = cleanProgress(raw);
      if (!p) {
        bump(report.progress.skipped, 'malformed');
      } else if (!expectedUserIds.has(p.userId)) {
        bump(report.progress.skipped, 'orphan_no_user');
      } else {
        const { rowCount } = await client.query(
          `insert into progress (user_id, xp, completed_unit_count, active_days, completed_units, steps, hints,
                                 quizzes, cards, interviews, daily)
           values ($1,$2,$3,$4::date[],$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb)
           on conflict (user_id) do nothing`,
          [p.userId, p.xp, Object.keys(p.completedUnits).length, p.activeDays, JSON.stringify(p.completedUnits),
            JSON.stringify(p.steps), JSON.stringify(p.hints), JSON.stringify(p.quizzes), JSON.stringify(p.cards),
            JSON.stringify(p.interviews), JSON.stringify(p.daily)],
        );
        if (rowCount === 1) {
          report.progress.imported += 1;
          expectedXp += p.xp;
        } else {
          bump(report.progress.skipped, 'already_present');
        }
      }
    }

    // 4. certificates
    for (const c of data.certificates) {
      const issued = c && validDate(c.issuedAt);
      if (!c || !CERT_ID.test(c.id || '') || !c.signature || !c.unitId || !issued) {
        bump(report.certificates.skipped, 'malformed');
      } else if (!expectedUserIds.has(c.userId)) {
        bump(report.certificates.skipped, 'orphan_no_user');
      } else {
        const score = Math.max(0, Math.min(100, Math.round(Number(c.score) || 0)));
        const { rowCount } = await client.query(
          `insert into certificates (id, user_id, student_name, unit_id, unit_title, score, issued_at, signature)
           values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`,
          [c.id, c.userId, String(c.studentName || ''), c.unitId, String(c.unitTitle || c.unitId), score, issued, c.signature],
        );
        if (rowCount === 1) report.certificates.imported += 1;
        else bump(report.certificates.skipped, 'duplicate_or_present');
      }
    }

    // 5. verification: what the source promised is what the database now holds
    const check = (name, expected, actual) => {
      const ok = expected === actual;
      report.verification.checks.push({ name, expected, actual, ok });
      if (!ok) report.verification.ok = false;
    };
    const accounted = (section) => section.imported + Object.values(section.skipped).reduce((a, b) => a + b, 0);
    for (const name of ['users', 'tokens', 'progress', 'certificates']) {
      check(`${name}: every source record is imported or explained`, report[name].source, accounted(report[name]));
    }
    const ids = [...expectedUserIds];
    const xp = await client.query('select coalesce(sum(xp), 0)::float8 as xp from progress where user_id = any($1::text[])', [ids]);
    // XP of rows imported now must be present; rows that already existed may differ and are not counted here.
    check('progress: imported XP is stored', expectedXp <= xp.rows[0].xp, true);
    const orphan = await client.query(
      `select
         (select count(*) from progress p where not exists (select 1 from users u where u.id = p.user_id)) +
         (select count(*) from certificates c where not exists (select 1 from users u where u.id = c.user_id)) as n`);
    check('no progress or certificates without a user', Number(orphan.rows[0].n), 0);

    if (apply && report.verification.ok) {
      await client.query('commit');
      report.committed = true;
    } else {
      await client.query('rollback');
    }
    return report;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { readJson, readSqlite, readSupabase, importLegacy, cleanUser, cleanProgress };
