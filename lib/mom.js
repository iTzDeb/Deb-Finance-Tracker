// ==========================================
// Password-gated family view: monthly aggregates only (no transaction details).
// Hidden and FORGOTTEN rows are excluded. Requires MOM_PASSWORD to be set.
// ==========================================

import { loadTransactions } from './txn.js';
import { MOM_PASSWORD, FORGOTTEN } from './config.js';
import { sameSecret, ymd } from './util.js';

export function monthlyTotals(txns, month) {
  let incoming = 0, outgoing = 0, businessIncome = 0, businessExpense = 0, personalExpense = 0;
  for (const t of txns) {
    if (t.hidden || t.status === FORGOTTEN) continue;
    if (t.date && !t.date.startsWith(month)) continue;
    const amount = Number(t.amount) || 0;
    const bucket = String(t.bucket || '').toLowerCase();
    if (bucket === 'internal') continue;
    if (t.direction === 'CREDIT') {
      incoming += amount;
      if (bucket === 'business') businessIncome += amount;
    } else {
      outgoing += amount;
      if (bucket === 'business') businessExpense += amount;
      else if (bucket === 'personal') personalExpense += amount;
    }
  }
  return { month, incoming, outgoing, businessIncome, businessExpense, personalExpense };
}

// Family-view transaction list: no notes, refs or statuses; hidden/forgotten and
// self-transfers (internal) are left out, matching the totals above.
export function monthTransactions(txns, month) {
  return txns
    .filter(t => !t.hidden && t.status !== FORGOTTEN && String(t.bucket || '').toLowerCase() !== 'internal')
    .filter(t => !t.date || t.date.startsWith(month))
    .sort((a, b) => String(b.loggedAt).localeCompare(String(a.loggedAt)))
    .map(t => ({
      date: t.date,
      counterparty: t.counterparty,
      amount: Math.abs(Number(t.amount) || 0),
      direction: t.direction,
      category: t.category || '',
      bucket: t.bucket || ''
    }));
}

export async function handleMom({ password, month } = {}) {
  if (!MOM_PASSWORD) throw new Error('family view is not configured');
  if (!sameSecret(password, MOM_PASSWORD)) throw new Error('wrong password');
  const txns = await loadTransactions();
  const now = new Date();
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = ymd(d).slice(0, 7);
    const totals = monthlyTotals(txns, m);
    if (totals.incoming || totals.outgoing || i === 0) months.push(totals);
  }
  const current = month || months[0].month;
  return { month: current, months, totals: monthlyTotals(txns, current), transactions: monthTransactions(txns, current) };
}
