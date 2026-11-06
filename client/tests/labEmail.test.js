import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labEmail } from '../src/lib/labEmail.js';

// server/lib/labIdentity.js must build the same address (its test checks the same string).
test('a Lab ID maps to the address the gateway registers', () => {
  assert.equal(labEmail(' SRM-CSE-0007 '), 'srm-cse-0007@lab.opsacademy.invalid');
});
