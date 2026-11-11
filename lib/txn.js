// ==========================================
// Transactions domain: read/write the Transactions tab, map rows <-> objects,
// and apply dedup + rules when logging new rows.
// ==========================================

import { randomUUID } from 'node:crypto';
import { readRange, writeRange, writeRanges, writeBlockRaw, appendRows, formatTransactionDates, endRowOf, TAB } from './sheet.js';
import { NCOL, REVIEW, SBI_ACCOUNT } from './config.js';
import { cellToDateStr, cellToStampStr, amountNum_, normBucket_, normCategory_, compositeKey_, dayStr_, normRef_, canonicalPayee, cleanPayeeName } from './util.js';
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

// Leading-zero refs are identifiers; write them as text or Sheets drops the zero.
function refForSheet(ref) {
  const value = String(ref || '');
  return /^0\d+$/.test(value) ? `'${value}` : value;
}

export function txnToRow(t) {
  return [
    t.loggedAt || '', t.date || '', t.direction || '', t.amount ?? '', t.counterparty || '',
    refForSheet(t.ref), t.source || '', t.account || '', t.status || REVIEW, t.bucket || '',
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
  const found = (await loadTransactionRows()).find(r => normRef_(r.txn.ref) === normRef_(ref));
  return found || null;
}

export async function appendTransactions(txns) {
  if (!txns.length) return;
  const range = await appendRows(TAB.transactions, txns.map(txnToRow));
  const end = endRowOf(range);
  if (end) await formatTransactionDates(end - txns.length + 1, end);
}

// Write a single transaction back at its 1-based row index (header is row 1).
export async function updateTransactionRow(rowIndex1, txn) {
  await writeRange(TAB.transactions, rowIndex1, 1, [txnToRow(txn)]);
  await formatTransactionDates(rowIndex1, rowIndex1);
}

// Write many transactions in one Sheets call.
export async function updateTransactionRows(rows) {
  if (!rows.length) return;
  await writeRanges(TAB.transactions, rows.map(({ row, txn }) => ({ row, values: txnToRow(txn) })));
  const indexes = rows.map(r => Number(r.row)).filter(Number.isFinite);
  if (indexes.length) await formatTransactionDates(Math.min(...indexes), Math.max(...indexes));
}

// The set of refs already present (dedup keys). NOREF/IMP are never matched.
export async function existingRefs() {
  const rows = await readRange(TAB.transactions, null, 6, 6); // Ref column F only
  const set = new Set();
  for (let i = 1; i < rows.length; i++) {
    const ref = String(rows[i]?.[0] || '').trim();
    if (ref && !/^(NOREF|IMP)-/.test(ref)) set.add(normRef_(ref));
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

// Row timestamp for ordering: column A is a serial number in the raw read, but
// fall back to a parsed string if someone typed a date.
function rowStamp_(row) {
  const a = row[0];
  if (typeof a === 'number' && isFinite(a)) return a;
  const n = Number(a);
  if (String(a ?? '').trim() !== '' && isFinite(n)) return n;
  const t = Date.parse(String(a || ''));
  return isFinite(t) ? t : 0;
}

export function sortedByLoggedAt(rows) {
  return [...rows].sort((a, b) => rowStamp_(a) - rowStamp_(b));
}

// Re-sorts the Transactions tab by Logged At (ascending). Appending an older
// statement at the bottom used to leave the sheet out of date/time order.
export async function sortTransactions() {
  const rows = await readRange(TAB.transactions, `'${TAB.transactions}'!A2:S`);
  const data = rows.filter(r => String(r[0] ?? '').trim() !== '');
  if (data.length < 2) return { sorted: 0 };
  const sorted = sortedByLoggedAt(data);
  if (!sorted.some((r, i) => r !== data[i])) return { sorted: 0 };
  await writeBlockRaw(TAB.transactions, 2, 1, sorted);
  await formatTransactionDates(2, sorted.length + 1);
  return { sorted: sorted.length };
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
  const all = await loadTransactions();
  const seenRefs = new Set(all.map(t => t.ref).filter(ref => !/^(NOREF|IMP)-/.test(ref)));
  const seenComposites = new Set();
  for (const t of all) if (t.date) seenComposites.add(compositeKey_(t.date, t.direction, t.amount));
  const knownNames = new Set(all.map(t => cleanPayeeName(t.counterparty)).filter(Boolean));
  for (const rule of rules.values()) if (rule.name) knownNames.add(cleanPayeeName(rule.name));
  const appended = [];

  for (const p of parsed) {
    p.counterparty = canonicalPayee(cleanPayeeName(p.counterparty), knownNames);
    const txn = classify(p, rules);
    const hadRef = !!txn.ref;
    if (!txn.ref) {
      txn.ref = `NOREF-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    }
    if (seenRefs.has(normRef_(txn.ref))) continue;
    // shortcut: the ref-less key ignores the payee, so two same-day equal
    // payments with no UPI ref collapse into one. Add the payee if one is lost.
    const ck = compositeKey_(txn.date, txn.direction, txn.amount);
    if ((txn.account === SBI_ACCOUNT || !hadRef) && seenComposites.has(ck)) continue;
    seenRefs.add(normRef_(txn.ref));
    seenComposites.add(ck);
    appended.push(txn);
  }

  await appendTransactions(appended);
  return appended;
}
