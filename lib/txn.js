// ==========================================
// Transactions domain: read/write the Transactions tab, map rows <-> objects,
// and apply dedup + rules when logging new rows.
// ==========================================

import { randomUUID } from 'node:crypto';
import { readRange, writeRange, appendRows, TAB } from './sheet.js';
import { HEADERS, NCOL, REVIEW, SBI_ACCOUNT } from './config.js';
import { cellToDateStr, cellToStampStr, amountNum_, normBucket_, normCategory_, compositeKey_, dayStr_ } from './util.js';
import { matchRule } from './rules.js';

function bool(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

// Raw row (array of NCOL) -> object with camelCase keys (frontend-compatible).
export function rowToTxn(row) {
  const [
    loggedAt, date, direction, amount, counterparty, ref, source, account, status,
    bucket, category, property, notes,
    suggestedBucket, suggestedCategory, suggestedProperty, aiConfidence, aiSource, accept
  ] = row;
  return {
    loggedAt: cellToStampStr(loggedAt),
    date: cellToDateStr(date),
    direction: String(direction || '').toUpperCase(),
    amount: amountNum_(amount),
    counterparty: String(counterparty || '').trim(),
    ref: String(ref || '').trim(),
    source: String(source || '').trim(),
    account: String(account || '').trim(),
    status: String(status || REVIEW).toUpperCase(),
    bucket: normBucket_(bucket),
    category: normCategory_(category),
    property: String(property || '').trim(),
    notes: String(notes || '').trim(),
    suggestedBucket: normBucket_(suggestedBucket),
    suggestedCategory: normCategory_(suggestedCategory),
    suggestedProperty: String(suggestedProperty || '').trim(),
    aiConfidence: aiConfidence == null ? '' : String(aiConfidence),
    aiSource: String(aiSource || '').trim(),
    accept: bool(accept)
  };
}

export function txnToRow(t) {
  return [
    t.loggedAt || '', t.date || '', t.direction || '', t.amount ?? '', t.counterparty || '',
    t.ref || '', t.source || '', t.account || '', t.status || REVIEW, t.bucket || '',
    t.category || '', t.property || '', t.notes || '',
    t.suggestedBucket || '', t.suggestedCategory || '', t.suggestedProperty || '',
    t.aiConfidence ?? '', t.aiSource || '', !!t.accept
  ];
}

// Raw rows with their absolute 1-based row index and parsed object.
export async function loadTransactionRows() {
  const rows = await readRange(TAB.transactions, null, 1, NCOL);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const txn = rowToTxn(rows[i]);
    if (txn.ref || txn.counterparty || txn.amount) out.push({ row: i + 1, txn });
  }
  return out;
}

// All transaction rows as objects (headers skipped).
export async function loadTransactions() {
  return (await loadTransactionRows()).map(r => r.txn);
}

// Finds a transaction by ref; returns { row, txn } or null.
export async function findTransaction(ref) {
  const found = (await loadTransactionRows()).find(r => r.txn.ref === String(ref));
  return found || null;
}

export async function appendTransactions(txns) {
  if (!txns.length) return;
  await appendRows(TAB.transactions, txns.map(txnToRow), NCOL);
}

// Write a single transaction back at its 1-based row index (header is row 1).
export async function updateTransactionRow(rowIndex1, txn) {
  await writeRange(TAB.transactions, rowIndex1, 1, [txnToRow(txn)]);
}

// The set of refs already present (dedup keys). NOREF/IMP are never matched.
export async function existingRefs() {
  const rows = await readRange(TAB.transactions, null, 6, 6); // Ref column F only
  const set = new Set();
  for (let i = 1; i < rows.length; i++) {
    const ref = String(rows[i]?.[0] || '').trim();
    if (ref && !/^(NOREF|IMP)-/.test(ref)) set.add(ref);
  }
  return set;
}

// Existing composite keys (date|direction|amount) for cross-source SBI dedup.
export async function existingComposites() {
  const rows = await readRange(TAB.transactions, null, 2, 4); // Date, Direction, Amount
  const set = new Set();
  for (let i = 1; i < rows.length; i++) {
    const [date, direction, amount] = rows[i] || [];
    const d = cellToDateStr(date);
    if (!d) continue;
    set.add(compositeKey_(d, direction, amount));
  }
  return set;
}

// Classify an incoming parsed txn against rules; returns a txn object with
// bucket/category/property filled and status set (CONFIRMED if trusted else PENDING).
export function classify(txn, rules) {
  const rule = matchRule(rules, txn.counterparty);
  const out = {
    ...txn,
    bucket: rule?.bucket || txn.bucket || '',
    category: rule?.category || txn.category || '',
    property: rule?.property || txn.property || '',
    status: rule?.trusted ? 'CONFIRMED' : 'PENDING'
  };
  return out;
}

// Log parsed transactions, deduping by ref (primary) and, for the SBI current
// account, by composite key (secondary). Returns the rows actually appended.
export async function logTransactions(parsed, rules, { source } = {}) {
  const refs = await existingRefs();
  const composites = await existingComposites();
  const seenRefs = new Set(refs);
  const seenComposites = new Set(composites);
  const appended = [];

  for (const p of parsed) {
    let txn = classify(p, rules);
    if (!txn.ref) {
      txn.ref = `NOREF-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    }
    if (seenRefs.has(txn.ref)) continue;
    const ck = compositeKey_(txn.date, txn.direction, txn.amount);
    if (txn.account === SBI_ACCOUNT && seenComposites.has(ck)) continue;
    seenRefs.add(txn.ref);
    seenComposites.add(ck);
    appended.push(txn);
  }

  await appendTransactions(appended);
  return appended;
}
