// Vercel cron entrypoint. Called by Vercel Cron with ?job=<name> and a
// X-Cron-Secret / CRON_SECRET. Jobs: sync (rules), suggest (AI), digest (Telegram).
//
//   GET /api/cron?job=sync&secret=...

import { syncRows } from '../lib/sync.js';
import { suggestOpenRows } from '../lib/ai.js';
import { sendDigest } from '../lib/digest.js';
import { CRON_SECRET } from '../lib/config.js';

const JOBS = { sync: syncRows, suggest: suggestOpenRows, digest: sendDigest };

export default async function handler(req) {
  const url = new URL(req.url);
  const job = url.searchParams.get('job');
  const secret = url.searchParams.get('secret') || req.headers.get('x-cron-secret') || '';
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401, headers: { 'content-type': 'application/json' }
    });
  }
  const fn = JOBS[job];
  if (!fn) {
    return new Response(JSON.stringify({ ok: false, error: 'unknown job' }), {
      status: 404, headers: { 'content-type': 'application/json' }
    });
  }
  try {
    const data = await fn();
    return new Response(JSON.stringify({ ok: true, job, ...data }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, job, error: err.message || 'failed' }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}
