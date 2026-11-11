// ==========================================
// AI suggestions (Gemini first, DeepSeek fallback). Suggestions only — never
// confirmed. Ports the GAS suggestOpenRows logic.
// ==========================================

import {
  GEMINI_KEY, GEMINI_MODEL, DEEPSEEK_KEY, ALLOWED_BUCKETS, ALLOWED_CATEGORIES, suggestPrompt
} from './config.js';
import { loadTransactionRows, updateTransactionRows } from './txn.js';
import { normBucket_, normCategory_ } from './util.js';
import { REVIEW, PENDING } from './config.js';

const OPEN = [REVIEW, PENDING];

async function gemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    })
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('gemini empty response');
  return JSON.parse(text);
}

async function deepseek(prompt) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0
    })
  });
  if (!res.ok) throw new Error(`deepseek ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('deepseek empty response');
  return JSON.parse(text);
}

// Returns a Map<id, suggestion>. Falls back to DeepSeek when Gemini fails.
export async function suggest(items) {
  const prompt = suggestPrompt() + JSON.stringify(items.map((t, i) => ({
    id: t.ref || String(i), counterparty: t.counterparty, amount: t.amount,
    direction: t.direction, notes: t.notes
  })));
  let data, source;
  if (GEMINI_KEY) {
    try { data = await gemini(prompt); source = 'gemini'; }
    catch (err) {
      if (!DEEPSEEK_KEY) throw err;
      data = await deepseek(prompt);
      source = 'deepseek';
    }
  } else if (DEEPSEEK_KEY) {
    data = await deepseek(prompt);
    source = 'deepseek';
  } else {
    throw new Error('no AI provider configured');
  }
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
