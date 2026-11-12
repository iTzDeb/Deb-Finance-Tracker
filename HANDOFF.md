# Handoff — 12 Nov 2026

Read this first next session; then only the files the task touches.

## Live

- App: **https://deb-finance.vercel.app/** — Vercel is the only host; GitHub Pages is disabled.
- Family view: **https://deb-finance.vercel.app/mom.html** (the `MOM_PASSWORD` env var is the password).
- Latest deploy: `6bbc800` (Vercel READY). `npm test`: **76 pass**.
- Sheet id is in Vercel env `SPREADSHEET_ID` (title *Expense Tracker 2026*).

## Current behaviour

- Tabs: `Transactions` (A–T; **T = Hidden**), `Staging`, `Rules`, `BotQuestions`, `BotLog`, `BotState`, `Categories` (Name | Active).
- **Hidden** hides a row from the family view only; it still counts in your own totals. Toggle in the edit sheet.
- **History** shows category and bucket as pills; the mom view shows a category pill.
- **Family view**: monthly cards + day-grouped transactions + search; green +in / red −out; hidden rows are filtered server-side (search can't see them).
- **Paytm is the default truth** for matched refs: its counterparty and exact time override bank/SMS values; generic “Self Transfer” labels never overwrite a person name.
- **Rules** have a `Direction` column (CREDIT/DEBIT/blank = both); the bot sets it from “credits”/“paid”. A direction-specific rule replaces an older both-directions rule for that payee.
- **Categories** are dynamic: `Categories` tab, `Active=FALSE` hides; the LLM adds/removes them ("add a category X", "remove X") and auto-adds on apply — no command.
- **Telegram**: /pending /ask /summary /spend /rules /forget /undo /pause /resume /status /help; menu registered via botSetup. Natural language also lists a named payee's transactions, hides/unhides named payees (family view only, undoable), and manages categories. Free-text rules apply to all matching transactions (confirmed included); amount/ref bulk works ("all 13 rupee ...", "all 500312... ...").
- Pages build failures are GitHub-side; Pages is disabled.

## Tomorrow: SBI setup

1. Get a sample statement first (CSV/XLSX/PDF). Note columns and whether rows have a UPI ref.
2. Where it lives:
   - `lib/config.js` — `SBI_ACCOUNT = 'Mother SBI current'`.
   - `lib/txn.js` — SBI composite dedup (date | direction | amount). Review: no ref means the composite is the main guard; check for same-day/same-amount legit duplicates.
   - `lib/parse.js` — SBI SMS/Gmail parser (existing Gmail-SBI rows); extend for the statement narration if needed.
   - `import.html` — `fromTable`/`narrationParts` for the SBI description format.
3. Procedure: dry-run the sample through the importer harness → compare against the sheet (added/skipped/check) → add a focused test → import → verify sorted → deploy.
4. Watch for double counting: SBI current rows may already exist via Gmail-SBI/SMS; composite + ref dedup should catch them. Paytm can then enrich names/times.

## Deferred / open

- **N–R columns**: N–Q (suggested bucket/category/property, AI confidence) are still used; **R (AI Source)** and **S (Accept)** are unused. Hide them or remove later.
- **Bot per-transaction tagging**: the bot is still payee-level ("this one only" is not wired); replies that name one amount/date create a payee rule or clarify.
- 7 duplicate BOI rows (9, 19, 35, 98, 155, 191, 299) — cleanup not approved.
- `dsh-plugin-finance-data` is blocked by a runtime mismatch (nothing installed).
- Old Pages PWA on the phone: uninstall and install from the Vercel URL.

## Cost / workflow notes

- Resuming this chat reuses the session; if the cache expired, this file + the README are the cheap path.
- Fast checks: `npm test`; `node --check` on changed JS; `leak_guard` before any push.
- Never commit secrets: `APP_KEY`, `GOOGLE_SERVICE_ACCOUNT`, `TG_TOKEN`, `MOM_PASSWORD`, `CRON_SECRET` live only in Vercel env.

## Bot redesign plan (priority)

Real Telegram phrasing kept breaking the single-intent LLM design. Stop patching
one message at a time; rebuild the intent layer around a validated action list.

### Failure classes seen today

| Message | Wrong result | Cause |
| --- | --- | --- |
| "No no personal, not business. My salary" | clarify | no memory (fixed), missing category |
| "Ravindra ... Teaching Payments (Part time Salary)" | Business / Staff | substituted an existing category; no direction |
| "Rohit Agarwal 2600 is personal shopping / note / hide" | only hid | one intent; note/hide not on create_rule |
| "Any transactions from Adarsh Kumar?" | month summary | no transactions intent |
| "Hide this from family view" | "Which payee(s)?" | no pronoun/last-payee context |
| "Adarsh kumar" | transactions again | pending clarification not tracked |
| History times +5:30 vs sheet | wrong times/dates | sheet serials formatted in IST (fixed to UTC wall clock) |
| "All 13 rupees transactions are for cigarettes" | could not match open payee | no amount selector (bulk added) |
| "All 500312789665/112026 ... personal; investment" | could not match open payee | numeric/ref payees were skipped (raw/ref matching + bulk added) |
| "All NAKUL / KSS Mart / KAKOLI ..." | could not match open payee | findPayee only looked at open rows (now any row; scope all) |
| "Transactions from KSS MART" | create_rule failed | intent classification; transactions lookup improved (engine next) |

### Target design

1. One message -> actions: [...] (a list), not one intent. Actions are typed and validated; each has its own executor.
2. Actions: rule{payee,bucket,category,property,direction,note,hide}, hide/unhide{payees}, transactions{payees,period}, note{payees,text}, summary, spend, category_add/category_remove, undo, clarify.
3. Deterministic executor: resolve payees/rows, validate enums, compute exact changes, show a preview ("I'll: ... [Apply] [Cancel]"). Apply logs each action for /undo.
4. Pending clarification state: if a payee/category is missing, store the partial action; the next message fills it ("Adarsh kumar").
5. Conversation: store user AND bot turns (role) in BotState; pass the last 6 to the LLM.
6. Fast paths before the LLM: hide/unhide, transactions from <payee>, add/remove category (regex) - deterministic, free, reliable.
7. Logging: every free-text stores the raw LLM JSON + resolved actions in BotLog for debugging.
8. Regression guard (scripts/eval-bot.mjs): ~25 fixtures (message -> expected actions) against DeepSeek; run manually, not CI.

### Phases

1. Schema + executor + preview + pending + logging + fixture tests (executor can be unit-tested without the LLM).
2. Eval harness + prompt iteration; target >=90% on the fixture set.
3. Fast paths + docs.

Seed the eval set with today's exact messages plus variants (numbers, two payees, corrections, direction, notes, multi-action).

### Status

- Done: memory (user messages), note/hide on create_rule, findPayee any row, scope all, amount/ref bulk + /undo, transactions for numeric refs, pills.
- Next: the action-array engine + preview + pending clarification + user/bot turns + eval harness.
