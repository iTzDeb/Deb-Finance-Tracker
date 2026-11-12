// ==========================================
// Telegram conversation bot. It asks about new payees, turns a confirmed reply
// into a trusted rule (with /undo), and answers date-scoped commands.
// ==========================================

import { randomUUID } from 'node:crypto';

import {
  ALLOWED_BUCKETS, ALLOWED_CATEGORIES,
  TG_CHAT, TG_WEBHOOK_SECRET, DEEPSEEK_KEY,
  REVIEW, PENDING, CONFIRMED, FORGOTTEN
} from './config.js';
import { ensureTab, readRange, writeRange, appendRows } from './sheet.js';
import { loadTransactions, loadTransactionRows, updateTransactionRows } from './txn.js';
import { loadRules, matchRule, saveRule, clearRule, normDirection_ } from './rules.js';
import { addCategory, loadCategories, removeCategory } from './categories.js';
import { normKey_, normRef_, ymd, stampStr } from './util.js';
import { askJSON } from './llm.js';
import * as tg from './telegram.js';

const Q_TAB = 'BotQuestions';
const L_TAB = 'BotLog';
const S_TAB = 'BotState';

// Registered with setMyCommands so Telegram shows the blue Menu button.
export const BOT_COMMANDS = [
  { command: 'pending', description: 'Open questions and suggested buckets' },
  { command: 'ask', description: 'Ask about open payees now' },
  { command: 'summary', description: "This month's received, spent and pending" },
  { command: 'spend', description: 'Spend for a category this month' },
  { command: 'rules', description: 'List rules and their trusted state' },
  { command: 'forget', description: "Mark a payee's open rows FORGOTTEN" },
  { command: 'undo', description: 'Undo the last rule or forget' },
  { command: 'pause', description: 'Pause new questions' },
  { command: 'resume', description: 'Resume questions' },
  { command: 'status', description: 'Bot status and counts' },
  { command: 'help', description: 'How to use the bot' }
];
const Q_HEADERS = ['Id', 'Chat', 'Message', 'Key', 'Payee', 'Refs', 'Evidence', 'Suggestion', 'Status', 'Created', 'Resolved'];
const L_HEADERS = ['Id', 'At', 'Action', 'Payload', 'Before', 'After', 'Status'];
const S_HEADERS = ['Key', 'Value'];
const Q_COLS = Q_HEADERS.length;
const L_COLS = L_HEADERS.length;
const OPEN = [REVIEW, PENDING];

const pad2 = n => String(n).padStart(2, '0');
const inr = n => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const esc = tg.escapeHtml;

let tabsReady = null;
async function ensureTabs() {
  if (!tabsReady) {
    tabsReady = (async () => {
      await ensureTab(Q_TAB, Q_HEADERS);
      await ensureTab(L_TAB, L_HEADERS);
      await ensureTab(S_TAB, S_HEADERS);
    })().catch(err => { tabsReady = null; throw err; });
  }
  return tabsReady;
}

function safeJson(text) {
  try { return text ? JSON.parse(text) : null; } catch (err) { return null; }
}

export function pickAllowed(value, list) {
  const v = String(value || '').trim().toLowerCase();
  return list.find(x => x.toLowerCase() === v) || '';
}

export function parseCommand(text) {
  const m = String(text || '').trim().match(/^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), args: (m[2] || '').trim() };
}

export function parsePeriod(args, today = ymd(new Date())) {
  const s = String(args || '').trim().toLowerCase();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const month = (yy, mm) => {
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return { from: yy + '-' + pad2(mm) + '-01', to: yy + '-' + pad2(mm) + '-' + pad2(last), label: yy + '-' + pad2(mm) };
  };
  if (!s) return month(y, m);
  if (/^\d{4}-\d{2}$/.test(s)) {
    const parts = s.split('-').map(Number);
    return parts[1] >= 1 && parts[1] <= 12 ? month(parts[0], parts[1]) : null;
  }
  if (/^\d{4}$/.test(s)) return { from: s + '-01-01', to: s + '-12-31', label: s };
  const range = s.match(/^(\d{4}-\d{2}-\d{2})(?:\.\.|\s+)(\d{4}-\d{2}-\d{2})$/);
  if (range) {
    return range[1] <= range[2] ? { from: range[1], to: range[2], label: range[1] + ' → ' + range[2] } : null;
  }
  if (s === 'today') return { from: today, to: today, label: 'today' };
  if (s === 'yesterday') {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    const key = d.toISOString().slice(0, 10);
    return { from: key, to: key, label: 'yesterday' };
  }
  if (s === 'this month') return month(y, m);
  if (s === 'last month') {
    const d = new Date(Date.UTC(y, m - 2, 1));
    return month(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
  if (s === 'last 30' || s === 'last 30 days') {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 29);
    return { from: d.toISOString().slice(0, 10), to: today, label: 'last 30 days' };
  }
  return null;
}

export function splitSpendArgs(args) {
  const s = String(args || '').trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  for (const n of [3, 2, 1]) {
    if (tokens.length > n) {
      const p = parsePeriod(tokens.slice(-n).join(' '));
      if (p) return { category: tokens.slice(0, -n).join(' '), period: p };
    }
  }
  return { category: s, period: parsePeriod('') };
}

export function matchCategory(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return '';
  const exact = ALLOWED_CATEGORIES.find(c => c.toLowerCase() === q);
  if (exact) return exact;
  const hits = ALLOWED_CATEGORIES.filter(c => c.toLowerCase().includes(q) || q.includes(c.toLowerCase()));
  return hits.length === 1 ? hits[0] : '';
}

function groupByKey(txns) {
  const groups = new Map();
  for (const t of txns) {
    const key = normKey_(t.counterparty);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return groups;
}

function evidenceFor(txns) {
  const amounts = new Map();
  for (const t of txns) {
    const a = Number(t.amount) || 0;
    amounts.set(a, (amounts.get(a) || 0) + 1);
  }
  const entries = [...amounts.entries()].sort((a, b) => a[0] - b[0]);
  const parts = entries.slice(0, 4).map(e => inr(e[0]) + '×' + e[1]);
  const total = entries.reduce((sum, e) => sum + e[0] * e[1], 0);
  const dates = txns.map(t => t.date).sort();
  const span = dates.length ? ' (' + dates[0] + ' → ' + dates[dates.length - 1] + ')' : '';
  const more = entries.length > 4 ? ' · …' : '';
  return txns.length + ' payment' + (txns.length === 1 ? '' : 's') + span + ' · ' + parts.join(' · ') + more + ' · total ' + inr(total);
}

async function stateAll() {
  await ensureTabs();
  const rows = await readRange(S_TAB, null, 1, 2);
  const map = new Map();
  for (const row of rows.slice(1)) if (row[0]) map.set(String(row[0]), String(row[1] ?? ''));
  return map;
}
async function stateGet(key) { return (await stateAll()).get(key) || ''; }
async function stateSet(key, value) {
  const rows = await readRange(S_TAB, null, 1, 2);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === key) {
      await writeRange(S_TAB, i + 1, 1, [[key, String(value)]]);
      return;
    }
  }
  await appendRows(S_TAB, [[key, String(value)]]);
}

function questionFromRow(row) {
  return {
    id: String(row[0] || ''), chat: String(row[1] || ''), message: String(row[2] || ''),
    key: String(row[3] || ''), payee: String(row[4] || ''),
    refs: String(row[5] || '').split(',').filter(Boolean),
    evidence: String(row[6] || ''), suggestion: safeJson(row[7]),
    status: String(row[8] || ''), created: String(row[9] || ''), resolved: String(row[10] || '')
  };
}
async function loadQuestions() {
  await ensureTabs();
  const rows = await readRange(Q_TAB, null, 1, Q_COLS);
  return rows.slice(1).filter(r => r[0]).map(questionFromRow);
}
async function findQuestion(id) {
  return (await loadQuestions()).find(q => q.id === String(id)) || null;
}
async function findQuestionByMessage(messageId) {
  return (await loadQuestions()).find(q => q.message === String(messageId) && q.status === 'open') || null;
}
async function addQuestion(q) {
  await appendRows(Q_TAB, [[
    q.id, q.chat, q.message, q.key, q.payee, q.refs.join(','), q.evidence,
    q.suggestion ? JSON.stringify(q.suggestion) : '', 'open', q.created, ''
  ]]);
}
async function setQuestionStatus(id, status) {
  const rows = await readRange(Q_TAB, null, 1, Q_COLS);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === id) {
      const row = Array.from({ length: Q_COLS }, (_, j) => rows[i][j] ?? '');
      row[8] = status;
      row[10] = stampStr(new Date());
      await writeRange(Q_TAB, i + 1, 1, [row]);
      return;
    }
  }
}

function logFromRow(row) {
  return {
    id: String(row[0] || ''), at: String(row[1] || ''), action: String(row[2] || ''),
    payload: safeJson(row[3]) || {}, before: safeJson(row[4]), after: safeJson(row[5]),
    status: String(row[6] || '')
  };
}
async function addLog({ action, payload, before, after, status }) {
  const id = randomUUID().replace(/-/g, '').slice(0, 10);
  await appendRows(L_TAB, [[id, stampStr(new Date()), action, JSON.stringify(payload || {}),
    JSON.stringify(before ?? null), JSON.stringify(after ?? null), status]]);
  return id;
}
async function getLog(id) {
  const rows = await readRange(L_TAB, null, 1, L_COLS);
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === id) return logFromRow(rows[i]);
  return null;
}
async function setLog(id, patch) {
  const rows = await readRange(L_TAB, null, 1, L_COLS);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === id) {
      const row = Array.from({ length: L_COLS }, (_, j) => rows[i][j] ?? '');
      if (patch.before !== undefined) row[4] = JSON.stringify(patch.before);
      if (patch.after !== undefined) row[5] = JSON.stringify(patch.after);
      if (patch.status !== undefined) row[6] = patch.status;
      await writeRange(L_TAB, i + 1, 1, [row]);
      return;
    }
  }
}
async function lastAppliedLog() {
  const rows = await readRange(L_TAB, null, 1, L_COLS);
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][6]) === 'applied') return logFromRow(rows[i]);
  }
  return null;
}

// ---------- rule apply / undo ----------
export async function applyRule({ payee, bucket, category, property = '', trusted = true, direction = '', note = '', hide = null, scope = 'open' }) {
  const bucketName = pickAllowed(bucket, ALLOWED_BUCKETS);
  const categoryName = pickAllowed(category, ALLOWED_CATEGORIES) || String(category || '').trim();
  if (!bucketName) throw new Error('invalid bucket');
  if (!categoryName) throw new Error('invalid category');
  const key = normKey_(payee);
  if (!key) throw new Error('payee required');
  const dir = normDirection_(direction);
  const prev = matchRule(await loadRules(), payee, dir);
  const rows = await loadTransactionRows();
  const targets = rows.filter(r => normKey_(r.txn.counterparty) === key && (scope === 'all' || OPEN.includes(r.txn.status)) && (!dir || r.txn.direction === dir));
  const before = {
    rule: prev ? { name: prev.name, bucket: prev.bucket, category: prev.category, property: prev.property, trusted: prev.trusted, direction: prev.direction } : null,
    rows: targets.map(r => ({ ref: r.txn.ref, status: r.txn.status, bucket: r.txn.bucket, category: r.txn.category, property: r.txn.property, notes: r.txn.notes, hidden: !!r.txn.hidden }))
  };
  // A direction-specific rule should not be shadowed by an older both-directions
  // rule for the same payee: retire the both rule so "credits only" is exact.
  if (dir && prev && !prev.direction) {
    try { await clearRule(payee, ''); } catch (err) { console.error('[bot] clear bare rule failed:', err.message); }
  }
  await saveRule(payee, bucketName, categoryName, property, trusted, dir);
  await addCategory(categoryName);
  for (const r of targets) {
    r.txn.bucket = bucketName;
    r.txn.category = categoryName;
    r.txn.property = property;
    if (note) r.txn.notes = note;
    if (hide !== null && hide !== undefined) r.txn.hidden = !!hide;
    r.txn.status = CONFIRMED;
  }
  await updateTransactionRows(targets);
  return { updated: targets.length, before };
}

export async function undoLast() {
  const log = await lastAppliedLog();
  if (!log) return { undone: false, message: 'Nothing to undo.' };
  if (log.action === 'forget') {
    const rows = (log.before && log.before.rows) || [];
    if (rows.length) {
      const current = await loadTransactionRows();
      const byRef = new Map(current.map(r => [normRef_(r.txn.ref), r]));
      const updates = [];
      for (const b of rows) {
        const r = byRef.get(normRef_(b.ref));
        if (!r) continue;
        r.txn.status = b.status;
        updates.push(r);
      }
      await updateTransactionRows(updates);
    }
    await setLog(log.id, { status: 'undone' });
    return { undone: true, payee: log.payload && log.payload.payee, rows: rows.length, kind: 'forget' };
  }
  if (log.action === 'hide') {
    const rows = (log.before && log.before.rows) || [];
    if (rows.length) {
      const current = await loadTransactionRows();
      const byRef = new Map(current.map(r => [normRef_(r.txn.ref), r]));
      const updates = [];
      for (const b of rows) {
        const r = byRef.get(normRef_(b.ref));
        if (!r) continue;
        r.txn.hidden = !!b.hidden;
        updates.push(r);
      }
      await updateTransactionRows(updates);
    }
    await setLog(log.id, { status: 'undone' });
    return { undone: true, payee: ((log.payload && log.payload.payees) || []).join(', '), rows: rows.length, kind: 'hide' };
  }
  if (log.action === 'bulk') {
    const rows = (log.before && log.before.rows) || [];
    if (rows.length) {
      const current = await loadTransactionRows();
      const byRef = new Map(current.map(r => [normRef_(r.txn.ref), r]));
      const updates = [];
      for (const b of rows) {
        const r = byRef.get(normRef_(b.ref));
        if (!r) continue;
        r.txn.status = b.status;
        r.txn.bucket = b.bucket;
        r.txn.category = b.category;
        r.txn.property = b.property;
        if (b.notes !== undefined) r.txn.notes = b.notes;
        if (typeof b.hidden === 'boolean') r.txn.hidden = b.hidden;
        updates.push(r);
      }
      await updateTransactionRows(updates);
    }
    await setLog(log.id, { status: 'undone' });
    return { undone: true, payee: '', rows: rows.length, kind: 'bulk' };
  }
  if (log.action !== 'rule') return { undone: false, message: 'The last action cannot be undone here.' };
  const payee = log.payload && log.payload.payee;
  if (!payee) return { undone: false, message: 'Undo data is incomplete.' };
  const before = log.before || {};
  const appliedDir = (log.payload && log.payload.direction) || '';
  if (before.rule) {
    const r = before.rule;
    await saveRule(r.name || payee, r.bucket, r.category, r.property, r.trusted, r.direction || '');
    if (appliedDir && appliedDir !== (r.direction || '')) {
      try { await clearRule(payee, appliedDir); } catch (err) { /* ignore */ }
    }
  } else {
    await clearRule(payee, appliedDir);
  }
  const rows = before.rows || [];
  if (rows.length) {
    const current = await loadTransactionRows();
    const byRef = new Map(current.map(r => [normRef_(r.txn.ref), r]));
    const updates = [];
    for (const b of rows) {
      const r = byRef.get(normRef_(b.ref));
      if (!r) continue;
      r.txn.status = b.status;
      r.txn.bucket = b.bucket;
      r.txn.category = b.category;
      r.txn.property = b.property;
      if (b.notes !== undefined) r.txn.notes = b.notes;
      if (typeof b.hidden === 'boolean') r.txn.hidden = b.hidden;
      updates.push(r);
    }
    await updateTransactionRows(updates);
  }
  await setLog(log.id, { status: 'undone' });
  return { undone: true, payee, rows: rows.length };
}

export async function forgetPayee(payee) {
  const key = normKey_(payee);
  if (!key) throw new Error('payee required');
  const rows = await loadTransactionRows();
  const targets = rows.filter(r => normKey_(r.txn.counterparty) === key && OPEN.includes(r.txn.status));
  const before = targets.map(r => ({ ref: r.txn.ref, status: r.txn.status }));
  for (const r of targets) r.txn.status = FORGOTTEN;
  await updateTransactionRows(targets);
  return { updated: targets.length, before };
}

// ---------- detection / questions ----------
async function askForGroup({ key, payee, txns, suggestion }) {
  const id = randomUUID().replace(/-/g, '').slice(0, 8);
  const evidence = evidenceFor(txns);
  const lines = ['🏷️ <b>' + esc(payee) + '</b>', esc(evidence)];
  if (suggestion) lines.push('Suggestion: ' + esc(suggestion.bucket) + ' / ' + esc(suggestion.category));
  lines.push('', 'Which bucket?');
  const keyboard = [];
  if (suggestion && pickAllowed(suggestion.bucket, ALLOWED_BUCKETS) && String(suggestion.category || '').trim()) {
    keyboard.push([{ text: '✅ ' + suggestion.bucket + ' / ' + suggestion.category, callback_data: 'q:' + id + ':s' }]);
  }
  keyboard.push([{ text: 'Personal', callback_data: 'q:' + id + ':b:Personal' }, { text: 'Business', callback_data: 'q:' + id + ':b:Business' }]);
  keyboard.push([{ text: 'Internal', callback_data: 'q:' + id + ':b:Internal' }, { text: 'Ignore', callback_data: 'q:' + id + ':i' }]);
  keyboard.push([{ text: 'Forget', callback_data: 'q:' + id + ':f' }, { text: 'Something else…', callback_data: 'q:' + id + ':x' }]);
  const msg = await tg.sendMessage(lines.join('\n'), { inline_keyboard: keyboard });
  await addQuestion({ id, chat: String(TG_CHAT), message: String(msg.message_id), key, payee,
    refs: txns.slice(0, 50).map(t => t.ref), evidence, suggestion, created: stampStr(new Date()) });
}

export async function notifyTransactions(txns, options = {}) {
  const limit = Number(options.limit) || 2;
  const force = !!options.force;
  if (!tg.botConfigured() || !txns.length) return { asked: 0 };
  try {
    await ensureTabs();
    const state = await stateAll();
    if (state.get('paused') === '1') return { asked: 0 };
    const rules = await loadRules();
    const questions = await loadQuestions();
    const openKeys = new Set(questions.filter(q => q.status === 'open').map(q => q.key));
    const now = Date.now();
    const asked = new Map();
    const ignored = new Map();
    for (const item of state) {
      if (item[0].startsWith('asked:')) asked.set(item[0].slice(6), Number(item[1]) || 0);
      if (item[0].startsWith('ignore:')) ignored.set(item[0].slice(7), Number(item[1]) || 0);
    }
    let count = 0;
    for (const entry of groupByKey(txns)) {
      if (count >= limit) break;
      const key = entry[0];
      const group = entry[1];
      if (rules.get(key) && rules.get(key).trusted) continue;
      if (openKeys.has(key)) continue;
      if (now - (ignored.get(key) || 0) < 7 * 86400000) continue;
      if (!force && now - (asked.get(key) || 0) < 7 * 86400000) continue;
      const withSuggestion = group.find(t => t.suggestedBucket && t.suggestedCategory);
      const suggestion = withSuggestion ? { bucket: withSuggestion.suggestedBucket, category: withSuggestion.suggestedCategory } : null;
      await askForGroup({ key, payee: group[0].counterparty, txns: group, suggestion });
      await stateSet('asked:' + key, String(now));
      count++;
    }
    return { asked: count };
  } catch (err) {
    console.error('[bot] notify failed:', err.message);
    return { asked: 0, error: err.message };
  }
}

export async function notifyImport(added) {
  if (!tg.botConfigured() || !added.length) return;
  try {
    const groups = groupByKey(added);
    const rules = await loadRules();
    let unknown = 0;
    for (const entry of groups) if (!(rules.get(entry[0]) && rules.get(entry[0]).trusted)) unknown++;
    if (added.length > 5) {
      await tg.sendMessage('📥 Imported <b>' + added.length + '</b> transactions. <b>' + unknown + '</b> payees have no trusted rule. Send /ask to review them.');
    } else {
      await notifyTransactions(added, { limit: 3 });
    }
  } catch (err) {
    console.error('[bot] import notify failed:', err.message);
  }
}

export async function askPending(options = {}) {
  const limit = Number(options.limit) || 5;
  const rows = await loadTransactionRows();
  const open = rows.map(r => r.txn).filter(t => OPEN.includes(t.status));
  return notifyTransactions(open, { limit, force: true });
}

// ---------- commands ----------
function helpText() {
  return [
    '🤖 <b>Finance bot</b>',
    '/pending — open rows and top payees',
    '/ask [period] — send questions now',
    '/summary [period] — month/range totals',
    '/spend &lt;category&gt; [period] — category spend',
    '/rules — list rules',
    '/forget &lt;payee&gt; — mark open rows FORGOTTEN',
    '/undo — reverse the last applied rule, forget or hide',
    '/pause, /resume — stop/start new questions',
    '/status — bot state',
    '',
    '',
    'Or just reply in plain English: set a bucket/category, hide payees from the family view, or add/remove categories.',
    'Periods: 2026-11 · 2026 · 2026-10-01..2026-11-12 · today · last month · last 30 days'
  ].join('\n');
}

async function cmdHelp() { return tg.sendMessage(helpText()); }

async function cmdPending() {
  const txns = (await loadTransactionRows()).map(r => r.txn);
  const open = txns.filter(t => OPEN.includes(t.status));
  const groups = [...groupByKey(open).values()]
    .map(g => ({ payee: g[0].counterparty, n: g.length, total: g.reduce((s, t) => s + (Number(t.amount) || 0), 0) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  const lines = ['📋 <b>Open rows:</b> ' + open.length];
  for (const g of groups) lines.push('• ' + esc(g.payee) + ' — ' + g.n + ' × ' + inr(g.total));
  if (!groups.length) lines.push('Nothing waiting.');
  lines.push('', 'Use /ask to send questions.');
  return tg.sendMessage(lines.join('\n'));
}

async function cmdAsk(args) {
  const period = parsePeriod(args);
  if (!period) return tg.sendMessage('Period? e.g. /ask 2026-11 or /ask 2026-10-01..2026-11-12');
  const rows = await loadTransactionRows();
  const open = rows.map(r => r.txn).filter(t => OPEN.includes(t.status) && t.date >= period.from && t.date <= period.to);
  const res = await notifyTransactions(open, { limit: 10, force: true });
  return tg.sendMessage(res.asked ? 'Sent ' + res.asked + ' question' + (res.asked === 1 ? '' : 's') + '.' : 'Nothing new to ask.');
}

function summaryFor(txns, period) {
  const rows = txns.filter(t => t.date >= period.from && t.date <= period.to && t.status !== FORGOTTEN);
  const biz = {};
  const per = {};
  let bizIncome = 0;
  let received = 0;
  let internal = 0;
  let pending = 0;
  for (const t of rows) {
    const amount = Number(t.amount) || 0;
    if (OPEN.includes(t.status)) pending++;
    if (t.bucket === 'Internal') { internal += amount; continue; }
    if (t.direction === 'CREDIT') {
      received += amount;
      if (t.bucket === 'Business') bizIncome += amount;
      continue;
    }
    const cat = t.category || 'Other';
    if (t.bucket === 'Business') biz[cat] = (biz[cat] || 0) + amount;
    else if (t.bucket === 'Personal') per[cat] = (per[cat] || 0) + amount;
  }
  const sum = obj => Object.values(obj).reduce((a, b) => a + b, 0);
  const bizOut = sum(biz);
  const perOut = sum(per);
  const net = bizIncome - bizOut;
  return [
    '📊 <b>' + esc(period.label) + '</b>',
    'Business result: <b>' + (net < 0 ? '−' : '') + inr(Math.abs(net)) + '</b>',
    'Income ' + inr(bizIncome) + ' · Business spend ' + inr(bizOut),
    'Received ' + inr(received) + ' · Personal ' + inr(perOut),
    'Internal ' + inr(internal) + ' · Open rows ' + pending
  ].join('\n');
}

async function cmdSummary(args) {
  const period = parsePeriod(args);
  if (!period) return tg.sendMessage('Period? e.g. /summary 2026-11 or /summary 2026-10-01..2026-11-12');
  return tg.sendMessage(summaryFor(await loadTransactions(), period));
}

async function cmdSpend(args) {
  const split = splitSpendArgs(args);
  if (!split.category) return tg.sendMessage('Usage: /spend &lt;category&gt; [period]');
  const category = matchCategory(split.category);
  if (!category) return tg.sendMessage('Category? One of: ' + ALLOWED_CATEGORIES.join(', '));
  const period = split.period;
  const txns = await loadTransactions();
  const rows = txns.filter(t => t.direction === 'DEBIT' && t.category === category && t.status !== FORGOTTEN && t.date >= period.from && t.date <= period.to);
  const total = rows.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  return tg.sendMessage('💸 <b>' + esc(category) + '</b> · ' + esc(period.label) + '\n' + rows.length + ' payments · ' + inr(total));
}

async function cmdRules() {
  const list = [...(await loadRules()).values()];
  const trusted = list.filter(r => r.trusted).length;
  const lines = ['📚 <b>Rules:</b> ' + list.length + ' (' + trusted + ' trusted)'];
  for (const r of list.slice(0, 15)) {
    const dir = r.direction === 'CREDIT' ? ' · credits' : r.direction === 'DEBIT' ? ' · debits' : '';
    lines.push('• ' + esc(r.name) + ' → ' + esc(r.bucket) + ' / ' + esc(r.category) + dir + (r.trusted ? ' ✅' : ''));
  }
  if (list.length > 15) lines.push('…and ' + (list.length - 15) + ' more.');
  return tg.sendMessage(lines.join('\n'));
}

async function cmdUndo() {
  const res = await undoLast();
  if (!res.undone) return tg.sendMessage(res.message);
  if (res.kind === 'forget') return tg.sendMessage('Undone: ' + res.rows + ' forgotten row(s) restored for <b>' + esc(res.payee) + '</b>.');
  if (res.kind === 'hide') return tg.sendMessage('Undone: ' + res.rows + ' transaction(s) restored for <b>' + esc(res.payee) + '</b>.');
  if (res.kind === 'bulk') return tg.sendMessage('Undone: ' + res.rows + ' transaction(s) restored.');
  return tg.sendMessage('Undone: rule for <b>' + esc(res.payee) + '</b> reverted' + (res.rows ? ', ' + res.rows + ' row' + (res.rows === 1 ? '' : 's') + ' restored' : '') + '.');
}

async function cmdForget(args) {
  const name = String(args || '').trim();
  if (!name) return tg.sendMessage('Usage: /forget <payee>');
  const payee = await findOpenPayee(name);
  if (!payee) return tg.sendMessage('No open rows for that payee.');
  const res = await forgetPayee(payee);
  try {
    await addLog({ action: 'forget', payload: { payee }, before: { rows: res.before }, after: { updated: res.updated }, status: 'applied' });
  } catch (err) { console.error('[bot] log failed:', err.message); }
  await stateSet('ignore:' + normKey_(payee), String(Date.now()));
  return tg.sendMessage('Forgotten <b>' + esc(payee) + '</b>: ' + res.updated + ' open row(s). /undo to restore.');
}

async function cmdStatus() {
  const state = await stateAll();
  const questions = await loadQuestions();
  const open = questions.filter(q => q.status === 'open').length;
  return tg.sendMessage([
    '🤖 Bot: ' + (tg.botConfigured() ? 'on' : 'off') + ' · AI: ' + (DEEPSEEK_KEY ? 'DeepSeek (primary)' : 'Gemini'),
    'Open questions: ' + open,
    'Paused: ' + (state.get('paused') === '1' ? 'yes' : 'no'),
    'Last update: ' + (state.get('last_update_id') || '—')
  ].join('\n'));
}

export async function handleCommand(text) {
  const parsed = parseCommand(text);
  if (!parsed) return false;
  switch (parsed.cmd) {
    case 'start':
    case 'help': return cmdHelp();
    case 'pending': return cmdPending();
    case 'ask': return cmdAsk(parsed.args);
    case 'summary': return cmdSummary(parsed.args);
    case 'spend': return cmdSpend(parsed.args);
    case 'rules': return cmdRules();
    case 'undo': return cmdUndo();
    case 'forget': return cmdForget(parsed.args);
    case 'pause':
      await stateSet('paused', '1');
      return tg.sendMessage('Paused. I will not ask about new payees until /resume.');
    case 'resume':
      await stateSet('paused', '0');
      return tg.sendMessage('Resumed.');
    case 'status': return cmdStatus();
    default: return tg.sendMessage('Unknown command. /help');
  }
}

// ---------- free text / LLM ----------
// Last few owner messages, so corrections like "no, personal not business"
// survive into the next message (the bot has no chat transcript otherwise).
async function recentMessages(chat) {
  try {
    const raw = await stateGet('conv:' + chat);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(-6) : [];
  } catch (err) { return []; }
}
async function rememberMessage(chat, text) {
  const list = await recentMessages(chat);
  list.push(String(text || '').slice(0, 400));
  try { await stateSet('conv:' + chat, JSON.stringify(list.slice(-6))); } catch (err) { /* ignore */ }
}

async function findOpenPayee(name) {
  const key = normKey_(name || '');
  if (!key) return null;
  const txns = (await loadTransactionRows()).map(r => r.txn);
  const open = txns.filter(t => OPEN.includes(t.status) && normKey_(t.counterparty));
  const hit = open.find(t => normKey_(t.counterparty) === key)
    || open.find(t => normKey_(t.counterparty).startsWith(key) || key.startsWith(normKey_(t.counterparty)));
  return hit ? hit.counterparty : null;
}

// Any payee, regardless of open/confirmed; also matches a raw ref string
// (e.g. "500312789665/112026") whose normKey_ is empty.
async function findPayee(name) {
  const value = String(name || '').trim();
  if (!value) return null;
  const key = normKey_(value);
  const raw = value.toUpperCase();
  const txns = (await loadTransactionRows()).map(r => r.txn);
  if (key) {
    const hit = txns.find(t => normKey_(t.counterparty) === key)
      || txns.find(t => { const k = normKey_(t.counterparty); return k && (k.startsWith(key) || key.startsWith(k)); });
    if (hit) return hit.counterparty;
  }
  const rawHit = txns.find(t => String(t.counterparty || '').toUpperCase().includes(raw)
    || String(t.ref || '').toUpperCase().includes(raw));
  return rawHit ? rawHit.counterparty : null;
}

function periodFromData(p) {
  if (p && /^\d{4}-\d{2}-\d{2}$/.test(p.from) && /^\d{4}-\d{2}-\d{2}$/.test(p.to) && p.from <= p.to) {
    return { from: p.from, to: p.to, label: p.from + ' → ' + p.to };
  }
  return parsePeriod('');
}

function intentPrompt(text, question, categories, history) {
  const allowed = (Array.isArray(categories) && categories.length) ? categories : ALLOWED_CATEGORIES;
  const context = question
    ? 'The owner replied to a question about the payee "' + question.payee + '" (key ' + question.key + ').\nEvidence: ' + question.evidence + '.'
    : 'No specific question; this is a general message.';
  const recent = (history && history.length) ? history.map(h => '"' + h + '"').join(' → ') : '(none)';
  return 'You are the finance bot for a single owner. ' + context + '\n' +
    'Owner message: "' + text + '"\n' +
    'Recent owner messages (oldest first): ' + recent + '\n\n' +
    'Allowed buckets: ' + ALLOWED_BUCKETS.join(', ') + '\n' +
    'Allowed categories: ' + allowed.join(', ') + ' (you may propose a new short category if none fit)\n\n' +
    'Return ONLY a JSON object:\n' +
    '{"intent":"create_rule"|"bulk"|"summary"|"spend"|"transactions"|"pending"|"rules"|"undo"|"pause"|"resume"|"help"|"add_category"|"remove_category"|"hide"|"unhide"|"clarify",' +
    '"payee":"","payees":[],"bucket":"","category":"","property":"","direction":"CREDIT"|"DEBIT"|"","note":"","hide":false,"match_amount":"","match_ref":"",' +
    '"period":{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"},"category_query":"","reply":""}\n\n' +
    'Rules:\n' +
    '- create_rule when the owner clearly states a bucket and a category for the payee in question (or a named payee). It applies to all matching transactions, including confirmed ones.\n' +
    '- bulk when the owner selects transactions by amount or reference ("all 13 rupee transactions", "all 500312... transactions"), not by a named payee; fill match_amount or match_ref plus bucket/category.\n' +
    '- add_category / remove_category when they ask to add or remove a category; category upkeep is your job.\n' +
    '- hide / unhide when they ask to hide or show transactions for named counterparties from the family view; put every name in payees. This does not create a rule.\n' +
    '- transactions when they ask about a named counterparty ("any transactions from X", "show X", "what did I pay X"); put the name in payees. Do not use summary for this.\n' +
    '- For create_rule, direction=CREDIT when they say credits/received/salary/teaching income, direction=DEBIT when paid/spent/debited, else empty (both).\n' +
    '- Respect the recent messages and corrections (e.g. "no, personal not business").\n' +
    '- If the owner names a category, use that exact name even if it is not in the list (e.g. "Teaching Payments"); never substitute a different existing category.\n' +
    '- Salary or part-time teaching income is Personal, not Business.\n' +
    '- If the owner asks for a note, put the text in note.\n' +
    '- If they ask to hide the transaction from the family view, set hide=true on the create_rule; use the hide intent only when there is no categorization.\n' +
    '- Recent messages are context: resolve "this", "that", "it" and a bare payee against them. If the last message named a payee and this one says hide/show, use hide/unhide with that payee; if the last message said hide and this one names a payee, same.\n' +
    '- Amounts like 40, 53 or 65 describe the same payee; never create amount-specific rules.\n' +
    '- For overall period totals use summary; category totals use spend; a named counterparty is transactions. Periods apply where stated.\n' +
    '- Never invent amounts or dates; use the evidence.\n' +
    '- If anything is unclear, return clarify with a short question in reply.';
}

// Rows selected by amount and/or ref (for "all 13 rupee" / "all 500312...").
export function matchBulkRows(rows, { amount, ref } = {}) {
  const amt = Number(amount) || 0;
  const needle = String(ref || '').trim().toUpperCase();
  return rows.filter(r => {
    if (amt && Math.abs(Number(r.txn.amount) - amt) > 0.005) return false;
    if (needle && !(String(r.txn.ref || '').toUpperCase().includes(needle) || String(r.txn.counterparty || '').toUpperCase().includes(needle))) return false;
    return true;
  });
}

// Rows whose counterparty matches one of the given names (exact key or prefix).
export function matchPayeeRows(rows, names) {
  const list = (Array.isArray(names) ? names : [names]).map(n => String(n || '').trim()).filter(Boolean);
  if (!list.length) return [];
  const keys = list.map(n => normKey_(n)).filter(Boolean);
  const raws = list.map(n => n.toUpperCase());
  return rows.filter(r => {
    const key = normKey_(r.txn.counterparty);
    if (key && keys.some(k => key === k || key.startsWith(k) || k.startsWith(key))) return true;
    const raw = String(r.txn.counterparty || '').toUpperCase();
    const ref = String(r.txn.ref || '').toUpperCase();
    return raws.some(w => w && (raw.includes(w) || ref.includes(w)));
  });
}

async function runIntent(data, question, categories = ALLOWED_CATEGORIES) {
  const intent = String((data && data.intent) || 'clarify').toLowerCase();
  if (intent === 'add_category') {
    const name = String(data.category || '').trim();
    if (!name) return tg.sendMessage('Which category should I add?');
    await addCategory(name);
    return tg.sendMessage('Added category <b>' + esc(name) + '</b>.');
  }
  if (intent === 'remove_category') {
    const name = String(data.category || '').trim();
    if (!name) return tg.sendMessage('Which category should I remove?');
    await removeCategory(name);
    return tg.sendMessage('Removed category <b>' + esc(name) + '</b> from the picker.');
  }
  if (intent === 'hide' || intent === 'unhide') {
    let names = (Array.isArray(data.payees) ? data.payees : [data.payee])
      .map(v => String(v || '').trim()).filter(Boolean);
    if (!names.length) {
      const last = await stateGet('lastpayee:' + TG_CHAT);
      if (last) names = [last];
    }
    if (!names.length) return tg.sendMessage('Which payee(s)? e.g. "hide Shalini Ghosh and Anandita".');
    const rows = await loadTransactionRows();
    const targets = matchPayeeRows(rows, names);
    if (!targets.length) return tg.sendMessage('No transactions matched: ' + names.map(esc).join(', '));
    const hide = intent === 'hide';
    const before = targets.map(r => ({ ref: r.txn.ref, hidden: !!r.txn.hidden }));
    for (const r of targets) r.txn.hidden = hide;
    await updateTransactionRows(targets);
    const matched = [...new Set(targets.map(r => r.txn.counterparty))];
    try {
      await addLog({ action: 'hide', payload: { payees: matched, hidden: hide }, before: { rows: before }, after: { updated: targets.length }, status: 'applied' });
    } catch (err) { console.error('[bot] log failed:', err.message); }
    return tg.sendMessage((hide ? 'Hid ' : 'Showing ') + targets.length + ' transaction(s) from <b>' + matched.map(esc).join('</b>, <b>') + '</b> ' + (hide ? 'in the family view' : 'again') + '.\nYour own totals are unchanged.' + (hide ? ' /undo to restore.' : ''));
  }
  if (intent === 'transactions') {
    const names = (Array.isArray(data.payees) ? data.payees : [data.payee])
      .map(v => String(v || '').trim()).filter(Boolean);
    if (!names.length) return tg.sendMessage('Which counterparty?');
    try { await stateSet('lastpayee:' + TG_CHAT, names[0]); } catch (err) { /* ignore */ }
    const period = data.period ? periodFromData(data.period) : null;
    const rows = await loadTransactionRows();
    const list = matchPayeeRows(rows, names)
      .filter(r => !period || (r.txn.date >= period.from && r.txn.date <= period.to))
      .map(r => r.txn)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.loggedAt).localeCompare(String(a.loggedAt)));
    if (!list.length) return tg.sendMessage('No transactions from ' + names.map(esc).join(', ') + (period ? ' in ' + esc(period.label) : '') + '.');
    const inSum = list.filter(t => t.direction === 'CREDIT').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const outSum = list.filter(t => t.direction === 'DEBIT').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const lines = ['📋 <b>' + names.map(esc).join(', ') + '</b> · ' + list.length + ' transaction' + (list.length === 1 ? '' : 's') + (period ? ' · ' + esc(period.label) : '')];
    for (const t of list.slice(0, 20)) {
      const credit = t.direction === 'CREDIT';
      lines.push((credit ? '↓ +' : '↑ −') + inr(t.amount) + ' · ' + esc(t.date) + (t.category ? ' · ' + esc(t.category) : ''));
    }
    if (list.length > 20) lines.push('…and ' + (list.length - 20) + ' more.');
    lines.push('', 'In +' + inr(inSum) + ' · Out −' + inr(outSum));
    return tg.sendMessage(lines.join('\n'));
  }
  if (intent === 'bulk') {
    const amount = Number(data.match_amount) || 0;
    const ref = String(data.match_ref || '').trim();
    const bucket = pickAllowed(data.bucket, ALLOWED_BUCKETS);
    const category = pickAllowed(data.category, categories) || String(data.category || '').trim();
    if ((!amount && !ref) || !bucket || !category) return tg.sendMessage('Tell me the amount/ref, bucket and category.');
    const rows = await loadTransactionRows();
    const targets = matchBulkRows(rows, { amount, ref });
    if (!targets.length) return tg.sendMessage('No transactions matched ' + (amount ? inr(amount) : esc(ref)) + '.');
    const note = String(data.note || '').trim();
    const hide = data.hide === true || data.hide === 'true';
    const before = targets.map(r => ({ ref: r.txn.ref, status: r.txn.status, bucket: r.txn.bucket, category: r.txn.category, property: r.txn.property, notes: r.txn.notes, hidden: !!r.txn.hidden }));
    for (const r of targets) {
      r.txn.bucket = bucket;
      r.txn.category = category;
      if (note) r.txn.notes = note;
      if (hide) r.txn.hidden = true;
      r.txn.status = CONFIRMED;
    }
    await updateTransactionRows(targets);
    await addCategory(category);
    try { await addLog({ action: 'bulk', payload: { match_amount: amount, match_ref: ref, bucket, category, note, hide }, before: { rows: before }, after: { updated: targets.length }, status: 'applied' }); } catch (err) { console.error('[bot] log failed:', err.message); }
    return tg.sendMessage('Tagged ' + targets.length + ' transaction(s) as <b>' + esc(bucket) + ' / ' + esc(category) + '</b>' + (hide ? ' · hidden from family view' : '') + '. /undo to revert.');
  }
  if (intent === 'create_rule') {
    const payee = question ? question.payee : ((await findPayee(data.payee)) || String(data.payee || '').trim());
    if (!payee) return tg.sendMessage('I could not match that to a payee. Reply to one of my questions or name the payee.');
    const bucket = pickAllowed(data.bucket, ALLOWED_BUCKETS);
    const category = pickAllowed(data.category, categories) || String(data.category || '').trim();
    if (!bucket || !category) {
      return tg.sendMessage('I need a bucket and category.\nBuckets: ' + ALLOWED_BUCKETS.join(', ') + '\nCategories: ' + categories.join(', '));
    }
    const property = String(data.property || '').trim();
    const direction = normDirection_(data.direction);
    const note = String(data.note || '').trim();
    const hide = data.hide === true || data.hide === 'true';
    const id = await addLog({ action: 'rule', payload: { payee, bucket, category, property, trusted: true, direction, note, hide, scope: 'all' }, before: null, after: null, status: 'proposed' });
    const dirLabel = direction === 'CREDIT' ? ' · credits only' : direction === 'DEBIT' ? ' · debits only' : '';
    const extras = [];
    if (note) extras.push('note: ' + esc(note));
    if (hide) extras.push('hidden from family view');
    return tg.sendMessage('Set <b>' + esc(payee) + '</b> → ' + esc(bucket) + ' / ' + esc(category) + (property ? ' · ' + esc(property) : '') + ' (trusted' + dirLabel + ')' + (extras.length ? ' · ' + extras.join(' · ') : '') + '.\nApply to all matching transactions?', {
      inline_keyboard: [[{ text: 'Apply', callback_data: 'a:' + id + ':y' }, { text: 'Cancel', callback_data: 'a:' + id + ':n' }]]
    });
  }
  if (intent === 'summary') return tg.sendMessage(summaryFor(await loadTransactions(), periodFromData(data.period)));
  if (intent === 'spend') {
    const category = matchCategory(data.category_query || data.category || '');
    if (!category) return tg.sendMessage('Category? One of: ' + ALLOWED_CATEGORIES.join(', '));
    const period = periodFromData(data.period);
    const rows = (await loadTransactions()).filter(t => t.direction === 'DEBIT' && t.category === category && t.date >= period.from && t.date <= period.to);
    return tg.sendMessage('💸 <b>' + esc(category) + '</b> · ' + esc(period.label) + '\n' + rows.length + ' payments · ' + inr(rows.reduce((s, t) => s + (Number(t.amount) || 0), 0)));
  }
  if (intent === 'pending') return cmdPending();
  if (intent === 'rules') return cmdRules();
  if (intent === 'undo') return cmdUndo();
  if (intent === 'pause') { await stateSet('paused', '1'); return tg.sendMessage('Paused.'); }
  if (intent === 'resume') { await stateSet('paused', '0'); return tg.sendMessage('Resumed.'); }
  if (intent === 'help') return cmdHelp();
  return tg.sendMessage((data && data.reply) || 'Tell me the payee, bucket and category (e.g. "THANDI → personal, chai and snacks").');
}

async function handleFreeText(text, question) {
  try { await tg.sendChatAction('typing'); } catch (err) { /* ignore */ }
  let categories = ALLOWED_CATEGORIES;
  try { categories = await loadCategories(); } catch (err) { /* fall back to the seed list */ }
  const history = await recentMessages(TG_CHAT);
  await rememberMessage(TG_CHAT, text);
  let data;
  try { data = (await askJSON(intentPrompt(text, question, categories, history))).data; }
  catch (err) {
    console.error('[bot] llm failed:', err.message);
    return tg.sendMessage('AI is unavailable right now. Use the buttons, or try again later.');
  }
  return runIntent(data, question, categories);
}

// ---------- callbacks ----------
async function handleQuestionCallback(parts, msg) {
  const id = parts[1];
  const question = await findQuestion(id);
  if (!question || question.status !== 'open') return tg.editMessage(msg.message_id, 'This question expired. Use /ask.');
  const action = parts[2];
  if (action === 'b') {
    const bucket = pickAllowed(parts[3], ALLOWED_BUCKETS);
    if (!bucket) return;
    const keyboard = [];
    for (let i = 0; i < ALLOWED_CATEGORIES.length; i += 3) {
      keyboard.push(ALLOWED_CATEGORIES.slice(i, i + 3).map((c, j) => ({
        text: c, callback_data: 'q:' + id + ':c:' + bucket + ':' + (i + j)
      })));
    }
    return tg.editMessage(msg.message_id, '🏷️ <b>' + esc(question.payee) + '</b>\n' + esc(question.evidence) + '\n\nBucket: <b>' + esc(bucket) + '</b>. Choose a category:', { inline_keyboard: keyboard });
  }
  if (action === 'c') {
    const bucket = pickAllowed(parts[3], ALLOWED_BUCKETS);
    const category = ALLOWED_CATEGORIES[Number(parts[4])];
    if (!bucket || !category) return;
    return applyFromQuestion(question, bucket, category, msg);
  }
  if (action === 's') {
    const s = question.suggestion;
    const bucket = s && pickAllowed(s.bucket, ALLOWED_BUCKETS);
    const category = s && pickAllowed(s.category, ALLOWED_CATEGORIES);
    if (!bucket || !category) return tg.editMessage(msg.message_id, 'Suggestion missing. Pick a bucket.');
    return applyFromQuestion(question, bucket, category, msg);
  }
  if (action === 'i') {
    await stateSet('ignore:' + question.key, String(Date.now()));
    await setQuestionStatus(question.id, 'ignored');
    return tg.editMessage(msg.message_id, 'Ignored <b>' + esc(question.payee) + '</b> for 7 days.');
  }
  if (action === 'f') {
    const res = await forgetPayee(question.payee);
    try {
      await addLog({ action: 'forget', payload: { payee: question.payee }, before: { rows: res.before }, after: { updated: res.updated }, status: 'applied' });
    } catch (err) { console.error('[bot] log failed:', err.message); }
    await stateSet('ignore:' + question.key, String(Date.now()));
    await setQuestionStatus(question.id, 'forgotten');
    return tg.editMessage(msg.message_id, 'Forgotten <b>' + esc(question.payee) + '</b>: ' + res.updated + ' open row(s) marked FORGOTTEN. /undo to restore.');
  }
  if (action === 'x') {
    return tg.editMessage(msg.message_id, '🏷️ <b>' + esc(question.payee) + '</b>\nReply to this message with the bucket and category, e.g. "personal, chai and snacks".');
  }
}

async function applyFromQuestion(question, bucket, category, msg) {
  const res = await applyRule({ payee: question.payee, bucket, category, trusted: true });
  try {
    await addLog({ action: 'rule', payload: { payee: question.payee, bucket, category, property: '', trusted: true }, before: res.before, after: { updated: res.updated }, status: 'applied' });
  } catch (err) { console.error('[bot] log failed:', err.message); }
  await setQuestionStatus(question.id, 'applied');
  return tg.editMessage(msg.message_id, '✅ <b>' + esc(question.payee) + '</b> → ' + esc(bucket) + ' / ' + esc(category) + ' (trusted).\n' + res.updated + ' open row(s) confirmed. /undo to revert.');
}

async function handleApplyCallback(parts, msg) {
  const log = await getLog(parts[1]);
  if (!log || log.status !== 'proposed') return tg.editMessage(msg.message_id, 'This action expired.');
  if (parts[2] !== 'y') {
    await setLog(log.id, { status: 'cancelled' });
    return tg.editMessage(msg.message_id, 'Cancelled.');
  }
  const res = await applyRule(log.payload);
  await setLog(log.id, { status: 'applied', before: res.before, after: { updated: res.updated } });
  const dirLabel = log.payload.direction === 'CREDIT' ? ' · credits only' : log.payload.direction === 'DEBIT' ? ' · debits only' : '';
  return tg.editMessage(msg.message_id, '✅ Applied <b>' + esc(log.payload.payee) + '</b> → ' + esc(log.payload.bucket) + ' / ' + esc(log.payload.category) + dirLabel + '.\n' + res.updated + ' transaction(s) updated. /undo to revert.');
}

async function handleCallback(cq) {
  if (!cq.message || String(cq.message.chat && cq.message.chat.id) !== String(TG_CHAT)) return;
  try { await tg.answerCallback(cq.id); } catch (err) { /* ignore */ }
  const parts = String(cq.data || '').split(':');
  if (parts[0] === 'q') return handleQuestionCallback(parts, cq.message);
  if (parts[0] === 'a') return handleApplyCallback(parts, cq.message);
}

// ---------- entry points ----------
export async function handleUpdate(update) {
  if (!tg.botConfigured() || !update) return;
  await ensureTabs();
  const last = Number(await stateGet('last_update_id')) || 0;
  if (update.update_id && update.update_id <= last) return;
  if (update.update_id) await stateSet('last_update_id', String(update.update_id));
  try {
    if (update.callback_query) return await handleCallback(update.callback_query);
    const msg = update.message;
    if (!msg || String(msg.chat && msg.chat.id) !== String(TG_CHAT)) return;
    const text = String(msg.text || '').trim();
    if (!text) return;
    if (text.startsWith('/')) return await handleCommand(text);
    const question = await findQuestionByMessage(msg.reply_to_message && msg.reply_to_message.message_id);
    return await handleFreeText(text, question);
  } catch (err) {
    console.error('[bot] update failed:', err.message);
    try { await tg.sendMessage('Something went wrong. Try again, or use /help.'); } catch (e) { /* ignore */ }
  }
}

export async function setupWebhook(url) {
  if (!TG_WEBHOOK_SECRET) throw new Error('APP_KEY is required to derive the webhook secret');
  if (!tg.botConfigured()) throw new Error('TG_TOKEN/TG_CHAT are not configured');
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('url must start with https://');
  await ensureTabs();
  const endpoint = String(url).replace(/\/+$/, '') + '/api/telegram';
  await tg.setWebhook(endpoint, TG_WEBHOOK_SECRET);
  let commands = [];
  try {
    await tg.setMyCommands(BOT_COMMANDS);
    await tg.setChatMenuButton({ type: 'commands' });
    commands = await tg.getMyCommands();
  } catch (err) { console.error('[bot] command menu failed:', err.message); }
  const info = await tg.webhookInfo();
  try { await tg.sendMessage('🤖 Finance bot connected. Send /help.'); } catch (err) { console.error('[bot] hello failed:', err.message); }
  return { endpoint, info, commands: (commands || []).map(c => c.command) };
}
