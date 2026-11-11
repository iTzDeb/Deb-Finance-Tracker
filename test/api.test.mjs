import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toPendingItem, toHistoryItem, computeSummary, filterHistory } from '../lib/api.js';

const txn = {
  loggedAt: '2026-01-15 10:30',
  date: '2026-01-15',
  direction: 'DEBIT',
  amount: 500,
  counterparty: 'CHAIWALA',
  ref: '123456789012',
  source: 'sms',
  account: 'Kotak',
  status: 'PENDING',
  bucket: '',
  category: '',
  property: '',
  notes: 'tea',
  suggestedBucket: 'Personal',
  suggestedCategory: 'Food out',
  suggestedProperty: '',
  aiConfidence: 'high',
  aiSource: '',
  accept: false
};

test('toHistoryItem maps the frontend normalizeHistoryItem fields', () => {
  const item = toHistoryItem(txn);
  assert.equal(item.ref, '123456789012');
  assert.equal(item.date, '2026-01-15');
  assert.equal(item.stamp, '2026-01-15 10:30');
  assert.equal(item.direction, 'DEBIT');
  assert.equal(item.amount, 500);
  assert.equal(item.counterparty, 'CHAIWALA');
  assert.equal(item.bucket, '');
});

test('toPendingItem adds AI suggestion fields', () => {
  const item = toPendingItem(txn);
  assert.equal(item.sBucket, 'Personal');
  assert.equal(item.sCategory, 'Food out');
  assert.equal(item.confidence, 'high');
  assert.equal(item.time, '10:30');
});

test('computeSummary buckets income and spending by month', () => {
  const txns = [
    { ...txn, bucket: 'Business', category: 'Rent', amount: 1000, status: 'CONFIRMED' },
    { ...txn, bucket: 'Business', category: 'Rent', amount: 500, status: 'CONFIRMED', date: '2026-02-01' },
    { ...txn, direction: 'CREDIT', bucket: 'Business', amount: 3000, status: 'CONFIRMED' },
    { ...txn, direction: 'CREDIT', bucket: 'Deposit', amount: 200, status: 'CONFIRMED' },
    { ...txn, bucket: 'Internal', amount: 50, status: 'CONFIRMED' },
    { ...txn, bucket: '', amount: 10, status: 'PENDING' },
    { ...txn, direction: 'CREDIT', bucket: 'Business', amount: 999, status: 'FORGOTTEN' },
    { ...txn, bucket: 'Business', amount: 777, status: 'FORGOTTEN' },
    { ...txn, direction: 'CREDIT', bucket: 'Business', amount: 888, hidden: true },
    { ...txn, bucket: 'Business', amount: 666, hidden: true },
  ];
  const s = computeSummary(txns, '2026-01');
  assert.equal(s.businessIncome, 3000);
  assert.equal(s.received, 3200);
  assert.equal(s.internal, 50);
  assert.equal(s.pendingCount, 1);
  assert.deepEqual(s.business, { Rent: 1000 });
});

test('filterHistory sorts newest first and filters status/date/q', () => {
  const txns = [
    { ...txn, ref: 'a', date: '2026-01-10', status: 'CONFIRMED', counterparty: 'Alpha' },
    { ...txn, ref: 'b', date: '2026-01-12', status: 'PENDING', counterparty: 'Beta' },
    { ...txn, ref: 'c', date: '2026-01-14', status: 'CONFIRMED', counterparty: 'Gamma' },
  ];
  assert.deepEqual(filterHistory(txns, {}).map(t => t.ref), ['c', 'b', 'a']);
  assert.deepEqual(filterHistory(txns, { status: 'PENDING' }).map(t => t.ref), ['b']);
  assert.deepEqual(filterHistory(txns, { from: '2026-01-12' }).map(t => t.ref), ['c', 'b']);
  assert.deepEqual(filterHistory(txns, { q: 'beta' }).map(t => t.ref), ['b']);
});

console.log('API tests passed.');
