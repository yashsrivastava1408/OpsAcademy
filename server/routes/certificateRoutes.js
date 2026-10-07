/**
 * Certificate Routes — signed completion certificates and public verification
 */

const express = require('express');
const { requireAuth, requireRegistered } = require('../middleware/auth');
const userService = require('../services/userService');
const certificateService = require('../services/certificateService');

const router = express.Router();

/**
 * GET /api/certificates
 * The caller's certificates
 */
router.get('/', requireAuth, (req, res) => {
  res.json({ success: true, data: certificateService.listFor(req.user.id) });
});

/**
 * POST /api/certificates
 * Issue a certificate for a unit the caller has completed
 * Body: { unitId }
 */
router.post('/', requireAuth, requireRegistered, (req, res, next) => {
  try {
    const user = userService.getById(req.user.id);
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized: account no longer exists' });

    const certificate = certificateService.issue(user, req.body && req.body.unitId);
    res.status(201).json({ success: true, data: certificate });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/certificates/verify/:certificateId
 * Public endpoint: confirms a certificate was issued here and is unaltered
 */
router.get('/verify/:certificateId', (req, res) => {
  const certificate = certificateService.verify(req.params.certificateId);
  if (!certificate) {
    return res.status(404).json({ success: false, verified: false, error: 'No valid certificate with this ID' });
  }
  res.json({ success: true, verified: true, data: certificate });
});

module.exports = router;
