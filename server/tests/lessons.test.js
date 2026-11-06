/**
 * Every lesson follows the same structure (see docs/LESSON_AUTHORING.md): an overview that says why the unit
 * matters, sections that end in key takeaways and a quiz, and a cheat sheet. This keeps new and edited units
 * from drifting back to thin or inconsistent content.
 */
const fs = require('fs');
const path = require('path');
const units = require('../lib/units');

const BLOCKS = new Set(['text', 'code', 'callout', 'diagram', 'mermaid', 'heading', 'list', 'table', 'markdown']);
const ids = fs.readdirSync(units.UNITS_DIR).filter((d) => fs.existsSync(path.join(units.UNITS_DIR, d, 'learn.json')));

describe.each(ids)('lesson %s', (unitId) => {
  const learn = JSON.parse(fs.readFileSync(path.join(units.UNITS_DIR, unitId, 'learn.json'), 'utf8'));

  test('has an overview that says why it matters and what the learner can do after it', () => {
    expect(learn.overview.why.length).toBeGreaterThanOrEqual(120);
    expect(learn.overview.outcomes.length).toBeGreaterThanOrEqual(3);
    expect(learn.overview.placementTip.length).toBeGreaterThan(20);
  });

  test('has sections with unique ids, known block types, key takeaways and a quiz', () => {
    expect(Array.isArray(learn.sections)).toBe(true);
    expect(learn.sections.length).toBeGreaterThanOrEqual(4);
    const seen = new Set();
    for (const section of learn.sections) {
      expect(seen.has(section.id)).toBe(false);
      seen.add(section.id);
      expect(section.title).toBeTruthy();
      expect(Array.isArray(section.content)).toBe(true);
      expect(section.content.length).toBeGreaterThan(0);
      for (const block of section.content) expect(BLOCKS.has(block.type)).toBe(true);
      expect(section.keyPoints.length).toBeGreaterThanOrEqual(2);
      expect(section.quiz.options).toHaveLength(4);
      expect(Number.isInteger(section.quiz.correctIndex)).toBe(true);
      expect(section.quiz.correctIndex).toBeGreaterThanOrEqual(0);
      expect(section.quiz.correctIndex).toBeLessThan(4);
      expect(section.quiz.explanation.length).toBeGreaterThan(20);
    }
  });

  test('ends with a cheat sheet', () => {
    expect(learn.cheatsheet.rows.length).toBeGreaterThanOrEqual(8);
    for (const row of learn.cheatsheet.rows) expect(row).toHaveLength(2);
  });

  test('structured blocks carry the fields the page needs', () => {
    for (const section of learn.sections) {
      for (const block of section.content) {
        if (block.type === 'list') expect(block.items.length).toBeGreaterThan(0);
        if (block.type === 'table') {
          expect(block.header.length).toBeGreaterThan(0);
          for (const row of block.rows) expect(row).toHaveLength(block.header.length);
        }
        if (block.type === 'callout') expect(['info', 'tip', 'warning']).toContain(block.style);
        if (block.type !== 'list' && block.type !== 'table') expect(typeof block.value).toBe('string');
      }
    }
  });
});
