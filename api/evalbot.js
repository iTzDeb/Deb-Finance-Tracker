// TEMPORARY: run the Telegram intent fixtures on the deployment's LLM key.
// Protected by APP_KEY; removed after the eval.
import { APP_KEY } from '../lib/config.js';
import { sameSecret } from '../lib/util.js';
import { askJSON } from '../lib/llm.js';
import { intentPrompt } from '../lib/bot.js';
import { normalizeActions } from '../lib/actions.js';

function bodyJson(req) {
  let b = req.body;
  if (b == null) return null;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (err) { return null; } }
  return b;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const body = bodyJson(req);
  if (!body || !sameSecret(body.key, APP_KEY)) { res.statusCode = 401; return res.end(); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  const results = [];
  for (const it of items) {
    try {
      const data = (await askJSON(intentPrompt(String(it.text || ''), null, [], Array.isArray(it.history) ? it.history : []))).data;
      results.push({ text: it.text, action: normalizeActions(data)[0] || null });
    } catch (err) {
      results.push({ text: it.text, error: err.message });
    }
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, results }));
}
