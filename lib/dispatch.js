// ==========================================
// Action dispatcher shared by the HTTP entrypoints (JSONP GET + JSON POST)
// and the cron endpoint.
// ==========================================

import * as api from './api.js';
import * as imp from './import.js';
import { syncRows } from './sync.js';
import { suggestOpenRows } from './ai.js';
import { sendDigest } from './digest.js';
import { handleIngest } from './ingest.js';
import { setupWebhook } from './bot.js';

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
  ingest: handleIngest,
  botSetup: ({ url }) => setupWebhook(url),
  sync: syncRows,
  suggest: suggestOpenRows,
  digest: sendDigest
};

// Actions callable through /api/exec (key-protected). 'ingest' is used by the
// GAS forwarder, not the PWA; 'sync'/'suggest'/'digest' run via /api/cron.
export const EXEC_ACTIONS = new Set([
  'pending', 'summary', 'save', 'bulkSave', 'history', 'snapshot',
  'importChunk', 'importCommit', 'importCancel', 'ingest', 'botSetup'
]);

export async function dispatch(action, params) {
  const fn = ACTIONS[action];
  if (!fn) throw new Error('unknown action');
  return fn(params || {});
}
