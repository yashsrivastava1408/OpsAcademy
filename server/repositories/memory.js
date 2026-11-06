/**
 * In-memory repositories: same contract as the Postgres ones (including unique
 * email/slug, foreign keys and cascading deletes), used by unit tests and by
 * local development without a database. Data is lost on restart.
 */

const { RepoError } = require('./errors');

const clone = (value) => (value === undefined ? value : structuredClone(value));

function emptyProgress(userId) {
  return {
    userId, xp: 0, completedUnits: {}, steps: {}, hints: {}, quizzes: {}, cards: {},
    interviews: [], activeDays: [], daily: {},
  };
}

function createMemoryRepos() {
  const users = new Map(); // id -> user
  const tokens = new Map(); // hash -> token
  const progress = new Map(); // userId -> doc
  const certificates = new Map(); // id -> certificate
  const sessions = new Map(); // sessionId -> session
  const memberships = []; // { userId, collegeId, sectionId, role }
  const colleges = new Map(); // id -> college
  const sections = new Map(); // id -> section
  const auditRows = []; // append-only
  const invites = []; // { collegeId, sectionId, email, role }
  const identities = new Map(); // `${provider}:${subject}` -> userId
  const rateHits = new Map(); // key -> { hits, resetAt }
  let nextId = 1;
  const locks = new Map(); // userId -> tail promise (serialises progress.mutate)

  const findByEmail = (email) => [...users.values()].find((u) => u.email === email);
  const findBySlug = (slug) => [...users.values()].find((u) => u.profileSlug === slug);
  const requireUser = (id) => {
    if (!users.has(id)) throw new RepoError('user_missing', `User ${id} does not exist`);
  };

  function checkUnique(user) {
    const sameEmail = user.email && findByEmail(user.email);
    if (sameEmail && sameEmail.id !== user.id) throw new RepoError('email_taken', 'User with this email already exists');
    const sameSlug = user.profileSlug && findBySlug(user.profileSlug);
    if (sameSlug && sameSlug.id !== user.id) throw new RepoError('slug_taken', 'Profile address is taken');
  }

  function cascadeDelete(id) {
    users.delete(id);
    progress.delete(id);
    for (const [hash, t] of tokens) if (t.userId === id) tokens.delete(hash);
    for (const [cid, c] of certificates) if (c.userId === id) certificates.delete(cid);
    for (const [sid, s] of sessions) if (s.userId === id) sessions.delete(sid);
    for (let i = memberships.length - 1; i >= 0; i -= 1) if (memberships[i].userId === id) memberships.splice(i, 1);
  }

  return {
    driver: 'memory',
    /** Direct access to the maps, for tests that simulate tampering. Not part of the contract. */
    _test: { users, certificates },

    async ping() { return true; },
    async close() {},

    users: {
      async create(user) {
        if (users.has(user.id)) throw new RepoError('user_exists', `User ${user.id} already exists`);
        checkUnique(user);
        users.set(user.id, clone(user));
        return clone(user);
      },
      /** Insert unless the id exists. @returns the stored user either way. */
      async createIfAbsent(user) {
        if (!users.has(user.id)) {
          checkUnique(user);
          users.set(user.id, clone(user));
        }
        return clone(users.get(user.id));
      },
      async getById(id) { return clone(users.get(id) || null); },
      async getByEmail(email) { return clone(findByEmail(email) || null); },
      async getBySlug(slug) { return clone(findBySlug(slug) || null); },
      /** Merge `patch` into the user. @returns the updated user, or null if unknown. */
      async update(id, patch) {
        const current = users.get(id);
        if (!current) return null;
        const next = { ...current, ...clone(patch), id };
        checkUnique(next);
        users.set(id, next);
        return clone(next);
      },
      /** Registered accounts with a password that have no Supabase identity yet (for the auth migration). */
      async listForAuthMigration() {
        const linked = new Set(identities.values());
        return [...users.values()].filter((u) => !u.guest && u.email && u.password && !linked.has(u.id)).map(clone);
      },
      /** @returns { [id]: name } for the ids that exist */
      async namesByIds(ids) {
        const out = {};
        for (const id of ids) if (users.has(id)) out[id] = users.get(id).name;
        return out;
      },
      async counts() {
        const all = [...users.values()];
        const guests = all.filter((u) => u.guest).length;
        return { registered: all.length - guests, guests };
      },
      /** Delete guests created before `cutoffMs`, with everything they own. */
      async pruneGuests(cutoffMs) {
        const stale = [...users.values()].filter((u) => u.guest && Date.parse(u.createdAt) < cutoffMs);
        for (const u of stale) cascadeDelete(u.id);
        return stale.length;
      },
    },

    tokens: {
      /** Store a token, replacing older ones of the same kind for that user. */
      async issue({ hash, userId, kind, expiresAt }) {
        requireUser(userId);
        for (const [h, t] of tokens) if (t.userId === userId && t.kind === kind) tokens.delete(h);
        tokens.set(hash, { hash, userId, kind, expiresAt });
      },
      /** Use a token once. @returns the user id, or null if unknown, of another kind or expired. */
      async redeem(hash, kind, now = Date.now()) {
        const t = tokens.get(hash);
        if (!t || t.kind !== kind) return null;
        tokens.delete(hash);
        return t.expiresAt > now ? t.userId : null;
      },
      async pruneExpired(now = Date.now()) {
        let removed = 0;
        for (const [h, t] of tokens) {
          if (t.expiresAt <= now) {
            tokens.delete(h);
            removed += 1;
          }
        }
        return removed;
      },
    },

    progress: {
      async get(userId) { return clone(progress.get(userId) || null); },
      /**
       * Read-modify-write one learner's progress atomically. `fn` receives the
       * document (a fresh one if none exists), may change it, and its return
       * value is returned here. Concurrent calls for the same learner run one after another.
       */
      async mutate(userId, fn) {
        requireUser(userId);
        const previous = locks.get(userId) || Promise.resolve();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        locks.set(userId, previous.then(() => gate));
        await previous;
        try {
          const doc = clone(progress.get(userId)) || emptyProgress(userId);
          const result = await fn(doc);
          progress.set(userId, doc);
          return result;
        } finally {
          release();
          if (locks.get(userId) === gate) locks.delete(userId);
        }
      },
      /** Top learners by XP. @returns [{ userId, xp, completedUnits (count), activeDays }] */
      async leaderboard(limit = 20, { collegeId = null } = {}) {
        let docs = [...progress.values()].filter((d) => d.xp > 0);
        if (collegeId) {
          const members = new Set(memberships.filter((m) => m.collegeId === collegeId && m.role === 'student').map((m) => m.userId));
          docs = docs.filter((d) => members.has(d.userId));
        }
        return docs
          .sort((a, b) => b.xp - a.xp || (a.userId < b.userId ? -1 : 1))
          .slice(0, limit)
          .map((d) => ({ userId: d.userId, xp: d.xp, completedUnits: Object.keys(d.completedUnits).length, activeDays: [...d.activeDays] }));
      },
      async totals() {
        const docs = [...progress.values()];
        return { learnersWithXp: docs.filter((d) => d.xp > 0).length, totalXp: docs.reduce((n, d) => n + d.xp, 0) };
      },
      async remove(userId) { return progress.delete(userId); },
    },

    memberships: {
      async add({ userId, collegeId, sectionId = null, role }) {
        requireUser(userId);
        memberships.push({ userId, collegeId, sectionId, role });
      },
      async forUser(userId) { return memberships.filter((m) => m.userId === userId).map(clone); },
      async remove({ userId, collegeId = null, role }) {
        const i = memberships.findIndex((m) => m.userId === userId && m.collegeId === collegeId && m.role === role);
        if (i < 0) return false;
        memberships.splice(i, 1);
        return true;
      },
      /** Members of one college, optionally one role: [{ userId, name, email, sectionId, role }] */
      async listByCollege(collegeId, { role = null } = {}) {
        return memberships
          .filter((m) => m.collegeId === collegeId && (!role || m.role === role))
          .map((m) => ({ ...clone(m), name: users.get(m.userId).name, email: users.get(m.userId).email }));
      },
    },

    colleges: {
      async create({ name, slug, timezone = 'Asia/Kolkata' }) {
        if ([...colleges.values()].some((c) => c.slug === slug)) throw new RepoError('college_slug_taken', 'A college with this address already exists');
        const college = { id: `col-${nextId++}`, name, slug, timezone, active: true, createdAt: new Date().toISOString() };
        colleges.set(college.id, college);
        return clone(college);
      },
      async getById(id) { return clone(colleges.get(id) || null); },
      async getBySlug(slug) { return clone([...colleges.values()].find((c) => c.slug === slug) || null); },
      async list() { return [...colleges.values()].sort((a, b) => a.name.localeCompare(b.name)).map(clone); },
    },

    sections: {
      /** Returns the existing section when the college already has one with that name. */
      async ensure({ collegeId, name, academicYear = null }) {
        if (!colleges.has(collegeId)) throw new RepoError('college_missing', `College ${collegeId} does not exist`);
        const found = [...sections.values()].find((s) => s.collegeId === collegeId && s.name === name);
        if (found) return clone(found);
        const section = { id: `sec-${nextId++}`, collegeId, name, academicYear };
        sections.set(section.id, section);
        return clone(section);
      },
      async listByCollege(collegeId) { return [...sections.values()].filter((s) => s.collegeId === collegeId).map(clone); },
    },

    identities: {
      /** Link an external identity (a Supabase user id) to an app user. */
      async link({ provider = 'supabase', subject, userId }) {
        requireUser(userId);
        identities.set(`${provider}:${subject}`, userId);
      },
      async getUserId(provider, subject) { return identities.get(`${provider}:${subject}`) || null; },
    },

    invites: {
      async add({ collegeId, sectionId = null, email, role = 'student' }) {
        const found = invites.find((i) => i.collegeId === collegeId && i.email === email && i.role === role);
        if (found) found.sectionId = sectionId;
        else invites.push({ collegeId, sectionId, email, role });
      },
      async listByCollege(collegeId) { return invites.filter((i) => i.collegeId === collegeId).map(clone); },
      /** Turn every invite for this email into a membership. @returns how many were new. */
      async claim(userId, email) {
        requireUser(userId);
        let made = 0;
        for (let i = invites.length - 1; i >= 0; i -= 1) {
          if (invites[i].email !== email) continue;
          const { collegeId, sectionId, role } = invites.splice(i, 1)[0];
          if (!memberships.some((m) => m.userId === userId && m.collegeId === collegeId && m.role === role)) {
            memberships.push({ userId, collegeId, sectionId, role });
            made += 1;
          }
        }
        return made;
      },
    },

    rateLimits: {
      /** Count one hit in the window that `key` is in. @returns { hits, resetAt (ms) } */
      async hit(key, windowMs) {
        const now = Date.now();
        let row = rateHits.get(key);
        if (!row || row.resetAt <= now) row = { hits: 0, resetAt: now + windowMs };
        row.hits += 1;
        rateHits.set(key, row);
        return { hits: row.hits, resetAt: row.resetAt };
      },
      async decrement(key) { const row = rateHits.get(key); if (row && row.hits > 0) row.hits -= 1; },
      async reset(key) { rateHits.delete(key); },
      async prune() {
        const now = Date.now();
        let n = 0;
        for (const [k, row] of rateHits) if (row.resetAt <= now) { rateHits.delete(k); n += 1; }
        return n;
      },
    },

    audit: {
      async record({ actorId = null, actorRole = null, action, entityType = null, entityId = null, collegeId = null, ip = null, meta = {} }) {
        auditRows.push({ id: auditRows.length + 1, at: new Date().toISOString(), actorId, actorRole, action, entityType, entityId, collegeId, ip, meta: clone(meta) });
      },
      /** Newest first. @param {{ collegeId?: string, actorId?: string, limit?: number }} filter */
      async list({ collegeId, actorId, limit = 100 } = {}) {
        return auditRows
          .filter((r) => (collegeId === undefined || r.collegeId === collegeId) && (!actorId || r.actorId === actorId))
          .slice().reverse().slice(0, limit).map(clone);
      },
    },

    certificates: {
      /** Insert unless this learner already has one for the unit. @returns the stored certificate. */
      async create(cert) {
        requireUser(cert.userId);
        const existing = [...certificates.values()].find((c) => c.userId === cert.userId && c.unitId === cert.unitId);
        if (existing) return clone(existing);
        certificates.set(cert.id, clone(cert));
        return clone(cert);
      },
      async getById(id) { return clone(certificates.get(id) || null); },
      async getForUnit(userId, unitId) {
        return clone([...certificates.values()].find((c) => c.userId === userId && c.unitId === unitId) || null);
      },
      async listForUser(userId) { return [...certificates.values()].filter((c) => c.userId === userId).map(clone); },
      async count() { return certificates.size; },
    },

    sessions: {
      async upsert(session) {
        requireUser(session.userId);
        sessions.set(session.sessionId, clone(session));
      },
      async delete(sessionId) { return sessions.delete(sessionId); },
      async all() { return [...sessions.values()].map(clone); },
    },

    jobs: {
      /** In memory there is only one process, so the lock is always free. */
      async withLock(name, fn) { return fn(); },
      async refreshLeaderboards() {},
    },
  };
}

module.exports = { createMemoryRepos, emptyProgress };
