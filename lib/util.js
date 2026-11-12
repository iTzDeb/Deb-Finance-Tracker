// ==========================================
// Pure helpers (no I/O). Ports of the Code.gs helpers plus a few
// small additions needed for the Sheets API / JSONP port.
// ==========================================

import { timingSafeEqual } from 'node:crypto';

import { ALLOWED_BUCKETS, ALLOWED_CATEGORIES, NON_TXN_PATTERNS, PAYTM_BUSINESS } from './config.js';

export const TZ = 'Asia/Kolkata';

export function amountNum_(v) { return Number(String(v).replace(/,/g, '')); }
export function st_(v) { return String(v || '').trim().toUpperCase(); }
export function isNonTxnSMS_(text) { return NON_TXN_PATTERNS.some(re => re.test(text || '')); }

// ---------- Date formatting (Asia/Kolkata, matching the owner's Sheets) ----------
const DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const TIME_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

export function ymd(d) { return DATE_FMT.format(d); }                  // yyyy-MM-dd
export function stampStr(d) { return `${DATE_FMT.format(d)} ${TIME_FMT.format(d)}`; } // yyyy-MM-dd HH:mm

// Sheets stores dates as serial numbers (days since 1899-12-30) when read unformatted.
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
export function serialToDate(serial) {
  return new Date(SHEETS_EPOCH_UTC + Math.round(Number(serial) * 86400000));
}

// Sheets serials are wall-clock values: format them in UTC, not IST, or every
// timestamp shifts by +5:30 (and late-evening rows roll to the next day).
function pad2_(n) { return String(n).padStart(2, '0'); }
export function serialDate_(serial) {
  const d = serialToDate(serial);
  return `${d.getUTCFullYear()}-${pad2_(d.getUTCMonth() + 1)}-${pad2_(d.getUTCDate())}`;
}
export function serialStamp_(serial) {
  const d = serialToDate(serial);
  return `${serialDate_(serial)} ${pad2_(d.getUTCHours())}:${pad2_(d.getUTCMinutes())}`;
}

// A cell from column A/B that may be a Date serial, an ISO string, or dd-Mon-yy text.
export function cellToDateStr(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && isFinite(v)) return serialDate_(v);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return normDate_(s);
}

// A cell from column A that may be a Date serial; returns yyyy-MM-dd HH:mm.
export function cellToStampStr(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && isFinite(v)) return serialStamp_(v);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

export function dayStr_(v) {
  return v instanceof Date
    ? ymd(v)
    : String(v).trim();
}

export function normDate_(s) {
  const m = (s || '').match(/(\d{2})[-.\s\/]?([A-Za-z]{3}|\d{2})[-.\s\/]?(\d{2,4})/);
  if (!m) return s;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mon = /\d/.test(m[2]) ? parseInt(m[2], 10) : months.indexOf(m[2].toLowerCase()) + 1;
  const year = m[3].length === 4 ? m[3] : `20${m[3]}`;
  return `${year}-${String(mon).padStart(2, '0')}-${m[1]}`;
}

// Rule key: letters only, titles removed, first 9 letters.
export function normKey_(name) {
  return String(name || '').toUpperCase()
    .replace(/\b(MR|MRS|MS|MISS|SHRI|SMT)\b\.?/g, '')
    .replace(/[^A-Z]/g, '')
    .slice(0, 9);
}

// Matches "INTERNAL" or "internal" to "Internal", and so on
export function pickAllowed_(value, list) {
  const v = String(value || '').trim().toLowerCase();
  return list.find(x => x.toLowerCase() === v) || String(value || '').trim();
}
export function normBucket_(v) { return pickAllowed_(v, ALLOWED_BUCKETS); }
export function normCategory_(v) { return pickAllowed_(v, ALLOWED_CATEGORIES); }

// The payee key the frontend uses for grouping in the Pending view (bulkSave).
export function pendingPayeeKey(payee) {
  return String(payee || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Sheets stores a numeric ref without its leading zeros, so compare refs
// through this normaliser.
export function normRef_(ref) {
  const s = String(ref || '').trim();
  return /^\d+$/.test(s) ? (s.replace(/^0+/, '') || '0') : s;
}

// Banks truncate UPI names ("DEB ZY" for "DEB ZYOTI DAS"). If `name` is a
// strict prefix of exactly one known full name, return that full name.
// Strips the account text some alerts append to a payee
// ("DEB ZYOTI DAS in your Kotak811 a/c XX7991").
export function cleanPayeeName(name) {
  return String(name || '').replace(/\s+in your .*?a\/c\s*[Xx*]*\d+.*$/i, '').trim();
}

export function canonicalPayee(name, knownNames = [], direction = '') {
  const value = String(name || '').trim();
  if (value.length < 3) return value;
  const flat = value.toUpperCase().replace(/\s+/g, ' ');
  if (String(direction).toUpperCase() === 'CREDIT' && (flat === 'PAYTM' || flat === 'PAYTM PAYMENTS SERVICES')) return PAYTM_BUSINESS;
  const up = value.toUpperCase();
  const knownList = Array.from(knownNames || []).map(k => String(k || '').trim()).filter(Boolean);
  // If the value is already a complete known name, keep it (do not expand a
  // short name like "Asit" into "ASIT DAS").
  const exact = knownList.find(k => k.toUpperCase() === up);
  if (exact) return exact;
  let match = null;
  for (const k of knownList) {
    if (!k || k.toUpperCase() === up) continue;
    if (k.toUpperCase().startsWith(up)) {
      if (match && match.toUpperCase() !== k.toUpperCase()) return value; // ambiguous
      match = k;
    }
  }
  return match || value;
}

// Composite dedup key: date | direction | amount (toFixed 2).
export function compositeKey_(date, direction, amount) {
  return [dayStr_(date), direction, amountNum_(amount).toFixed(2)].join('|');
}

// Totals identical to the frontend historySum() so server + client totals agree.
export function historyTotals(items) {
  const totals = { sent: 0, received: 0, business: 0, personal: 0, internal: 0 };
  items.forEach(item => {
    if (String(item.status || '').toUpperCase() === 'FORGOTTEN') return;
    const amount = Number(item.amount) || 0;
    const bucket = String(item.bucket || '').toLowerCase();
    if (bucket === 'internal') totals.internal += amount;
    else if (item.direction === 'DEBIT') totals.sent += amount;
    else if (item.direction === 'CREDIT') totals.received += amount;
    if (item.direction === 'DEBIT' && bucket === 'business') totals.business += amount;
    if (item.direction === 'DEBIT' && bucket === 'personal') totals.personal += amount;
  });
  return totals;
}

// Sanitises a value for JSONP callback safety (the frontend validates the name).
export function safeCallback(name) {
  return /^[A-Za-z_$][\w$]*$/.test(String(name || '')) ? name : null;
}

// Compares secrets without leaking length/content through timing.
export function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Request params for /api/exec. Apps Script merged query params (e.parameter)
// with the posted body, and forwarders relied on that, so the Vercel port must
// do the same: key in the query string, SMS as JSON, form-urlencoded or raw text.
export function readRequestParams(method, url, body) {
  const query = Object.fromEntries(new URL(url || '/', 'http://localhost').searchParams);
  if (method === 'GET') return query;
  let parsed = body;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(parsed)) parsed = parsed.toString('utf8');
  if (typeof parsed === 'string') {
    const text = parsed.trim();
    try { parsed = JSON.parse(text); }
    catch {
      parsed = text.includes('=') ? Object.fromEntries(new URLSearchParams(text)) : { sms: text };
    }
  }
  return parsed && typeof parsed === 'object' ? { ...query, ...parsed } : query;
}
