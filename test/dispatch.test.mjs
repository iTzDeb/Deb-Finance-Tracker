import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch, FRONTEND_ACTIONS } from '../lib/dispatch.js';

test('FRONTEND_ACTIONS includes the actions the PWA calls', () => {
  for (const a of ['pending', 'summary', 'save', 'bulkSave', 'history', 'snapshot', 'importChunk', 'importCommit', 'importCancel']) {
    assert.ok(FRONTEND_ACTIONS.has(a), a);
  }
});

test('dispatch rejects unknown actions', async () => {
  await assert.rejects(() => dispatch('nope', {}), /unknown action/);
});

console.log('Dispatch tests passed.');
