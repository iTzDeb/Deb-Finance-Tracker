// ==========================================
// Google Sheets access via the Sheets REST API v4, authenticated with a
// service account through google-auth-library. This replaces SpreadsheetApp.
// ==========================================

import { GoogleAuth } from 'google-auth-library';
import {
  SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT,
  SHEET, RULES_TAB, STAGE_TAB, NCOL, STAGE_NCOL
} from './config.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let _client = null;

function credentials() {
  if (!GOOGLE_SERVICE_ACCOUNT) return null;
  try { return JSON.parse(GOOGLE_SERVICE_ACCOUNT); } catch { return null; }
}

export function configured() {
  return !!(SPREADSHEET_ID && credentials());
}

async function client() {
  if (_client) return _client;
  const auth = new GoogleAuth({ credentials: credentials(), scopes: SCOPES });
  _client = await auth.getClient();
  return _client;
}

async function request(opts) {
  const c = await client();
  const res = await c.request(opts);
  return res.data;
}

// 1 -> 'A', 27 -> 'AA'
export function colLetter(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function rangeFor(tab, startRow, endRow, startCol, endCol) {
  const a = `${colLetter(startCol)}${startRow}`;
  const b = `${colLetter(endCol)}${endRow}`;
  return `'${tab}'!${a}:${b}`;
}

// Reads raw values (dates as serial numbers, numbers as numbers).
export async function readRange(tab, range, startCol = 1, endCol = NCOL) {
  const r = range || rangeFor(tab, 1, 1000, startCol, endCol);
  const url = `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(r)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const data = await request({ url, method: 'GET' });
  return data.values || [];
}

// Writes a single range with USER_ENTERED semantics (strings stay strings).
export async function writeRange(tab, startRow, startCol, values) {
  const range = rangeFor(tab, startRow, startRow + values.length - 1, startCol, startCol + (values[0]?.length || 1) - 1);
  const url = `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  await request({ url, method: 'PUT', data: { values } });
}

export async function clearRange(tab, range) {
  const url = `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:clear`;
  await request({ url, method: 'POST' });
}

// Appends rows to the bottom of `tab`, scanning the used range first so we
// never overwrite existing data (Sheets has no native "append" in the REST API).
export async function appendRows(tab, rows, cols) {
  if (!rows.length) return;
  const colCount = cols || Math.max(...rows.map(r => r.length));
  const existing = await readRange(tab, null, 1, colCount);
  const lastRow = existing.length;
  await writeRange(tab, lastRow + 1, 1, rows);
}

export const TAB = { transactions: SHEET, rules: RULES_TAB, staging: STAGE_TAB };
