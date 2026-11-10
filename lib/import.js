// ==========================================
// Import flow (importChunk / importCommit / importCancel). Staged rows live in
// the Staging tab, then importCommit cross-checks against the sheet with a
// 3-pass dedup (same ref; same day+payee+amount; payee+amount ±1 day) and flags
// "CHECK" for same-amount/same-date rows under a different name.
// ==========================================

import { randomUUID } from 'node:crypto';
import { readRange, appendRows, writeRange, clearRange, TAB, rangeFor } from './sheet.js';
import { STAGE_NCOL, STAGE_HEADERS, REVIEW } from './config.js';
import { normKey_, cellToDateStr } from './util.js';
import { loadTransactions, appendTransactions, classify } from './txn.js';
import { loadRules } from './rules.js';

function dayMs(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Date.UTC(y, m - 1, d);
}
function dayDiff(a, b) {
  return Math.abs(dayMs(a) - dayMs(b)) / 86400000;
}

export function stageRowToTxn(row) {
  const [batch, stamp, direction, amount, party, ref, account, source] = row;
  return {
    loggedAt: String(stamp || ''),
    date: String(stamp || '').slice(0, 10),
    direction: String(direction || '').toUpperCase(),
    amount: Number(String(amount).replace(/,/g, '')) || 0,
    counterparty: String(party || '').trim(),
    ref: String(ref || '').trim(),
    account: String(account || '').trim(),
    source: String(source || '').trim(),
    status: 'PENDING'
  };
}

export async function loadStaging(batch) {
  const rows = await readRange(TAB.staging, null, 1, STAGE_NCOL);
  return rows.slice(1)
    .filter(r => !batch || String(r[0]) === String(batch))
    .map(stageRowToTxn);
}

export async function clearStaging(batch) {
  const rows = await readRange(TAB.staging, null, 1, 1);
  // Delete matching rows bottom-up so indices stay valid.
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(batch)) {
      await clearRange(TAB.staging, rangeFor(TAB.staging, i + 1, i + 1, 1, STAGE_NCOL));
    }
  }
}

// ---------- importChunk ----------
export async function handleImportChunk({ batch, rows }) {
  if (!batch) throw new Error('importChunk requires a batch id');
  let parsed;
  try { parsed = JSON.parse(rows); } catch { throw new Error('invalid rows payload'); }
  if (!Array.isArray(parsed)) throw new Error('rows must be an array');
  const stageRows = parsed.map(r => [
    batch,
    String(r.stamp || ''),
    String(r.direction || '').toUpperCase(),
    Number(String(r.amount).replace(/,/g, '')) || 0,
    String(r.party || '').trim(),
    String(r.ref || '').trim(),
    String(r.account || '').trim(),
    String(r.source || '').trim()
  ]);
  if (stageRows.length) await appendRows(TAB.staging, stageRows, STAGE_NCOL);
  return { ok: true };
}

// ---------- importCommit ----------
export async function handleImportCommit({ batch }) {
  if (!batch) throw new Error('importCommit requires a batch id');
  const staged = await loadStaging(batch);
  if (!staged.length) throw new Error('no staged rows for this batch');
  staged.sort((a, b) => String(a.loggedAt).localeCompare(String(b.loggedAt)));

  const existing = await loadTransactions();
  const refs = new Set(existing.map(t => t.ref).filter(ref => !/^(NOREF|IMP)-/.test(ref)));
  const rules = await loadRules();

  let added = 0, skipped = 0, check = 0;
  const toAppend = [];

  for (const s of staged) {
    if (s.ref && refs.has(s.ref)) { skipped++; continue; }
    const sDate = s.date;
    const sAmt = Number(s.amount);
    const sKey = normKey_(s.party);

    // Pass 2: same date + payee + amount.
    const sameDay = existing.find(t =>
      normKey_(t.counterparty) === sKey && t.date === sDate && Math.abs((Number(t.amount) || 0) - sAmt) < 0.005);
    if (sameDay) { skipped++; continue; }

    // Pass 3: payee + amount within ±1 day.
    const nearDay = existing.find(t =>
      normKey_(t.counterparty) === sKey && Math.abs((Number(t.amount) || 0) - sAmt) < 0.005 && dayDiff(t.date, sDate) <= 1);
    if (nearDay) { skipped++; continue; }

    // CHECK: same amount + date, but a different payee name.
    const sameAmountDate = existing.find(t =>
      t.date === sDate && Math.abs((Number(t.amount) || 0) - sAmt) < 0.005 && normKey_(t.counterparty) !== sKey);
    if (sameAmountDate) check++;

    const txn = classify(s, rules);
    if (!txn.ref) txn.ref = `IMP-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    if (sameAmountDate) {
      txn.status = REVIEW;
      txn.notes = (txn.notes ? txn.notes + ' · ' : '') + `CHECK: matches ${sameAmountDate.counterparty} (${sameAmountDate.date})`;
    }
    toAppend.push(txn);
    added++;
  }

  await appendTransactions(toAppend);
  await clearStaging(batch);
  return { added, skipped, check };
}

// ---------- importCancel ----------
export async function handleImportCancel({ batch }) {
  if (!batch) throw new Error('importCancel requires a batch id');
  await clearStaging(batch);
  return { ok: true };
}
