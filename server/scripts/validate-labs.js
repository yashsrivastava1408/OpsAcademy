#!/usr/bin/env node
/**
 * Validate every unit under data/units against the authoring format
 * described in docs/LAB_AUTHORING.md.
 *
 *   npm run labs:validate
 *
 * Errors (exit 1) are things that break a page or a check. Warnings are
 * accepted legacy layouts that the loader normalises.
 */

const fs = require('fs');
const path = require('path');
const { UNITS_DIR } = require('../lib/units');

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const CHECKS = ['exact', 'contains', 'exitCode'];
const UNIT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const errors = [];
const warnings = [];

function readJson(file, unit) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    errors.push(`${unit}/${path.basename(file)}: invalid JSON (${err.message})`);
    return null;
  }
}

const isText = (value) => typeof value === 'string' && value.trim().length > 0;

function validateMeta(unit, meta) {
  const at = `${unit}/unit.json`;
  if (!meta) return errors.push(`${at}: missing`);
  if (meta.id !== unit) errors.push(`${at}: id "${meta.id}" must match the folder name`);
  for (const field of ['title', 'description', 'duration', 'category']) {
    if (!isText(meta[field])) errors.push(`${at}: "${field}" is required`);
  }
  if (!DIFFICULTIES.includes(meta.difficulty)) errors.push(`${at}: difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  if (!Array.isArray(meta.objectives) || meta.objectives.length === 0) warnings.push(`${at}: no objectives listed`);
}

function validatePractice(unit, practice) {
  const at = `${unit}/practice.json`;
  if (!practice) return warnings.push(`${at}: no practice lab`);
  if (!Array.isArray(practice.steps) || practice.steps.length === 0) return errors.push(`${at}: "steps" must be a non-empty array`);

  practice.steps.forEach((step, index) => {
    const where = `${at} step ${step.step ?? `#${index + 1}`}`;
    if (step.step !== index + 1) errors.push(`${where}: steps must be numbered 1, 2, 3... in order`);
    if (!isText(step.title)) errors.push(`${where}: "title" is required`);
    if (!isText(step.description)) errors.push(`${where}: "description" is required`);
    if (!Array.isArray(step.tasks) || step.tasks.length === 0 || !step.tasks.every(isText)) {
      errors.push(`${where}: "tasks" must be a non-empty array of strings`);
    }

    const check = step.verification;
    if (!check || !isText(check.command)) return errors.push(`${where}: "verification.command" is required`);
    if (!CHECKS.includes(check.check)) errors.push(`${where}: verification.check must be one of ${CHECKS.join(', ')}`);
    if (check.check !== 'exitCode' && !isText(check.expectedOutput)) {
      errors.push(`${where}: verification.expectedOutput is required for "${check.check}" checks`);
    }
    return undefined;
  });
  return undefined;
}

function validateQuiz(where, quiz) {
  if (!isText(quiz.question)) errors.push(`${where}: quiz "question" is required`);
  if (!Array.isArray(quiz.options) || quiz.options.length < 2) errors.push(`${where}: quiz needs at least two options`);
  else if (!Number.isInteger(quiz.correctIndex) || quiz.correctIndex < 0 || quiz.correctIndex >= quiz.options.length) {
    errors.push(`${where}: quiz correctIndex must point at one of the options`);
  }
}

function validateLearn(unit, learn) {
  const at = `${unit}/learn.json`;
  if (!learn) return warnings.push(`${at}: no learn content`);
  if (learn.modules && !learn.sections) warnings.push(`${at}: uses legacy "modules"; prefer "sections"`);

  const sections = learn.sections || learn.modules;
  if (!Array.isArray(sections) || sections.length === 0) return errors.push(`${at}: "sections" must be a non-empty array`);

  const ids = new Set();
  for (const section of sections) {
    const where = `${at} section "${section.id}"`;
    if (!isText(section.id)) errors.push(`${at}: every section needs an "id"`);
    if (ids.has(section.id)) errors.push(`${where}: duplicate id`);
    ids.add(section.id);
    if (!isText(section.title)) errors.push(`${where}: "title" is required`);
    if (!isText(section.content) && !(Array.isArray(section.content) && section.content.length > 0)) {
      errors.push(`${where}: "content" is required`);
    }
    if (section.quiz) validateQuiz(where, section.quiz);
  }
  return undefined;
}

function validatePrepare(unit, prepare) {
  const at = `${unit}/prepare.json`;
  if (!prepare) return warnings.push(`${at}: no prepare content`);
  if (prepare.questions && !prepare.interviewQuestions) warnings.push(`${at}: uses legacy "questions"; prefer "interviewQuestions"`);

  const cards = prepare.flashcards || [];
  const questions = prepare.interviewQuestions || prepare.questions || [];
  if (cards.length + questions.length === 0) errors.push(`${at}: needs flashcards or interviewQuestions`);

  const unique = (items, label) => {
    const ids = items.map((item) => item.id);
    if (ids.some((id) => id === undefined || id === null || id === '')) errors.push(`${at}: every ${label} needs an "id"`);
    if (new Set(ids).size !== ids.length) errors.push(`${at}: duplicate ${label} ids`);
  };
  unique(cards, 'flashcard');
  unique(questions, 'interview question');

  if (cards.some((card) => card.question && !card.front)) warnings.push(`${at}: flashcards use legacy question/answer; prefer front/back`);
  for (const card of cards) {
    if (!isText(card.front ?? card.question) || !isText(card.back ?? card.answer)) errors.push(`${at} flashcard "${card.id}": needs front and back text`);
  }
  for (const q of questions) {
    if (!isText(q.question) || !isText(q.modelAnswer ?? q.answer)) errors.push(`${at} question "${q.id}": needs question and modelAnswer`);
    if (!Array.isArray(q.keyPoints) || q.keyPoints.length === 0) {
      warnings.push(`${at} question "${q.id}": no keyPoints, so mock-interview scoring derives a rubric from the model answer`);
    }
  }
  return undefined;
}

function main() {
  const units = fs.readdirSync(UNITS_DIR).filter((name) => fs.statSync(path.join(UNITS_DIR, name)).isDirectory()).sort();
  let steps = 0;

  for (const unit of units) {
    if (!UNIT_ID.test(unit)) {
      errors.push(`${unit}: folder name must be lowercase letters, digits and hyphens`);
      continue;
    }
    const dir = path.join(UNITS_DIR, unit);
    validateMeta(unit, readJson(path.join(dir, 'unit.json'), unit));
    const practice = readJson(path.join(dir, 'practice.json'), unit);
    validatePractice(unit, practice);
    validateLearn(unit, readJson(path.join(dir, 'learn.json'), unit));
    validatePrepare(unit, readJson(path.join(dir, 'prepare.json'), unit));
    steps += practice && Array.isArray(practice.steps) ? practice.steps.length : 0;
  }

  const verbose = process.argv.includes('--verbose');
  if (verbose) for (const warning of warnings) console.log(`warning  ${warning}`);
  for (const error of errors) console.log(`error    ${error}`);
  console.log(`\n${units.length} units, ${steps} lab steps: ${errors.length} errors, ${warnings.length} warnings${verbose || !warnings.length ? '' : ' (--verbose to list)'}`);
  process.exit(errors.length ? 1 : 0);
}

main();
