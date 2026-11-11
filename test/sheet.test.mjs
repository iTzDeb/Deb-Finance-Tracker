import { test } from 'node:test';
import assert from 'node:assert/strict';

import { colLetter, rangeFor, wholeColumns, endRowOf } from '../lib/sheet.js';

// Regression: reads used a fixed A1:S1000 window and silently dropped rows.
test('default reads cover whole columns, not a fixed 1000 rows', () => {
  assert.equal(wholeColumns('Transactions', 1, 19), "'Transactions'!A:S");
  assert.equal(wholeColumns('Transactions', 6, 6), "'Transactions'!F:F");
});

test('endRowOf parses the append response range', () => {
  assert.equal(endRowOf("'Transactions'!A380:S388"), 388);
  assert.equal(endRowOf(''), 0);
});

test('rangeFor and colLetter build A1 ranges', () => {
  assert.equal(rangeFor('Transactions', 1, 5, 1, 3), "'Transactions'!A1:C5");
  assert.equal(colLetter(1), 'A');
  assert.equal(colLetter(27), 'AA');
});
