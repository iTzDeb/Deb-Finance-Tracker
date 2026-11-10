// Vercel serverless entrypoint: serves the JSONP API the PWA frontend expects
// (script.google.com replacement). Supports GET (JSONP) and POST (JSON body).
//
//   GET  /api/exec?key=...&action=pending&callback=cb_xxx
//   POST /api/exec  { "key": "...", "action": "...", ...params }

import { dispatch, EXEC_ACTIONS } from '../lib/dispatch.js';
import { safeCallback } from '../lib/util.js';
import { APP_KEY } from '../lib/config.js';

const CORS = { 'access-control-allow-origin': '*' };

function jsonResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...extra }
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  let params;
  if (req.method === 'GET') {
    params = Object.fromEntries(new URL(req.url).searchParams);
  } else if (req.method === 'POST') {
    try { params = await req.json(); } catch { params = {}; }
  } else {
    return jsonResponse({ ok: false, error: 'method not allowed' }, 405);
  }

  const callback = safeCallback(params.callback);
  const respond = body => {
    if (callback) {
      return new Response(`${callback}(${JSON.stringify(body)});`, {
        status: 200,
        headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store', ...CORS }
      });
    }
    return jsonResponse(body);
  };

  if (!APP_KEY) return respond({ ok: false, error: 'server not configured' });
  if (params.key !== APP_KEY) return respond({ ok: false, error: 'unauthorized' });
  if (!EXEC_ACTIONS.has(params.action)) return respond({ ok: false, error: 'unknown action' });

  try {
    const data = await dispatch(params.action, params);
    return respond({ ok: true, ...data });
  } catch (err) {
    return respond({ ok: false, error: err.message || 'failed' });
  }
}
