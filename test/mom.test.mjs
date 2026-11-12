import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyTotals, monthTransactions } from '../lib/mom.js';

const txn = (over = {}) => ({ loggedAt: '2026-01-15 09:30', date: '2026-01-15', direction: 'DEBIT', amount: 100, counterparty: 'X', ref: 'r', status: 'CONFIRMED', bucket: '', category: '', source: 'SMS-BOI', notes: 'note a', hidden: false, ...over });

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

test('monthTransactions hides hidden/forgotten/internal and sorts newest', () => {
  const txns = [
    txn({ date: '2026-01-15', loggedAt: '2026-01-15 10:00', counterparty: 'A' }),
    txn({ date: '2026-01-16', loggedAt: '2026-01-16 10:00', counterparty: 'B', direction: 'CREDIT' }),
    txn({ date: '2026-01-16', loggedAt: '2026-01-16 11:00', counterparty: 'C', hidden: true }),
    txn({ date: '2026-01-16', loggedAt: '2026-01-16 12:00', counterparty: 'D', bucket: 'Internal' }),
    txn({ date: '2026-02-01', loggedAt: '2026-02-01 10:00', counterparty: 'E' })
  ];
  const list = monthTransactions(txns, '2026-01');
  assert.deepEqual(list.map(x => x.counterparty), ['B', 'A']);
  assert.equal(list[0].loggedAt, '2026-01-16 10:00');
  assert.equal(list[1].source, 'SMS-BOI');
  assert.equal(list[1].notes, 'note a');
});
