import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApiBase, wsBase, DEFAULT_API_URL } from '../src/lib/apiBase.js';

test('unset falls back to local development', () => {
  assert.equal(normalizeApiBase(undefined), DEFAULT_API_URL);
});

test('same-origin spellings all become empty', () => {
  for (const v of ['', '/', '/api', '/api/', ' /api ']) assert.equal(normalizeApiBase(v), '', JSON.stringify(v));
});

test('absolute URLs lose a trailing slash or /api', () => {
  assert.equal(normalizeApiBase('https://app.example.com'), 'https://app.example.com');
  assert.equal(normalizeApiBase('https://app.example.com/'), 'https://app.example.com');
  assert.equal(normalizeApiBase('https://app.example.com/api'), 'https://app.example.com');
});

test('websocket base follows the API origin or the page origin', () => {
  assert.equal(wsBase('https://api.example.com', 'https://x'), 'wss://api.example.com');
  assert.equal(wsBase('http://localhost:4000', 'http://localhost:5173'), 'ws://localhost:4000');
  assert.equal(wsBase('', 'https://43.205.44.22'), 'wss://43.205.44.22');
});
