import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stageRowToTxn, dedupStaged } from '../lib/import.js';

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

const stagedTxn = (over = {}) => ({
  loggedAt: '2026-01-15 09:30', date: '2026-01-15', direction: 'DEBIT', amount: 100,
  counterparty: 'ALPHA', ref: '', status: 'PENDING', ...over
});

// Regression: staged rows expose counterparty, not party. Reading the wrong
// field made passes 2 and 3 compare against an empty payee key.
test('dedupStaged matches the staged counterparty', () => {
  const staged = [stageRowToTxn(['B1', '2026-01-15 09:30', 'DEBIT', '100', 'ALPHA', '', 'Kotak', 'Import-Kotak'])];
  const existing = [stagedTxn({ ref: 'old-ref' })];
  assert.equal(dedupStaged(staged, existing).skipped, 1);
});

test('dedupStaged skips by ref, same day, and ±1 day', () => {
  const existing = [stagedTxn({ ref: 'ref-1', date: '2026-01-10', amount: 100 })];
  const staged = [
    stagedTxn({ ref: 'ref-1', date: '2026-01-11' }),
    stagedTxn({ ref: 'ref-2', date: '2026-01-10', amount: 100 }),
    stagedTxn({ ref: 'ref-3', date: '2026-01-11', amount: 100 }),
    stagedTxn({ ref: 'ref-4', date: '2026-01-20', amount: 100 })
  ];
  const out = dedupStaged(staged, existing);
  assert.equal(out.skipped, 3);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].txn.ref, 'ref-4');
});

test('dedupStaged flags CHECK for same amount+date under another payee', () => {
  const existing = [stagedTxn({ ref: 'ref-1', date: '2026-01-10', amount: 100 })];
  const staged = [stagedTxn({ ref: 'ref-2', counterparty: 'BETA', date: '2026-01-10', amount: 100 })];
  const out = dedupStaged(staged, existing);
  assert.equal(out.skipped, 0);
  assert.equal(out.check, 1);
  assert.equal(out.rows[0].match.name, 'ALPHA');
});

test('dedupStaged keeps a reversal that shares a ref with the original', () => {
  const existing = [stagedTxn({ ref: 'ref-9', direction: 'DEBIT', amount: 400, date: '2026-10-07' })];
  const staged = [stagedTxn({ ref: 'ref-9', direction: 'CREDIT', amount: 400, date: '2026-10-07' })];
  const out = dedupStaged(staged, existing);
  assert.equal(out.rows.length, 1);
  assert.equal(out.skipped, 0);
});

test('dedupStaged still skips a re-import with the same ref, direction and amount', () => {
  const existing = [stagedTxn({ ref: 'ref-9', direction: 'DEBIT', amount: 400, date: '2026-10-07' })];
  const staged = [stagedTxn({ ref: 'ref-9', direction: 'DEBIT', amount: 400, date: '2026-10-09' })];
  assert.equal(dedupStaged(staged, existing).skipped, 1);
});

test('dedupStaged skips duplicates inside the same batch', () => {
  const out = dedupStaged([stagedTxn({ ref: '' }), stagedTxn({ ref: '' })], []);
  assert.equal(out.rows.length, 1);
  assert.equal(out.skipped, 1);
});

console.log('Import tests passed.');
