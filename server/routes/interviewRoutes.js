/**
 * Interview Routes — mock interview questions scored against a rubric
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const units = require('../lib/units');
const { getHubClient } = require('../services/aiHubClient');
const progressService = require('../services/progressService');

const router = express.Router();
const MAX_ANSWER_CHARS = 4000;
const MIN_ANSWER_CHARS = 20;

router.use(requireAuth);

/**
 * GET /api/interview/:unitId/questions
 * The unit's interview questions, without model answers
 */
router.get('/:unitId/questions', (req, res) => {
  if (!units.getUnit(req.params.unitId)) {
    return res.status(404).json({ success: false, error: 'Unit not found' });
  }
  const data = units.getInterviewQuestions(req.params.unitId)
    .map(({ id, question, difficulty }) => ({ id, question, difficulty }));
  res.json({ success: true, data });
});

/**
 * POST /api/interview/:unitId/:questionId/answer
 * Score a written answer against the question's key points
 * Body: { answer }
 */
router.post('/:unitId/:questionId/answer', rateLimit.agent(), async (req, res, next) => {
  try {
    const { unitId, questionId } = req.params;
    const answer = req.body && typeof req.body.answer === 'string' ? req.body.answer.trim() : '';

    const question = units.getInterviewQuestions(unitId).find((q) => q.id === questionId);
    if (!question) return res.status(404).json({ success: false, error: 'Question not found' });
    if (answer.length < MIN_ANSWER_CHARS) {
      return res.status(400).json({ success: false, error: `Write at least ${MIN_ANSWER_CHARS} characters before submitting` });
    }
    if (answer.length > MAX_ANSWER_CHARS) {
      return res.status(400).json({ success: false, error: `Answer is too long (max ${MAX_ANSWER_CHARS} characters)` });
    }

    let evaluation;
    try {
      evaluation = await getHubClient().scoreInterview({
        question: question.question,
        answer,
        keyPoints: question.keyPoints || [],
        modelAnswer: question.modelAnswer || '',
      });
    } catch {
      return res.status(503).json({ success: false, error: 'Answer scoring is unavailable right now. Please try again shortly.' });
    }

    const { xpAwarded } = progressService.recordInterview(req.user.id, unitId, questionId, evaluation.score);

    res.json({
      success: true,
      data: {
        ...evaluation,
        xpAwarded,
        passScore: progressService.INTERVIEW_PASS_SCORE,
        modelAnswer: question.modelAnswer,
        keyPoints: question.keyPoints || [],
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
