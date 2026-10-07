import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const TOKEN_KEY = 'opsacademy_token';
const USER_KEY = 'opsacademy_user';

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Identity ─────────────────────────────────────────────────
// Every visitor has an identity: a guest token is created on first use and
// replaced by an account token on login or registration.

const identityListeners = new Set();

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

export function setIdentity(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  identityListeners.forEach((listener) => listener(user));
}

export function clearIdentity() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  identityListeners.forEach((listener) => listener(null));
}

/** Be told when the signed-in user changes. Returns an unsubscribe function. */
export function onIdentityChange(listener) {
  identityListeners.add(listener);
  return () => identityListeners.delete(listener);
}

let pendingGuest = null;

/** Resolve with a token, creating a guest identity if there is none yet. */
export function ensureIdentity() {
  const token = getToken();
  if (token) return Promise.resolve(token);

  // Concurrent callers share one request so only one guest is created.
  if (!pendingGuest) {
    pendingGuest = axios
      .post(`${API_BASE_URL}/api/auth/guest`)
      .then((res) => {
        setIdentity(res.data.token, res.data.user);
        return res.data.token;
      })
      .finally(() => {
        pendingGuest = null;
      });
  }
  return pendingGuest;
}

const isAuthRoute = (url = '') => url.startsWith('/auth/login') || url.startsWith('/auth/register');

api.interceptors.request.use(async (config) => {
  if (!isAuthRoute(config.url) || getToken()) {
    const token = isAuthRoute(config.url) ? getToken() : await ensureIdentity();
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// An expired or revoked token: start over as a guest and retry the request once.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !original.retried && !isAuthRoute(original.url)) {
      original.retried = true;
      clearIdentity();
      await ensureIdentity();
      return api(original);
    }
    return Promise.reject(error);
  }
);

/** The server's error message for a failed request, or a fallback. */
export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  return error?.response?.data?.error || fallback;
}

// ── Auth API ─────────────────────────────────────────────────
export const authApi = {
  register: (name, email, password) =>
    api.post('/auth/register', { name, email, password }),

  login: (email, password) =>
    api.post('/auth/login', { email, password }),

  me: () =>
    api.get('/auth/me'),
};

// ── Sandbox API ──────────────────────────────────────────────
export const sandboxApi = {
  start: (labId) =>
    api.post('/sandbox/start', { labId }),

  stop: (sessionId) =>
    api.delete(`/sandbox/${sessionId}`),

  status: (sessionId) =>
    api.get(`/sandbox/${sessionId}/status`),

  getTelemetry: (sessionId) =>
    api.get(`/sandbox/${sessionId}/telemetry`),

  getHistory: (sessionId) =>
    api.get(`/sandbox/${sessionId}/history`),

  getFile: (sessionId, path) =>
    api.get(`/sandbox/${sessionId}/file`, { params: { path } }),

  reset: (sessionId) =>
    api.post(`/sandbox/${sessionId}/reset`),

  stats: () =>
    api.get('/sandbox/stats'),

  // The caller's own running sandboxes
  list: () =>
    api.get('/sandbox'),
};

// ── Unit API (Learn, Practice, Prepare) ──────────────────────
export const unitApi = {
  list: () =>
    api.get('/units'),

  getMeta: (unitId) =>
    api.get(`/units/${unitId}`),

  getMode: (unitId, mode) =>
    api.get(`/units/${unitId}/${mode}`),
};

// ── Lab API ──────────────────────────────────────────────
export const labApi = {
  verify: (unitId, sessionId, stepNumber) =>
    api.post(`/labs/${unitId}/verify`, { sessionId, stepNumber }),
};

// ── Agent API (AI Mentor) ────────────────────────────────────
export const agentApi = {
  getHint: ({ query, unitId, stepNumber, sessionId, tier }) =>
    api.post('/agent/hint', { query, unitId, stepNumber, sessionId, tier }),
};

// ── Progress API ─────────────────────────────────────────────
export const progressApi = {
  get: () =>
    api.get('/progress'),

  leaderboard: () =>
    api.get('/progress/leaderboard'),

  answerQuiz: (unitId, sectionId, answerIndex) =>
    api.post('/progress/quiz', { unitId, sectionId, answerIndex }),

  getDeck: (unitId) =>
    api.get(`/progress/flashcards/${unitId}`),

  reviewCard: (unitId, cardId, grade) =>
    api.post(`/progress/flashcards/${unitId}/${cardId}/review`, { grade }),
};

// ── Interview API ────────────────────────────────────────────
export const interviewApi = {
  questions: (unitId) =>
    api.get(`/interview/${unitId}/questions`),

  answer: (unitId, questionId, answer) =>
    api.post(`/interview/${unitId}/${questionId}/answer`, { answer }),
};

// ── Certificate API ──────────────────────────────────────────
export const certificateApi = {
  list: () =>
    api.get('/certificates'),

  issue: (unitId) =>
    api.post('/certificates', { unitId }),

  verify: (certificateId) =>
    api.get(`/certificates/verify/${encodeURIComponent(certificateId)}`),
};

// ── Health Check ─────────────────────────────────────────────
export const healthCheck = () => api.get('/health');

// ── WebSocket URL helper ─────────────────────────────────────
// Browsers cannot send headers on a WebSocket, so the token goes in the URL.
export async function getTerminalWsUrl(sessionId) {
  const token = await ensureIdentity();
  const wsBase = API_BASE_URL.replace(/^http/, 'ws');
  return `${wsBase}/api/terminal?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
}

export default api;
