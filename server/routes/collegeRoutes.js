/**
 * College Routes — colleges, sections, members, roster import, college leaderboard.
 *
 * Tenant rule: everything under /:collegeId first proves the caller is a member of
 * that college (requireCollegeRole); platform admins may act on any college.
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requireCollegeRole, loadAccess } = require('../middleware/rbac');
const asyncHandler = require('../middleware/asyncHandler');
const collegeService = require('../services/collegeService');
const audit = require('../services/auditService');
const slotService = require('../services/slotService');

const router = express.Router();

const STAFF = ['trainer', 'placement_officer', 'college_admin'];
const ANY_MEMBER = ['student', ...STAFF];

/** POST /api/colleges — platform admin creates a college */
router.post('/', requireRole('platform_admin'), asyncHandler(async (req, res) => {
  const college = await collegeService.createCollege(req.body || {});
  await audit.record(req, 'college.create', { entityType: 'college', entityId: college.id, collegeId: college.id, meta: { slug: college.slug } });
  res.status(201).json({ success: true, data: college });
}));

/** GET /api/colleges — platform admin: every college */
router.get('/', requireRole('platform_admin'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await collegeService.listColleges() });
}));

/** GET /api/colleges/mine — the colleges the caller belongs to, with their roles */
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const access = await loadAccess(req.user);
  const colleges = [];
  for (const collegeId of access.collegeIds) {
    const college = await collegeService.getCollege(collegeId);
    colleges.push({ ...college, roles: access.memberships.filter((m) => m.collegeId === collegeId).map((m) => m.role) });
  }
  res.json({ success: true, data: colleges });
}));

router.get('/:collegeId', requireCollegeRole(...ANY_MEMBER), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await collegeService.getCollege(req.params.collegeId) });
}));

router.get('/:collegeId/sections', requireCollegeRole(...STAFF), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await collegeService.listSections(req.params.collegeId) });
}));

router.get('/:collegeId/members', requireCollegeRole(...STAFF), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await collegeService.listMembers(req.params.collegeId, req.query.role) });
}));

/** GET /api/colleges/:collegeId/leaderboard — students see their own college's ranking */
router.get('/:collegeId/leaderboard', requireCollegeRole(...ANY_MEMBER), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await collegeService.leaderboard(req.params.collegeId) });
}));

/**
 * POST /api/colleges/:collegeId/roster
 * Body: { csv, dryRun }. Columns: name, email, section, role. Returns a report.
 */
router.post('/:collegeId/roster', requireCollegeRole('college_admin'), asyncHandler(async (req, res) => {
  const { csv, dryRun } = req.body || {};
  if (typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ success: false, error: 'Send the file contents as "csv"' });
  }
  const report = await collegeService.importRoster(req.params.collegeId, csv, { dryRun: dryRun === true });
  if (!report.dryRun) {
    await audit.record(req, 'roster.import', {
      entityType: 'college', entityId: req.params.collegeId, collegeId: req.params.collegeId,
      meta: { added: report.added, invited: report.invited, rejected: report.errors.length },
    });
  }
  res.json({ success: true, data: report });
}));

/** GET /api/colleges/:collegeId/audit — what admins and trainers did in this college */
router.get('/:collegeId/audit', requireCollegeRole('college_admin'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await audit.list({ collegeId: req.params.collegeId, limit: 200 }) });
}));

// ── Lab slots ────────────────────────────────────────────────
// The college decides who uses which slot: admins make templates, blackout dates and slots and give them to
// sections; trainers move individual students. Every change is audit-logged.

const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN = ['college_admin'];
const TRAINERS = ['trainer', 'college_admin'];

function timeRange(query) {
  const from = Number(query.from) || Date.now() - DAY_MS;
  const to = Number(query.to) || from + 31 * DAY_MS;
  return { from, to: Math.min(to, from + 190 * DAY_MS) };
}

router.get('/:collegeId/slot-templates', requireCollegeRole(...STAFF), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await slotService.listTemplates(req.params.collegeId) });
}));

router.post('/:collegeId/slot-templates', requireCollegeRole(...ADMIN), asyncHandler(async (req, res) => {
  const template = await slotService.createTemplate(req.params.collegeId, req.body, req.user.id);
  await audit.record(req, 'slot_template.create', { entityType: 'slot_template', entityId: template.id, collegeId: req.params.collegeId, meta: { weekday: template.weekday, startTime: template.startTime, seats: template.seats } });
  res.status(201).json({ success: true, data: template });
}));

router.post('/:collegeId/slot-templates/:templateId/:action(activate|deactivate)', requireCollegeRole(...ADMIN), asyncHandler(async (req, res) => {
  const template = await slotService.setTemplateActive(req.params.collegeId, req.params.templateId, req.params.action === 'activate');
  await audit.record(req, `slot_template.${req.params.action}`, { entityType: 'slot_template', entityId: template.id, collegeId: req.params.collegeId });
  res.json({ success: true, data: template });
}));

router.delete('/:collegeId/slot-templates/:templateId', requireCollegeRole(...ADMIN), asyncHandler(async (req, res) => {
  await slotService.deleteTemplate(req.params.collegeId, req.params.templateId);
  await audit.record(req, 'slot_template.delete', { entityType: 'slot_template', entityId: req.params.templateId, collegeId: req.params.collegeId });
  res.json({ success: true });
}));

router.get('/:collegeId/blackouts', requireCollegeRole(...STAFF), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await slotService.listBlackouts(req.params.collegeId) });
}));

router.post('/:collegeId/blackouts', requireCollegeRole(...ADMIN), asyncHandler(async (req, res) => {
  const blackout = await slotService.addBlackout(req.params.collegeId, req.body || {});
  await audit.record(req, 'blackout.add', { entityType: 'blackout', entityId: blackout.id, collegeId: req.params.collegeId, meta: { onDate: blackout.onDate } });
  res.status(201).json({ success: true, data: blackout });
}));

router.delete('/:collegeId/blackouts/:id', requireCollegeRole(...ADMIN), asyncHandler(async (req, res) => {
  await slotService.removeBlackout(req.params.collegeId, req.params.id);
  await audit.record(req, 'blackout.remove', { entityType: 'blackout', entityId: req.params.id, collegeId: req.params.collegeId });
  res.json({ success: true });
}));

/** POST /api/colleges/:collegeId/slots/generate  { from, to, templateId? } — a semester of slots in one action */
router.post('/:collegeId/slots/generate', requireCollegeRole(...ADMIN), asyncHandler(async (req, res) => {
  const result = await slotService.generate(req.params.collegeId, req.body || {}, req.user.id);
  await audit.record(req, 'slots.generate', { entityType: 'college', entityId: req.params.collegeId, collegeId: req.params.collegeId, meta: result });
  res.status(201).json({ success: true, data: result });
}));

/** GET /api/colleges/:collegeId/slots?from=&to= (epoch ms) — slots with who may use them and any warnings */
router.get('/:collegeId/slots', requireCollegeRole(...STAFF), asyncHandler(async (req, res) => {
  const { from, to } = timeRange(req.query);
  res.json({ success: true, data: await slotService.listSlots(req.params.collegeId, from, to) });
}));

/** PATCH /api/colleges/:collegeId/slots/:slotId  { sectionId?, capacity? } — give a slot to a section, set its seats */
router.patch('/:collegeId/slots/:slotId', requireCollegeRole(...ADMIN), asyncHandler(async (req, res) => {
  const slot = await slotService.updateSlot(req.params.collegeId, req.params.slotId, req.body || {});
  await audit.record(req, 'slot.update', { entityType: 'slot', entityId: slot.id, collegeId: req.params.collegeId, meta: { sectionId: slot.sectionId, capacity: slot.capacity } });
  res.json({ success: true, data: slot });
}));

router.delete('/:collegeId/slots/:slotId', requireCollegeRole(...ADMIN), asyncHandler(async (req, res) => {
  await slotService.deleteSlot(req.params.collegeId, req.params.slotId);
  await audit.record(req, 'slot.delete', { entityType: 'slot', entityId: req.params.slotId, collegeId: req.params.collegeId });
  res.json({ success: true });
}));

router.get('/:collegeId/slots/:slotId/assignments', requireCollegeRole(...STAFF), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await slotService.listAssignments(req.params.collegeId, req.params.slotId) });
}));

/** PUT /api/colleges/:collegeId/slots/:slotId/students/:userId  { kind: 'add' | 'remove' } — a trainer's override for one student */
router.put('/:collegeId/slots/:slotId/students/:userId', requireCollegeRole(...TRAINERS), asyncHandler(async (req, res) => {
  const kind = (req.body && req.body.kind) || 'add';
  const result = await slotService.assignStudent(req.params.collegeId, req.params.slotId, req.params.userId, kind);
  await audit.record(req, `slot.student_${kind}`, { entityType: 'slot', entityId: req.params.slotId, collegeId: req.params.collegeId, meta: { userId: req.params.userId, warnings: result.warnings.map((w) => w.code) } });
  res.json({ success: true, data: result });
}));

router.delete('/:collegeId/slots/:slotId/students/:userId', requireCollegeRole(...TRAINERS), asyncHandler(async (req, res) => {
  await slotService.unassignStudent(req.params.collegeId, req.params.slotId, req.params.userId);
  await audit.record(req, 'slot.student_clear', { entityType: 'slot', entityId: req.params.slotId, collegeId: req.params.collegeId, meta: { userId: req.params.userId } });
  res.json({ success: true });
}));

module.exports = router;
