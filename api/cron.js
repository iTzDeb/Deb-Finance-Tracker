// Vercel cron entrypoints (Node runtime). Vercel Cron calls a plain path and,
// when CRON_SECRET is set, sends it automatically as
// "Authorization: Bearer <CRON_SECRET>". Query/header forms are kept for
// manual runs. Jobs: maintenance (sync + suggest), digest (Telegram), sync and
// suggest individually.
//
//   /api/maintenance   daily rules sync + AI suggestions
//   /api/digest        daily Telegram summary
//   /api/cron?job=...  manual runs

import { syncRows } from '../lib/sync.js';
import { suggestOpenRows } from '../lib/ai.js';
import { sendDigest } from '../lib/digest.js';
import { CRON_SECRET } from '../lib/config.js';
import { sameSecret } from '../lib/util.js';

// One daily job for Hobby plans: re-apply rules, then fill AI suggestions.
// A missing AI key must not fail the rule sync.
async function maintenance() {
  const sync = await syncRows();
  let suggest;
  try { suggest = await suggestOpenRows(); }
  catch (err) { suggest = { error: err.message }; }
  return { sync, suggest };
}

const JOBS = { sync: syncRows, suggest: suggestOpenRows, digest: sendDigest, maintenance };

function send(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export function cronHandler(forcedJob) {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const secret = url.searchParams.get('secret') || req.headers['x-cron-secret'] || bearer;
    if (!CRON_SECRET || !sameSecret(secret, CRON_SECRET)) {
      return send(res, { ok: false, error: 'unauthorized' }, 401);
    }

    const job = forcedJob || url.searchParams.get('job') || 'maintenance';
    const fn = JOBS[job];
    if (!fn) return send(res, { ok: false, error: 'unknown job' }, 404);

    try {
      const data = await fn();
      return send(res, { ok: true, job, ...data });
    } catch (err) {
      return send(res, { ok: false, job, error: err.message || 'failed' }, 500);
    }
  };
}

export default cronHandler();
