import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCommand, parsePeriod, splitSpendArgs, matchCategory, pickAllowed, BOT_COMMANDS } from '../lib/bot.js';
import { ALLOWED_BUCKETS } from '../lib/config.js';

test('BOT_COMMANDS is valid for setMyCommands', () => {
  const names = new Set();
  assert.ok(BOT_COMMANDS.length > 0 && BOT_COMMANDS.length <= 100);
  for (const c of BOT_COMMANDS) {
    assert.match(c.command, /^[a-z0-9_]{1,32}$/);
    assert.ok(c.description.length >= 3 && c.description.length <= 256);
    assert.ok(!names.has(c.command));
    names.add(c.command);
  }
});

test('parseCommand handles commands, args and @bot suffixes', () => {
  assert.deepEqual(parseCommand('/summary 2026-10'), { cmd: 'summary', args: '2026-10' });
  assert.deepEqual(parseCommand('/pending@finance_bot'), { cmd: 'pending', args: '' });
  assert.deepEqual(parseCommand('/spend fuel 2026-10'), { cmd: 'spend', args: 'fuel 2026-10' });
  assert.equal(parseCommand('hello'), null);
});

test('parsePeriod handles months, years, ranges and presets', () => {
  const today = '2026-11-12';
  assert.deepEqual(parsePeriod('', today), { from: '2026-11-01', to: '2026-11-30', label: '2026-11' });
  assert.deepEqual(parsePeriod('2026-10', today), { from: '2026-10-01', to: '2026-10-31', label: '2026-10' });
  assert.deepEqual(parsePeriod('2026', today), { from: '2026-01-01', to: '2026-12-31', label: '2026' });
  assert.deepEqual(parsePeriod('2026-10-01..2026-11-12', today), { from: '2026-10-01', to: '2026-11-12', label: '2026-10-01 → 2026-11-12' });
  assert.deepEqual(parsePeriod('this month', today), { from: '2026-11-01', to: '2026-11-30', label: '2026-11' });
  assert.deepEqual(parsePeriod('last month', today), { from: '2026-10-01', to: '2026-10-31', label: '2026-10' });
  assert.deepEqual(parsePeriod('last 30 days', today), { from: '2026-10-14', to: '2026-11-12', label: 'last 30 days' });
  assert.equal(parsePeriod('nope', today), null);
});

test('splitSpendArgs separates a category from an optional period', () => {
  const a = splitSpendArgs('fuel 2026-10');
  assert.equal(a.category, 'fuel');
  assert.equal(a.period.label, '2026-10');
  const b = splitSpendArgs('chai and snacks 2026-10');
  assert.equal(b.category, 'chai and snacks');
  assert.equal(b.period.label, '2026-10');
  const c = splitSpendArgs('fuel last 30 days');
  assert.equal(c.category, 'fuel');
  assert.equal(c.period.label, 'last 30 days');
  const d = splitSpendArgs('fuel');
  assert.equal(d.category, 'fuel');
});

test('matchCategory resolves the owner-friendly names', () => {
  assert.equal(matchCategory('fuel'), 'Fuel');
  assert.equal(matchCategory('chai'), 'Chai and snacks');
  assert.equal(matchCategory('cig'), 'Cigarettes');
  assert.equal(matchCategory('zzz'), '');
});

test('pickAllowed normalises to the canonical value', () => {
  assert.equal(pickAllowed('personal', ALLOWED_BUCKETS), 'Personal');
  assert.equal(pickAllowed('nope', ALLOWED_BUCKETS), '');
});
