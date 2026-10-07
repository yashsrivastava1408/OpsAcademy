/**
 * AI Hub client — calls the Python AI hub with a timeout and a circuit breaker
 *
 * When the hub fails repeatedly the breaker opens and calls fail fast for a
 * while, so a dead hub adds no latency to the routes that fall back.
 */

const axios = require('axios');
const config = require('../config');
const logger = require('../lib/logger');
const metrics = require('../lib/metrics');

const FAILURE_THRESHOLD = 3;
const OPEN_MS = 30000;
const RETRYABLE_CODES = new Set(['ECONNRESET', 'EPIPE']);

class HubUnavailableError extends Error {}

function createClient({ baseUrl = config.aiHubUrl, token = config.aiHubToken, timeoutMs = config.aiHubTimeoutMs, http = axios } = {}) {
  let failures = 0;
  let openUntil = 0;

  async function post(endpoint, body) {
    if (Date.now() < openUntil) {
      metrics.aiHubDuration.observe({ endpoint, outcome: 'circuit_open' }, 0);
      throw new HubUnavailableError('AI hub circuit open');
    }

    const end = metrics.aiHubDuration.startTimer({ endpoint });
    const send = () => http.post(`${baseUrl}${endpoint}`, body, {
      timeout: timeoutMs,
      headers: token ? { 'x-internal-token': token } : {},
    });
    try {
      let response;
      try {
        response = await send();
      } catch (err) {
        // A kept-alive socket the hub had already closed fails instantly with
        // a reset. Hub calls have no side effects, so try once more on a new one.
        if (!RETRYABLE_CODES.has(err.code)) throw err;
        response = await send();
      }
      failures = 0;
      end({ outcome: 'ok' });
      return response.data.data;
    } catch (err) {
      end({ outcome: 'error' });
      failures += 1;
      if (failures >= FAILURE_THRESHOLD) {
        openUntil = Date.now() + OPEN_MS;
        failures = 0;
        logger.warn({ endpoint }, '[AI Hub] circuit opened after repeated failures');
      }
      throw new HubUnavailableError(err.message);
    }
  }

  async function isHealthy() {
    try {
      await http.get(`${baseUrl}/health`, { timeout: Math.min(timeoutMs, 1500) });
      return true;
    } catch {
      return false;
    }
  }

  return {
    hint: (payload) => post('/api/agent/hint', payload),
    scan: (command) => post('/api/agent/scan', { command }),
    scoreInterview: (payload) => post('/api/agent/interview/score', payload),
    isHealthy,
  };
}

let defaultClient = null;

function getHubClient() {
  if (!defaultClient) defaultClient = createClient();
  return defaultClient;
}

/** Replace the shared client (tests). */
function setHubClient(client) {
  defaultClient = client;
}

module.exports = { createClient, getHubClient, setHubClient, HubUnavailableError };
