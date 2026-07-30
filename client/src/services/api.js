import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Auth interceptor — attach JWT token if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('opsacademy_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('opsacademy_token');
      // Redirect to login if needed
    }
    return Promise.reject(error);
  }
);

// ── Sandbox API ──────────────────────────────────────────────
export const sandboxApi = {
  start: (userId, labId) =>
    api.post('/sandbox/start', { userId, labId }),

  stop: (sessionId) =>
    api.delete(`/sandbox/${sessionId}`),

  status: (sessionId) =>
    api.get(`/sandbox/${sessionId}/status`),

  list: () =>
    api.get('/sandbox'),
};

// ── Lab API (Phase 2) ────────────────────────────────────────
export const labApi = {
  list: () =>
    api.get('/labs'),

  get: (labId) =>
    api.get(`/labs/${labId}`),

  verify: (labId, sessionId) =>
    api.post(`/labs/${labId}/verify`, { sessionId }),
};

// ── Health Check ─────────────────────────────────────────────
export const healthCheck = () => api.get('/health');

// ── WebSocket URL helper ─────────────────────────────────────
export function getTerminalWsUrl(sessionId) {
  const wsBase = API_BASE_URL.replace(/^http/, 'ws');
  return `${wsBase}/api/terminal?sessionId=${sessionId}`;
}

export default api;
