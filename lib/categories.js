// ==========================================
// Dynamic category list stored in the "Categories" tab (Name | Active).
// Seeded from ALLOWED_CATEGORIES on first use. Active=FALSE hides it from the
// picker/AI without deleting it; re-adding reactivates.
// ==========================================

import { readRange, writeRange, appendRows, ensureTab } from './sheet.js';
import { CAT_TAB, CAT_HEADERS, ALLOWED_CATEGORIES } from './config.js';

async function ensure() {
  await ensureTab(CAT_TAB, CAT_HEADERS);
}

const isOn = row => String(row[1] || '').toUpperCase() !== 'FALSE';

export async function loadCategories() {
  await ensure();
  const rows = await readRange(CAT_TAB, `'${CAT_TAB}'!A2:B`);
  if (!rows.length) {
    await writeRange(CAT_TAB, 2, 1, ALLOWED_CATEGORIES.map(c => [c, 'TRUE']));
    return ALLOWED_CATEGORIES.slice();
  }
  return [...new Set(rows
    .filter(r => String(r[0] || '').trim() && isOn(r))
    .map(r => String(r[0]).trim()))];
}

export async function addCategory(name) {
  const value = String(name || '').trim();
  if (!value) return;
  const rows = await readRange(CAT_TAB, `'${CAT_TAB}'!A2:B`);
  const i = rows.findIndex(r => String(r[0] || '').trim().toLowerCase() === value.toLowerCase());
  if (i >= 0) {
    if (!isOn(rows[i])) await writeRange(CAT_TAB, i + 2, 1, [[String(rows[i][0]).trim(), 'TRUE']]);
    return;
  }
  await appendRows(CAT_TAB, [[value, 'TRUE']]);
}

export async function removeCategory(name) {
  const value = String(name || '').trim().toLowerCase();
  if (!value) return;
  const rows = await readRange(CAT_TAB, `'${CAT_TAB}'!A2:B`);
  const i = rows.findIndex(r => String(r[0] || '').trim().toLowerCase() === value);
  if (i < 0) return;
  await writeRange(CAT_TAB, i + 2, 1, [[String(rows[i][0]).trim(), 'FALSE']]);
}
