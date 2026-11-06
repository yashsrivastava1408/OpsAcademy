/**
 * Colleges, sections and the roster import. Every read and write takes the
 * college id explicitly, and the routes only call in after checking the caller
 * belongs to that college (middleware/rbac.requireCollegeRole).
 */
const { getRepos } = require('../repositories');
const { parseCsv } = require('../lib/csv');
const { computeStreak } = require('./progressService');

class CollegeError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const SLUG = /^[a-z0-9-]{2,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROSTER_ROWS = 1000;
const ROSTER_ROLES = ['student', 'trainer'];

async function createCollege({ name, slug, timezone }) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
  if (cleanName.length < 2 || cleanName.length > 120) throw new CollegeError('College name must be 2 to 120 characters');
  if (!SLUG.test(cleanSlug)) throw new CollegeError('Address must be 2 to 40 letters, digits or hyphens');
  if (timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch {
      throw new CollegeError('Unknown time zone');
    }
  }
  try {
    return await getRepos().colleges.create({ name: cleanName, slug: cleanSlug, timezone });
  } catch (err) {
    if (err.code === 'college_slug_taken') throw new CollegeError(err.message, 409);
    throw err;
  }
}

const listColleges = () => getRepos().colleges.list();

async function getCollege(collegeId) {
  const college = await getRepos().colleges.getById(collegeId);
  if (!college) throw new CollegeError('Not found', 404);
  return college;
}

const listSections = (collegeId) => getRepos().sections.listByCollege(collegeId);
const listMembers = (collegeId, role) => getRepos().memberships.listByCollege(collegeId, { role: role || null });

/** The college's own ranking, only its members, with names. */
async function leaderboard(collegeId, limit = 20, now = Date.now()) {
  const repos = getRepos();
  const rows = await repos.progress.leaderboard(limit, { collegeId });
  const names = await repos.users.namesByIds(rows.map((r) => r.userId));
  return rows
    .filter((r) => names[r.userId] !== undefined)
    .map((r, index) => ({ rank: index + 1, name: names[r.userId], xp: r.xp, completedUnits: r.completedUnits, streak: computeStreak(r.activeDays, now).current }));
}

/**
 * Read a roster: columns name, email, section (optional), role (optional: student or trainer).
 * A header row is detected by the word "email". Returns the valid rows and a report of the rest.
 */
function readRoster(csv) {
  const raw = parseCsv(csv);
  if (raw.length === 0) throw new CollegeError('The file has no rows');
  let columns = { name: 0, email: 1, section: 2, role: 3 };
  let start = 0;
  const header = raw[0].map((c) => c.trim().toLowerCase());
  if (header.includes('email')) {
    columns = { name: header.indexOf('name'), email: header.indexOf('email'), section: header.indexOf('section'), role: header.indexOf('role') };
    start = 1;
  }
  if (raw.length - start > MAX_ROSTER_ROWS) throw new CollegeError(`Import at most ${MAX_ROSTER_ROWS} rows at a time`, 413);
  const cell = (row, i) => (i >= 0 && row[i] !== undefined ? row[i].trim() : '');

  const rows = [];
  const errors = [];
  const seen = new Set();
  for (let i = start; i < raw.length; i += 1) {
    const line = i + 1;
    const row = raw[i];
    const email = cell(row, columns.email).toLowerCase();
    const role = (cell(row, columns.role) || 'student').toLowerCase();
    const section = cell(row, columns.section);
    if (!EMAIL.test(email) || email.length > 254) errors.push({ line, reason: 'Not a valid email address' });
    else if (!ROSTER_ROLES.includes(role)) errors.push({ line, email, reason: `Role must be one of: ${ROSTER_ROLES.join(', ')}` });
    else if (section.length > 80) errors.push({ line, email, reason: 'Section name is longer than 80 characters' });
    else if (seen.has(`${email}|${role}`)) errors.push({ line, email, reason: 'Listed twice in this file' });
    else {
      seen.add(`${email}|${role}`);
      rows.push({ line, email, role, section: section || null, name: cell(row, columns.name) });
    }
  }
  return { rows, errors };
}

/**
 * Add people to a college from a CSV. Someone who already has a verified account
 * becomes a member at once; everyone else gets an invite that is applied when they
 * sign in with that email. `dryRun` validates and reports without writing.
 */
async function importRoster(collegeId, csv, { dryRun = false } = {}) {
  await getCollege(collegeId);
  const repos = getRepos();
  const { rows, errors } = readRoster(csv);
  const report = { dryRun, total: rows.length + errors.length, added: 0, invited: 0, alreadyMembers: 0, sectionsCreated: 0, errors };

  const knownSections = new Map((await repos.sections.listByCollege(collegeId)).map((s) => [s.name, s]));
  const existing = new Set((await repos.memberships.listByCollege(collegeId)).map((m) => `${m.email}|${m.role}`));

  for (const row of rows) {
    let section = row.section ? knownSections.get(row.section) : null;
    if (row.section && !section) {
      report.sectionsCreated += 1;
      if (!dryRun) section = await repos.sections.ensure({ collegeId, name: row.section });
      knownSections.set(row.section, section || { id: null, name: row.section });
    }
    if (existing.has(`${row.email}|${row.role}`)) {
      report.alreadyMembers += 1;
      continue;
    }
    const user = await repos.users.getByEmail(row.email);
    if (user && user.emailVerified) {
      if (!dryRun) await repos.memberships.add({ userId: user.id, collegeId, sectionId: section ? section.id : null, role: row.role });
      report.added += 1;
    } else {
      if (!dryRun) await repos.invites.add({ collegeId, sectionId: section ? section.id : null, email: row.email, role: row.role });
      report.invited += 1;
    }
  }
  return report;
}

module.exports = { CollegeError, createCollege, listColleges, getCollege, listSections, listMembers, leaderboard, importRoster, readRoster, MAX_ROSTER_ROWS };
