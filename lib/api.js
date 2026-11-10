// ==========================================
// Read/action endpoints for the frontend: pending, summary, save, bulkSave,
// history, snapshot. Each handler returns a plain object ready to JSONP-wrap.
// Shapes are pinned to the live frontend contract (index.html / import.html).
// ==========================================

import { loadTransactions, loadTransactionRows, findTransaction, updateTransactionRow } from './txn.js';
import { loadRules, saveRule } from './rules.js';
import { REVIEW, PENDING, CONFIRMED } from './config.js';
import { historyTotals, pendingPayeeKey } from './util.js';

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
    confidence: t.aiConfidence
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
    notes: t.notes
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
export async function handleSave({ ref, bucket, category, property, notes }) {
  if (!ref) throw new Error('save requires a ref');
  const found = await findTransaction(ref);
  if (!found) throw new Error('transaction not found');
  const t = found.txn;
  t.bucket = bucket || t.bucket;
  t.category = category || t.category;
  t.property = property || t.property || '';
  t.notes = notes || t.notes || '';
  t.status = CONFIRMED;
  await updateTransactionRow(found.row, t);
  if (t.counterparty) await saveRule(t.counterparty, t.bucket, t.category, t.property, false);
  return { updated: 1 };
}

// ---------- bulkSave ----------
export async function handleBulkSave({ payeeKey, bucket, category }) {
  if (!payeeKey) throw new Error('bulkSave requires a payeeKey');
  const rows = await loadTransactionRows();
  const targets = rows.filter(r => pendingPayeeKey(r.txn.counterparty) === pendingPayeeKey(payeeKey)
    && OPEN_STATUSES.includes(r.txn.status));
  for (const { row, txn } of targets) {
    txn.bucket = bucket;
    txn.category = category;
    txn.status = CONFIRMED;
    await updateTransactionRow(row, txn);
  }
  const refs = targets.map(r => r.txn.ref);
  if (targets.length && targets[0].txn.counterparty) {
    await saveRule(targets[0].txn.counterparty, bucket, category, '', true);
  }
  return { updated: refs.length, refs };
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
  const limit = Math.min(Math.max(Number(params.limit) || 40, 1), 100);
  const offset = Math.max(Number(params.offset) || 0, 0);
  const filtered = filterHistory(await loadTransactions(), params);
  const page = filtered.slice(offset, offset + limit);
  return {
    items: page.map(toHistoryItem),
    hasMore: offset + limit < filtered.length,
    totals: historyTotals(filtered.map(toHistoryItem)),
    serverMs: 0
  };
}

// ---------- snapshot ----------
export async function handleSnapshot({ from, to }) {
  const txns = await loadTransactions();
  const items = txns
    .filter(t => (!from || t.date >= from) && (!to || t.date <= to))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.loggedAt).localeCompare(String(a.loggedAt)))
    .map(toHistoryItem);
  return { items };
}
