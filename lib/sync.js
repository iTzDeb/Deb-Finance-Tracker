// ==========================================
// Background sync: re-applies rules to open rows (trusted rules confirm,
// untrusted rules fill the suggestion fields). No AI, no network beyond Sheets.
// ==========================================

import { loadTransactionRows, updateTransactionRows } from './txn.js';
import { loadRules, matchRule } from './rules.js';
import { REVIEW, PENDING, CONFIRMED } from './config.js';

export async function syncRows() {
  const rules = await loadRules();
  const rows = await loadTransactionRows();
  let confirmed = 0, suggested = 0;
  const updates = [];
  for (const { row, txn } of rows) {
    if (txn.status !== REVIEW && txn.status !== PENDING) continue;
    const rule = matchRule(rules, txn.counterparty, txn.direction);
    if (!rule) continue;
    let changed = false;
    if (rule.trusted) {
      txn.bucket = rule.bucket;
      txn.category = rule.category;
      txn.property = rule.property;
      txn.status = CONFIRMED;
      changed = true; confirmed++;
    } else if (!txn.suggestedBucket || txn.suggestedBucket !== rule.bucket || txn.suggestedCategory !== rule.category) {
      txn.suggestedBucket = rule.bucket;
      txn.suggestedCategory = rule.category;
      txn.suggestedProperty = rule.property;
      changed = true; suggested++;
    }
    if (changed) updates.push({ row, txn });
  }
  await updateTransactionRows(updates);
  return { confirmed, suggested };
}
