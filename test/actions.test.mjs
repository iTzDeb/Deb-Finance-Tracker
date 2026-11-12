import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActions, planAction, planActions, describePlan, actionToIntent, mergePendingActions } from '../lib/actions.js';

const rows = [
  { row: 2, txn: { counterparty: 'Rohit Agarwal', ref: 'a', amount: 2600, direction: 'DEBIT', status: 'NEEDS REVIEW', bucket: '', category: '' } },
  { row: 3, txn: { counterparty: 'Kss Mart', ref: 'b', amount: 13, direction: 'DEBIT', status: 'CONFIRMED', bucket: 'Personal', category: 'Cigarettes' } },
  { row: 4, txn: { counterparty: '500312789665/112026', ref: '500312789665', amount: 500, direction: 'DEBIT', status: 'CONFIRMED', bucket: '', category: '' } }
];

test('normalizeActions accepts legacy intents and action arrays', () => {
  assert.equal(normalizeActions({ intent: 'create_rule', payee: 'X', bucket: 'Personal', category: 'Other' })[0].type, 'rule');
  assert.equal(normalizeActions({ actions: [{ type: 'hide', payees: ['A'] }] })[0].type, 'hide');
  assert.equal(normalizeActions({ intent: 'nonsense' }).length, 0);
});

test('planAction resolves rule targets/needs', () => {
  const ok = planAction({ type: 'rule', payee: 'Rohit', bucket: 'Personal', category: 'Shopping', scope: 'all' }, rows);
  assert.equal(ok.targets.length, 1);
  assert.equal(ok.needs.length, 0);
  const missing = planAction({ type: 'rule', payee: 'Rohit' }, rows);
  assert.deepEqual(missing.needs, ['bucket', 'category']);
});

test('planAction resolves bulk amount/ref', () => {
  assert.equal(planAction({ type: 'bulk', match_amount: 13, bucket: 'Personal', category: 'Cigarettes' }, rows).targets.length, 1);
  assert.equal(planAction({ type: 'bulk', match_ref: '500312789665', bucket: 'Personal', category: 'Investment' }, rows).targets.length, 1);
});

test('actionToIntent maps read-only actions', () => {
  assert.equal(actionToIntent({ type: 'transactions', payees: ['X'] }).intent, 'transactions');
  assert.equal(actionToIntent({ type: 'rule', payee: 'X' }).intent, 'create_rule');
  assert.equal(actionToIntent({ type: 'clarify', reply: 'hm' }).intent, 'clarify');
});

test('mergePendingActions fills a hide payee from a follow-up lookup', () => {
  const pending = [{ type: 'hide', payees: [], bucket: '' }];
  const incoming = [{ type: 'transactions', payees: ['Adarsh Kumar'] }];
  const merged = mergePendingActions(pending, incoming, 'Adarsh Kumar');
  assert.deepEqual(merged[0].payees, ['Adarsh Kumar']);
  assert.equal(merged[0].type, 'hide');
});

test('planAction resolves hide/note and describePlan', () => {
  const plan = planActions([
    { type: 'hide', payees: ['Kss Mart'] },
    { type: 'rule', payee: 'Rohit', bucket: 'Personal', category: 'Shopping' }
  ], rows);
  assert.equal(plan[0].targets.length, 1);
  assert.equal(describePlan(plan).length, 2);
});
