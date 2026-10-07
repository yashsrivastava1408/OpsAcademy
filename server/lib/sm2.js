/**
 * SM-2 spaced repetition (the SuperMemo 2 schedule used by Anki-style decks).
 *
 * grade: 0-5 recall quality. Below 3 means the card was forgotten and restarts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RELEARN_MS = 10 * 60 * 1000;
const MIN_EASE = 1.3;

function initialCard() {
  return { ease: 2.5, intervalDays: 0, reps: 0, due: 0, lastReviewed: null };
}

function review(card, grade, now = Date.now()) {
  const q = Math.max(0, Math.min(5, Math.round(grade)));
  const prev = card || initialCard();
  const next = { ...prev, lastReviewed: now };

  if (q < 3) {
    next.reps = 0;
    next.intervalDays = 0;
    next.due = now + RELEARN_MS;
  } else {
    next.reps = prev.reps + 1;
    if (next.reps === 1) next.intervalDays = 1;
    else if (next.reps === 2) next.intervalDays = 6;
    else next.intervalDays = Math.round(prev.intervalDays * prev.ease);
    next.due = now + next.intervalDays * DAY_MS;
  }

  next.ease = Math.max(MIN_EASE, prev.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  next.ease = Math.round(next.ease * 1000) / 1000;
  return next;
}

function isDue(card, now = Date.now()) {
  return !card || card.due <= now;
}

module.exports = { initialCard, review, isDue, DAY_MS, RELEARN_MS, MIN_EASE };
