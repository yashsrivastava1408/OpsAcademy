/**
 * Progress Routes — XP, streaks, weak topics, quizzes, flashcards and leaderboard
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const units = require('../lib/units');
const progressService = require('../services/progressService');

const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requireAuth);

/**
 * GET /api/progress
 * The caller's progress summary
 */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await progressService.summary(req.user.id) });
}));

/**
 * GET /api/progress/leaderboard
 */
router.get('/leaderboard', asyncHandler(async (req, res) => {
  const rows = (await progressService.leaderboard(20)).map(({ userId, ...row }) => ({ ...row, you: userId === req.user.id }));
  res.json({ success: true, data: rows });
}));

/**
 * POST /api/progress/quiz
 * Check a concept-check answer on the server and award XP on the first pass
 * Body: { unitId, sectionId, answerIndex }
 */
router.post('/quiz', asyncHandler(async (req, res) => {
  const { unitId, sectionId, answerIndex } = req.body || {};
  const section = units.getLearnSections(unitId).find((s) => s.id === sectionId);
  if (!section || !section.quiz) {
    return res.status(404).json({ success: false, error: 'Quiz not found' });
  }

  const correct = Number(answerIndex) === section.quiz.correctIndex;
  const { xpAwarded } = correct ? await progressService.recordQuiz(req.user.id, unitId, sectionId) : { xpAwarded: 0 };
  res.json({ success: true, correct, xpAwarded });
}));

/**
 * GET /api/progress/flashcards/:unitId
 * The unit's deck with spaced-repetition state, due cards first
 */
router.get('/flashcards/:unitId', asyncHandler(async (req, res) => {
  if (!units.getUnit(req.params.unitId)) {
    return res.status(404).json({ success: false, error: 'Unit not found' });
  }
  res.json({ success: true, data: await progressService.getDeck(req.user.id, req.params.unitId) });
}));

/**
 * POST /api/progress/flashcards/:unitId/:cardId/review
 * Body: { grade } — 0-5 recall quality (1 again, 3 hard, 4 good, 5 easy)
 */
router.post('/flashcards/:unitId/:cardId/review', asyncHandler(async (req, res) => {
  const grade = Number(req.body && req.body.grade);
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
    return res.status(400).json({ success: false, error: 'grade must be an integer from 0 to 5' });
  }

  const card = await progressService.reviewCard(req.user.id, req.params.unitId, req.params.cardId, grade);
  if (!card) return res.status(404).json({ success: false, error: 'Flashcard not found' });
  // The re-sorted deck comes back too, so the page needs no second request.
  res.json({ success: true, data: card, deck: await progressService.getDeck(req.user.id, req.params.unitId) });
}));

module.exports = router;
