/**
 * Progress Service — server-side record of what each learner has done
 *
 * Tracks verified lab steps, hints used, quiz passes, flashcard schedules
 * and mock-interview scores, and derives XP, streaks and weak topics from
 * them. Lab completion is only ever written by the verification route, so
 * it reflects checks that actually ran in the sandbox.
 */

const { getStore } = require('../lib/store');
const units = require('../lib/units');
const sm2 = require('../lib/sm2');

const PROGRESS = 'progress';
const USERS = 'users';

const XP = { step: 20, unit: 100, quiz: 25, flashcard: 2, interview: 30 };
const XP_PER_LEVEL = 250;
const INTERVIEW_PASS_SCORE = 70;
const MAX_ACTIVE_DAYS = 400;
const MAX_INTERVIEWS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function emptyProgress(userId) {
  return {
    userId,
    xp: 0,
    completedUnits: {},
    steps: {},
    hints: {},
    quizzes: {},
    cards: {},
    interviews: [],
    activeDays: [],
  };
}

function load(userId) {
  return getStore().get(PROGRESS, userId) || emptyProgress(userId);
}

function save(doc) {
  getStore().set(PROGRESS, doc.userId, doc);
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function markActive(doc, now) {
  const today = dayKey(now);
  if (!doc.activeDays.includes(today)) {
    doc.activeDays.push(today);
    doc.activeDays.sort();
    if (doc.activeDays.length > MAX_ACTIVE_DAYS) doc.activeDays = doc.activeDays.slice(-MAX_ACTIVE_DAYS);
  }
}

function stepKey(unitId, step) {
  return `${unitId}:${step}`;
}

/**
 * Days are counted in UTC. The current streak stays alive through today:
 * it only breaks once a full day has been missed.
 */
function computeStreak(activeDays, now = Date.now()) {
  if (activeDays.length === 0) return { current: 0, longest: 0, activeToday: false };

  const days = [...new Set(activeDays)].sort();
  const toIndex = (key) => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = toIndex(days[i]) - toIndex(days[i - 1]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const todayIndex = toIndex(dayKey(now));
  const lastIndex = toIndex(days[days.length - 1]);
  const activeToday = lastIndex === todayIndex;

  let current = 0;
  if (todayIndex - lastIndex <= 1) {
    current = 1;
    for (let i = days.length - 1; i > 0; i -= 1) {
      if (toIndex(days[i]) - toIndex(days[i - 1]) !== 1) break;
      current += 1;
    }
  }

  return { current, longest, activeToday };
}

/**
 * Record the outcome of a verification run.
 * @param {Array<{ step: number, passed: boolean }>} results
 */
function recordVerification(userId, unitId, results, now = Date.now()) {
  const doc = load(userId);
  let xpAwarded = 0;

  for (const result of results) {
    const key = stepKey(unitId, result.step);
    const entry = doc.steps[key] || { attempts: 0, fails: 0, passedAt: null };
    entry.attempts += 1;
    if (result.passed) {
      if (!entry.passedAt) {
        entry.passedAt = now;
        xpAwarded += XP.step;
      }
    } else if (!entry.passedAt) {
      // Failures after a step has been passed are re-checks, not struggle.
      entry.fails += 1;
    }
    doc.steps[key] = entry;
  }

  const allSteps = units.getSteps(unitId);
  const unitCompleted = allSteps.length > 0
    && allSteps.every((s) => doc.steps[stepKey(unitId, s.step)] && doc.steps[stepKey(unitId, s.step)].passedAt);

  let newlyCompleted = false;
  if (unitCompleted && !doc.completedUnits[unitId]) {
    doc.completedUnits[unitId] = now;
    xpAwarded += XP.unit;
    newlyCompleted = true;
  }

  doc.xp += xpAwarded;
  markActive(doc, now);
  save(doc);
  return { xpAwarded, unitCompleted, newlyCompleted };
}

function hintCount(userId, unitId, step) {
  return load(userId).hints[stepKey(unitId, step)] || 0;
}

function recordHint(userId, unitId, step, now = Date.now()) {
  const doc = load(userId);
  const key = stepKey(unitId, step);
  doc.hints[key] = (doc.hints[key] || 0) + 1;
  markActive(doc, now);
  save(doc);
  return doc.hints[key];
}

function recordQuiz(userId, unitId, quizId, now = Date.now()) {
  const doc = load(userId);
  const key = `${unitId}:${quizId}`;
  let xpAwarded = 0;
  if (!doc.quizzes[key]) {
    doc.quizzes[key] = now;
    xpAwarded = XP.quiz;
    doc.xp += xpAwarded;
  }
  markActive(doc, now);
  save(doc);
  return { xpAwarded };
}

/** The unit's flashcards with each card's schedule, due cards first. */
function getDeck(userId, unitId, now = Date.now()) {
  const doc = load(userId);
  const cards = units.getFlashcards(unitId).map((card) => {
    const state = doc.cards[`${unitId}:${card.id}`] || null;
    return {
      ...card,
      due: sm2.isDue(state, now),
      dueAt: state ? state.due : null,
      intervalDays: state ? state.intervalDays : 0,
      reps: state ? state.reps : 0,
      seen: Boolean(state),
    };
  });

  cards.sort((a, b) => Number(b.due) - Number(a.due) || (a.dueAt || 0) - (b.dueAt || 0));
  return { cards, dueCount: cards.filter((c) => c.due).length, total: cards.length };
}

function reviewCard(userId, unitId, cardId, grade, now = Date.now()) {
  if (!units.getFlashcards(unitId).some((card) => card.id === cardId)) return null;

  const doc = load(userId);
  const key = `${unitId}:${cardId}`;
  doc.cards[key] = sm2.review(doc.cards[key], grade, now);
  doc.xp += XP.flashcard;
  markActive(doc, now);
  save(doc);
  return doc.cards[key];
}

function recordInterview(userId, unitId, questionId, score, now = Date.now()) {
  const doc = load(userId);
  const alreadyPassed = doc.interviews.some(
    (i) => i.unitId === unitId && i.questionId === questionId && i.score >= INTERVIEW_PASS_SCORE
  );
  let xpAwarded = 0;
  if (score >= INTERVIEW_PASS_SCORE && !alreadyPassed) {
    xpAwarded = XP.interview;
    doc.xp += xpAwarded;
  }
  doc.interviews.push({ unitId, questionId, score, at: now });
  if (doc.interviews.length > MAX_INTERVIEWS) doc.interviews = doc.interviews.slice(-MAX_INTERVIEWS);
  markActive(doc, now);
  save(doc);
  return { xpAwarded };
}

/**
 * Units where the learner struggled, ranked by failed checks and hints used.
 */
function weakTopics(doc, limit = 5) {
  const byUnit = new Map();
  const bump = (key, field, amount) => {
    const [unitId, step] = key.split(':');
    if (!byUnit.has(unitId)) byUnit.set(unitId, { fails: 0, hints: 0, steps: new Map() });
    const unit = byUnit.get(unitId);
    unit[field] += amount;
    const stepEntry = unit.steps.get(step) || { fails: 0, hints: 0 };
    stepEntry[field] += amount;
    unit.steps.set(step, stepEntry);
  };

  for (const [key, entry] of Object.entries(doc.steps)) if (entry.fails) bump(key, 'fails', entry.fails);
  for (const [key, count] of Object.entries(doc.hints)) if (count) bump(key, 'hints', count);

  const weight = (entry) => entry.fails + entry.hints * 0.5;

  return [...byUnit.entries()]
    .map(([unitId, entry]) => {
      const unit = units.getUnit(unitId);
      const steps = [...entry.steps.entries()]
        .map(([step, s]) => {
          const stepData = units.getStep(unitId, step);
          return { step: Number(step), title: stepData ? stepData.title : `Step ${step}`, fails: s.fails, hints: s.hints };
        })
        .sort((a, b) => weight(b) - weight(a))
        .slice(0, 3);
      return {
        unitId,
        title: unit ? unit.meta.title : unitId,
        fails: entry.fails,
        hints: entry.hints,
        score: weight(entry),
        steps,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function summary(userId, now = Date.now()) {
  const doc = load(userId);

  const unitProgress = {};
  let stepsPassed = 0;
  for (const meta of units.listMeta()) {
    const steps = units.getSteps(meta.id);
    let passed = 0;
    for (const s of steps) {
      const entry = doc.steps[stepKey(meta.id, s.step)];
      if (entry && entry.passedAt) passed += 1;
    }
    stepsPassed += passed;
    if (passed > 0 || doc.completedUnits[meta.id]) {
      unitProgress[meta.id] = {
        passedSteps: passed,
        totalSteps: steps.length,
        completedAt: doc.completedUnits[meta.id] || null,
      };
    }
  }

  let cardsDue = 0;
  for (const state of Object.values(doc.cards)) if (sm2.isDue(state, now)) cardsDue += 1;

  const stepsTotal = units.totalSteps();
  const interviewScores = doc.interviews.map((i) => i.score);

  return {
    xp: doc.xp,
    level: Math.floor(doc.xp / XP_PER_LEVEL) + 1,
    xpToNextLevel: XP_PER_LEVEL - (doc.xp % XP_PER_LEVEL),
    streak: computeStreak(doc.activeDays, now),
    completedUnits: Object.keys(doc.completedUnits),
    unitProgress,
    passedQuizzes: Object.keys(doc.quizzes),
    weakTopics: weakTopics(doc),
    cardsDue,
    cardsStarted: Object.keys(doc.cards).length,
    interviews: {
      answered: interviewScores.length,
      averageScore: interviewScores.length
        ? Math.round(interviewScores.reduce((a, b) => a + b, 0) / interviewScores.length)
        : null,
    },
    totals: { units: units.listMeta().length, steps: stepsTotal, stepsPassed },
    // Share of all lab steps verified in a sandbox.
    readiness: stepsTotal ? Math.round((stepsPassed / stepsTotal) * 100) : 0,
    activeDays: doc.activeDays.slice(-60),
  };
}

/** How cleanly a unit was completed: 100 means every step passed first time. */
function unitAccuracy(userId, unitId) {
  const doc = load(userId);
  let passed = 0;
  let fails = 0;
  for (const s of units.getSteps(unitId)) {
    const entry = doc.steps[stepKey(unitId, s.step)];
    if (!entry) continue;
    if (entry.passedAt) passed += 1;
    fails += entry.fails;
  }
  return passed + fails === 0 ? 0 : Math.round((passed / (passed + fails)) * 100);
}

function isUnitCompleted(userId, unitId) {
  return Boolean(load(userId).completedUnits[unitId]);
}

function leaderboard(limit = 20, now = Date.now()) {
  const store = getStore();
  return store.all(PROGRESS)
    .filter((doc) => doc.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit)
    .map((doc, index) => {
      const user = store.get(USERS, doc.userId);
      return {
        rank: index + 1,
        userId: doc.userId,
        name: user ? user.name : 'Learner',
        xp: doc.xp,
        completedUnits: Object.keys(doc.completedUnits).length,
        streak: computeStreak(doc.activeDays, now).current,
      };
    });
}

module.exports = {
  XP,
  INTERVIEW_PASS_SCORE,
  computeStreak,
  recordVerification,
  hintCount,
  recordHint,
  recordQuiz,
  getDeck,
  reviewCard,
  recordInterview,
  summary,
  unitAccuracy,
  isUnitCompleted,
  leaderboard,
};
