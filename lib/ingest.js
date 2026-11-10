// ==========================================
// Ingest endpoint for the hybrid Gmail/SMS forwarder. Accepts raw messages
// (Kotak email) and/or SMS text, parses them, and logs with dedup + rules.
// ==========================================

import { parseKotak_, parseKotakSMS_, parseSMS_, parseSBISMS_ } from './parse.js';
import { logTransactions } from './txn.js';
import { loadRules } from './rules.js';
import { amountNum_, stampStr } from './util.js';

function toTxn(p, source) {
  return {
    loggedAt: stampStr(new Date()),
    date: p.date,
    direction: p.direction,
    amount: amountNum_(p.amount),
    counterparty: p.party || '',
    ref: p.ref || '',
    account: p.account || '',
    source
  };
}

export async function handleIngest({ messages, sms }) {
  const rules = await loadRules();
  const parsed = [];

  if (Array.isArray(messages)) {
    for (const m of messages) {
      const t = parseKotak_(m.subject || '', m.body || m.text || '');
      if (t) parsed.push(toTxn(t, 'gmail'));
    }
  }

  if (Array.isArray(sms)) {
    for (const s of sms) {
      const text = String(s.text || s.body || '');
      const t = parseKotakSMS_(text) || parseSMS_(text) || parseSBISMS_(text);
      if (t) parsed.push(toTxn(t, 'sms'));
    }
  }

  const added = await logTransactions(parsed, rules);
  return { added: added.length };
}
