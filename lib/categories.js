// ==========================================
// Dynamic category list stored in a "Categories" tab. Seeded from the static
// ALLOWED_CATEGORIES on first use; the bot/app add new ones as they are applied.
// ==========================================

import { readRange, writeRange, appendRows, ensureTab } from './sheet.js';
import { CAT_TAB, CAT_HEADERS, ALLOWED_CATEGORIES } from './config.js';

async function ensure() {
  await ensureTab(CAT_TAB, CAT_HEADERS);
}

export async function loadCategories() {
  await ensure();
  const rows = await readRange(CAT_TAB, `'${CAT_TAB}'!A2:A`);
  let names = rows.map(r => String(r[0] || '').trim()).filter(Boolean);
  if (!names.length) {
    await writeRange(CAT_TAB, 2, 1, ALLOWED_CATEGORIES.map(c => [c]));
    names = ALLOWED_CATEGORIES.slice();
  }
  return [...new Set(names)];
}

export async function addCategory(name) {
  const value = String(name || '').trim();
  if (!value) return;
  const existing = await loadCategories();
  if (existing.some(c => c.toLowerCase() === value.toLowerCase())) return;
  await appendRows(CAT_TAB, [[value]]);
}
