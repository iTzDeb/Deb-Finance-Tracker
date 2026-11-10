// ==========================================
// SMS / email parsers (ports of Code.gs). Pure functions: text in, txn out (or null).
// ==========================================

import { SBI_ACCOUNT } from './config.js';
import { normDate_ } from './util.js';

// Kotak email (backup)
export function parseKotak_(subject, body) {
  const amt = (body.match(/(?:Amount:\s*₹|INR\s*)([\d,]+\.\d{2})/) || [])[1];
  const ref = (body.match(/Reference Number(?: \(RRN\))?:\s*(\d{12})/) || [])[1];
  const date = (body.match(/Date:\s*([\w-]+)/) || [])[1];
  if (!amt || !ref) return null;
  const credit = /Credit/i.test(subject);
  const party = credit
    ? (body.match(/Sender:\s*(.+)/) || [])[1]
    : (body.match(/towards\s+(.+?)\s+through/) || [])[1];
  return { date: normDate_(date), direction: credit ? 'CREDIT' : 'DEBIT',
           amount: amt, party: (party || '').trim(), ref, account: 'Kotak' };
}

// Kotak SMS: "Sent Rs.X from XX7991 to NAME on DD-Mon-YY. UPI ref no. N"
export function parseKotakSMS_(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const amt = (t.match(/Rs\.?\s?([\d,]+\.\d{2})/) || [])[1];
  const ref = (t.match(/UPI ref(?: no\.?| number)?\.?\s*(\d{12})/i) || [])[1];
  const date = (t.match(/on (\d{2}-[A-Za-z]{3}-\d{2})/) || [])[1];
  if (!amt || !ref) return null;
  const isDebit = /\bSent Rs/i.test(t);
  const isCredit = /\bReceived Rs/i.test(t);
  if (!isDebit && !isCredit) return null;
  const party = isDebit
    ? ((t.match(/Sent Rs\.?\s?[\d,.]+ from \S+ to (.+?) on /i) || [])[1] || '')
    : ((t.match(/from (.+?) in your/i) || [])[1] || '');
  return { date: normDate_(date), direction: isDebit ? 'DEBIT' : 'CREDIT',
           amount: amt, party: party.trim(), ref, account: 'Kotak' };
}

// BOI SMS (iPhone Shortcut). Accepts UPI, IMPS and NEFT references.
export function parseSMS_(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const amt = (t.match(/Rs\.?\s?([\d,]+\.\d{2})/) || [])[1];
  const ref = (t.match(/(?:UPI|IMPS|NEFT)\s*ref(?:erence)?(?:\s*No\.?|\s*Number)?\.?\s*:?\s*(\d{9,})/i) || [])[1];
  const date = (t.match(/on (\d{2}-?(?:[A-Za-z]{3}|\d{2})-?\d{2})/) || [])[1];
  if (!amt || !ref) return null;
  const direction = /debited/i.test(t) ? 'DEBIT' : 'CREDIT';
  const party = direction === 'DEBIT'
    ? ((t.match(/credited to (.+?) via (?:UPI|IMPS|NEFT)/i) || [])[1] || '')
    : '';
  return { date: normDate_(date), direction, amount: amt, party: party.trim(), ref, account: 'BOI' };
}

// SBI SMS for the mother's current account (ending 2175)
export function parseSBISMS_(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const masked = (t.match(/\b[Xx]{2,}\s?(\d{4,})/) || [])[1];
  if (!masked || masked.slice(-4) !== '2175') return null;
  const amt = (t.match(/(?:Rs\.?|INR)\s?([\d,]+\.\d{2})/) || [])[1];
  const dm = t.match(/(\d{2})[\/-](\d{2})[\/-](\d{2})/);
  if (!amt || !dm) return null;
  const isDebit = /Debited/i.test(t);
  const isCredit = !isDebit && /credited/i.test(t);
  if (!isDebit && !isCredit) return null;
  const ref = isCredit ? ((t.match(/(?:IMPS|NEFT|UPI) ?Ref# ?(\d{9,})/i) || [])[1] || '') : '';
  const party = isDebit
    ? ((t.match(/Transferred to (.+?)\. Avl/i) || [])[1] || '')
    : ((t.match(/linked to mobile \S+?-(.+?) \((?:IMPS|NEFT|UPI)/i) || [])[1] || '');
  return {
    date: `20${dm[3]}-${dm[2]}-${dm[1]}`,
    direction: isDebit ? 'DEBIT' : 'CREDIT',
    amount: amt,
    party: party.trim(),
    ref,
    account: SBI_ACCOUNT
  };
}
