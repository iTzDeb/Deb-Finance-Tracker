# Deb Finance Tracker

[![tests](https://github.com/iTzDeb/Deb-Finance-Tracker/actions/workflows/test.yml/badge.svg)](https://github.com/iTzDeb/Deb-Finance-Tracker/actions/workflows/test.yml)

A personal finance tracker for a PG/hostel business: a static installable PWA
on GitHub Pages, a small Node.js (ESM) backend on Vercel Functions, and
**Google Sheets as the database**. It replaces an older Google Apps Script web
app; the only remaining Apps Script is the Gmail forwarder.

The app ingests bank alerts (SMS/email), imports bank statements, applies
categorisation rules, asks an LLM for suggestions, and gives three daily views:
**Pending**, **Month** and **History**.

---

## Contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Data model](#data-model)
- [Request lifecycle](#request-lifecycle)
- [HTTP API](#http-api)
- [Ingest (SMS / email)](#ingest-sms--email)
- [Statement import](#statement-import)
- [Telegram bot](#telegram-bot)
- [Background jobs (cron)](#background-jobs-cron)
- [Frontend (PWA)](#frontend-pwa)
- [Deployment](#deployment)
- [Security model](#security-model)
- [Local development and tests](#local-development-and-tests)
- [Development workflow](#development-workflow)
- [Operations and troubleshooting](#operations-and-troubleshooting)
- [Known limitations and design notes](#known-limitations-and-design-notes)
- [License](#license)

---

## Architecture

```
                        ┌───────────────────────────────┐
                        │  GitHub Pages (static PWA)    │
                        │  index.html · import.html     │
                        │  manifest.json · sw.js        │
                        │  localStorage (cfg, pending)  │
                        │  IndexedDB (10-day history)   │
                        └───────────────┬───────────────┘
                                        │ fetch, GET ?key=…&action=…
                                        │ (JSONP callback= still accepted)
                                        ▼
┌───────────────┐   POST/GET    ┌───────────────────────┐   Sheets API v4   ┌───────────────┐
│ iOS Shortcut  │──────────────▶│  Vercel Functions     │──────────────────▶│ Google Sheets │
│ (BOI SMS)     │               │  api/exec.js          │                   │ Transactions  │
├───────────────┤               │  api/cron.js          │                   │ Rules         │
│ GAS forwarder │──────────────▶│  api/maintenance.js   │                   │ Staging       │
│ (Kotak email) │               │  api/digest.js        │                   └───────────────┘
└───────────────┘               └───────────▲───────────┘
                                            │ Authorization: Bearer $CRON_SECRET
                                  ┌─────────┴─────────┐
                                  │   Vercel Cron     │
                                  │ 21:30 / 03:30 UTC │
                                  └───────────────────┘
```

`/api/telegram` receives bot updates (questions, commands, buttons) and sends
replies through the same bot token as the digest.

**Components**

| Component | Where | What it does |
| --- | --- | --- |
| PWA shell | `index.html` | Pending / Month / History, settings, offline cache |
| Importer | `import.html` | Parses CSV/XLSX/PDF statements in the browser, stages rows, commits |
| API | `api/exec.js` | Key-authenticated JSON/JSONP endpoint for the PWA and forwarders |
| Cron | `api/cron.js`, `api/maintenance.js`, `api/digest.js` | Rule sync, AI suggestions, Telegram digest |
| Telegram bot | `api/telegram.js`, `lib/bot.js` | Asks about new payees, applies trusted rules, commands, undo |
| Domain logic | `lib/*.js` | Sheets client, parsers, rules, dedup, import, AI, digest, bot |
| Gmail forwarder | `gas-forwarder/Code.gs` | The only Apps Script left: forwards Kotak emails |
| Storage | Google Sheets | `Transactions`, `Rules`, `Staging`, `BotQuestions`, `BotLog`, `BotState` |

---

## Repository layout

| Path | Lines | Role |
| --- | --- | --- |
| `index.html` | ~1.3k | The PWA. Inline CSS/JS, no build step. Three tabs + bottom sheets |
| `import.html` | ~300 | Statement importer (CSV, Excel, PDF), same design language |
| `sw.js` | 30 | Service worker: precache shell, network-first navigations |
| `manifest.json` | 30 | PWA manifest (`id`, `scope`, icons) |
| `api/exec.js` | ~110 | HTTP entrypoint: CORS, key auth, body normalisation, JSONP |
| `api/cron.js` | ~70 | Cron handler factory + job table |
| `api/maintenance.js` | 3 | `/api/maintenance` → `sync` then `suggest` |
| `api/digest.js` | 3 | `/api/digest` → Telegram summary |
| `api/telegram.js` | ~50 | Telegram webhook: secret check, update_id dedupe, bot dispatch |
| `lib/config.js` | ~60 | Column names, buckets/categories, env secrets, AI prompt |
| `lib/sheet.js` | ~150 | Sheets REST v4 client, whole-column reads, batch writes |
| `lib/txn.js` | ~155 | Row ↔ object mapping, dedup, classify, append/update |
| `lib/rules.js` | ~65 | Rule load/upsert, `normKey_` matching |
| `lib/parse.js` | ~95 | Kotak SMS/email, BOI SMS, SBI SMS parsers |
| `lib/ingest.js` | ~70 | Forwarder endpoint: parse → classify → dedup → append |
| `lib/import.js` | ~200 | Staging, 3-pass dedup, commit/cancel |
| `lib/sync.js` | ~35 | Re-apply rules to open rows |
| `lib/ai.js` | ~85 | Suggestion prompting/validation (via `llm.js`) |
| `lib/llm.js` | ~60 | Shared LLM adapter: DeepSeek primary, Gemini fallback |
| `lib/telegram.js` | ~80 | Bot API client: send/edit/answer/setWebhook |
| `lib/bot.js` | ~700 | Questions, rules/undo, commands, LLM intents, webhook setup |
| `lib/digest.js` | ~30 | Telegram monthly summary |
| `lib/dispatch.js` | ~45 | Action table shared by HTTP and cron |
| `lib/util.js` | ~135 | Dates, keys, totals, request params, secret compare |
| `test/*.test.mjs` | — | Node test runner; includes a VM test for `import.html` |
| `.github/workflows/test.yml` | — | CI: Node 26, `npm ci`, `npm test` |

---

## Data model

Google Sheets is the source of truth. Three tabs, exact column order matters.

### `Transactions` (19 columns)

| # | Column | Notes |
| --- | --- | --- |
| A | Logged At | `YYYY-MM-DD HH:mm` in Asia/Kolkata |
| B | Date | `YYYY-MM-DD` (transaction date) |
| C | Direction | `DEBIT` or `CREDIT` |
| D | Amount | positive number |
| E | Counterparty | payee, cleaned from the narration where possible |
| F | Ref | bank/UPI reference; `NOREF-…`/`IMP-…` for generated ones |
| G | Source | `SMS-BOI`, `SMS-Kotak`, `Gmail-Kotak`, `Gmail-SBI`, `Import-<account>` |
| H | Account | `BOI`, `Kotak`, `Mother SBI current`, … |
| I | Status | `NEEDS REVIEW`, `PENDING`, `CONFIRMED` |
| J | Bucket | `Business`, `Personal`, `Internal`, `Deposit` |
| K | Category | one of the allowed categories (below) |
| L | Property | unit number, optional |
| M | Notes | free text; import `CHECK:` notes land here |
| N–P | Suggested Bucket / Category / Property | rule or AI suggestion |
| Q | AI Confidence | `high`, `medium`, `unsure` |
| R | AI Source | `Gemini`, `DeepSeek`, `Rule` |
| S | Accept | boolean (legacy) |

**Statuses**

| Status | Meaning |
| --- | --- |
| `NEEDS REVIEW` | No usable suggestion; the user must categorise |
| `PENDING` | Has a suggestion (rule or AI) and can be confirmed |
| `CONFIRMED` | Final; counts as categorised |
| `FORGOTTEN` | Terminal "leave it": out of Pending and out of Month/History totals, still in the sheet and visible in History under its filter |

**Buckets** — `Business`, `Personal`, `Internal`, `Deposit`.

**Categories** — Electricity, Plumbing, Repairs, Groceries, Rent, Staff, Chai and
snacks, Cigarettes, Fuel, Medicine, Food out, Family support, Self transfer,
Deposit refund, Tenant rent, Reimbursement, Other.

### `Rules` (5 columns)

`Counterparty`, `Bucket`, `Category`, `Property`, `Trusted`.

Rules are keyed by `normKey_(name)`: uppercase, titles (MR/MRS/MS/SHRI/SMT)
removed, non-letters stripped, first 9 characters. A **trusted** rule
auto-confirms matching new rows; an untrusted rule only fills the suggestion
columns. Saving a pending row upserts an untrusted rule; `bulkSave` (apply to a
payee group) upserts a trusted one. Editing an already-confirmed row preserves
the rule's existing trust flag.

### `Staging` (8 columns)

`Batch`, `Stamp`, `Direction`, `Amount`, `Counterparty`, `Ref`, `Account`,
`Source`. Only used during an import; cleared when the batch commits or is
cancelled.

### Bot tabs (created on demand by `botSetup` / the first update)

| Tab | Columns |
| --- | --- |
| `BotQuestions` | Id, Chat, Message, Key, Payee, Refs, Evidence, Suggestion, Status, Created, Resolved |
| `BotLog` | Id, At, Action, Payload, Before, After, Status |
| `BotState` | Key, Value (last update id, pause flag, asked/ignore timestamps) |

`BotQuestions` maps the bot's message id to a payee so a reply or inline button
can be resolved without conversation memory. `BotLog` is the audit trail and
the source for `/undo`.

---

## Request lifecycle

`api/exec.js` handles every PWA/forwarder call:

1. **Method** — `GET` or `POST` only (otherwise 405). `OPTIONS` returns 204 with CORS.
2. **Params** — `readRequestParams()` merges the query string with the body:
   - `GET` → query string.
   - `POST` JSON object, form-urlencoded, raw text, or a Buffer/stream (Vercel
     may hand the body over in any of these forms). A body with no `=` is
     treated as a raw SMS and exposed as `sms`.
   - The query string is merged with the body; **body values win on conflict**,
     which is why `?key=…` plus a JSON/form body both work.
3. **Auth** — `APP_KEY` must match `params.key` (constant-time compare). A
   missing `APP_KEY` is `server not configured`.
4. **Action** — `params.action`, or inferred as `ingest` when `sms`/`messages`
   is present. Only `EXEC_ACTIONS` are callable (cron-only jobs excluded).
5. **Response** — `{ ok: true, ...data }` or `{ ok: false, error }`, JSON, or
   JSONP when `callback` is a valid identifier. **`/api/exec` errors keep HTTP
   200** for legacy JSONP/Shortcut compatibility, so clients must check `ok`
   (cron endpoints do return 401/404/500). `cache-control: no-store` on every
   response. CORS is `*`.

```
GET  /api/exec?key=…&action=pending&callback=cb
GET  /api/exec?key=…&action=ingest&sms=<text>
POST /api/exec            { "key": "…", "action": "…", … }
POST /api/exec?key=…      <raw SMS text>
```

---

## HTTP API

All actions are `/api/exec` and require `key=APP_KEY`.

| Action | Params | Returns |
| --- | --- | --- |
| `pending` | — | `{ items }` — open rows, newest first |
| `summary` | `month` (`YYYY-MM`) | `{ summary }` |
| `save` | `ref`, `bucket`, `category`, `property`, `notes` | `{ updated: 1 }` |
| `bulkSave` | `payeeKey`, `bucket`, `category` | `{ updated, refs }` |
| `forget` | `ref` (any status) or `payeeKey` (open rows) | `{ updated, refs }` |
| `history` | `status`, `q`, `from`, `to`, `limit` (≤100), `offset` | `{ items, hasMore, totals, serverMs }` |
| `snapshot` | `from`, `to` | `{ items }` (all rows in range) |
| `importChunk` | `batch`, `rows` (JSON string) | `{ ok: true }` |
| `importCommit` | `batch` | `{ added, skipped, check }` |
| `importCancel` | `batch` | `{ ok: true }` |
| `ingest` | `sms` (string or array) or `messages` (array) | `{ added, parsed }` |

### Item shapes

`pending` item:

```
{ ref, stamp, date, time, direction, amount, counterparty, source, account,
  status, bucket, category, property, notes,
  sBucket, sCategory, sProperty, confidence }
```

`history` / `snapshot` item:

```
{ ref, stamp, date, direction, amount, counterparty, source, account,
  status, bucket, category, property, notes }
```

`summary`:

```
{ month,
  business: { [category]: total },   // business DEBIT by category
  personal: { [category]: total },   // personal DEBIT by category
  businessIncome, received, internal, pendingCount }
```

**Notes**

- `history` filters server-side by date/status/q, then pages; totals cover the
  whole filtered range, not just the page.
- `snapshot` is what feeds the offline cache; it rejects responses over 5,000
  rows rather than silently truncating.
- Totals **include open rows** by design (the Month/History figures are
  "everything logged", not "confirmed only") but **exclude `FORGOTTEN`**.
- `save` validates bucket/category against the allowed lists and upserts a rule
  (untrusted, or preserving the rule's existing trust). A failed rule upsert
  never turns a saved row into an error.

---

## Ingest (SMS / email)

`POST/GET /api/exec?action=ingest` (or the action inferred from `sms`).

**Accepted shapes**

```
GET  ?key=…&action=ingest&sms=<text>
GET  ?key=…&src=KOTAK_SMS&sms=<text>          (legacy forwarder)
POST { "key": "…", "sms": "<text>" }
POST { "key": "…", "sms": [{ "text": "…" }] }
POST { "key": "…", "messages": [{ "subject": "…", "body": "…" }] }
POST ?key=…   <raw SMS body>
```

**Parsers** (`lib/parse.js`), tried in order:

| Parser | Matches |
| --- | --- |
| Kotak SMS | `sent/received Rs…`, `UPI Ref:`, `from XX#### to`; 2- or 4-digit years |
| SBI SMS | only accounts ending **2175**; IMPS/NEFT/UPI |
| BOI SMS | `debited/credited`, `Rs/INR`, `UPI Ref No#`, `UPI/ref/NAME`, 2/4-digit years |

Non-transaction texts (OTP, one-time password, "don't share") are skipped.
Kotak/BOI alerts are guarded so they are never labelled SBI or BOI by mistake.

**Processing**

1. `classify()` — match the counterparty against `Rules`; trusted → `CONFIRMED`,
   otherwise `PENDING`.
2. `logTransactions()` — dedup:
   - by `Ref` against existing rows (generated `NOREF-`/`IMP-` refs excluded);
   - by `date|direction|amount` for the SBI account **and for any ref-less alert**
     (a ref-less Kotak SMS can otherwise duplicate on re-forward);
   - generate `NOREF-<12 hex>` when no ref exists.
3. Append matched rows in one Sheets call.

**iOS Shortcut (BOI)**

- Trigger: *When I receive a message* → sender contains `BOIIND` (or message
  contains `XX4245`).
- Action: *Get Contents of URL* → `https://<project>.vercel.app/api/exec`,
  method **POST**, Request Body **JSON**:
  - `key` = `APP_KEY`
  - `sms` = the **Message variable** (the coloured token, not the literal text
    `Message` — a literal sends no SMS and logs nothing).
- Or put `?key=…&action=ingest` in the URL and post the raw SMS as the body.

**Gmail forwarder**

`gas-forwarder/Code.gs` polls unread Kotak alert emails hourly and POSTs
`{ key, action: "ingest", messages: [{ subject, body }] }`. Re-sending is safe
because ingest dedups by ref.

---

## Statement import

The browser does the parsing; the server only stages and commits.

### Client-side (`import.html`)

1. Pick the **account** (Kotak, BOI, Mother SBI current, Paytm, Google Pay, Other).
2. Pick a **CSV, XLSX/XLS or PDF** file.
3. `readRows()`:
   - CSV/TXT → a small quoted-field parser (delimiter detected from the header);
   - XLSX/XLS → SheetJS from cdnjs (SRI-pinned);
   - PDF → pdf.js text extraction, grouped into lines by y-position.
4. `fromTable()` looks for a header row containing a date column and an
   amount/debit/credit/withdraw/deposit column. Then:
   - **Date** — `YYYY-MM-DD`, `dd-mm-yyyy`, `dd/mm/yy`, `dd-Mon-yy`;
     4-digit years are matched before 2-digit ones (`01-10-2026` ≠ 2020).
   - **Time** — from a time column or anywhere in the row; defaults to `00:00`.
   - **Direction** — separate Debit/Credit columns, or `Amount` + a
     `Dr/Cr`/`Type` column (spaces around the slash are handled).
   - **Narration** — `narrationParts()` extracts payee and ref:
     | Bank | Example | Payee | Ref |
     | --- | --- | --- | --- |
     | BOI | `UPI/627498773714/DR/THANDI/YESB/…` | `THANDI` | `627498773714` |
     | Kotak | `UPI/SHALINI GHOSH/UBIN/617985807272/…` | `SHALINI GHOSH` | `617985807272` |
     | Standard | `UPI/DR/627…/NAME/…` | `NAME` | `627…` |
     | NEFT/IMPS/RTGS | `NEFT/SBIN226275322203/SBIN/ITDTAX REFUND` | `ITDTAX REFUND` | `SBIN226275322203` |
     | Kotak IMPS | `SentIMPS628600308833Kakoli Sah/…` | `Kakoli Sah` | `628600308833` |
     | Card | `PCI/0165/PAYPAL *X/…` | `PAYPAL *X` | from the ref column |
     | Charges/interest | `CHRG: …`, `SBInt.Pd:…` | full text | from the ref column |
      | Paytm | `Paid to Sindhu Dixit`, `Received from …`, `Transferred to Self, …` | `Sindhu Dixit`, `Self Transfer · <bank>` | `UPI Ref No.` column |
   - **Ref priority** — the UPI ref inside the narration wins over the bank's
     ref column (Kotak's column holds `UPI-210039702734`, which SMS alerts never
     use); otherwise the ref column, otherwise none.
   - **Signed amounts** (Paytm `-240.00` / `+200.00`) set the direction; an
     unsigned amount falls back to the narration (`Received from …` → credit,
     `Paid to …` → debit). A `Dr/Cr` type column wins over the narration.
   - **Multi-sheet workbooks** (Paytm `Summary` + `Passbook Payment History`)
     pick the sheet whose name looks like transactions and has a header (else
     the largest sheet), so the Summary tab is ignored.
5. Preview: count, date range, paid/received totals, first 8 rows.
6. Import sends rows in **chunks of 12** (`importChunk`), then `importCommit`.

### Server-side (`lib/import.js`)

`importCommit` loads the staged batch and the current `Transactions`, then runs
a **3-pass dedup**:

1. **Ref** — skip when the same `ref` **and direction and amount** already exist
   (a reversal books the same UPI ref as both a debit and a credit; it is kept).
2. **Same day + payee + amount** (direction-sensitive) — skip.
3. **Payee + amount within ±1 day** — skip.

Rows that collide on **amount + date under a different payee** are still added,
but with a `CHECK: matches <name> (<date>)` note and `NEEDS REVIEW`, so a human
decides. Rows appended in the same commit are added to the index, so duplicates
inside one statement are caught. Staged rows are cleared in one call per
contiguous run.

Matched rows are also **enriched in place**: a fuller counterparty and an exact
transaction time from the newer statement backfill the existing row, and
truncated payee names (`DEB ZY`) are expanded to the fullest known name
(`DEB ZYOTI DAS`) when the match is unambiguous.

After each import the sheet is re-sorted by **Logged At**, so an older statement
lands in date/time order instead of at the bottom.

The importer also refuses a transaction date that cannot be parsed or an amount
≤ 0.

---

## Telegram bot

A conversational assistant on the same bot as the digest. It asks about new
payees, turns a confirmed reply into a **trusted rule** (with `/undo`), and
answers date-scoped commands.

**When it speaks**

- After `ingest` (SMS/email), for each new payee without a trusted rule: one
  message, up to 2 per call.
- After an import: one summary message ("N imported, M payees need a rule —
  /ask"), or up to 3 questions for small imports.
- The daily `maintenance` job asks up to 3.
- `/ask [period]` asks up to 10 for the chosen period (it bypasses the 7-day
  "already asked" window, but not open questions or ignores).

**Answering**

- Buttons: `Personal` / `Business` / `Internal` / `Ignore` /
  `Forget` / `Something else…`, plus `✅ <suggested bucket>/<category>` when a
  suggestion exists.
- Bucket → category keyboard → rule applied. The bot confirms how many open
  rows were confirmed and that `/undo` reverts it.
- `Ignore` silences that payee for 7 days.
- `Forget` marks the payee's open rows `FORGOTTEN` (out of Pending and totals,
  still in the sheet); `/undo` restores them.
- Free text: reply to the question (or just send it) — the LLM maps it to a
  validated action and shows an Apply/Cancel confirmation. Amounts such as
  ₹40/₹53/₹65 are the same payee; rules are never amount-specific.

**Commands**

| Command | Does |
| --- | --- |
| `/help` | command list |

The bot registers these with Telegram's `setMyCommands` and sets the menu
button to *commands*, so the blue **Menu** button lists them. Re-run
`?action=botSetup` after changing the list.
| `/pending` | open count + top 5 payees |
| `/ask [period]` | send questions now |
| `/summary [period]` | business result, received, personal, internal, open |
| `/spend <category> [period]` | payments + total for a category |
| `/rules` | rules and their trusted state |
| `/forget <payee>` | mark that payee's open rows FORGOTTEN |
| `/undo` | revert the last applied bot rule |
| `/pause`, `/resume` | stop/start new questions |
| `/status` | bot state, open questions, AI provider |

Periods: `2026-11`, `2026`, `2026-10-01..2026-11-12`, `today`,
`yesterday`, `this month`, `last month`, `last 30 days` (default: the
current month).

**Rule application and undo**

Applying a rule saves a trusted `Rules` row, sets every open transaction for
that payee to `CONFIRMED` with the chosen bucket/category/property, and writes
a `BotLog` row with the payload and the previous state. `/undo` restores the
previous rule (or clears it) and the affected rows. You can also delete the
rule directly in the sheet.

**Setup**

After deploying:

```
curl "https://<project>.vercel.app/api/exec?key=<APP_KEY>&action=botSetup&url=https://<project>.vercel.app"
```

This creates the three bot tabs, calls `setWebhook` for `/api/telegram`, and
sends a hello message. The webhook secret is derived from `APP_KEY`
(`sha256("tg:" + APP_KEY)`) unless `TG_WEBHOOK_SECRET` is set; rotating
`APP_KEY` requires re-running `botSetup`. `TG_TOKEN`/`TG_CHAT` are the same as
the digest. The endpoint only acts on `TG_CHAT` and dedupes `update_id`.

**AI** — DeepSeek is primary, Gemini the fallback (the free tier is rate
limited). The model only proposes an action; buckets and categories are
validated server-side, and nothing is written until Apply.

**Limits** — one question per payee per 7 days, 2 per ingest, 3 for imports,
10 per `/ask`; a fresh `/ask` is the override. In a group, free-text replies
need privacy mode off or a reply to the bot's message.

---

## Background jobs (cron)

Declared in `vercel.json`:

| Path | Job | Schedule (UTC) |
| --- | --- | --- |
| `/api/maintenance` | `sync` → `suggest` → `ask` (bot) | 21:30 daily (03:00 IST) |
| `/api/digest` | Telegram summary | 03:30 daily (09:00 IST) |

`/api/cron?job=sync|suggest|digest|maintenance` runs any job manually;
`maintenance` is the default if no job is given.

**Auth:** Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when
`CRON_SECRET` is set. The handler also accepts `?secret=` and `x-cron-secret`:

```
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://<project>.vercel.app/api/cron?job=sync"
```

**What each job does**

- `sync` — re-applies rules to `NEEDS REVIEW`/`PENDING` rows: trusted rules
  confirm, untrusted rules fill the suggestion columns. Writes are batched.
- `suggest` — asks Gemini (fallback DeepSeek) for bucket/category/property on
  open rows without a suggestion, and stores the confidence and the provider
  that answered. Never changes status.
- `digest` — posts the current-month summary + open-row count to Telegram.
- `maintenance` — `sync`, then `suggest`, then asks the bot about up to 3
  payees; a missing AI key does not fail the sync.

Hobby allows roughly one cron run per day; the old 10-minute sync and the 19:00
digest need a paid plan.

---

## Frontend (PWA)

A single-page app with no build step (inline CSS/JS) and a bottom tab bar.

| Tab | What it shows |
| --- | --- |
| **Pending** | Open rows. Filters All/Review/Suggested, search, Rows or Group-by-payee view. Confirm with a suggestion, edit details, or apply one bucket/category to every open row for a payee (which trusts the rule). |
| **Month** | Business result hero (income − business spend), received, personal spend, category bars, month arrows. |
| **History** | Sent/received totals, business/personal split, internal transfers, type filters, search, date presets/range, infinite scroll, day/month groupings, net per day/month, detail sheet with Edit. |

**Settings** (gear) — backend URL + app key, saved in `localStorage` under
`fin_cfg`; **Check connection** calls `pending`. The app shows "Setup required"
and opens Settings when no key is stored.

**Offline / caching**

- `localStorage` — `fin_cfg` (URL + key) and `fin_cache` (last pending list,
  shown while offline or until the refresh lands).
- `IndexedDB` (`fin-cache`) — a rolling **10-day** history window, refreshed
  from `snapshot`; older ranges are paged live from `history` (40 at a time).
- Service worker (`sw.js`, cache `finance-v20`) — precaches the shell; **network-
  first navigations** so a deploy is picked up without a manual cache bump;
  data requests are never cached (`vercel.app`, Google, `callback=` are skipped).
- **Import** links to `import.html`; the importer is a separate page.

Accessibility: skip link, `aria-live` status, focus-trapped bottom sheets with
inert background, `aria-pressed` toggles, reduced-motion support, dark mode,
`<dl>` detail lists.

---

## Deployment

### Vercel (backend)

1. Import this repo at [vercel.com/new](https://vercel.com/new), preset **Other**,
   root directory default. `api/*.js` become functions; `vercel.json` sets
   `maxDuration: 60` and the two crons.
2. Set environment variables (Project → Settings → Environment Variables):

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `APP_KEY` | yes | Shared secret the PWA/Shortcut/forwarder send as `key` |
   | `SPREADSHEET_ID` | yes | Spreadsheet id from the sheet URL |
   | `GOOGLE_SERVICE_ACCOUNT` | yes | Full service-account JSON as one string |
   | `CRON_SECRET` | recommended | Protects cron; Vercel sends it as a Bearer token |
   | `DEEPSEEK_KEY` | optional | AI primary (suggestions + bot) |
   | `GEMINI_KEY` | optional | AI fallback when DeepSeek fails |
   | `GEMINI_MODEL` | optional | Default `gemini-3.1-flash-lite` |
   | `TG_TOKEN`, `TG_CHAT` | optional | Telegram digest **and conversation bot** |
   | `TG_WEBHOOK_SECRET` | optional | Overrides the webhook secret derived from `APP_KEY` |
   | `OWNER_CONTEXT` | optional | Extra context in the AI prompt |

   `APP_KEY`, `SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT` are **sensitive** in
   Vercel: they can be set but not read back through the API.
3. Google Sheets access:
   1. Create a service account; enable the **Google Sheets API**.
   2. Create a JSON key; paste the whole JSON into `GOOGLE_SERVICE_ACCOUNT`.
   3. Share the spreadsheet with the service account email (**Editor**).
4. Point the PWA at `https://<project>.vercel.app/api/exec` (Settings), and set
   the key. Or change `DEFAULT_WEB_APP_URL` in `index.html`/`import.html`.

### GitHub Pages (frontend)

Serve the repository root from `main` (Settings → Pages → Deploy from branch →
`main` / root). No build step, no workflow. Files served: `index.html`,
`import.html`, `manifest.json`, `sw.js`, icons.

### CI

`.github/workflows/test.yml` runs on every push to `main` (and manual
dispatch): Node 26, `npm ci`, `npm test`.

---

## Security model

- **One shared key** (`APP_KEY`) guards the HTTP API. It lives in the PWA's
  `localStorage`, the iOS Shortcut, and the GAS forwarder — rotate all three
  together. The API compares it in constant time.
- The API returns **HTTP 200 even for auth/validation errors** (legacy JSONP),
  so clients must check `ok`. This is also why a misconfigured Shortcut looks
  like it "ran successfully".
- **JSONP** (`callback=`) is still accepted for old clients; the callback name
  is validated. Prefer JSON + CORS (`Access-Control-Allow-Origin: *`).
- **No secrets in the repo.** `.env` is gitignored; Vercel holds the secrets.
- The service-account key grants edit access to the sheet — treat it as a
  password; never commit it.
- CDN scripts in `import.html` are pinned with **SRI** hashes.
- All API responses are `cache-control: no-store`.
- **Telegram webhook** — `/api/telegram` accepts only POSTs carrying
  `X-Telegram-Bot-Api-Secret-Token` (derived from `APP_KEY` unless
  `TG_WEBHOOK_SECRET` is set) and only acts on `TG_CHAT`; `update_id` is
  deduped so a Telegram retry cannot double-apply a rule.

---

## Local development and tests

```bash
npm install
npm test        # node --test, discovers test/*.test.mjs
```

- Node: `engines: 26.x`, `.nvmrc` = 26; the suite also passes on Node 22.
- Tests (46):
  - `test/util-parse.test.mjs` — amounts, dates (incl. 4-digit years), keys,
    totals, request-param merging, secret compare, SMS parsers (real BOI alert,
    Kotak credit with forwarding metadata, SBI 2175);
  - `test/api.test.mjs` — item mapping, summary, history filtering/sorting;
  - `test/import.test.mjs` — staging mapping, 3-pass dedup, reversals,
    in-batch duplicates;
  - `test/import-html.test.mjs` — loads the inline importer from `import.html`
    in a VM and checks BOI/Kotak dates, directions, payees and refs;
  - `test/dispatch.test.mjs` — action table.
- Sheets/AI/Telegram paths need real credentials; they are exercised against
  the deployed environment.

---

## Development workflow

- **One branch: `main`.** Every change goes directly to `main`; CI runs on push;
  Vercel and Pages deploy from `main`. No feature branches or pull requests.
- **GitHub is the source of truth.** The code on github.com is final; local
  clones are disposable working copies — sync before working and never leave
  uncommitted/unpushed changes behind.
- Verify the deployment (Vercel READY, Pages updated) after pushing.

---

## Operations and troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| "Setup required" | No key in `localStorage`; open Settings, paste URL + `APP_KEY` |
| `unauthorized` | Key rotated or wrong; update Settings, the Shortcut and the GAS forwarder |
| Shortcut "ran" but nothing logged | Body `sms` is the literal text `Message` instead of the message variable; or the key is in the body but the URL is wrong |
| Import dates show **2020** | Old cached importer; hard-refresh the app (Cmd/Ctrl+Shift+R) so `sw.js` v20/network-first takes over |
| Duplicate rows after import | Review rows with a `CHECK:` note; the 3-pass dedup skips exact matches, CHECK flags the ambiguous ones |
| Re-importing is safe | Yes: ref and payee/amount/date passes skip existing rows |
| Import fails mid-way | `importCancel` clears the batch; Staging holds only a batch id, re-import after fixing |
| Cron returns 401 | `CRON_SECRET` missing/mismatched; Vercel sends it as a Bearer token automatically |
| Cron returns 500 | Check function logs; AI jobs degrade gracefully if the AI key is missing |
| Stale UI after a deploy | Hard-refresh once; navigations are network-first, but the open page stays as loaded |
| `Could not load the default credentials` | `GOOGLE_SERVICE_ACCOUNT` missing/invalid, or the sheet is not shared with the service account |
| Sheet rows past 999 invisible | Fixed: reads use whole columns, not `A1:S1000` |
| Bot silent | `botSetup` not run, wrong `TG_CHAT`, or the webhook secret changed; re-run the setup call and check `getWebhookInfo` |
| Bot asks nothing | `/pause`, the 7-day `asked:` window, an open question for that payee, or a trusted rule already exists; use `/ask` |
| `/undo` does nothing | only applied bot rule actions are undoable, one at a time |

**Rotating `APP_KEY`**: update Vercel → update the PWA Settings → update the iOS
Shortcut JSON → update `gas-forwarder/Code.gs` (script properties).
**Rotating `CRON_SECRET`**: update Vercel only; Vercel Cron picks it up
automatically.

---

## Known limitations and design notes

- **Totals include open rows** (Month/History) — intentional: the user wants
  "everything logged", not "confirmed only".
- **Hobby cron cadence** — one daily maintenance run; instant rule re-application
  and digest timing need a paid plan.
- **10-day offline window** — History older than 10 days is fetched live; there
  is no full offline mirror.
- **Payee truncation** — bank statements truncate names (e.g. `Pratik` vs
  `Pratik Kumar`); same-amount/same-date rows under different names are flagged
  with `CHECK` instead of being silently merged.
- **One shared key** — no per-device keys or rate limiting; a leaked key needs
  rotation everywhere.
- **JSONP kept** for compatibility; the app itself uses `fetch` + CORS.
- **Query-string key** — the key appears in URLs/logs; acceptable for a personal
  single-user tool, but a header-based scheme would be stronger.
- **Forgotten rows stay in the sheet** with no category; they are excluded from
  Month/History totals but appear in History's `Forgotten` filter.
- **Bot cost** — each free-text message is one LLM call (DeepSeek); buttons and
  commands are deterministic and free.
- **No conversation memory** — free text is interpreted from the question
  evidence and the message itself; the bot does not keep a chat transcript.
- **Group privacy mode** — in a group, free text may not reach the bot unless
  privacy mode is disabled or you reply to its message.

---

## License

MIT — see [LICENSE](./LICENSE).
