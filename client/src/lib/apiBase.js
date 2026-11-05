/**
 * Where the gateway lives, from VITE_API_URL.
 *
 *  - unset              -> http://localhost:4000 (local development)
 *  - "" or "/" or "/api" -> same origin: the app is served behind a reverse
 *                          proxy that forwards /api to the gateway (production)
 *  - "https://host[/api]" -> that origin
 *
 * The result never ends with "/" or "/api"; callers append "/api/...".
 */
export const DEFAULT_API_URL = 'http://localhost:4000';

export function normalizeApiBase(value) {
  if (value === undefined || value === null) return DEFAULT_API_URL;
  return String(value).trim().replace(/\/+$/, '').replace(/\/api$/, '');
}

/** ws:// or wss:// base for the terminal. `origin` is the page origin, used for same-origin setups. */
export function wsBase(apiBase, origin) {
  return (apiBase || origin).replace(/^http/, 'ws');
}
