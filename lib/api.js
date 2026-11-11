// ==========================================
// Read/action endpoints for the frontend: pending, summary, save, bulkSave,
// history, snapshot. Each handler returns a plain object ready to JSONP-wrap.
// Shapes are pinned to the live frontend contract (index.html / import.html).
// ==========================================

import { loadTransactions, loadTransactionRows, findTransaction, updateTransactionRow, updateTransactionRows } from './txn.js';
import { loadRules, matchRule, saveRule } from './rules.js';
import { REVIEW, PENDING, CONFIRMED, FORGOTTEN, ALLOWED_BUCKETS } from './config.js';
import { historyTotals, pendingPayeeKey, normRef_ } from './util.js';
import { addCategory, loadCategories } from './categories.js';

const OPEN_STATUSES = [REVIEW, PENDING];

// Full item used by the Pending view (adds AI suggestion fields).
export function toPendingItem(t) {
  return {
    ref: t.ref,
    stamp: t.loggedAt,
    date: t.date,
    time: t.loggedAt && t.loggedAt.length > 10 ? t.loggedAt.slice(11, 16) : '',
    direction: t.direction,
    amount: t.amount,
    counterparty: t.counterparty,
    source: t.source,
    account: t.account,
    status: t.status,
    bucket: t.bucket,
    category: t.category,
    property: t.property,
    notes: t.notes,
    sBucket: t.suggestedBucket,
    sCategory: t.suggestedCategory,
    sProperty: t.suggestedProperty,
    confidence: t.aiConfidence,
    hidden: !!t.hidden
  };
}

// Item shape consumed by normalizeHistoryItem (History + Snapshot).
export function toHistoryItem(t) {
  return {
    ref: t.ref,
    stamp: t.loggedAt,
    date: t.date,
    direction: t.direction,
    amount: Math.abs(t.amount),
    counterparty: t.counterparty,
    source: t.source,
    account: t.account,
    status: t.status,
    bucket: t.bucket,
    category: t.category,
    property: t.property,
    notes: t.notes,
    hidden: !!t.hidden
  };
}

// ---------- pending ----------
export async function handlePending() {
  const txns = await loadTransactions();
  const items = txns
    .filter(t => OPEN_STATUSES.includes(t.status))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.loggedAt).localeCompare(String(a.loggedAt)))
    .map(toPendingItem);
  return { items };
}

// ---------- summary ----------
export function computeSummary(txns, month) {
  const biz = {}, per = {};
  let businessIncome = 0, received = 0, internal = 0, pendingCount = 0;
  for (const t of txns) {
    if (t.date && !t.date.startsWith(month)) continue;
    if (t.status === FORGOTTEN) continue;
    const cat = t.category || 'Other';
    const amount = Number(t.amount) || 0;
    if (t.status === REVIEW || t.status === PENDING) pendingCount++;
    if (t.bucket === 'Internal') { internal += amount; continue; }
    if (t.direction === 'CREDIT') {
      received += amount;
      if (t.bucket === 'Business') businessIncome += amount;
      continue;
    }
    // DEBIT
    if (t.bucket === 'Business') biz[cat] = (biz[cat] || 0) + amount;
    else if (t.bucket === 'Personal') per[cat] = (per[cat] || 0) + amount;
  }
  return { month, business: biz, personal: per, businessIncome, received, internal, pendingCount };
}

export async function handleSummary({ month }) {
  const txns = await loadTransactions();
  return { summary: computeSummary(txns, String(month || '')) };
}

// ---------- save ----------
export async function handleSave({ ref, bucket, category, property, notes, hidden }) {
  if (!ref) throw new Error('save requires a ref');
  if (bucket && !ALLOWED_BUCKETS.includes(bucket)) throw new Error('invalid bucket');
  if (category) await addCategory(category);
  const found = await findTransaction(ref);
  if (!found) throw new Error('transaction not found');
  const t = found.txn;
  t.bucket = bucket || t.bucket;
  t.category = category || t.category;
  t.property = property || t.property || '';
  t.notes = notes || t.notes || '';
  if (hidden !== undefined && hidden !== null) t.hidden = hidden === true || hidden === 'true' || hidden === '1' || hidden === 1;
  t.status = CONFIRMED;
  await updateTransactionRow(found.row, t);
  // The row is the user's decision; a failed rule upsert must not report failure.
  // Keep an existing trusted rule trusted: editing one row must not stop the
  // payee from auto-confirming future rows.
  if (t.counterparty) {
    try {
      const rule = matchRule(await loadRules(), t.counterparty);
      await saveRule(t.counterparty, t.bucket, t.category, t.property, rule ? rule.trusted : false);
    } catch (err) { console.log('[save] rule upsert failed:', err.message); }
  }
  return { updated: 1 };
}

// ---------- bulkSave ----------
export async function handleBulkSave({ payeeKey, bucket, category }) {
  if (!payeeKey) throw new Error('bulkSave requires a payeeKey');
  if (!ALLOWED_BUCKETS.includes(bucket)) throw new Error('invalid bucket');
  if (category) await addCategory(category);
  const rows = await loadTransactionRows();
  const targets = rows.filter(r => pendingPayeeKey(r.txn.counterparty) === pendingPayeeKey(payeeKey)
    && OPEN_STATUSES.includes(r.txn.status));
  for (const { txn } of targets) {
    txn.bucket = bucket;
    txn.category = category;
    txn.status = CONFIRMED;
  }
  await updateTransactionRows(targets);
  const refs = targets.map(r => r.txn.ref);
  if (targets.length && targets[0].txn.counterparty) {
    try { await saveRule(targets[0].txn.counterparty, bucket, category, '', true); }
    catch (err) { console.log('[bulkSave] rule upsert failed:', err.message); }
  }
  return { updated: refs.length, refs };
}

// ---------- forget ----------
// Marks open rows as FORGOTTEN: out of Pending and out of Month/History totals,
// but still present in the sheet (and visible in History with its filter).
export async function handleForget({ ref, payeeKey }) {
  if (!ref && !payeeKey) throw new Error('forget requires a ref or payeeKey');
  const rows = await loadTransactionRows();
  const targets = rows.filter(r => (ref
    ? normRef_(r.txn.ref) === normRef_(ref)
    : OPEN_STATUSES.includes(r.txn.status) && pendingPayeeKey(r.txn.counterparty) === pendingPayeeKey(payeeKey)));
  for (const { txn } of targets) txn.status = FORGOTTEN;
  await updateTransactionRows(targets);
  return { updated: targets.length, refs: targets.map(r => r.txn.ref) };
}

// ---------- history ----------
function matchesQuery(t, q) {
  if (!q) return true;
  const hay = `${t.counterparty} ${t.notes} ${t.amount}`.toLowerCase();
  return hay.includes(String(q).toLowerCase());
}

export function filterHistory(txns, { status = 'all', q = '', from, to } = {}) {
  const st = String(status || 'all').toUpperCase();
  return txns.filter(t => {
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    if (st !== 'ALL' && t.status !== st) return false;
    return matchesQuery(t, q);
  }).sort((a, b) => String(b.date).localeCompare(String(a.date))
    || String(b.loggedAt).localeCompare(String(a.loggedAt))
    || String(b.ref).localeCompare(String(a.ref)));
}

export async function handleHistory(params) {
  const started = Date.now();
  const limit = Math.min(Math.max(Number(params.limit) || 40, 1), 100);
  const offset = Math.max(Number(params.offset) || 0, 0);
  const filtered = filterHistory(await loadTransactions(), params);
  const page = filtered.slice(offset, offset + limit);
  return {
    items: page.map(toHistoryItem),
    hasMore: offset + limit < filtered.length,
    totals: historyTotals(filtered.map(toHistoryItem)),
    serverMs: Date.now() - started
  };
}

// ---------- snapshot ----------
export async function handleSnapshot({ from, to }) {
  const txns = await loadTransactions();
  const items = txns
    .filter(t => (!from || t.date >= from) && (!to || t.date <= to))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.loggedAt).localeCompare(String(a.loggedAt)))
    .map(toHistoryItem);
  if (items.length > 5000) throw new Error('snapshot range too large');
  return { items, categories: await loadCategories() };
}
