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

// Whole-column range, e.g. "'Transactions'!A:S" — used when no range is given.
export function wholeColumns(tab, startCol, endCol) {
  return `'${tab}'!${colLetter(startCol)}:${colLetter(endCol)}`;
}

export function rangeFor(tab, startRow, endRow, startCol, endCol) {
  const a = `${colLetter(startCol)}${startRow}`;
  const b = `${colLetter(endCol)}${endRow}`;
  return `'${tab}'!${a}:${b}`;
}

// Reads raw values (dates as serial numbers, numbers as numbers). Without an
// explicit range this reads whole columns: the sheet keeps growing, so a fixed
// row cap would silently hide old transactions and break dedup.
export async function readRange(tab, range, startCol = 1, endCol = NCOL) {
  const r = range || wholeColumns(tab, startCol, endCol);
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

// Writes many single-row updates in one Sheets batchUpdate call.
export async function writeRanges(tab, rows) {
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const data = rows.slice(i, i + CHUNK).map(({ row, values }) => ({
      range: rangeFor(tab, row, row, 1, values.length),
      values: [values]
    }));
    await request({
      url: `${BASE}/${SPREADSHEET_ID}/values:batchUpdate`,
      method: 'POST',
      data: { valueInputOption: 'USER_ENTERED', data }
    });
  }
}

// Writes a block with RAW semantics so text (leading-zero refs) stays text.
export async function writeBlockRaw(tab, startRow, startCol, values) {
  const range = rangeFor(tab, startRow, startRow + values.length - 1, startCol, startCol + (values[0]?.length || 1) - 1);
  const url = `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
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
  if (!rows.length) return '';
  const url = `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${tab}'!A1`)}`
    + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
  const append = () => request({ url, method: 'POST', data: { values: rows } });
  let data;
  try {
    data = await append();
  } catch (err) {
    if (!/exceeds grid limits/i.test(err.message || '')) throw err;
    await growGrid(tab, rows.length);
    data = await append();
  }
  return data?.updates?.updatedRange || '';
}

// End row of an A1 range returned by the append endpoint.
export function endRowOf(updatedRange) {
  const m = String(updatedRange || '').match(/![A-Z]+(\d+):[A-Z]+(\d+)/);
  return m ? Number(m[2]) : 0;
}

// Keeps Transactions A/B displaying as ISO date/time instead of raw serials.
export async function formatTransactionDates(startRow, endRow) {
  const from = Number(startRow);
  const to = Number(endRow);
  if (!(to >= from) || from < 1) return;
  const id = await sheetId(SHEET);
  await request({
    url: `${BASE}/${SPREADSHEET_ID}:batchUpdate`,
    method: 'POST',
    data: { requests: [
      { repeatCell: {
        range: { sheetId: id, startRowIndex: from - 1, endRowIndex: to, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm' } } },
        fields: 'userEnteredFormat.numberFormat'
      } },
      { repeatCell: {
        range: { sheetId: id, startRowIndex: from - 1, endRowIndex: to, startColumnIndex: 1, endColumnIndex: 2 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
        fields: 'userEnteredFormat.numberFormat'
      } }
    ] }
  });
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

// Creates a tab (and its header row) when it does not exist yet.
export async function ensureTab(tab, headers) {
  try {
    const rows = await readRange(tab, rangeFor(tab, 1, 1, 1, headers.length));
    if (!rows.length || !String(rows[0][0] || '').trim()) await writeRange(tab, 1, 1, [headers]);
    return;
  } catch (err) {
    if (!/not found|unable to parse range|does not exist|cannot find/i.test(err.message || '')) throw err;
  }
  const data = await request({
    url: `${BASE}/${SPREADSHEET_ID}:batchUpdate`,
    method: 'POST',
    data: { requests: [{ addSheet: { properties: { title: tab } } }] }
  });
  const created = data?.replies?.[0]?.addSheet?.properties;
  if (created) _sheetIds.set(tab, created.sheetId);
  await writeRange(tab, 1, 1, [headers]);
}
