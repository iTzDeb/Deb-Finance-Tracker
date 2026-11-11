// ==========================================
// AI suggestions (DeepSeek primary, Gemini fallback). Suggestions only — never
// confirmed. Ports the GAS suggestOpenRows logic.
// ==========================================

import { ALLOWED_BUCKETS, ALLOWED_CATEGORIES, suggestPrompt, REVIEW, PENDING } from './config.js';
import { loadTransactionRows, updateTransactionRows } from './txn.js';
import { normBucket_, normCategory_ } from './util.js';
import { askJSON } from './llm.js';

const OPEN = [REVIEW, PENDING];

// Returns a Map<id, suggestion> plus the provider that answered.
export async function suggest(items) {
  const prompt = suggestPrompt() + JSON.stringify(items.map((t, i) => ({
    id: t.ref || String(i), counterparty: t.counterparty, amount: t.amount,
    direction: t.direction, notes: t.notes
  })));
  const { data, source } = await askJSON(prompt);
  const out = new Map();
  for (const s of data?.items || []) {
    if (!s || s.id == null) continue;
    out.set(String(s.id), {
      bucket: ALLOWED_BUCKETS.includes(s.bucket) ? s.bucket : '',
      category: ALLOWED_CATEGORIES.includes(s.category) ? s.category : 'Other',
      property: String(s.property || '').trim(),
      confidence: ['high', 'medium', 'unsure'].includes(s.confidence) ? s.confidence : 'unsure'
    });
  }
  return { suggestions: out, source };
}

// Fills Suggested Bucket/Category/Property + confidence for open rows that
// still lack a suggestion. Never changes status or confirmed fields.
export async function suggestOpenRows() {
  const rows = await loadTransactionRows();
  const open = rows.filter(r => OPEN.includes(r.txn.status) && !r.txn.suggestedBucket);
  if (!open.length) return { suggested: 0 };
  const { suggestions, source } = await suggest(open.map(r => r.txn));
  let applied = 0;
  const updates = [];
  for (const { row, txn } of open) {
    const s = suggestions.get(txn.ref);
    if (!s) continue;
    txn.suggestedBucket = normBucket_(s.bucket);
    txn.suggestedCategory = normCategory_(s.category);
    txn.suggestedProperty = s.property;
    txn.aiConfidence = s.confidence;
    txn.aiSource = source;
    updates.push({ row, txn });
    applied++;
  }
  await updateTransactionRows(updates);
  return { suggested: applied };
}
