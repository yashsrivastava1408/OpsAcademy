/**
 * Entering the lab: who may start a sandbox, when, and in what order.
 *
 * Policy (config.labPolicy):
 *   open      anyone signed in may start (the original behaviour)
 *   accounts  only lab accounts; when seats are full they wait in a queue
 *   slots     lab accounts, only inside a slot the college assigned them, within that slot's seats
 * Platform admins are always let in. A seat is reserved (an "admitted" queue entry) before the sandbox
 * starts, and counted against the slot and the whole cluster, so admission never exceeds either.
 */
const config = require('../config');
const { getRepos } = require('../repositories');
const { loadAccess } = require('../middleware/rbac');
const slotService = require('./slotService');

class LabError extends Error {
  constructor(message, statusCode, code, state = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.state = state;
  }
}

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const lazyManager = () => require('./sandboxManager').getManager();

const baseState = (now) => ({
  policy: config.labPolicy,
  serverTime: now,
  keepAliveMinutes: config.sandbox.maxInactivityMinutes,
  sessionMinutes: config.sandbox.maxSessionMinutes,
});

async function clusterCapacity() {
  return (await lazyManager().stats()).capacity;
}

const slotView = (s) => (s ? { id: s.id, collegeId: s.collegeId, startsAt: s.startsAt, endsAt: s.endsAt, capacity: s.capacity, makeup: s.makeup, unitId: s.unitId } : null);

async function queueView(entry, slot) {
  const repos = getRepos();
  const position = await repos.queue.position(entry);
  const seats = slot ? slot.capacity : await clusterCapacity();
  return {
    position,
    waiting: await repos.queue.waitingCount(entry.slotId),
    estimatedWaitMinutes: Math.ceil(position / Math.max(1, seats)) * config.lab.typicalSessionMinutes,
  };
}

/**
 * Work out where a learner stands, and (with `create`) take a seat or join the queue.
 * @returns {Promise<object>} the state shown to the learner; `_entry` is the queue row for the caller's use
 */
async function evaluate(user, { create = false, unitId = null } = {}) {
  const now = Date.now();
  const base = baseState(now);
  const repos = getRepos();

  const running = (await repos.sessions.listByUser(user.id))[0];
  if (running) {
    // The slot's end time lets the lab page count down to it.
    const slot = running.slotId ? await repos.slots.getSlot(running.slotId) : null;
    return { ...base, state: 'running', sessionId: running.sessionId, labId: running.labId, slotId: running.slotId || null, slot: slotView(slot) };
  }
  if (config.labPolicy === 'open') return { ...base, state: 'open' };

  const access = await loadAccess(user);
  if (access.disabled) return { ...base, state: 'blocked', reason: 'account_disabled' };
  if (access.roles.includes('platform_admin')) return { ...base, state: 'ready', admin: true };
  if (!access.labAccess) return { ...base, state: 'blocked', reason: 'lab_account_required' };

  let slot = null;
  let entry = await repos.queue.getOpen(user.id);
  if (entry && entry.status === 'admitted' && entry.expiresAt <= now) {
    await repos.queue.cancel(user.id); // the seat went unclaimed
    entry = null;
  }

  if (config.labPolicy === 'slots') {
    const eligible = await slotService.eligibleSlots(user.id, { from: now, to: now + 14 * DAY, now });
    slot = eligible.find((s) => s.startsAt <= now && now < s.endsAt) || null;
    if (!slot) {
      if (entry) await repos.queue.cancel(user.id);
      return { ...base, state: 'no_slot', nextSlot: slotView(eligible.find((s) => s.startsAt > now) || null) };
    }
  }
  const scope = slot ? slot.id : null;
  if (entry && entry.slotId !== scope) { // the slot it was for is over
    await repos.queue.cancel(user.id);
    entry = null;
  }

  if (entry && entry.status === 'admitted') {
    return { ...base, state: 'ready', slot: slotView(slot), reservedUntil: entry.expiresAt, _entry: entry };
  }
  if (entry && entry.status === 'waiting') {
    await repos.queue.touch(entry.id);
    return { ...base, state: 'queued', slot: slotView(slot), queue: await queueView(entry, slot), _entry: entry };
  }

  const capacity = await clusterCapacity();
  const collegeId = slot ? slot.collegeId : access.collegeId;
  const waiting = await repos.queue.waitingCount(scope);
  const used = await repos.queue.seatUsage(scope);
  const free = Math.min(capacity - used.cluster, slot ? slot.capacity - used.slot : Infinity);

  if (!create) {
    if (free > 0 && waiting === 0) return { ...base, state: 'available', slot: slotView(slot), seatsLeft: free };
    return { ...base, state: 'full', slot: slotView(slot), queue: { position: waiting + 1, waiting, estimatedWaitMinutes: Math.ceil((waiting + 1) / Math.max(1, slot ? slot.capacity : capacity)) * config.lab.typicalSessionMinutes } };
  }

  if (waiting === 0) {
    const reserved = await repos.queue.reserveSeat({
      userId: user.id, collegeId, slotId: scope, unitId, ttlMs: config.lab.admitTtlMs, slotCapacity: slot ? slot.capacity : null, clusterCapacity: capacity,
    }).catch((err) => { if (err.code === 'already_queued') return undefined; throw err; });
    if (reserved) {
      await record(user, 'queue_admitted', { immediate: true, slotId: scope });
      return { ...base, state: 'ready', slot: slotView(slot), reservedUntil: reserved.expiresAt, _entry: reserved };
    }
  }
  try {
    entry = await repos.queue.enqueue({ userId: user.id, collegeId, slotId: scope, unitId });
  } catch (err) {
    if (err.code === 'already_queued') return evaluate(user, { create: false, unitId }); // a second tab got there first
    throw err;
  }
  await record(user, 'queue_joined', { slotId: scope });
  return { ...base, state: 'queued', slot: slotView(slot), queue: await queueView(entry, slot), _entry: entry };
}

const strip = ({ _entry, ...state }) => state;

/** Where the learner stands now (reading this keeps a waiting place alive). */
async function availability(user) {
  return strip(await evaluate(user, { create: false }));
}

/** Try to get in: reserve a seat now, or join the queue. */
async function enter(user, { unitId = null } = {}) {
  const state = await evaluate(user, { create: true, unitId });
  return strip(state);
}

/** Leave the queue (or give up a reserved seat). */
async function leave(user) {
  const left = await getRepos().queue.cancel(user.id);
  if (left) await record(user, 'queue_left', {});
  return left;
}

/**
 * Called before a sandbox is started. Returns what the start must report back (`entry`, `slotId`), or throws
 * a LabError (403 not allowed, 409 not admitted yet) that carries the state to show the learner.
 */
async function authorizeStart(user) {
  if (config.labPolicy === 'open') return { entry: null, slotId: null };
  const state = await evaluate(user, { create: true });
  // Already inside (a second lab in the same visit): no new seat is taken.
  if (state.state === 'running') return { entry: null, slotId: state.slotId };
  if (state.state === 'ready') return { entry: state._entry || null, slotId: state.slot ? state.slot.id : null };
  const shown = strip(state);
  if (state.state === 'blocked') {
    await record(user, 'lab_blocked', { reason: state.reason });
    throw new LabError(state.reason === 'account_disabled' ? 'This account is disabled' : 'Lab access needs a Lab ID from your admin', 403, state.reason, shown);
  }
  if (state.state === 'no_slot') throw new LabError('You have no lab slot right now', 403, 'no_slot', shown);
  throw new LabError('The lab is full. You are in the queue.', 409, 'queued', shown); // queued
}

/** The sandbox started: the seat becomes a session. */
async function started(entry, sessionId) {
  if (entry) await getRepos().queue.markStarted(entry.id, sessionId);
}

/** The sandbox failed to start: hand the seat back. */
async function startFailed(user) {
  await getRepos().queue.cancel(user.id).catch(() => {});
}

/** Housekeeping, every few seconds: release unclaimed seats and stale waiters, then admit waiters into free seats. */
async function admitWaiting({ now = Date.now() } = {}) {
  const repos = getRepos();
  const expired = await repos.queue.expire({ now, waitingStaleMs: config.lab.waitingStaleMs });
  const capacity = await clusterCapacity();
  let admitted = 0;
  for (const scope of await repos.queue.scopesWaiting()) {
    const slot = scope ? await repos.slots.getSlot(scope) : null;
    if (scope && (!slot || slot.endsAt <= now)) continue; // a finished slot's waiters lapse on their own
    const rows = await repos.queue.admitSeats({ slotId: scope, slotCapacity: slot ? slot.capacity : null, clusterCapacity: capacity, ttlMs: config.lab.admitTtlMs });
    admitted += rows.length;
    for (const row of rows) await repos.events.record({ name: 'queue_admitted', userId: row.userId, collegeId: row.collegeId, props: { slotId: scope, waitedMs: now - row.enqueuedAt } }).catch(() => {});
  }
  return { expired, admitted };
}

/** End sandboxes whose slot is over (after a short grace), so a slot's seats really are free for the next one. */
async function closeEndedSlots(manager = lazyManager(), { now = Date.now() } = {}) {
  if (config.labPolicy !== 'slots') return [];
  const repos = getRepos();
  const closed = [];
  const graceMs = config.lab.slotEndGraceMinutes * MINUTE;
  for (const session of await repos.sessions.all()) {
    if (!session.slotId) continue;
    const slot = await repos.slots.getSlot(session.slotId);
    if (slot && slot.endsAt + graceMs > now) continue;
    if (await manager.destroySession(session.sessionId, 'slot_ended').catch(() => false)) closed.push(session.sessionId);
  }
  return closed;
}

// ── Capacity planning ────────────────────────────────────────

/**
 * For each day ahead: the slots, the most seats in use at once, and the lab servers that needs.
 * Servers = ceil(peak seats / learners per server) (LEARNERS_PER_SERVER, to be set from the load test).
 */
async function capacityPlan({ days = 7, now = Date.now() } = {}) {
  const horizon = Math.min(Math.max(Number(days) || 7, 1), 60);
  const repos = getRepos();
  const slots = await repos.slots.listSlots({ from: now, to: now + horizon * DAY });
  const colleges = new Map((await repos.colleges.list()).map((c) => [c.id, c]));
  const { localParts } = require('../lib/zonedTime');

  const byDay = new Map();
  for (const slot of slots) {
    const tz = (colleges.get(slot.collegeId) || {}).timezone || 'UTC';
    const date = localParts(slot.startsAt, tz).date;
    byDay.set(date, [...(byDay.get(date) || []), { ...slot, collegeName: (colleges.get(slot.collegeId) || {}).name || slot.collegeId }]);
  }
  const perServer = config.lab.learnersPerServer;
  const plan = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => {
    // the busiest moment is some slot's start: add up every slot that is running then
    const peak = Math.max(...list.map((s) => list.filter((o) => o.startsAt <= s.startsAt && o.endsAt > s.startsAt).reduce((n, o) => n + o.capacity, 0)));
    return {
      date,
      slots: list.map((s) => ({ id: s.id, college: s.collegeName, startsAt: s.startsAt, endsAt: s.endsAt, seats: s.capacity, makeup: s.makeup })),
      peakSeats: peak,
      serversNeeded: Math.ceil(peak / perServer),
    };
  });
  return { learnersPerServer: perServer, generatedAt: now, days: plan, maxServersNeeded: plan.reduce((m, d) => Math.max(m, d.serversNeeded), 0) };
}

// ── Analytics ────────────────────────────────────────────────

const EVENT_NAMES = new Set(['switch_to_lab', 'switch_to_theory', 'transition_step', 'transition_failed', 'queue_joined', 'queue_left', 'queue_admitted', 'lab_blocked']);

/** Keep only small, known fields: events come from browsers. */
function cleanProps(props) {
  const out = {};
  if (props && typeof props === 'object') {
    if (typeof props.step === 'string') out.step = props.step.slice(0, 32);
    if (typeof props.ok === 'boolean') out.ok = props.ok;
    if (typeof props.reason === 'string') out.reason = props.reason.slice(0, 64);
    if (typeof props.unitId === 'string') out.unitId = props.unitId.slice(0, 64);
    if (typeof props.slotId === 'string') out.slotId = props.slotId.slice(0, 64);
    if (typeof props.from === 'string') out.from = props.from.slice(0, 16);
    if (typeof props.immediate === 'boolean') out.immediate = props.immediate;
    if (Number.isFinite(props.waitedMs)) out.waitedMs = Math.round(props.waitedMs);
    if (Number.isFinite(props.ms)) out.ms = Math.round(props.ms);
  }
  return out;
}

async function record(user, name, props = {}) {
  if (!EVENT_NAMES.has(name)) return false;
  try {
    await getRepos().events.record({ name, userId: user ? user.id : null, props: cleanProps(props) });
    return true;
  } catch {
    return false; // analytics must never break entering the lab
  }
}

async function funnel({ days = 7, now = Date.now() } = {}) {
  const horizon = Math.min(Math.max(Number(days) || 7, 1), 90);
  const rows = await getRepos().events.funnel({ from: now - horizon * DAY, to: now + MINUTE });
  const transition = rows.filter((r) => r.name === 'transition_step');
  const steps = [...new Set(transition.map((r) => r.step))].map((step) => {
    const ok = transition.filter((r) => r.step === step && r.ok === 'true').reduce((n, r) => n + r.count, 0);
    const failed = transition.filter((r) => r.step === step && r.ok === 'false').reduce((n, r) => n + r.count, 0);
    return { step, ok, failed, dropOffPercent: ok + failed === 0 ? 0 : Math.round((failed / (ok + failed)) * 1000) / 10 };
  });
  const total = (name) => rows.filter((r) => r.name === name).reduce((n, r) => n + r.count, 0);
  return {
    days: horizon,
    switchesToLab: total('switch_to_lab'),
    switchesToTheory: total('switch_to_theory'),
    queueJoined: total('queue_joined'),
    queueLeft: total('queue_left'),
    queueAdmitted: total('queue_admitted'),
    blocked: total('lab_blocked'),
    steps,
  };
}

module.exports = { LabError, availability, enter, leave, authorizeStart, started, startFailed, admitWaiting, closeEndedSlots, capacityPlan, record, funnel, EVENT_NAMES, cleanProps };
