// ==========================================
// Category suggestions from repeated notes/payees. Minimum 3 matching rows;
// the LLM judges the candidate (raw notes included) and the bot always asks
// before creating a category or moving rows.
// ==========================================

import { askJSON } from './llm.js';
import { normKey_ } from './util.js';

const GENERIC = new Set(['', 'other', 'groceries', 'shopping', 'food out', 'chai and snacks',
  'staff', 'family support', 'medicine', 'fuel', 'rent', 'repairs', 'plumbing',
  'electricity', 'self transfer', 'tenant rent', 'reimbursement', 'deposit refund']);
const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'this', 'that', 'paid', 'pay', 'to',
  'of', 'by', 'at', 'on', 'in', 'a', 'an', 'my', 'me', 'is', 'was', 'via', 'upi', 'ref',
  'transaction', 'transactions', 'sent', 'received', 'cash', 'card', 'bank', 'account',
  'rent', 'loan', 'bike', 'repair', 'phone', 'buy', 'transfer', 'withdraw', 'salary', 'pension',
  'check', 'matches']);

// Deterministic candidates: a payee with >=3 rows under a broad category, and
// note tokens seen in >=3 rows that are not already categories.
export function candidateContext(rows, categories) {
  const have = new Set((categories || []).map(c => String(c).toLowerCase()));
  const payees = new Map();
  const tokens = new Map();
  for (const t of rows) {
    const payee = String(t.counterparty || '').trim();
    if (payee && String(t.bucket || '').toLowerCase() !== 'internal') {
      const k = normKey_(payee);
      if (k) {
        if (!payees.has(k)) payees.set(k, { payee, bucket: t.bucket || '', category: t.category || '', notes: [], count: 0 });
        const c = payees.get(k);
        c.count++;
        if (t.notes) c.notes.push(String(t.notes));
      }
    }
    const note = String(t.notes || '').trim();
    if (note) {
      for (const tok of new Set(note.toLowerCase().split(/[^a-z0-9]+/))) {
        if (tok.length < 3 || STOP.has(tok) || have.has(tok)) continue;
        if (!tokens.has(tok)) tokens.set(tok, { token: tok, notes: [], payees: new Set(), count: 0 });
        const c = tokens.get(tok);
        c.count++;
        c.notes.push(note);
        c.payees.add(payee);
      }
    }
  }
  const out = [];
  for (const [k, c] of payees) {
    if (c.count < 3) continue;
    if (!GENERIC.has(String(c.category || '').toLowerCase())) continue;
    out.push({ kind: 'merchant', key: 'm:' + k, payee: c.payee, bucket: c.bucket || 'Personal', current: c.category || '', count: c.count, notes: c.notes.slice(0, 4) });
  }
  for (const [token, c] of tokens) {
    if (c.count < 3) continue;
    out.push({ kind: 'type', key: 't:' + token, token, bucket: 'Personal', count: c.count, payees: [...c.payees].filter(Boolean).slice(0, 4), notes: c.notes.slice(0, 4) });
  }
  // Keep the prompt small and the strongest signals first.
  const merchants = out.filter(c => c.kind === 'merchant').sort((a, b) => b.count - a.count).slice(0, 15);
  const types = out.filter(c => c.kind === 'type').sort((a, b) => b.count - a.count).slice(0, 10);
  return [...merchants, ...types];
}

export async function proposeSuggestions(candidates, categories) {
  if (!candidates.length) return [];
  const prompt = 'You are the finance bot for a single owner. Propose a dedicated category only when the signal is a real merchant or a spending type, at least 3 transactions match, and the category does not already exist. Skip people, self transfers, bank labels, generic words and one-off notes.\n' +
    'Existing categories: ' + categories.join(', ') + '\n' +
    'Candidates (raw notes included):\n' + candidates.map(c => JSON.stringify(c)).join('\n') + '\n\n' +
    'Return JSON {"suggestions":[{"key":"the candidate key","category":"Short category name","kind":"merchant"|"type","reason":"one line"}]}. Max 3, best first.';
  const data = (await askJSON(prompt)).data;
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

export function validateSuggestions(raw, candidates, categories) {
  const have = new Set((categories || []).map(c => String(c).toLowerCase()));
  const byKey = new Map(candidates.map(c => [c.key, c]));
  const out = [];
  for (const s of raw) {
    const c = byKey.get(String(s.key || ''));
    if (!c) continue;
    const cat = String(s.category || '').trim();
    if (!cat || have.has(cat.toLowerCase())) continue;
    out.push({ ...c, category: cat, kind: s.kind === 'type' ? 'type' : c.kind, reason: String(s.reason || '') });
  }
  return out.slice(0, 3);
}

export async function suggestionsFor(rows, categories) {
  const candidates = candidateContext(rows, categories);
  if (!candidates.length) return [];
  try { return validateSuggestions(await proposeSuggestions(candidates, categories), candidates, categories); }
  catch (err) { console.error('[suggest] llm failed:', err.message); return []; }
}
