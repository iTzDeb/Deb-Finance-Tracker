// Vercel serverless entrypoint (Node runtime). Replaces the Apps Script web app
// for both the PWA (JSONP GET) and the SMS/email forwarders (POST or GET).
//
//   GET  /api/exec?key=...&action=pending&callback=cb_xxx
//   GET  /api/exec?key=...&action=ingest&sms=<text>
//   POST /api/exec  { "key": "...", "action": "...", ...params }

import { dispatch, EXEC_ACTIONS } from '../lib/dispatch.js';
import { safeCallback } from '../lib/util.js';
import { APP_KEY } from '../lib/config.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};

function send(res, body, status = 200, contentType = 'application/json; charset=utf-8') {
  res.statusCode = status;
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    return res.end();
  }

  let params;
  if (req.method === 'GET') {
    params = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
  } else if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      // Forwarder apps send either JSON or form-urlencoded ("sms=...").
      try {
        body = JSON.parse(body);
      } catch {
        body = Object.fromEntries(new URLSearchParams(body));
      }
    }
    params = body && typeof body === 'object' ? body : {};
  } else {
    return send(res, { ok: false, error: 'method not allowed' }, 405);
  }

  const callback = safeCallback(params.callback);
  const respond = body => (callback
    ? send(res, `${callback}(${JSON.stringify(body)});`, 200, 'application/javascript; charset=utf-8')
    : send(res, body));

  if (!APP_KEY) return respond({ ok: false, error: 'server not configured' });
  if (params.key !== APP_KEY) return respond({ ok: false, error: 'unauthorized' });

  // Legacy SMS forwarders send ?src=KOTAK_SMS&sms=... with no action param.
  const action = params.action || ((params.sms || params.messages) ? 'ingest' : '');
  if (!EXEC_ACTIONS.has(action)) return respond({ ok: false, error: 'unknown action' });

  try {
    const data = await dispatch(action, params);
    return respond({ ok: true, ...data });
  } catch (err) {
    return respond({ ok: false, error: err.message || 'failed' });
  }
}
