// ==========================================
// Rule loading / upserting. A rule maps a counterparty (by normKey_) to a
// default bucket/category/property, a "trusted" flag (auto-confirm) and an
// optional direction (CREDIT/DEBIT; blank = both).
// ==========================================

import { readRange, writeRange, appendRows, clearRange, TAB, rangeFor } from './sheet.js';
import { normKey_, normBucket_, normCategory_, st_ } from './util.js';

const RULE_COLS = 6;

export function normDirection_(value) {
  const d = String(value || '').toUpperCase();
  return d === 'CREDIT' || d === 'DEBIT' ? d : '';
}

function rowToRule(row) {
  const [name, bucket, category, property, trusted, direction] = row;
  return {
    name: String(name || '').trim(),
    bucket: normBucket_(bucket),
    category: normCategory_(category),
    property: String(property || '').trim(),
    trusted: trusted === true || String(trusted).toUpperCase() === 'TRUE',
    direction: normDirection_(direction)
  };
}

function ruleToRow(rule) {
  return [rule.name, rule.bucket, rule.category, rule.property, rule.trusted, rule.direction || ''];
}

// Returns a Map<key, rule>. A direction-specific rule is keyed
// "normKey|CREDIT" / "normKey|DEBIT"; a both-directions rule is the bare key.
export async function loadRules() {
  const rows = await readRange(TAB.rules, null, 1, RULE_COLS);
  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const rule = rowToRule(rows[i]);
    const key = normKey_(rule.name);
    if (!key) continue;
    map.set(rule.direction ? key + '|' + rule.direction : key, rule);
  }
  return map;
}

// Direction-specific rule first, then the both-directions fallback.
export function matchRule(rules, name, direction) {
  const key = normKey_(name);
  const dir = normDirection_(direction);
  if (dir) {
    const specific = rules.get(key + '|' + dir);
    if (specific) return specific;
  }
  return rules.get(key) || null;
}

// Creates or updates the rule for (payee, direction) in place.
export async function saveRule(name, bucket, category, property, trusted, direction = '') {
  const key = normKey_(name);
  if (!key) throw new Error('Rule requires a counterparty');
  const dir = normDirection_(direction);
  const rule = {
    name: String(name).trim(),
    bucket: normBucket_(bucket),
    category: normCategory_(category),
    property: String(property || '').trim(),
    trusted: trusted === true || st_(trusted) === 'TRUE',
    direction: dir
  };
  const rows = await readRange(TAB.rules, null, 1, RULE_COLS);
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (normKey_(rows[i][0]) === key && normDirection_(rows[i][5]) === dir) { found = i; break; }
  }
  if (found >= 0) {
    await writeRange(TAB.rules, found + 1, 1, [ruleToRow(rule)]);
  } else {
    await appendRows(TAB.rules, [ruleToRow(rule)]);
  }
  return rule;
}

// Removes the rule for (payee, direction) (used by /undo).
export async function clearRule(name, direction = '') {
  const key = normKey_(name);
  const dir = normDirection_(direction);
  const rows = await readRange(TAB.rules, null, 1, RULE_COLS);
  for (let i = 1; i < rows.length; i++) {
    if (normKey_(rows[i][0]) === key && normDirection_(rows[i][5]) === dir) {
      await clearRange(TAB.rules, rangeFor(TAB.rules, i + 1, i + 1, 1, RULE_COLS));
      return true;
    }
  }
  return false;
}
