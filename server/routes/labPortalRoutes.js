/**
 * Lab Portal Routes — can I enter the lab, and in what order.
 *   GET    /api/lab/availability   where I stand right now (one cheap call for the Theory/Lab switch button)
 *   POST   /api/lab/enter          reserve a seat now, or join the queue
 *   DELETE /api/lab/queue          leave the queue, or give back a reserved seat
 *   POST   /api/lab/events         switch clicks and transition steps, for the drop-off dashboard
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const labService = require('../services/labService');
const slotService = require('../services/slotService');

const router = express.Router();

// Polled every few seconds by the lab page: a short per-process cache keeps it far below the database's limits.
const CACHE_MS = 1000; // short, so a seat freed by the worker shows up well inside 5 s
const cache = new Map(); // userId -> { at, value }
function dropCached(userId) {
  cache.delete(userId);
}

router.get('/availability', requireAuth, asyncHandler(async (req, res) => {
  const hit = cache.get(req.user.id);
  let value;
  if (hit && Date.now() - hit.at < CACHE_MS) {
    value = { ...hit.value, serverTime: Date.now() };
  } else {
    value = await labService.availability(req.user);
    if (cache.size > 5000) cache.clear();
    cache.set(req.user.id, { at: Date.now(), value });
  }
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: value });
}));

/** GET /api/lab/my-slots — the caller's own upcoming lab slots (next 14 days), for the dashboard */
router.get('/my-slots', requireAuth, asyncHandler(async (req, res) => {
  const now = Date.now();
  const slots = await slotService.eligibleSlots(req.user.id, { from: now, to: now + 14 * 24 * 60 * 60 * 1000, now });
  res.json({ success: true, data: slots.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, capacity: s.capacity, makeup: s.makeup, unitId: s.unitId })) });
}));

router.post('/enter', requireAuth, asyncHandler(async (req, res) => {
  dropCached(req.user.id);
  const unitId = req.body && typeof req.body.unitId === 'string' ? req.body.unitId.slice(0, 64) : null;
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: await labService.enter(req.user, { unitId }) });
}));

router.delete('/queue', requireAuth, asyncHandler(async (req, res) => {
  dropCached(req.user.id);
  res.json({ success: true, left: await labService.leave(req.user) });
}));

router.post('/events', requireAuth, asyncHandler(async (req, res) => {
  const { name, props } = req.body || {};
  if (typeof name !== 'string' || !labService.EVENT_NAMES.has(name)) {
    return res.status(400).json({ success: false, error: 'Unknown event' });
  }
  await labService.record(req.user, name, props);
  res.status(202).json({ success: true });
}));

module.exports = router;
module.exports.dropCached = dropCached;
