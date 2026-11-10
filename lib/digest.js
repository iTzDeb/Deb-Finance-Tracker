// ==========================================
// Telegram digest (09:00 + 19:00). Sends a short summary of the current month
// plus how many open rows still need a decision. No-op without TG_TOKEN.
// ==========================================

import { TG_TOKEN, TG_CHAT } from './config.js';
import { loadTransactions } from './txn.js';
import { computeSummary } from './api.js';
import { ymd } from './util.js';

export async function sendDigest() {
  if (!TG_TOKEN || !TG_CHAT) return { sent: false };
  const txns = await loadTransactions();
  const month = ymd(new Date()).slice(0, 7);
  const s = computeSummary(txns, month);
  const open = txns.filter(t => t.status === 'NEEDS REVIEW' || t.status === 'PENDING').length;
  const text = `📊 Finance digest — ${month}\n` +
    `Business result: ₹${Math.round(s.businessIncome - Object.values(s.business).reduce((a, b) => a + b, 0)).toLocaleString('en-IN')}\n` +
    `Received: ₹${Math.round(s.received).toLocaleString('en-IN')} · Internal: ₹${Math.round(s.internal).toLocaleString('en-IN')}\n` +
    `Waiting for review: ${s.pendingCount} (${open} open rows)`;
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text })
  });
  if (!res.ok) throw new Error(`telegram ${res.status}`);
  return { sent: true };
}
