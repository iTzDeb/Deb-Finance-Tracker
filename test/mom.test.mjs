import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyTotals } from '../lib/mom.js';

const txn = (over = {}) => ({ loggedAt: '2026-01-15 09:30', date: '2026-01-15', direction: 'DEBIT', amount: 100, counterparty: 'X', ref: 'r', status: 'CONFIRMED', bucket: '', category: '', hidden: false, ...over });

test('monthlyTotals splits incoming/outgoing and excludes hidden/forgotten/internal', () => {
  const txns = [
    txn({ direction: 'CREDIT', amount: 5000, bucket: 'Business' }),
    txn({ direction: 'DEBIT', amount: 1000, bucket: 'Business', category: 'Rent' }),
    txn({ direction: 'DEBIT', amount: 200, bucket: 'Personal', category: 'Food out' }),
    txn({ direction: 'DEBIT', amount: 50, bucket: 'Internal' }),
    txn({ direction: 'CREDIT', amount: 999, hidden: true }),
    txn({ direction: 'DEBIT', amount: 777, status: 'FORGOTTEN' })
  ];
  const t = monthlyTotals(txns, '2026-01');
  assert.equal(t.incoming, 5000);
  assert.equal(t.outgoing, 1200);
  assert.equal(t.businessIncome, 5000);
  assert.equal(t.businessExpense, 1000);
  assert.equal(t.personalExpense, 200);
});
