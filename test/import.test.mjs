import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stageRowToTxn } from '../lib/import.js';

test('stageRowToTxn maps Staging columns to a txn object', () => {
  const t = stageRowToTxn(['B1', '2026-01-15 09:30', 'DEBIT', '1,250.50', 'CHAIWALA', '123456789012', 'Kotak', 'Import-Kotak']);
  assert.equal(t.loggedAt, '2026-01-15 09:30');
  assert.equal(t.date, '2026-01-15');
  assert.equal(t.direction, 'DEBIT');
  assert.equal(t.amount, 1250.5);
  assert.equal(t.counterparty, 'CHAIWALA');
  assert.equal(t.ref, '123456789012');
  assert.equal(t.account, 'Kotak');
  assert.equal(t.source, 'Import-Kotak');
  assert.equal(t.status, 'PENDING');
});

console.log('Import tests passed.');
