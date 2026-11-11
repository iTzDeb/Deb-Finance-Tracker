// ==========================================
// Import flow (importChunk / importCommit / importCancel). Staged rows live in
// the Staging tab, then importCommit cross-checks against the sheet with a
// 3-pass dedup (same ref; same day+payee+amount; payee+amount ±1 day) and flags
// "CHECK" for same-amount/same-date rows under a different name.
// ==========================================

import { randomUUID } from 'node:crypto';
import { readRange, appendRows, clearRange, TAB, rangeFor } from './sheet.js';
import { STAGE_NCOL, REVIEW } from './config.js';
import { normKey_, normRef_, canonicalPayee, cleanPayeeName } from './util.js';
import { loadTransactionRows, appendTransactions, classify, updateTransactionRows, sortTransactions } from './txn.js';
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
  pushTo(index.byPayeeAmount, `${direction}|${key}|${amount}`, { date: t.date, txn: t });
  pushTo(index.byAmountDate, `${direction}|${amount}|${t.date}`, { key, name: t.counterparty, date: t.date, txn: t });
}

export function buildDedupIndex(existing) {
  const index = { byPayeeAmount: new Map(), byAmountDate: new Map() };
  existing.forEach(t => addToIndex(index, t));
  return index;
}

// Decides which staged rows are new. Rows added during the same call go into
// the index too, so duplicates inside one statement are skipped.
// Returns { rows: [{ txn, match }], skipped, check }.
// When a staged row matches an existing one, propose richer details (a fuller
// counterparty, an exact time) for the existing row.
function enrichFrom(existing, staged) {
  const updates = {};
  const eRaw = String(existing.counterparty || '').trim();
  const sRaw = String(staged.counterparty || '').trim();
  const eName = cleanPayeeName(eRaw);
  const sName = cleanPayeeName(sRaw);
  let target = null;
  if (eName && sName) {
    const eu = eName.toUpperCase();
    const su = sName.toUpperCase();
    if (su.startsWith(eu) && sName.length > eName.length) target = sName;
  }
  if (!target && eRaw !== eName && eName) target = eName; // de-pollute an existing name
  if (target) updates.counterparty = target;
  if (existing.date && staged.date && existing.date === staged.date) {
    const eTime = String(existing.loggedAt || '').slice(11, 16);
    const sTime = String(staged.loggedAt || '').slice(11, 16);
    if ((!eTime || eTime === '00:00') && sTime && sTime !== '00:00') updates.loggedAt = staged.loggedAt;
  }
  return Object.keys(updates).length ? updates : null;
}

const refKey = t => `${String(t.direction || '').toUpperCase()}|${amtKey(t.amount)}`;

export function dedupStaged(staged, existing) {
  // Refs are keyed by direction+amount so a reversal (same ref, both legs) is kept.
  const refs = new Map();
  for (const t of existing) {
    if (!t.ref || /^(NOREF|IMP)-/.test(t.ref)) continue;
    const ref = normRef_(t.ref);
    if (!refs.has(ref)) refs.set(ref, []);
    refs.get(ref).push(t);
  }
  const index = buildDedupIndex(existing);
  const rows = [];
  const enrich = [];
  let skipped = 0, check = 0;

  for (const s of staged) {
    const sDirection = String(s.direction || '').toUpperCase();
    const sAmount = amtKey(s.amount);
    const sKey = normKey_(s.counterparty);
    const sRef = s.ref ? normRef_(s.ref) : '';

    const refMatch = sRef && (refs.get(sRef) || []).find(t => refKey(t) === refKey(s));
    if (refMatch) {
      skipped++;
      const up = enrichFrom(refMatch, s);
      if (up) enrich.push({ txn: refMatch, updates: up });
      continue;
    }

    const samePayeeAmount = index.byPayeeAmount.get(`${sDirection}|${sKey}|${sAmount}`) || [];
    const payeeMatch = samePayeeAmount.find(e => e.date === s.date) || samePayeeAmount.find(e => dayDiff(e.date, s.date) <= 1);
    // Two rows with different refs are genuinely different transactions even
    // when payee, amount and day match (e.g. a split payment); merge only when
    // at least one side has no ref or the refs are equal.
    const matchRef = payeeMatch && payeeMatch.txn.ref ? normRef_(payeeMatch.txn.ref) : '';
    if (payeeMatch && !(sRef && matchRef && sRef !== matchRef)) {
      skipped++;
      const up = enrichFrom(payeeMatch.txn, s);
      if (up) enrich.push({ txn: payeeMatch.txn, updates: up });
      continue;
    }

    // CHECK: same amount + date, but a different payee name.
    const sameAmountDate = index.byAmountDate.get(`${sDirection}|${sAmount}|${s.date}`) || [];
    const match = sameAmountDate.find(entry => entry.key !== sKey);
    if (match) check++;

    if (sRef) {
      if (!refs.has(sRef)) refs.set(sRef, []);
      refs.get(sRef).push(s);
    }
    addToIndex(index, s);
    rows.push({ txn: s, match });
  }
  return { rows, skipped, check, enrich };
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

  const existingRows = await loadTransactionRows();
  const existing = existingRows.map(r => { r.txn.row = r.row; return r.txn; });
  const rules = await loadRules();
  const knownNames = new Set(existing.map(t => cleanPayeeName(t.counterparty)).filter(Boolean));
  for (const rule of rules.values()) if (rule.name) knownNames.add(cleanPayeeName(rule.name));
  for (const s of staged) s.counterparty = canonicalPayee(cleanPayeeName(s.counterparty), knownNames);
  const { rows, skipped, check, enrich } = dedupStaged(staged, existing);

  // Backfill richer details (full name, exact time) into matched existing rows.
  const enrichRows = [];
  for (const e of enrich) {
    if (!e.txn.row) continue;
    Object.assign(e.txn, e.updates);
    enrichRows.push({ row: e.txn.row, txn: e.txn });
  }
  if (enrichRows.length) await updateTransactionRows(enrichRows);

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
  await sortTransactions();
  await clearStaging(batch);
  if (toAppend.length) {
    try { await notifyImport(toAppend); }
    catch (err) { console.error('[import] notify failed:', err.message); }
  }
  return { added: toAppend.length, skipped, check, enriched: enrichRows.length };
}

// ---------- importCancel ----------
export async function handleImportCancel({ batch }) {
  if (!batch) throw new Error('importCancel requires a batch id');
  await clearStaging(batch);
  return { ok: true };
}
