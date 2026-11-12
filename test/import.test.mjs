import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stageRowToTxn, dedupStaged } from '../lib/import.js';
import { txnToRow, sortedByLoggedAt } from '../lib/txn.js';

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

test('sortedByLoggedAt orders rows by the Logged At value', () => {
  const rows = [[46332.9, 'c'], [46330.1, 'a'], [46331.5, 'b']];
  assert.deepEqual(sortedByLoggedAt(rows).map(r => r[1]), ['a', 'b', 'c']);
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
    stagedTxn({ ref: 'ref-1', date: '2026-01-11' }),            // same ref
    stagedTxn({ ref: '', date: '2026-01-10', amount: 100 }),    // no ref: same day
    stagedTxn({ ref: '', date: '2026-01-11', amount: 100 }),    // no ref: ±1 day
    stagedTxn({ ref: 'ref-4', date: '2026-01-20', amount: 100 }) // new
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

test('dedupStaged matches a ref whose leading zero Sheets dropped', () => {
  const existing = [stagedTxn({ ref: '43303202554', date: '2026-10-20', amount: 30000, counterparty: 'Shivam Sir', direction: 'CREDIT' })];
  const staged = [stagedTxn({ ref: '043303202554', date: '2026-10-20', amount: 30000, counterparty: 'SHIVAM', direction: 'CREDIT' })];
  assert.equal(dedupStaged(staged, existing).skipped, 1);
});

test('txnToRow writes a leading-zero ref as text', () => {
  assert.equal(txnToRow({ ref: '043303202554' })[5], "'043303202554");
  assert.equal(txnToRow({ ref: 'UPI-210039702734' })[5], 'UPI-210039702734');
});

test('dedupStaged enriches a matched row with a fuller name and time', () => {
  const existing = [stagedTxn({ ref: 'ref-1', counterparty: 'DEB ZY', loggedAt: '2026-01-15 00:00', date: '2026-01-15', amount: 100, row: 5 })];
  const staged = [stagedTxn({ ref: 'ref-1', counterparty: 'DEB ZYOTI DAS', loggedAt: '2026-01-15 09:30', date: '2026-01-15', amount: 100 })];
  const out = dedupStaged(staged, existing);
  assert.equal(out.skipped, 1);
  assert.equal(out.rows.length, 0);
  assert.equal(out.enrich.length, 1);
  assert.equal(out.enrich[0].txn.row, 5);
  assert.deepEqual(out.enrich[0].updates, { counterparty: 'DEB ZYOTI DAS', loggedAt: '2026-01-15 09:30' });
});

test('dedupStaged fills an empty existing counterparty', () => {
  const existing = [stagedTxn({ ref: 'ref-1', counterparty: '', date: '2026-11-08', amount: 6000, row: 7, loggedAt: '2026-11-08 12:44' })];
  const staged = [stagedTxn({ ref: 'ref-1', counterparty: 'Ravindra Institute Of Indian Civil Services Opc', date: '2026-11-08', amount: 6000, loggedAt: '2026-11-08 12:44' })];
  const out = dedupStaged(staged, existing);
  assert.equal(out.skipped, 1);
  assert.equal(out.enrich.length, 1);
  assert.equal(out.enrich[0].updates.counterparty, 'Ravindra Institute Of Indian Civil Services Opc');
});

test('Paytm name/time win over a different existing name', () => {
  const existing = [stagedTxn({ ref: 'ref-1', counterparty: 'RAVIND', date: '2026-11-08', amount: 6000, loggedAt: '2026-11-08 00:00', row: 7 })];
  const staged = [stagedTxn({ ref: 'ref-1', counterparty: 'Ravindra Institute Of Indian Civil Services Opc', date: '2026-11-08', amount: 6000, loggedAt: '2026-11-08 12:44', source: 'Import-Paytm', account: 'Paytm' })];
  const out = dedupStaged(staged, existing);
  assert.equal(out.enrich.length, 1);
  assert.deepEqual(out.enrich[0].updates, { counterparty: 'Ravindra Institute Of Indian Civil Services Opc', loggedAt: '2026-11-08 12:44' });
});

test('Google Pay name and time win over a different existing name', () => {
  const existing = [stagedTxn({ ref: '664536461256', counterparty: 'Bharat Petrole', date: '2026-10-06', amount: 1116.25, loggedAt: '2026-10-06 00:00', row: 9 })];
  const staged = [stagedTxn({ ref: '664536461256', counterparty: 'BPCL LOYALTY', date: '2026-10-06', amount: 1116.25, loggedAt: '2026-10-06 13:35', source: 'Import-GPay', account: 'Mother SBI current' })];
  const out = dedupStaged(staged, existing);
  assert.equal(out.enrich.length, 1);
  assert.deepEqual(out.enrich[0].updates, { counterparty: 'BPCL LOYALTY', loggedAt: '2026-10-06 13:35' });
});

test('Paytm self-transfer label keeps the person name but takes the time', () => {
  const existing = [stagedTxn({ ref: 'ref-1', counterparty: 'DEB ZYOTI DAS', date: '2026-11-08', amount: 200, loggedAt: '2026-11-08 00:00', row: 8 })];
  const staged = [stagedTxn({ ref: 'ref-1', counterparty: 'Self Transfer · Bank Of India - 4245', date: '2026-11-08', amount: 200, loggedAt: '2026-11-08 22:34', source: 'Import-Paytm', account: 'Paytm' })];
  const out = dedupStaged(staged, existing);
  assert.equal(out.enrich.length, 1);
  assert.deepEqual(out.enrich[0].updates, { loggedAt: '2026-11-08 22:34' });
});

test('dedupStaged does not enrich an unrelated name', () => {
  const existing = [stagedTxn({ ref: 'ref-1', counterparty: 'DEB ZYOTI DAS', loggedAt: '2026-01-15 00:00', date: '2026-01-15', amount: 100, row: 5 })];
  const staged = [stagedTxn({ ref: 'ref-1', counterparty: 'Self Transfer · BOI-4245', loggedAt: '2026-01-15 00:00', date: '2026-01-15', amount: 100 })];
  const out = dedupStaged(staged, existing);
  assert.equal(out.skipped, 1);
  assert.equal(out.enrich.length, 0);
});

test('dedupStaged keeps two different refs for the same payee/amount/day', () => {
  const staged = [
    stagedTxn({ ref: 'ref-a', counterparty: 'SHALINI GHOSH', amount: 10000, date: '2026-10-12', loggedAt: '2026-10-12 21:39' }),
    stagedTxn({ ref: 'ref-b', counterparty: 'SHALINI GHOSH', amount: 10000, date: '2026-10-12', loggedAt: '2026-10-12 21:39' })
  ];
  const out = dedupStaged(staged, []);
  assert.equal(out.rows.length, 2);
  assert.equal(out.skipped, 0);
});

test('dedupStaged keeps a distinct ref matching an existing row', () => {
  const existing = [stagedTxn({ ref: 'ref-a', counterparty: 'SHALINI GHOSH', amount: 10000, date: '2026-10-12' })];
  const staged = [stagedTxn({ ref: 'ref-b', counterparty: 'SHALINI GHOSH', amount: 10000, date: '2026-10-12' })];
  const out = dedupStaged(staged, existing);
  assert.equal(out.rows.length, 1);
  assert.equal(out.skipped, 0);
});

test('dedupStaged skips duplicates inside the same batch', () => {
  const out = dedupStaged([stagedTxn({ ref: '' }), stagedTxn({ ref: '' })], []);
  assert.equal(out.rows.length, 1);
  assert.equal(out.skipped, 1);
});

console.log('Import tests passed.');
