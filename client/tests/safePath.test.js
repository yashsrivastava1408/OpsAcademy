import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeInternalPath } from '../src/lib/safePath.js';

test('keeps ordinary internal paths', () => {
  assert.equal(safeInternalPath('/dashboard'), '/dashboard');
  assert.equal(safeInternalPath('/unit/linux/practice?step=2#top'), '/unit/linux/practice?step=2#top');
});

test('falls back for empty or non-string values', () => {
  assert.equal(safeInternalPath(null), '/dashboard');
  assert.equal(safeInternalPath(undefined), '/dashboard');
  assert.equal(safeInternalPath(''), '/dashboard');
  assert.equal(safeInternalPath(['/x']), '/dashboard');
});

test('rejects off-site destinations', () => {
  for (const bad of [
    'https://evil.com',
    'http://evil.com/x',
    '//evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    'evil.com',
    '/ok\nhttps://evil.com',
    '/a\\b',
  ]) {
    assert.equal(safeInternalPath(bad), '/dashboard', bad);
  }
});

test('uses the supplied fallback', () => {
  assert.equal(safeInternalPath('//evil.com', '/home'), '/home');
});
