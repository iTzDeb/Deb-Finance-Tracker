// Vercel serverless entrypoint (Node runtime). Replaces the Apps Script web app
// for both the PWA (JSONP GET) and the SMS/email forwarders (POST or GET).
//
//   GET  /api/exec?key=...&action=pending&callback=cb_xxx
//   GET  /api/exec?key=...&action=ingest&sms=<text>
//   POST /api/exec  { "key": "...", "action": "...", ...params }

import { dispatch, EXEC_ACTIONS } from '../lib/dispatch.js';
import { safeCallback, sameSecret, readRequestParams } from '../lib/util.js';
import { APP_KEY } from '../lib/config.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};

// Vercel only pre-parses some content types; forwarders may post raw text or
// form data, so fall back to the request stream when req.body is absent.
async function requestBody(req) {
  if (req.body != null) return req.body;
  if (typeof req[Symbol.asyncIterator] !== 'function') return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

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

  if (req.method !== 'GET' && req.method !== 'POST') {
    return send(res, { ok: false, error: 'method not allowed' }, 405);
  }
  const rawBody = req.method === 'POST' ? await requestBody(req) : undefined;
  const params = readRequestParams(req.method, req.url, rawBody);

  const callback = safeCallback(params.callback);
  const respond = body => (callback
    ? send(res, `${callback}(${JSON.stringify(body)});`, 200, 'application/javascript; charset=utf-8')
    : send(res, body));

  // Legacy SMS forwarders send ?src=KOTAK_SMS&sms=... with no action param.
  const action = params.action || ((params.sms || params.messages) ? 'ingest' : '');

  // The family view is password-gated instead of key-gated.
  if (!APP_KEY && action !== 'mom') return respond({ ok: false, error: 'server not configured' });
  if (action !== 'mom' && !sameSecret(params.key, APP_KEY)) return respond({ ok: false, error: 'unauthorized' });

  if (!EXEC_ACTIONS.has(action)) return respond({ ok: false, error: 'unknown action' });

  // Names only, never values: enough to diagnose forwarder request shapes.
  console.log('[exec]', req.method, 'action=' + action,
    'params=' + Object.keys(params).join('|'),
    'body=' + (Buffer.isBuffer(rawBody) ? 'buffer' : typeof rawBody));

  try {
    const data = await dispatch(action, params);
    if (action === 'ingest') console.log('[ingest]', JSON.stringify(data));
    return respond({ ok: true, ...data });
  } catch (err) {
    return respond({ ok: false, error: err.message || 'failed' });
  }
}
