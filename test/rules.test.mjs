import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRule, normDirection_ } from '../lib/rules.js';

test('matchRule prefers a direction-specific rule', () => {
  const rules = new Map([
    ['RAVINDRA', { name: 'Ravindra', bucket: 'Business', category: 'Staff', direction: '' }],
    ['RAVINDRA|CREDIT', { name: 'Ravindra', bucket: 'Personal', category: 'Teaching Payments', direction: 'CREDIT' }]
  ]);
  assert.equal(matchRule(rules, 'Ravindra', 'CREDIT').category, 'Teaching Payments');
  assert.equal(matchRule(rules, 'Ravindra', 'DEBIT').category, 'Staff');
  assert.equal(matchRule(rules, 'Ravindra').category, 'Staff');
});

test('normDirection_ normalises', () => {
  assert.equal(normDirection_('credit'), 'CREDIT');
  assert.equal(normDirection_('Debit'), 'DEBIT');
  assert.equal(normDirection_(''), '');
  assert.equal(normDirection_('other'), '');
});
