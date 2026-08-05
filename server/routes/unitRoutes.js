/**
 * Unit Routes — REST API for Learning Units (Learn, Practice, Prepare)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const UNITS_DIR = path.join(__dirname, '..', 'data', 'units');

/**
 * Helper to read JSON safely
 */
function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

/**
 * GET /api/units
 * List all learning units (metadata only)
 */
router.get('/', (req, res, next) => {
  try {
    if (!fs.existsSync(UNITS_DIR)) {
      return res.json({ success: true, data: [], count: 0 });
    }

    const folders = fs.readdirSync(UNITS_DIR);
    const units = [];

    for (const folder of folders) {
      const metaPath = path.join(UNITS_DIR, folder, 'unit.json');
      const meta = readJsonFile(metaPath);
      if (meta) {
        units.push(meta);
      }
    }

    res.json({ success: true, data: units, count: units.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/units/:unitId
 * Get metadata for a specific unit
 */
router.get('/:unitId', (req, res, next) => {
  try {
    const { unitId } = req.params;
    const metaPath = path.join(UNITS_DIR, unitId, 'unit.json');
    const meta = readJsonFile(metaPath);

    if (!meta) {
      return res.status(404).json({ success: false, error: `Unit '${unitId}' not found` });
    }

    res.json({ success: true, data: meta });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/units/:unitId/:mode (learn | practice | prepare)
 * Get mode-specific content for a unit
 */
router.get('/:unitId/:mode', (req, res, next) => {
  try {
    const { unitId, mode } = req.params;
    if (!['learn', 'practice', 'prepare', 'casestudy'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'Mode must be one of: learn, practice, prepare, casestudy' });
    }

    const contentPath = path.join(UNITS_DIR, unitId, `${mode}.json`);
    const content = readJsonFile(contentPath);

    if (!content) {
      return res.status(404).json({ success: false, error: `Content for ${mode} mode in '${unitId}' not found` });
    }

    res.json({ success: true, data: content });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
