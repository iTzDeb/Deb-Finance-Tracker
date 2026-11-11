// ==========================================
// Rule loading / upserting. A rule maps a counterparty (by normKey_) to a
// default bucket/category/property and a "trusted" flag (auto-confirm).
// ==========================================

import { readRange, writeRange, appendRows, clearRange, TAB, rangeFor } from './sheet.js';
import { normKey_, normBucket_, normCategory_, st_ } from './util.js';

const RULE_COLS = 5;

function rowToRule(row) {
  const [name, bucket, category, property, trusted] = row;
  return {
    name: String(name || '').trim(),
    bucket: normBucket_(bucket),
    category: normCategory_(category),
    property: String(property || '').trim(),
    trusted: trusted === true || String(trusted).toUpperCase() === 'TRUE'
  };
}

function ruleToRow(rule) {
  return [rule.name, rule.bucket, rule.category, rule.property, rule.trusted];
}

// Returns a Map<key, rule>. Key is normKey_(name).
export async function loadRules() {
  const rows = await readRange(TAB.rules, null, 1, RULE_COLS);
  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const rule = rowToRule(rows[i]);
    const key = normKey_(rule.name);
    if (key) map.set(key, rule);
  }
  return map;
}

export function matchRule(rules, name) {
  return rules.get(normKey_(name)) || null;
}

// Creates or updates a rule in place, preserving row order.
export async function saveRule(name, bucket, category, property, trusted) {
  const key = normKey_(name);
  if (!key) throw new Error('Rule requires a counterparty');
  const rule = {
    name: String(name).trim(),
    bucket: normBucket_(bucket),
    category: normCategory_(category),
    property: String(property || '').trim(),
    trusted: trusted === true || st_(trusted) === 'TRUE'
  };
  const rows = await readRange(TAB.rules, null, 1, RULE_COLS);
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (normKey_(rows[i][0]) === key) { found = i; break; }
  }
  if (found >= 0) {
    await writeRange(TAB.rules, found + 1, 1, [ruleToRow(rule)]);
  } else {
    await appendRows(TAB.rules, [ruleToRow(rule)]);
  }
  return rule;
}

// Removes a rule (used by /undo after a bot-created rule).
export async function clearRule(name) {
  const key = normKey_(name);
  const rows = await readRange(TAB.rules, null, 1, RULE_COLS);
  for (let i = 1; i < rows.length; i++) {
    if (normKey_(rows[i][0]) === key) {
      await clearRange(TAB.rules, rangeFor(TAB.rules, i + 1, i + 1, 1, RULE_COLS));
      return true;
    }
  }
  return false;
}
