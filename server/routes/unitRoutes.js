/**
 * Unit Routes — REST API for Learning Units (Learn, Practice, Prepare)
 */

const express = require('express');
const units = require('../lib/units');

const router = express.Router();

/**
 * Course content only changes with a deploy and is the same for everyone,
 * so browsers may reuse it for a few minutes and then revalidate with the ETag.
 */
function sendContent(res, body) {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(body);
}

/**
 * GET /api/units
 * List all learning units (metadata only)
 */
router.get('/', (req, res) => {
  const data = units.listMeta();
  sendContent(res, { success: true, data, count: data.length });
});

/**
 * GET /api/units/:unitId
 * Get metadata for a specific unit
 */
router.get('/:unitId', (req, res) => {
  const unit = units.getUnit(req.params.unitId);
  if (!unit) {
    return res.status(404).json({ success: false, error: 'Unit not found' });
  }
  sendContent(res, { success: true, data: unit.meta });
});

/**
 * GET /api/units/:unitId/:mode (learn | practice | prepare | casestudy)
 * Get mode-specific content for a unit
 */
router.get('/:unitId/:mode', (req, res) => {
  const { unitId, mode } = req.params;
  if (!units.MODES.includes(mode)) {
    return res.status(400).json({ success: false, error: `Mode must be one of: ${units.MODES.join(', ')}` });
  }

  const unit = units.getUnit(unitId);
  const content = unit && (mode === 'practice' ? units.publicPractice(unitId) : unit[mode]);
  if (!content) {
    return res.status(404).json({ success: false, error: `No ${mode} content for this unit` });
  }

  sendContent(res, { success: true, data: content });
});

module.exports = router;
