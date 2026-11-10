// ==========================================
// Ingest endpoint for the SMS/email forwarders (Android app, iOS Shortcut,
// Gmail). Accepts raw message text, parses it, and logs with dedup + rules.
//
// Query/POST shapes accepted:
//   GET  ?key=..&action=ingest&sms=<text>            (single SMS)
//   GET  ?key=..&src=KOTAK_SMS&sms=<text>            (legacy forwarder shape)
//   POST { key, action, sms: "<text>" }              (single SMS)
//   POST { key, action, sms: [{ text }, ...] }
//   POST { key, action, messages: [{ subject, body }] }
// ==========================================

import { parseKotak_, parseKotakSMS_, parseSMS_, parseSBISMS_ } from './parse.js';
import { logTransactions } from './txn.js';
import { loadRules } from './rules.js';
import { amountNum_, stampStr, isNonTxnSMS_ } from './util.js';

// The Source column mirrors the values already in the sheet: SMS-Kotak, SMS-BOI,
// SMS-SBI, Gmail-Kotak.
function sourceLabel(kind, account) {
  const bank = /sbi/i.test(account) ? 'SBI' : account;
  return `${kind}-${bank}`;
}

// Parsers are mutually exclusive by bank, so trying them in order is safe.
function parseText(text) {
  return parseKotakSMS_(text) || parseSBISMS_(text) || parseSMS_(text);
}

function smsTexts(sms) {
  if (typeof sms === 'string') return [sms];
  if (Array.isArray(sms)) return sms.map(s => (typeof s === 'string' ? s : String(s.text || s.body || '')));
  return [];
}

function toTxn(p, source) {
  return {
    loggedAt: stampStr(new Date()),
    date: p.date,
    direction: p.direction,
    amount: amountNum_(p.amount),
    counterparty: p.party || '',
    ref: p.ref || '',
    account: p.account || '',
    source: sourceLabel(source, p.account)
  };
}

export async function handleIngest({ messages, sms }) {
  const rules = await loadRules();
  const parsed = [];

  if (Array.isArray(messages)) {
    for (const m of messages) {
      const t = parseKotak_(m.subject || '', m.body || m.text || '');
      if (t) parsed.push(toTxn(t, 'Gmail'));
    }
  }

  for (const text of smsTexts(sms)) {
    if (!text || isNonTxnSMS_(text)) continue;
    const t = parseText(text);
    if (t) parsed.push(toTxn(t, 'SMS'));
  }

  const added = await logTransactions(parsed, rules);
  return { added: added.length, parsed: parsed.length };
}
