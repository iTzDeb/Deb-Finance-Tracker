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

// Appends rows to the bottom of `tab`. Uses the Sheets append endpoint with
// INSERT_ROWS so the grid grows itself; if the sheet is already at its row
// limit, grow it explicitly and retry.
export async function appendRows(tab, rows) {
  if (!rows.length) return;
  const url = `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${tab}'!A1`)}`
    + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
  const append = () => request({ url, method: 'POST', data: { values: rows } });
  try {
    await append();
  } catch (err) {
    if (!/exceeds grid limits/i.test(err.message || '')) throw err;
    await growGrid(tab, rows.length);
    await append();
  }
}

// Adds empty rows to a sheet's grid (does not touch data).
async function growGrid(tab, by) {
  const url = `${BASE}/${SPREADSHEET_ID}:batchUpdate`;
  await request({
    url,
    method: 'POST',
    data: {
      requests: [{
        appendDimension: {
          sheetId: await sheetId(tab),
          dimension: 'ROWS',
          length: Math.max(by + 100, 200)
        }
      }]
    }
  });
}

const _sheetIds = new Map();

async function sheetId(tab) {
  if (_sheetIds.has(tab)) return _sheetIds.get(tab);
  const data = await request({
    url: `${BASE}/${SPREADSHEET_ID}?fields=sheets.properties(sheetId,title)`,
    method: 'GET'
  });
  for (const s of data.sheets || []) {
    _sheetIds.set(s.properties.title, s.properties.sheetId);
  }
  if (!_sheetIds.has(tab)) throw new Error(`sheet not found: ${tab}`);
  return _sheetIds.get(tab);
}

export const TAB = { transactions: SHEET, rules: RULES_TAB, staging: STAGE_TAB };
