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
  const nodes = new Map(); // nodeId -> node
  const tickets = new Map(); // hash -> { sessionId, userId, expiresAt }
  const templates = new Map(); // id -> slot template
  const blackouts = new Map(); // id -> { id, collegeId, onDate, reason }
  const slotRows = new Map(); // id -> slot
  const assignments = []; // { slotId, userId, kind }
  const queueRows = []; // lab queue entries, oldest first
  const eventRows = []; // analytics events
  let queueSeq = 0;
  let nextId = 1;
  const locks = new Map(); // userId -> tail promise (serialises progress.mutate)

  const seatUsageNow = (slotId, now) => {
    const held = (id) => queueRows.filter((q) => q.status === 'admitted' && q.expiresAt > now && (id === undefined || q.slotId === id)).length;
    const running = (id) => [...sessions.values()].filter((x) => (id === undefined ? true : x.slotId === id)).length;
    return { slot: slotId == null ? 0 : running(slotId) + held(slotId), cluster: running(undefined) + held(undefined) };
  };
  const findByEmail = (email) => [...users.values()].find((u) => u.email === email);
  const findBySlug = (slug) => [...users.values()].find((u) => u.profileSlug === slug);
  const findByUsername = (name) => [...users.values()].find((u) => u.username === String(name).toLowerCase());
  const lowerName = (u) => (u && u.username ? { ...u, username: String(u.username).toLowerCase() } : u);
  const requireUser = (id) => {
    if (!users.has(id)) throw new RepoError('user_missing', `User ${id} does not exist`);
  };

  function checkUnique(user) {
    const sameEmail = user.email && findByEmail(user.email);
    if (sameEmail && sameEmail.id !== user.id) throw new RepoError('email_taken', 'User with this email already exists');
    const sameSlug = user.profileSlug && findBySlug(user.profileSlug);
    if (sameSlug && sameSlug.id !== user.id) throw new RepoError('slug_taken', 'Profile address is taken');
    const sameName = user.username && findByUsername(user.username);
    if (sameName && sameName.id !== user.id) throw new RepoError('username_taken', 'That lab ID is taken');
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
        user = lowerName(user);
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
      async getByUsername(username) { return clone(findByUsername(username) || null); },
      /** Lab accounts (those with a lab ID), newest last. @returns { total, rows } */
      async listLabAccounts({ search = '', limit = 50, offset = 0 } = {}) {
        const term = search.toLowerCase();
        const all = [...users.values()]
          .filter((u) => u.username && (!term || u.username.includes(term) || (u.name || '').toLowerCase().includes(term)))
          .sort((a, b) => (a.createdAt === b.createdAt ? a.username.localeCompare(b.username) : a.createdAt < b.createdAt ? -1 : 1));
        return { total: all.length, rows: all.slice(offset, offset + limit).map(clone) };
      },
      /** The highest N among lab IDs shaped `prefix-N`, or 0. */
      async maxUsernameSequence(prefix) {
        const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
        let max = 0;
        for (const u of users.values()) {
          const m = u.username && pattern.exec(u.username);
          if (m) max = Math.max(max, Number(m[1]));
        }
        return max;
      },
      /** Merge `patch` into the user. @returns the updated user, or null if unknown. */
      async update(id, patch) {
        const current = users.get(id);
        if (!current) return null;
        const next = lowerName({ ...current, ...clone(patch), id });
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
      async getSubject(provider, userId) {
        for (const [key, id] of identities) if (id === userId && key.startsWith(`${provider}:`)) return key.slice(provider.length + 1);
        return null;
      },
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

    nodes: {
      /** Create or refresh a node from its heartbeat; stamps last-seen with the server clock. */
      async heartbeat({ nodeId, baseUrl, capacity, running = 0, draining = false, version = null }) {
        nodes.set(nodeId, { nodeId, baseUrl, capacity, running, draining, version, lastSeenAt: Date.now() });
      },
      async get(nodeId) { return clone(nodes.get(nodeId) || null); },
      async list() { return [...nodes.values()].map(clone); },
      /** Nodes seen within `maxAgeMs` that are not draining. */
      async listHealthy(maxAgeMs) {
        const cutoff = Date.now() - maxAgeMs;
        return [...nodes.values()].filter((n) => n.lastSeenAt >= cutoff && !n.draining).map(clone);
      },
      async remove(nodeId) { return nodes.delete(nodeId); },
    },

    tickets: {
      async create({ hash, sessionId, userId, expiresAt }) {
        if (!sessions.has(sessionId)) throw new RepoError('session_missing', 'Session does not exist');
        tickets.set(hash, { sessionId, userId, expiresAt });
      },
      /** Single use: returns the ticket's session and user once, then never again. */
      async redeem(hash) {
        const t = tickets.get(hash);
        if (!t) return null;
        tickets.delete(hash);
        return t.expiresAt > Date.now() ? { sessionId: t.sessionId, userId: t.userId } : null;
      },
      async prune() {
        let n = 0;
        for (const [hash, t] of tickets) if (t.expiresAt <= Date.now()) { tickets.delete(hash); n += 1; }
        return n;
      },
    },

    slots: {
      async createTemplate(t) {
        const row = { id: `tpl-${nextId++}`, collegeId: t.collegeId, sectionId: t.sectionId || null, weekday: t.weekday, startTime: t.startTime,
          durationMinutes: t.durationMinutes, seats: t.seats, unitId: t.unitId || null, makeup: Boolean(t.makeup), active: true, createdBy: t.createdBy || null };
        templates.set(row.id, row);
        return clone(row);
      },
      async getTemplate(id) { return clone(templates.get(id) || null); },
      async listTemplates(collegeId) { return [...templates.values()].filter((t) => t.collegeId === collegeId).map(clone); },
      async updateTemplate(id, patch) {
        const t = templates.get(id);
        if (!t) return null;
        Object.assign(t, clone(patch));
        return clone(t);
      },
      async deleteTemplate(id) {
        for (const s of slotRows.values()) if (s.templateId === id) s.templateId = null;
        return templates.delete(id);
      },
      async addBlackout({ collegeId, onDate, reason = null }) {
        const found = [...blackouts.values()].find((b) => b.collegeId === collegeId && b.onDate === onDate);
        if (found) { found.reason = reason; return clone(found); }
        const row = { id: `bo-${nextId++}`, collegeId, onDate, reason };
        blackouts.set(row.id, row);
        return clone(row);
      },
      async listBlackouts(collegeId) { return [...blackouts.values()].filter((b) => b.collegeId === collegeId).sort((a, b) => a.onDate.localeCompare(b.onDate)).map(clone); },
      async removeBlackout(collegeId, id) {
        const b = blackouts.get(id);
        return b && b.collegeId === collegeId ? blackouts.delete(id) : false;
      },
      /** Insert slots, skipping any whose template and start already exist. @returns how many were new */
      async createSlots(rows) {
        let created = 0;
        for (const r of rows) {
          if (r.templateId && [...slotRows.values()].some((s) => s.templateId === r.templateId && s.startsAt === r.startsAt)) continue;
          const row = { id: `slot-${nextId++}`, collegeId: r.collegeId, sectionId: r.sectionId || null, startsAt: r.startsAt, endsAt: r.endsAt,
            capacity: r.capacity, unitId: r.unitId || null, makeup: Boolean(r.makeup), templateId: r.templateId || null, createdBy: r.createdBy || null };
          slotRows.set(row.id, row);
          created += 1;
        }
        return created;
      },
      async getSlot(id) { return clone(slotRows.get(id) || null); },
      /** Slots overlapping [from, to) (epoch ms), optionally one college, by start time. */
      async listSlots({ collegeId = null, from, to }) {
        return [...slotRows.values()]
          .filter((s) => (!collegeId || s.collegeId === collegeId) && s.endsAt > from && s.startsAt < to)
          .sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id)).map(clone);
      },
      async updateSlot(id, patch) {
        const s = slotRows.get(id);
        if (!s) return null;
        for (const key of Object.keys(patch)) if (!['sectionId', 'capacity', 'unitId'].includes(key)) throw new RepoError('bad_patch', `Cannot update slot field "${key}"`);
        Object.assign(s, clone(patch));
        return clone(s);
      },
      async deleteSlot(id) {
        for (let i = assignments.length - 1; i >= 0; i -= 1) if (assignments[i].slotId === id) assignments.splice(i, 1);
        return slotRows.delete(id);
      },
      async setAssignment({ slotId, userId, kind = 'add' }) {
        const found = assignments.find((a) => a.slotId === slotId && a.userId === userId);
        if (found) found.kind = kind;
        else assignments.push({ slotId, userId, kind });
      },
      async removeAssignment(slotId, userId) {
        const i = assignments.findIndex((a) => a.slotId === slotId && a.userId === userId);
        if (i < 0) return false;
        assignments.splice(i, 1);
        return true;
      },
      async listAssignments(slotId) {
        return assignments.filter((a) => a.slotId === slotId).map((a) => ({ ...a, name: users.get(a.userId)?.name || null }));
      },
      async assignmentsForUser(userId) { return assignments.filter((a) => a.userId === userId).map(clone); },
    },

    queue: {
      /** Wait for a seat in `slotId` (null = anywhere). */
      async enqueue({ userId, collegeId = null, slotId = null, unitId = null }) {
        requireUser(userId);
        if (queueRows.some((q) => q.userId === userId && (q.status === 'waiting' || q.status === 'admitted'))) throw new RepoError('already_queued', 'Already waiting for a lab seat');
        const row = { id: ++queueSeq, userId, collegeId, slotId, unitId, status: 'waiting', enqueuedAt: Date.now(), lastSeenAt: Date.now(), admittedAt: null, expiresAt: null, sessionId: null };
        queueRows.push(row);
        return clone(row);
      },
      /** Take a seat at once (nobody is ahead): an entry that starts out admitted. */
      async reserve({ userId, collegeId = null, slotId = null, unitId = null, ttlMs }) {
        requireUser(userId);
        if (queueRows.some((q) => q.userId === userId && (q.status === 'waiting' || q.status === 'admitted'))) throw new RepoError('already_queued', 'Already waiting for a lab seat');
        const now = Date.now();
        const row = { id: ++queueSeq, userId, collegeId, slotId, unitId, status: 'admitted', enqueuedAt: now, lastSeenAt: now, admittedAt: now, expiresAt: now + ttlMs, sessionId: null };
        queueRows.push(row);
        return clone(row);
      },
      async getOpen(userId) { return clone(queueRows.find((q) => q.userId === userId && (q.status === 'waiting' || q.status === 'admitted')) || null); },
      async position(entry) { return queueRows.filter((q) => q.status === 'waiting' && q.slotId === entry.slotId && q.id <= entry.id).length; },
      async waitingCount(slotId) { return queueRows.filter((q) => q.status === 'waiting' && q.slotId === slotId).length; },
      async countHeldAll(now = Date.now()) { return queueRows.filter((q) => q.status === 'admitted' && q.expiresAt > now).length; },
      async countHeld(slotId, now = Date.now()) { return queueRows.filter((q) => q.status === 'admitted' && q.slotId === slotId && q.expiresAt > now).length; },
      async touch(id) { const q = queueRows.find((r) => r.id === id); if (q) q.lastSeenAt = Date.now(); },
      async cancel(userId) {
        const q = queueRows.find((r) => r.userId === userId && (r.status === 'waiting' || r.status === 'admitted'));
        if (!q) return false;
        q.status = 'cancelled';
        return true;
      },
      /** Admit the longest-waiting entries of a scope, up to `limit`, each holding its seat for `ttlMs`. */
      async admit({ slotId = null, limit, ttlMs }) {
        const now = Date.now();
        const chosen = queueRows.filter((q) => q.status === 'waiting' && q.slotId === slotId).slice(0, Math.max(0, limit));
        for (const q of chosen) { q.status = 'admitted'; q.admittedAt = now; q.expiresAt = now + ttlMs; }
        return chosen.map(clone);
      },
      /** Let go of seats nobody claimed, and of waiters who stopped checking in. @returns how many entries expired */
      async expire({ now = Date.now(), waitingStaleMs }) {
        let n = 0;
        for (const q of queueRows) {
          if ((q.status === 'admitted' && q.expiresAt <= now) || (q.status === 'waiting' && q.lastSeenAt < now - waitingStaleMs)) { q.status = 'expired'; n += 1; }
        }
        return n;
      },
      async markStarted(id, sessionId) {
        const q = queueRows.find((r) => r.id === id);
        if (q) { q.status = 'started'; q.sessionId = sessionId; }
      },
      /** Which of these slots has the user actually used? */
      async attendedSlots(userId, slotIds) {
        return [...new Set(queueRows.filter((q) => q.userId === userId && q.status === 'started' && slotIds.includes(q.slotId)).map((q) => q.slotId))];
      },
      /** Seats in use in a scope (running sessions plus seats held for admitted entries), and across the cluster. */
      async seatUsage(slotId, now = Date.now()) { return seatUsageNow(slotId, now); },
      // The next two do their counting and their writing in one synchronous step, so they cannot interleave.
      /** Take a seat if the slot and the cluster both have one. @returns the admitted entry, or null when full */
      async reserveSeat({ userId, collegeId = null, slotId = null, unitId = null, ttlMs, slotCapacity = null, clusterCapacity }) {
        requireUser(userId);
        const used = seatUsageNow(slotId, Date.now());
        if (used.cluster >= clusterCapacity || (slotId != null && slotCapacity != null && used.slot >= slotCapacity)) return null;
        if (queueRows.some((q) => q.userId === userId && (q.status === 'waiting' || q.status === 'admitted'))) throw new RepoError('already_queued', 'Already waiting for a lab seat');
        const now = Date.now();
        const row = { id: ++queueSeq, userId, collegeId, slotId, unitId, status: 'admitted', enqueuedAt: now, lastSeenAt: now, admittedAt: now, expiresAt: now + ttlMs, sessionId: null };
        queueRows.push(row);
        return clone(row);
      },
      /** Admit waiters of a scope, oldest first, as far as the slot and the cluster have seats. */
      async admitSeats({ slotId = null, slotCapacity = null, clusterCapacity, ttlMs }) {
        const used = seatUsageNow(slotId, Date.now());
        let free = clusterCapacity - used.cluster;
        if (slotId != null && slotCapacity != null) free = Math.min(free, slotCapacity - used.slot);
        if (free <= 0) return [];
        const now = Date.now();
        const chosen = queueRows.filter((q) => q.status === 'waiting' && q.slotId === slotId).slice(0, free);
        for (const q of chosen) { q.status = 'admitted'; q.admittedAt = now; q.expiresAt = now + ttlMs; }
        return chosen.map(clone);
      },
      async scopesWaiting() { return [...new Set(queueRows.filter((q) => q.status === 'waiting').map((q) => q.slotId))]; },
    },

    events: {
      async record({ name, userId = null, collegeId = null, props = {} }) {
        eventRows.push({ id: eventRows.length + 1, at: Date.now(), name, userId, collegeId, props: clone(props) });
      },
      /** Counts per event name and step between two times: [{ name, step, ok, count }] */
      async funnel({ from, to }) {
        const out = new Map();
        for (const e of eventRows) {
          if (e.at < from || e.at >= to) continue;
          const step = e.props.step === undefined ? null : String(e.props.step);
          const ok = e.props.ok === undefined ? null : String(e.props.ok);
          const key = `${e.name}|${step}|${ok}`;
          out.set(key, { name: e.name, step, ok, count: (out.get(key)?.count || 0) + 1 });
        }
        return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || String(a.step).localeCompare(String(b.step)));
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
        const before = sessions.get(session.sessionId);
        const next = clone(session);
        if (before) { // like the database: a stale writer cannot move activity or strikes backwards
          next.lastActiveAt = Math.max(before.lastActiveAt, next.lastActiveAt);
          next.strikes = Math.max(before.strikes || 0, next.strikes || 0);
        }
        sessions.set(session.sessionId, next);
      },
      async delete(sessionId) {
        for (const [hash, t] of tickets) if (t.sessionId === sessionId) tickets.delete(hash);
        return sessions.delete(sessionId);
      },
      async all() { return [...sessions.values()].map(clone); },
      async get(sessionId) { return clone(sessions.get(sessionId) || null); },
      async countBySlot(slotId) { return [...sessions.values()].filter((s) => s.slotId === slotId).length; },
      async listByUser(userId) { return [...sessions.values()].filter((s) => s.userId === userId).map(clone); },
      async count() { return sessions.size; },
      async countByUser(userId) { return [...sessions.values()].filter((s) => s.userId === userId).length; },
      async listByNode(nodeId) { return [...sessions.values()].filter((s) => s.nodeId === nodeId).map(clone); },
      /** Record activity; never moves the clock backwards. */
      async touch(sessionId, atMs = Date.now()) {
        const s = sessions.get(sessionId);
        if (s && atMs > s.lastActiveAt) s.lastActiveAt = atMs;
      },
      /** Append to the capped command history (oldest dropped). */
      async appendCommand(sessionId, entry, cap) {
        const s = sessions.get(sessionId);
        if (!s) return;
        s.history = [...(s.history || []), entry].slice(-cap);
      },
      async clearHistory(sessionId) {
        const s = sessions.get(sessionId);
        if (s) s.history = [];
      },
      /** @returns the new strike count, or 0 when the session is gone */
      async addStrike(sessionId) {
        const s = sessions.get(sessionId);
        if (!s) return 0;
        s.strikes = (s.strikes || 0) + 1;
        return s.strikes;
      },
      /** Sessions created before `createdBefore` or idle since before `activeBefore` (epoch ms). */
      async listExpired({ createdBefore, activeBefore }) {
        return [...sessions.values()].filter((s) => s.createdAt < createdBefore || s.lastActiveAt < activeBefore).map(clone);
      },
    },

    jobs: {
      /** In memory there is only one process, so the lock is always free. */
      async withLock(name, fn) { return fn(); },
      async refreshLeaderboards() {},
    },
  };
}

module.exports = { createMemoryRepos, emptyProgress };
