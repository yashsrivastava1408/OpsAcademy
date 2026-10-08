/**
 * Profile Routes — a public page a learner can choose to share
 *
 * Shows achievements only (XP, streak, completed units, certificates). It
 * exists only for accounts that turned it on, at an address that cannot be
 * guessed from the account id.
 */

const express = require('express');
const userService = require('../services/userService');
const progressService = require('../services/progressService');
const certificateService = require('../services/certificateService');

const router = express.Router();

/**
 * GET /api/profiles/:slug
 */
router.get('/:slug', (req, res) => {
  const user = userService.getByProfileSlug(req.params.slug);
  if (!user) return res.status(404).json({ success: false, error: 'Profile not found' });

  res.json({
    success: true,
    data: {
      name: user.name,
      memberSince: user.registeredAt || user.createdAt,
      ...progressService.publicSummary(user.id),
      certificates: certificateService.listFor(user.id)
        .map(({ id, unitId, unitTitle, score, issuedAt }) => ({ id, unitId, unitTitle, score, issuedAt })),
    },
  });
});

module.exports = router;
