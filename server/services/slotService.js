/**
 * Lab slots: weekly templates per college, blackout dates, generated slots, who may use which slot.
 *
 * A slot belongs to one college and, optionally, one section. A student may use a slot when it is their
 * college's (and their section's, if the slot names one), or when a trainer added them to it, unless a
 * trainer removed them from it. A makeup slot is for students who missed their regular slot that day.
 */
const { getRepos } = require('../repositories');
const { zonedToUtcMs, localParts, addDays, weekdayOf, isDate, isTime } = require('../lib/zonedTime');

class SlotError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const MAX_GENERATE_DAYS = 190; // about a semester
const MINUTE = 60000;

function intIn(value, min, max, what) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new SlotError(`${what} must be a whole number from ${min} to ${max}`);
  return n;
}

async function collegeOrThrow(collegeId) {
  const college = await getRepos().colleges.getById(collegeId);
  if (!college) throw new SlotError('Not found', 404);
  return college;
}

// ── Templates and blackouts ──────────────────────────────────

async function createTemplate(collegeId, input, actorId = null) {
  await collegeOrThrow(collegeId);
  const { weekday, startTime, durationMinutes, seats, sectionId, unitId, makeup } = input || {};
  if (!isTime(startTime)) throw new SlotError('Start time must look like 10:00');
  const template = {
    collegeId,
    weekday: intIn(weekday, 0, 6, 'Weekday (0 = Sunday ... 6 = Saturday)'),
    startTime,
    durationMinutes: intIn(durationMinutes, 15, 480, 'Length in minutes'),
    seats: intIn(seats, 1, 5000, 'Seats'),
    sectionId: sectionId || null,
    unitId: typeof unitId === 'string' && unitId ? unitId.slice(0, 64) : null,
    makeup: makeup === true,
    createdBy: actorId,
  };
  if (template.sectionId) {
    const sections = await getRepos().sections.listByCollege(collegeId);
    if (!sections.some((s) => s.id === template.sectionId)) throw new SlotError('That section is not in this college');
  }
  return getRepos().slots.createTemplate(template);
}

const listTemplates = (collegeId) => getRepos().slots.listTemplates(collegeId);

async function setTemplateActive(collegeId, templateId, active) {
  const tpl = await getRepos().slots.getTemplate(templateId);
  if (!tpl || tpl.collegeId !== collegeId) throw new SlotError('Not found', 404);
  return getRepos().slots.updateTemplate(templateId, { active: Boolean(active) });
}

async function deleteTemplate(collegeId, templateId) {
  const tpl = await getRepos().slots.getTemplate(templateId);
  if (!tpl || tpl.collegeId !== collegeId) throw new SlotError('Not found', 404);
  return getRepos().slots.deleteTemplate(templateId);
}

async function addBlackout(collegeId, { onDate, reason }) {
  await collegeOrThrow(collegeId);
  if (!isDate(onDate)) throw new SlotError('Date must look like 2026-12-25');
  return getRepos().slots.addBlackout({ collegeId, onDate, reason: typeof reason === 'string' ? reason.slice(0, 200) : null });
}

const listBlackouts = (collegeId) => getRepos().slots.listBlackouts(collegeId);

async function removeBlackout(collegeId, id) {
  if (!(await getRepos().slots.removeBlackout(collegeId, id))) throw new SlotError('Not found', 404);
}

// ── Generating a semester of slots ───────────────────────────

/**
 * Make the slots for every active template between two dates (inclusive), in the college's time zone,
 * skipping blackout dates. Safe to repeat: a slot that exists is not made again.
 * @returns {{ created: number, skippedBlackout: number, templates: number, from: string, to: string }}
 */
async function generate(collegeId, { from, to, templateId = null }, actorId = null) {
  const college = await collegeOrThrow(collegeId);
  if (!isDate(from) || !isDate(to)) throw new SlotError('Give from and to as dates like 2026-11-01');
  if (to < from) throw new SlotError('The end date is before the start date');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (days > MAX_GENERATE_DAYS) throw new SlotError(`Generate at most ${MAX_GENERATE_DAYS} days at a time`);

  const repos = getRepos();
  let templates = (await repos.slots.listTemplates(collegeId)).filter((t) => t.active);
  if (templateId) templates = templates.filter((t) => t.id === templateId);
  const blackout = new Set((await repos.slots.listBlackouts(collegeId)).map((b) => b.onDate));

  const rows = [];
  let skippedBlackout = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const weekday = weekdayOf(date);
    for (const t of templates) {
      if (t.weekday !== weekday) continue;
      if (blackout.has(date)) { skippedBlackout += 1; continue; }
      const startsAt = zonedToUtcMs(date, t.startTime, college.timezone);
      rows.push({
        collegeId, sectionId: t.sectionId, startsAt, endsAt: startsAt + t.durationMinutes * MINUTE, capacity: t.seats,
        unitId: t.unitId, makeup: t.makeup, templateId: t.id, createdBy: actorId,
      });
    }
  }
  const created = await repos.slots.createSlots(rows);
  return { created, skippedBlackout, templates: templates.length, from, to };
}

// ── Listing, assignment, warnings ────────────────────────────

/** The college's students: [{ userId, sectionId }] */
async function studentsOf(collegeId) {
  return (await getRepos().memberships.listByCollege(collegeId, { role: 'student' })).map((m) => ({ userId: m.userId, sectionId: m.sectionId || null }));
}

/** A slot with how many students may use it and anything the admin should look at. */
async function describeSlot(slot, students, assignments) {
  const base = students.filter((s) => !slot.sectionId || s.sectionId === slot.sectionId).map((s) => s.userId);
  const removed = new Set(assignments.filter((a) => a.kind === 'remove').map((a) => a.userId));
  const added = assignments.filter((a) => a.kind === 'add').map((a) => a.userId);
  const eligible = new Set([...base.filter((id) => !removed.has(id)), ...added]);
  const warnings = [];
  if (eligible.size > slot.capacity) warnings.push({ code: 'over_capacity', message: `${eligible.size} students may use this slot but it has ${slot.capacity} seats` });
  return { ...slot, eligible: eligible.size, added: added.length, removed: removed.size, warnings };
}

async function listSlots(collegeId, from, to) {
  await collegeOrThrow(collegeId);
  const repos = getRepos();
  const [slots, students] = await Promise.all([repos.slots.listSlots({ collegeId, from, to }), studentsOf(collegeId)]);
  const out = [];
  for (const slot of slots) out.push(await describeSlot(slot, students, await repos.slots.listAssignments(slot.id)));
  return out;
}

async function slotInCollege(collegeId, slotId) {
  const slot = await getRepos().slots.getSlot(slotId);
  if (!slot || slot.collegeId !== collegeId) throw new SlotError('Not found', 404);
  return slot;
}

/** Give a slot to a section (or the whole college) and set its seats. */
async function updateSlot(collegeId, slotId, { sectionId, capacity }) {
  await slotInCollege(collegeId, slotId);
  const patch = {};
  if (sectionId !== undefined) {
    if (sectionId) {
      const sections = await getRepos().sections.listByCollege(collegeId);
      if (!sections.some((s) => s.id === sectionId)) throw new SlotError('That section is not in this college');
    }
    patch.sectionId = sectionId || null;
  }
  if (capacity !== undefined) patch.capacity = intIn(capacity, 1, 5000, 'Seats');
  const updated = await getRepos().slots.updateSlot(slotId, patch);
  return describeSlot(updated, await studentsOf(collegeId), await getRepos().slots.listAssignments(slotId));
}

async function deleteSlot(collegeId, slotId) {
  await slotInCollege(collegeId, slotId);
  await getRepos().slots.deleteSlot(slotId);
}

/**
 * Add a student to a slot, or remove them from the one their section gives them (a trainer's override).
 * Warns, but does not refuse, when the slot is over capacity or clashes with another slot of theirs.
 */
async function assignStudent(collegeId, slotId, userId, kind = 'add') {
  if (!['add', 'remove'].includes(kind)) throw new SlotError('kind must be add or remove');
  const slot = await slotInCollege(collegeId, slotId);
  const repos = getRepos();
  const memberships = await repos.memberships.forUser(userId);
  const mine = memberships.find((m) => m.collegeId === collegeId);
  if (!mine) throw new SlotError('That student is not in this college', 404);

  await repos.slots.setAssignment({ slotId, userId, kind });
  const warnings = [];
  if (kind === 'add') {
    const clashes = (await eligibleSlots(userId, { from: slot.startsAt, to: slot.endsAt, includeMakeup: true }))
      .filter((s) => s.id !== slotId && s.startsAt < slot.endsAt && s.endsAt > slot.startsAt);
    if (clashes.length) warnings.push({ code: 'overlap', message: 'This student already has a slot at the same time' });
  }
  const summary = await describeSlot(slot, await studentsOf(collegeId), await repos.slots.listAssignments(slotId));
  warnings.push(...summary.warnings);
  return { slot: summary, warnings };
}

async function unassignStudent(collegeId, slotId, userId) {
  await slotInCollege(collegeId, slotId);
  await getRepos().slots.removeAssignment(slotId, userId);
}

const listAssignments = async (collegeId, slotId) => {
  await slotInCollege(collegeId, slotId);
  return getRepos().slots.listAssignments(slotId);
};

// ── Which slots may this user use? ───────────────────────────

/**
 * The slots overlapping [from, to) this user may use, soonest first. Makeup slots are included only
 * for a student who missed a regular slot earlier that local day (or was added to the makeup by a trainer).
 */
async function eligibleSlots(userId, { from, to, now = Date.now(), includeMakeup = false }) {
  const repos = getRepos();
  const memberships = (await repos.memberships.forUser(userId)).filter((m) => m.collegeId);
  if (memberships.length === 0) return [];
  const overrides = new Map((await repos.slots.assignmentsForUser(userId)).map((a) => [a.slotId, a.kind]));

  const candidates = [];
  const colleges = new Map();
  for (const m of memberships) {
    if (!colleges.has(m.collegeId)) colleges.set(m.collegeId, await repos.colleges.getById(m.collegeId));
  }
  const byCollege = new Map();
  for (const m of memberships) byCollege.set(m.collegeId, [...(byCollege.get(m.collegeId) || []), m]);

  for (const [collegeId, ms] of byCollege) {
    // Look a day either side so "earlier the same local day" is visible for the makeup rule.
    const slots = await repos.slots.listSlots({ collegeId, from: from - 24 * 60 * MINUTE, to: to + 24 * 60 * MINUTE });
    for (const slot of slots) {
      const kind = overrides.get(slot.id);
      if (kind === 'remove') continue;
      const inSection = !slot.sectionId || ms.some((m) => m.sectionId === slot.sectionId);
      if (inSection || kind === 'add') candidates.push({ slot, kind, timezone: colleges.get(collegeId)?.timezone || 'UTC' });
    }
  }

  const regularEnded = candidates.filter((c) => !c.slot.makeup && c.slot.endsAt <= now);
  const attended = new Set(await repos.queue.attendedSlots(userId, regularEnded.map((c) => c.slot.id)));
  const missedDays = new Set(regularEnded.filter((c) => !attended.has(c.slot.id)).map((c) => `${c.slot.collegeId}|${localParts(c.slot.startsAt, c.timezone).date}`));

  return candidates
    .filter(({ slot, kind, timezone }) => {
      if (slot.endsAt <= from || slot.startsAt >= to) return false;
      if (!slot.makeup) return true;
      if (kind === 'add' || includeMakeup) return true;
      return missedDays.has(`${slot.collegeId}|${localParts(slot.startsAt, timezone).date}`);
    })
    .map((c) => c.slot)
    .sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
}

module.exports = {
  SlotError, createTemplate, listTemplates, setTemplateActive, deleteTemplate, addBlackout, listBlackouts, removeBlackout,
  generate, listSlots, updateSlot, deleteSlot, assignStudent, unassignStudent, listAssignments, eligibleSlots, describeSlot, MAX_GENERATE_DAYS,
};
