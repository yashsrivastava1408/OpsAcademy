import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeInline } from '../src/features/learn/inline.js';

test('plain text is one token', () => {
  assert.deepEqual(tokenizeInline('just words'), [{ type: 'text', value: 'just words' }]);
});

test('bold, italic and code are found next to plain text', () => {
  assert.deepEqual(tokenizeInline('Run `ls -la` to **list** and *check*.'), [
    { type: 'text', value: 'Run ' }, { type: 'code', value: 'ls -la' }, { type: 'text', value: ' to ' },
    { type: 'bold', value: 'list' }, { type: 'text', value: ' and ' }, { type: 'italic', value: 'check' }, { type: 'text', value: '.' },
  ]);
});

test('asterisks inside a code span stay as they are', () => {
  assert.deepEqual(tokenizeInline('Use `grep -r "*.log" .` here'), [
    { type: 'text', value: 'Use ' }, { type: 'code', value: 'grep -r "*.log" .' }, { type: 'text', value: ' here' },
  ]);
});

test('a lone asterisk or an unclosed backtick is left as text', () => {
  assert.deepEqual(tokenizeInline('2 * 3 and a ` tick'), [{ type: 'text', value: '2 * 3 and a ` tick' }]);
});

test('empty input gives no tokens', () => {
  assert.deepEqual(tokenizeInline(''), []);
  assert.deepEqual(tokenizeInline(undefined), []);
});
