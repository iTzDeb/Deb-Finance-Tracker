// Vercel cron entrypoint (Node runtime). Called by Vercel Cron with ?job=<name>
// and the CRON_SECRET either in the query string or an x-cron-secret header.
// Jobs: sync (rules), suggest (AI), digest (Telegram).
//
//   GET /api/cron?job=sync&secret=...

import { syncRows } from '../lib/sync.js';
import { suggestOpenRows } from '../lib/ai.js';
import { sendDigest } from '../lib/digest.js';
import { CRON_SECRET } from '../lib/config.js';
import { sameSecret } from '../lib/util.js';

const JOBS = { sync: syncRows, suggest: suggestOpenRows, digest: sendDigest };

function send(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const job = url.searchParams.get('job');
  const secret = url.searchParams.get('secret') || req.headers['x-cron-secret'] || '';
  if (!CRON_SECRET || !sameSecret(secret, CRON_SECRET)) {
    return send(res, { ok: false, error: 'unauthorized' }, 401);
  }

  const fn = JOBS[job];
  if (!fn) return send(res, { ok: false, error: 'unknown job' }, 404);

  try {
    const data = await fn();
    return send(res, { ok: true, job, ...data });
  } catch (err) {
    return send(res, { ok: false, job, error: err.message || 'failed' }, 500);
  }
}
