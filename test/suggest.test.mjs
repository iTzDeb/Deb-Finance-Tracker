import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateContext, validateSuggestions } from '../lib/suggest.js';

const row = (over) => ({ counterparty: 'Zepto Marketplace Private Limited', bucket: 'Personal', category: 'Groceries', notes: '', ...over });

test('candidateContext needs 3 rows and a broad category', () => {
  assert.equal(candidateContext([row({}), row({})], ['Groceries']).length, 0);
  const c = candidateContext([row({}), row({}), row({})], ['Groceries']);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'merchant');
  assert.equal(c[0].count, 3);
});

test('candidateContext skips Internal and specific categories', () => {
  assert.equal(candidateContext([row({ bucket: 'Internal' }), row({ bucket: 'Internal' }), row({ bucket: 'Internal' })], []).length, 0);
  assert.equal(candidateContext([row({ category: 'Cigarettes' }), row({ category: 'Cigarettes' }), row({ category: 'Cigarettes' })], ['Cigarettes']).length, 0);
});

test('candidateContext finds repeated note tokens, excluding categories and stopwords', () => {
  const rows = [row({ notes: 'zepto' }), row({ notes: 'zepto' }), row({ notes: 'zepto' }), row({ notes: 'the and' })];
  const c = candidateContext(rows, ['Groceries']);
  const tok = c.find(x => x.kind === 'type' && x.token === 'zepto');
  assert.ok(tok);
  assert.equal(tok.count, 3);
  assert.equal(c.find(x => x.token === 'the'), undefined);
});

test('validateSuggestions drops existing/unknown categories', () => {
  const cands = [{ kind: 'merchant', key: 'm:zepto', payee: 'Zepto', bucket: 'Personal', count: 3, notes: [] }];
  const out = validateSuggestions([
    { key: 'm:zepto', category: 'Zepto' },
    { key: 'm:zepto', category: 'Groceries' },
    { key: 'm:nope', category: 'Nope' }
  ], cands, ['Groceries']);
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'Zepto');
});
