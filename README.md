# Deb Finance Tracker — backend

Node.js (ESM) backend that replaces the Google Apps Script web app. The
frontend stays as a static PWA on GitHub Pages; this repo provides the data
API via [Vercel Functions](https://vercel.com/docs/functions), with **Google
Sheets kept as the data store**.

## Architecture

```
GitHub Pages (PWA) ──fetch (CORS)──▶ Vercel Functions (/api/exec) ──Sheets API v4──▶ Google Sheets
                                    ▲
                                    │ POST /api/exec (action=ingest)
                          Gmail forwarder (tiny GAS script)
```

- `index.html` / `import.html` call the backend with `fetch`
  (`?key=…&action=…`); the JSONP `callback=` parameter is still accepted for
  old clients.
- `api/exec.js` dispatches frontend actions; `api/cron.js` runs background jobs.
- `lib/` holds the ported GAS logic (config, parsers, Sheets client, rules,
  transactions, import, sync, AI suggestions, digest, ingest).

## Data model (Google Sheets — unchanged)

| Tab | Columns |
| --- | --- |
| `Transactions` (19) | Logged At, Date, Direction, Amount, Counterparty, Ref, Source, Account, Status, Bucket, Category, Property, Notes, Suggested Bucket, Suggested Category, Suggested Property, AI Confidence, AI Source, Accept |
| `Rules` (5) | Counterparty, Bucket, Category, Property, Trusted |
| `Staging` (8) | Batch, Stamp, Direction, Amount, Counterparty, Ref, Account, Source |

Status values: `NEEDS REVIEW`, `PENDING`, `CONFIRMED`.

## Deploy

1. **Deploy to Vercel** — import this repo, framework preset "Other", root
   directory default. The `api/*.js` files become serverless functions.

2. **Set environment variables** in Vercel (Project → Settings → Environment Variables):

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `APP_KEY` | ✅ | Shared secret the PWA sends as `key`. Pick any strong string. |
   | `SPREADSHEET_ID` | ✅ | The Google Sheets spreadsheet id (from its URL). |
   | `GOOGLE_SERVICE_ACCOUNT` | ✅ | Full JSON key of a service account, as a single string. |
   | `GEMINI_KEY` | optional | Google AI Studio key for suggestions. |
   | `GEMINI_MODEL` | optional | Default `gemini-3.1-flash-lite`. |
   | `DEEPSEEK_KEY` | optional | Fallback provider for suggestions. |
   | `TG_TOKEN`, `TG_CHAT` | optional | Telegram bot token + chat id for the digest. |
   | `CRON_SECRET` | optional | Protects `/api/cron`. |
   | `OWNER_CONTEXT` | optional | Extra context injected into the AI prompt. |

3. **Google Sheets service account**
   1. In Google Cloud, create a Service Account.
   2. Enable the **Google Sheets API** for that project.
   3. Create a JSON key and paste its **entire** contents into
      `GOOGLE_SERVICE_ACCOUNT`.
   4. Share your spreadsheet (Edit access) with the service account's email
      address (looks like `…@…iam.gserviceaccount.com`).

4. **Point the frontend at the new backend**
   - Open the deployed PWA → Settings, and set the URL to
     `https://<your-project>.vercel.app/api/exec` and the key to `APP_KEY`.
   - Or edit `DEFAULT_WEB_APP_URL` in `index.html` and `import.html` so new
     visitors get the right default.

## Background jobs (cron)

The old GAS time triggers map to Vercel Cron hitting `/api/cron`:

| Job | Purpose | Schedule (GAS) |
| --- | --- | --- |
| `sync` | Re-apply rules to open rows | every 10 min |
| `suggest` | AI suggestions for open rows | 23:00 daily |
| `digest` | Telegram summary | 09:00 + 19:00 daily |

Configure these in Vercel → Settings → Cron Jobs, pointing at paths like:

```
/api/cron?job=sync&secret=YOUR_CRON_SECRET
```

Put the secret in the path **in the Vercel dashboard only** (never commit it).
Note: Vercel Hobby allows limited cron frequency — the 10-minute `sync` may
require a paid plan; `suggest`/`digest` (daily) work on Hobby.

## Hybrid Gmail forwarder

[`gas-forwarder/Code.gs`](gas-forwarder/Code.gs) is the only remaining Apps
Script. It forwards unread Kotak alert emails to `/api/exec?action=ingest`.
Follow the setup comments in that file and add an hourly trigger.

## Local development

```bash
npm install
npm test        # runs the Node test runner (test/*.test.mjs)
```

The unit tests cover the pure logic (parsers, date/key helpers, summary,
history filtering, import mapping). Sheets/AI/Telegram paths need real
credentials, so they're exercised against the deployed environment.
