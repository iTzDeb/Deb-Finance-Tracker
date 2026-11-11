// ==========================================
// Import flow (importChunk / importCommit / importCancel). Staged rows live in
// the Staging tab, then importCommit cross-checks against the sheet with a
// 3-pass dedup (same ref; same day+payee+amount; payee+amount ±1 day) and flags
// "CHECK" for same-amount/same-date rows under a different name.
// ==========================================

import { randomUUID } from 'node:crypto';
import { readRange, appendRows, clearRange, TAB, rangeFor } from './sheet.js';
import { STAGE_NCOL, REVIEW } from './config.js';
import { normKey_, normRef_ } from './util.js';
import { loadTransactions, appendTransactions, classify } from './txn.js';
import { loadRules } from './rules.js';
import { notifyImport } from './bot.js';

function dayMs(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Date.UTC(y, m - 1, d);
}
function dayDiff(a, b) {
  return Math.abs(dayMs(a) - dayMs(b)) / 86400000;
}

// Normalise a staged stamp to the full "YYYY-MM-DD HH:mm" column-A format,
// defaulting to midnight when the importer found no time.
function normalizeStamp(stamp) {
  const s = String(stamp || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10) + ' 00:00';
  return s;
}

export function stageRowToTxn(row) {
  const [batch, stamp, direction, amount, party, ref, account, source] = row;
  const loggedAt = normalizeStamp(stamp);
  return {
    loggedAt,
    date: loggedAt.slice(0, 10),
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

// Clears every staged row for a batch, one clear call per contiguous run.
export async function clearStaging(batch) {
  const rows = await readRange(TAB.staging, null, 1, 1);
  let start = -1;
  for (let i = 1; i < rows.length; i++) {
    const match = String(rows[i][0]) === String(batch);
    if (match && start === -1) start = i + 1;
    const last = i === rows.length - 1;
    if (start !== -1 && (!match || last)) {
      await clearRange(TAB.staging, rangeFor(TAB.staging, start, match ? i + 1 : i, 1, STAGE_NCOL));
      start = -1;
    }
  }
}

const amtKey = value => (Number(value) || 0).toFixed(2);

function pushTo(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// Index existing transactions by payee+amount and by amount+date so dedup is
// O(staged) instead of scanning every row for every staged row.
function addToIndex(index, t) {
  const key = normKey_(t.counterparty);
  const amount = amtKey(t.amount);
  const direction = String(t.direction || '').toUpperCase();
  pushTo(index.byPayeeAmount, `${direction}|${key}|${amount}`, t.date);
  pushTo(index.byAmountDate, `${direction}|${amount}|${t.date}`, { key, name: t.counterparty, date: t.date });
}

export function buildDedupIndex(existing) {
  const index = { byPayeeAmount: new Map(), byAmountDate: new Map() };
  existing.forEach(t => addToIndex(index, t));
  return index;
}

// Decides which staged rows are new. Rows added during the same call go into
// the index too, so duplicates inside one statement are skipped.
// Returns { rows: [{ txn, match }], skipped, check }.
const refKey = t => `${String(t.direction || '').toUpperCase()}|${amtKey(t.amount)}`;

export function dedupStaged(staged, existing) {
  // A ref alone is not unique enough: a reversal books the same UPI ref as a
  // debit and a credit, so key refs by direction+amount as well.
  const refs = new Map();
  for (const t of existing) {
    if (!t.ref || /^(NOREF|IMP)-/.test(t.ref)) continue;
    const ref = normRef_(t.ref);
    const seen = refs.get(ref) || new Set();
    seen.add(refKey(t));
    refs.set(ref, seen);
  }
  const index = buildDedupIndex(existing);
  const rows = [];
  let skipped = 0, check = 0;

  for (const s of staged) {
    if (s.ref && refs.get(normRef_(s.ref))?.has(refKey(s))) { skipped++; continue; }
    const sKey = normKey_(s.counterparty);
    const sAmount = amtKey(s.amount);
    const sDirection = String(s.direction || '').toUpperCase();
    const samePayeeAmount = index.byPayeeAmount.get(`${sDirection}|${sKey}|${sAmount}`) || [];

    // Pass 2: same date + payee + amount.
    if (samePayeeAmount.includes(s.date)) { skipped++; continue; }
    // Pass 3: payee + amount within ±1 day.
    if (samePayeeAmount.some(date => dayDiff(date, s.date) <= 1)) { skipped++; continue; }

    // CHECK: same amount + date, but a different payee name.
    const sameAmountDate = index.byAmountDate.get(`${sDirection}|${sAmount}|${s.date}`) || [];
    const match = sameAmountDate.find(entry => entry.key !== sKey);
    if (match) check++;

    if (s.ref) {
      const ref = normRef_(s.ref);
      const seen = refs.get(ref) || new Set();
      seen.add(refKey(s));
      refs.set(ref, seen);
    }
    addToIndex(index, s);
    rows.push({ txn: s, match });
  }
  return { rows, skipped, check };
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
  if (stageRows.length) await appendRows(TAB.staging, stageRows);
  return { ok: true };
}

// ---------- importCommit ----------
export async function handleImportCommit({ batch }) {
  if (!batch) throw new Error('importCommit requires a batch id');
  const staged = await loadStaging(batch);
  if (!staged.length) throw new Error('no staged rows for this batch');
  staged.sort((a, b) => String(a.loggedAt).localeCompare(String(b.loggedAt)));

  const existing = await loadTransactions();
  const rules = await loadRules();
  const { rows, skipped, check } = dedupStaged(staged, existing);

  const toAppend = rows.map(({ txn, match }) => {
    const out = classify(txn, rules);
    if (!out.ref) out.ref = `IMP-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    if (match) {
      out.status = REVIEW;
      out.notes = (out.notes ? out.notes + ' · ' : '') + `CHECK: matches ${match.name} (${match.date})`;
    }
    return out;
  });

  await appendTransactions(toAppend);
  await clearStaging(batch);
  if (toAppend.length) {
    try { await notifyImport(toAppend); }
    catch (err) { console.error('[import] notify failed:', err.message); }
  }
  return { added: toAppend.length, skipped, check };
}

// ---------- importCancel ----------
export async function handleImportCancel({ batch }) {
  if (!batch) throw new Error('importCancel requires a batch id');
  await clearStaging(batch);
  return { ok: true };
}
