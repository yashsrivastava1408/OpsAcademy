/**
 * Progress store
 *
 * Progress lives on the server (verified lab steps, XP, streaks, weak
 * topics). This module keeps the latest summary in memory and lets
 * components subscribe to it; call refreshProgress() after anything that
 * changes it.
 */

import { progressApi, getToken, onIdentityChange } from './api';

export const EMPTY_PROGRESS = {
  xp: 0,
  level: 1,
  xpToNextLevel: 250,
  streak: { current: 0, longest: 0, activeToday: false },
  completedUnits: [],
  unitProgress: {},
  passedQuizzes: [],
  weakTopics: [],
  cardsDue: 0,
  cardsStarted: 0,
  interviews: { answered: 0, averageScore: null },
  totals: { units: 0, steps: 0, stepsPassed: 0 },
  readiness: 0,
  activeDays: [],
};

let current = EMPTY_PROGRESS;
let inFlight = null;
const listeners = new Set();

export function getProgress() {
  return current;
}

export function subscribeProgress(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function refreshProgress() {
  // No identity yet means nothing has been done yet: there is nothing to fetch.
  if (!getToken()) return Promise.resolve(current);
  if (!inFlight) {
    inFlight = progressApi
      .get()
      .then((res) => {
        current = res.data.data;
        listeners.forEach((listener) => listener(current));
        return current;
      })
      .catch(() => current)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function isUnitCompleted(unitId) {
  return current.completedUnits.includes(unitId);
}

// A different user means different progress.
onIdentityChange(() => {
  current = EMPTY_PROGRESS;
  listeners.forEach((listener) => listener(current));
  refreshProgress();
});
