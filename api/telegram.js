// ==========================================
// Telegram webhook. Telegram calls POST /api/telegram with the secret token
// header; updates are processed in-process and always answered with 200 so
// Telegram does not retry (update_id dedupe is the second guard).
// ==========================================

import { handleUpdate } from '../lib/bot.js';
import { TG_WEBHOOK_SECRET } from '../lib/config.js';
import { sameSecret } from '../lib/util.js';

async function readJson(req) {
  let body = req.body;
  if (body == null) {
    if (typeof req[Symbol.asyncIterator] !== 'function') return null;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (!chunks.length) return null;
    body = Buffer.concat(chunks);
  }
  if (typeof body === 'string') return JSON.parse(body);
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8'));
  return body;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end();
  }
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (!TG_WEBHOOK_SECRET || !sameSecret(secret, TG_WEBHOOK_SECRET)) {
    res.statusCode = 401;
    return res.end();
  }
  let update;
  try {
    update = await readJson(req);
  } catch (err) {
    res.statusCode = 400;
    return res.end();
  }
  try {
    await handleUpdate(update);
  } catch (err) {
    console.error('[telegram] update failed:', err.message);
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'text/plain');
  res.end('ok');
}
