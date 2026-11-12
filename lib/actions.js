// ==========================================
// Action schema + planner for the Telegram intent layer (Phase 1).
// The LLM returns {actions:[...]}; the planner resolves each action against
// the transactions and produces a preview. Execution is separate (next step).
// ==========================================

import { normKey_ } from './util.js';
import { ALLOWED_BUCKETS, REVIEW, PENDING } from './config.js';

export const ACTION_TYPES = ['rule', 'bulk', 'hide', 'unhide', 'note', 'transactions',
  'summary', 'spend', 'pending', 'rules', 'undo', 'pause', 'resume', 'help',
  'add_category', 'remove_category', 'clarify'];

export const MUTATING = new Set(['rule', 'bulk', 'hide', 'unhide', 'note', 'add_category', 'remove_category']);

// Rows selected by amount and/or ref (for "all 13 rupee" / "all 500312...").
export function matchBulkRows(rows, { amount, ref } = {}) {
  const amt = Number(amount) || 0;
  const needle = String(ref || '').trim().toUpperCase();
  return rows.filter(r => {
    if (amt && Math.abs(Number(r.txn.amount) - amt) > 0.005) return false;
    if (needle && !(String(r.txn.ref || '').toUpperCase().includes(needle) || String(r.txn.counterparty || '').toUpperCase().includes(needle))) return false;
    return true;
  });
}

// Rows whose counterparty matches one of the given names (exact key or prefix),
// or whose raw counterparty/ref contains a numeric ref string.
export function matchPayeeRows(rows, names) {
  const list = (Array.isArray(names) ? names : [names]).map(n => String(n || '').trim()).filter(Boolean);
  if (!list.length) return [];
  const keys = list.map(n => normKey_(n)).filter(Boolean);
  const raws = list.map(n => n.toUpperCase());
  return rows.filter(r => {
    const key = normKey_(r.txn.counterparty);
    if (key && keys.some(k => key === k || key.startsWith(k) || k.startsWith(key))) return true;
    const raw = String(r.txn.counterparty || '').toUpperCase();
    const ref = String(r.txn.ref || '').toUpperCase();
    return raws.some(w => w && (raw.includes(w) || ref.includes(w)));
  });
}

const dirOf = v => { const d = String(v || '').toUpperCase(); return d === 'CREDIT' || d === 'DEBIT' ? d : ''; };

// Accepts the new {actions:[...]} shape or the legacy single {intent}.
export function normalizeActions(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.actions)) {
    return data.actions
      .filter(a => a && ACTION_TYPES.includes(String(a.type || '').toLowerCase()))
      .map(a => ({ ...a, type: String(a.type).toLowerCase() }));
  }
  const intent = String(data.intent || '').toLowerCase();
  if (!intent) return [];
  const base = { ...data };
  if (intent === 'create_rule') return [{ ...base, type: 'rule', scope: base.scope === 'open' ? 'open' : 'all' }];
  if (intent === 'bulk') return [{ ...base, type: 'bulk' }];
  if (intent === 'transactions') return [{ ...base, type: 'transactions' }];
  if (intent === 'hide' || intent === 'unhide') return [{ ...base, type: intent }];
  if (intent === 'add_category' || intent === 'remove_category') return [{ ...base, type: intent }];
  if (intent === 'clarify') return [{ type: 'clarify', reply: base.reply || '' }];
  if (['summary', 'spend', 'pending', 'rules', 'undo', 'pause', 'resume', 'help'].includes(intent)) return [{ ...base, type: intent }];
  return [];
}

// Resolve one action into targets + a human preview; needs[] lists missing input.
export function planAction(action, rows) {
  const type = String(action.type || '').toLowerCase();
  const out = { action: { ...action, type }, targets: [], needs: [], summary: '' };
  const names = () => {
    const list = Array.isArray(action.payees) ? action.payees.map(v => String(v || '').trim()).filter(Boolean) : [];
    if (list.length) return list;
    return action.payee ? [String(action.payee).trim()] : [];
  };
  if (type === 'rule') {
    const payee = String(action.payee || '').trim();
    const bucket = ALLOWED_BUCKETS.find(b => b.toLowerCase() === String(action.bucket || '').trim().toLowerCase()) || '';
    const category = String(action.category || '').trim();
    out.action.bucket = bucket;
    if (!payee) out.needs.push('payee');
    if (!bucket) out.needs.push('bucket');
    if (!category) out.needs.push('category');
    const dir = dirOf(action.direction);
    const scope = action.scope === 'open' ? 'open' : 'all';
    if (payee) out.targets = matchPayeeRows(rows, [payee]).filter(r => (!dir || r.txn.direction === dir) && (scope === 'all' || [REVIEW, PENDING].includes(r.txn.status)));
    out.summary = payee
      ? 'Set ' + payee + ' → ' + (bucket || '?') + ' / ' + (category || '?') + (dir ? ' · ' + dir.toLowerCase() + ' only' : '') + (action.note ? ' · note' : '') + (action.hide ? ' · hidden from family view' : '') + ' (' + out.targets.length + ' transaction' + (out.targets.length === 1 ? '' : 's') + ')'
      : 'Choose a payee for ' + (bucket || '?') + ' / ' + (category || '?');
    return out;
  }
  if (type === 'bulk') {
    const amount = Number(action.match_amount) || 0;
    const ref = String(action.match_ref || '').trim();
    const bucket = ALLOWED_BUCKETS.find(b => b.toLowerCase() === String(action.bucket || '').trim().toLowerCase()) || '';
    const category = String(action.category || '').trim();
    out.action.bucket = bucket;
    if (!amount && !ref) out.needs.push('amount/ref');
    if (!bucket) out.needs.push('bucket');
    if (!category) out.needs.push('category');
    out.targets = matchBulkRows(rows, { amount, ref });
    out.summary = 'Tag ' + out.targets.length + ' transaction' + (out.targets.length === 1 ? '' : 's') + ' (' + (amount ? '₹' + amount : ref) + ') as ' + (bucket || '?') + ' / ' + (category || '?');
    return out;
  }
  if (type === 'hide' || type === 'unhide') {
    const payees = names();
    if (!payees.length) out.needs.push('payees');
    out.targets = matchPayeeRows(rows, payees);
    out.summary = (type === 'hide' ? 'Hide ' : 'Show ') + out.targets.length + ' transaction' + (out.targets.length === 1 ? '' : 's') + ' from ' + (payees.join(', ') || '?');
    return out;
  }
  if (type === 'note') {
    const payees = names();
    const text = String(action.text || action.note || '').trim();
    if (!payees.length) out.needs.push('payees');
    if (!text) out.needs.push('note');
    out.targets = matchPayeeRows(rows, payees);
    out.summary = 'Add note to ' + out.targets.length + ' transaction(s) from ' + (payees.join(', ') || '?');
    return out;
  }
  if (type === 'transactions') {
    const payees = names();
    if (!payees.length) out.needs.push('payees');
    out.summary = 'Transactions from ' + (payees.join(', ') || '?');
    return out;
  }
  if (type === 'add_category' || type === 'remove_category') {
    const name = String(action.category || '').trim();
    if (!name) out.needs.push('category');
    out.summary = (type === 'add_category' ? 'Add category ' : 'Remove category ') + (name || '?');
    return out;
  }
  if (type === 'clarify') { out.summary = String(action.reply || 'Clarify'); return out; }
  out.summary = 'Run ' + type;
  return out;
}

export function planActions(actions, rows) {
  return (actions || []).map(action => planAction(action, rows));
}

export function describePlan(plan) {
  return plan.filter(p => p.summary).map(p => '• ' + p.summary);
}

// Map an action to the legacy intent shape (for read-only handlers).
export function actionToIntent(action) {
  const type = String(action.type || '').toLowerCase();
  if (type === 'rule') return { ...action, intent: 'create_rule', scope: action.scope || 'all' };
  if (type === 'bulk') return { ...action, intent: 'bulk' };
  if (type === 'hide' || type === 'unhide') return { ...action, intent: type };
  if (type === 'transactions') return { ...action, intent: 'transactions' };
  if (type === 'add_category' || type === 'remove_category') return { ...action, intent: type };
  if (type === 'clarify') return { ...action, intent: 'clarify' };
  return { ...action, intent: type };
}

// Fill the fields a pending action was missing from the owner's follow-up.
export function mergePendingActions(pending, incoming, text) {
  if (!Array.isArray(pending) || !pending.length) return Array.isArray(incoming) ? incoming : [];
  const inc = (Array.isArray(incoming) && incoming[0]) || {};
  return pending.map(p => {
    const a = { ...p };
    for (const k of ['payee', 'bucket', 'category', 'direction', 'note', 'property', 'match_ref', 'text']) {
      if (!a[k] && inc[k]) a[k] = inc[k];
    }
    if (!a.payee && Array.isArray(inc.payees) && inc.payees.length) a.payee = inc.payees[0];
    if ((!a.payees || !a.payees.length) && Array.isArray(inc.payees) && inc.payees.length) a.payees = inc.payees.slice();
    if (!a.payee && a.payees && a.payees.length) a.payee = a.payees[0];
    if (!a.payee && !a.match_amount && !a.match_ref && !a.category) a.payee = String(text || '').trim();
    return a;
  });
}
