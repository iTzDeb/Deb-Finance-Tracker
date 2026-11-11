# Handoff — 12 Nov 2026

Read this first next session; then only the files the task touches.

## Live

- App: **https://deb-finance.vercel.app/** — Vercel is the only host; GitHub Pages is disabled.
- Family view: **https://deb-finance.vercel.app/mom.html** (password = `MOM_PASSWORD` in Vercel).
- Latest deploy: `b731f8a` (Vercel READY). `npm test`: **70 pass**.
- Sheet id is in Vercel env `SPREADSHEET_ID` (title *Expense Tracker 2026*).

## Current behaviour

- Tabs: `Transactions` (A–T; **T = Hidden**), `Staging`, `Rules`, `BotQuestions`, `BotLog`, `BotState`, `Categories` (Name | Active).
- **Hidden** hides a row from the family view only; it still counts in your own totals. Toggle in the edit sheet.
- **Family view**: monthly cards + day-grouped transactions + search; green +in / red −out; hidden rows are filtered server-side (search can't see them).
- **Paytm is the default truth** for matched refs: its counterparty and exact time override bank/SMS values; generic “Self Transfer” labels never overwrite a person name.
- **Categories** are dynamic: `Categories` tab, `Active=FALSE` hides; `/category list|add|remove`; applying a rule/save auto-adds.
- **Telegram**: /pending /ask /summary /spend /rules /forget /category /undo /pause /resume /status /help; menu registered via botSetup.
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
- 7 duplicate BOI rows (9, 19, 35, 98, 155, 191, 299) — cleanup not approved.
- `dsh-plugin-finance-data` is blocked by a runtime mismatch (nothing installed).
- Old Pages PWA on the phone: uninstall and install from the Vercel URL.

## Cost / workflow notes

- Resuming this chat reuses the session; if the cache expired, this file + the README are the cheap path.
- Fast checks: `npm test`; `node --check` on changed JS; `leak_guard` before any push.
- Never commit secrets: `APP_KEY`, `GOOGLE_SERVICE_ACCOUNT`, `TG_TOKEN`, `MOM_PASSWORD`, `CRON_SECRET` live only in Vercel env.
