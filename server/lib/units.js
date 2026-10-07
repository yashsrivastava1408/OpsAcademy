/**
 * Unit content loader — reads server/data/units once and serves it from memory.
 */

const fs = require('fs');
const path = require('path');

const UNITS_DIR = path.join(__dirname, '..', 'data', 'units');
const MODES = ['learn', 'practice', 'prepare', 'casestudy'];
const UNIT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

let cache = null;

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Prepare content has been authored in three layouts (front/back vs
 * question/answer cards, `interviewQuestions` vs `questions`). Convert them
 * all to one, so the API and the UI only deal with a single shape.
 */
function normalisePrepare(prepare) {
  const flashcards = (prepare.flashcards || []).map((card, index) => ({
    ...card,
    id: String(card.id ?? `fc-${index + 1}`),
    front: card.front ?? card.question,
    back: card.back ?? card.answer,
  }));

  const interviewQuestions = (prepare.interviewQuestions || prepare.questions || []).map((q, index) => ({
    ...q,
    id: String(q.id ?? `iq-${index + 1}`),
    difficulty: q.difficulty || 'intermediate',
    modelAnswer: q.modelAnswer ?? q.answer,
  }));

  return { ...prepare, flashcards, interviewQuestions };
}

function load(unitsDir = UNITS_DIR) {
  const units = new Map();
  if (!fs.existsSync(unitsDir)) return units;

  for (const folder of fs.readdirSync(unitsDir).sort()) {
    if (!UNIT_ID_PATTERN.test(folder)) continue;
    const meta = readJson(path.join(unitsDir, folder, 'unit.json'));
    if (!meta) continue;
    const unit = { meta };
    for (const mode of MODES) {
      unit[mode] = readJson(path.join(unitsDir, folder, `${mode}.json`));
    }
    if (unit.prepare) unit.prepare = normalisePrepare(unit.prepare);
    units.set(folder, unit);
  }
  return units;
}

function all() {
  if (!cache) cache = load();
  return cache;
}

/** Unit ids come from URLs, so reject anything that is not a plain slug. */
function isValidUnitId(unitId) {
  return typeof unitId === 'string' && UNIT_ID_PATTERN.test(unitId);
}

function getUnit(unitId) {
  if (!isValidUnitId(unitId)) return null;
  return all().get(unitId) || null;
}

function listMeta() {
  return [...all().values()].map((unit) => unit.meta);
}

function getSteps(unitId) {
  const unit = getUnit(unitId);
  return unit && unit.practice ? unit.practice.steps || [] : [];
}

function getStep(unitId, stepNumber) {
  return getSteps(unitId).find((s) => s.step === Number(stepNumber)) || null;
}

/**
 * Practice content as sent to the browser: the verification command stays on
 * the server so the check itself cannot be read off the network tab.
 */
function publicPractice(unitId) {
  const unit = getUnit(unitId);
  if (!unit || !unit.practice) return null;
  return {
    ...unit.practice,
    steps: (unit.practice.steps || []).map(({ verification, ...step }) => ({
      ...step,
      autoVerified: Boolean(verification && verification.command),
    })),
  };
}

/** Learn content is authored as either `sections` or `modules`. */
function getLearnSections(unitId) {
  const unit = getUnit(unitId);
  if (!unit || !unit.learn) return [];
  return unit.learn.sections || unit.learn.modules || [];
}

function getInterviewQuestions(unitId) {
  const unit = getUnit(unitId);
  return unit && unit.prepare ? unit.prepare.interviewQuestions || [] : [];
}

function getFlashcards(unitId) {
  const unit = getUnit(unitId);
  return unit && unit.prepare ? unit.prepare.flashcards || [] : [];
}

function totalSteps() {
  let count = 0;
  for (const unit of all().values()) count += unit.practice ? (unit.practice.steps || []).length : 0;
  return count;
}

module.exports = {
  MODES,
  UNITS_DIR,
  load,
  normalisePrepare,
  isValidUnitId,
  getUnit,
  listMeta,
  getSteps,
  getStep,
  publicPractice,
  getLearnSections,
  getInterviewQuestions,
  getFlashcards,
  totalSteps,
};
