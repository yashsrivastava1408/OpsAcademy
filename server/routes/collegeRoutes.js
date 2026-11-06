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

module.exports = router;
