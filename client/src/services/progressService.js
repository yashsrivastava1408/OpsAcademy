/**
 * Progress & Placement Readiness Score Service
 * Tracks completed units, labs, and quizzes in localStorage.
 */

const STORAGE_KEY = 'opsacademy_progress';

export function getProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { completedUnits: [], passedQuizzes: [], score: 0 };
  } catch {
    return { completedUnits: [], passedQuizzes: [], score: 0 };
  }
}

export function markUnitCompleted(unitId) {
  const current = getProgress();
  if (!current.completedUnits.includes(unitId)) {
    current.completedUnits.push(unitId);
    recalculateScore(current);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  }
  return current;
}

export function recordQuizPass(unitId, quizId) {
  const current = getProgress();
  const key = `${unitId}_${quizId}`;
  if (!current.passedQuizzes.includes(key)) {
    current.passedQuizzes.push(key);
    recalculateScore(current);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  }
  return current;
}

function recalculateScore(progress) {
  // Total 4 units = 100% (25% per completed unit)
  const totalUnits = 4;
  const count = progress.completedUnits.length;
  progress.score = Math.min(100, Math.round((count / totalUnits) * 100));
}

export function isUnitCompleted(unitId) {
  const current = getProgress();
  return current.completedUnits.includes(unitId);
}
