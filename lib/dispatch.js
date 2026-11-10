// ==========================================
// Action dispatcher shared by the HTTP entrypoints (JSONP GET + JSON POST)
// and the cron endpoint.
// ==========================================

import * as api from './api.js';
import * as imp from './import.js';
import { syncRows } from './sync.js';
import { suggestOpenRows } from './ai.js';
import { sendDigest } from './digest.js';

const ACTIONS = {
  pending: api.handlePending,
  summary: api.handleSummary,
  save: api.handleSave,
  bulkSave: api.handleBulkSave,
  history: api.handleHistory,
  snapshot: api.handleSnapshot,
  importChunk: imp.handleImportChunk,
  importCommit: imp.handleImportCommit,
  importCancel: imp.handleImportCancel,
  sync: syncRows,
  suggest: suggestOpenRows,
  digest: sendDigest
};

// Frontend actions (JSONP) — anything else is internal/background only.
export const FRONTEND_ACTIONS = new Set([
  'pending', 'summary', 'save', 'bulkSave', 'history', 'snapshot',
  'importChunk', 'importCommit', 'importCancel'
]);

export async function dispatch(action, params) {
  const fn = ACTIONS[action];
  if (!fn) throw new Error('unknown action');
  return fn(params || {});
}
