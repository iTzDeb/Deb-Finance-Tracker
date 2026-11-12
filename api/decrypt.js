// Password-protected statement decryption (XLSX/XLS).
// The browser cannot decrypt Office agile encryption, so the importer posts the
// file + password here; the decrypted bytes go back and SheetJS parses them.
// APP_KEY-protected; nothing is stored or logged.
import { APP_KEY } from '../lib/config.js';
import { sameSecret } from '../lib/util.js';
import { decrypt } from 'officecrypto-tool';

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
  const password = String(body.password || '');
  const file = String(body.file || '');
  if (!password || !file) { res.statusCode = 400; return res.end('missing file or password'); }
  let buf;
  try { buf = Buffer.from(file, 'base64'); } catch (err) { res.statusCode = 400; return res.end('bad file'); }
  if (!buf.length || buf.length > 4 * 1024 * 1024) { res.statusCode = 413; return res.end(); }
  try {
    const out = await decrypt(buf, { password });
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, file: Buffer.from(out).toString('base64') }));
  } catch (err) {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'Could not open the file — check the password.' }));
  }
}
