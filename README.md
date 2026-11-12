<p align="center"><img src="avatar.png" width="110" alt="Finance avatar"></p>

# Deb Finance Tracker

> **Turn bank noise into a calm, clear picture of your money.**

A private, installable finance tracker that brings every payment into one place,
sorts it with rules and AI suggestions, and shows what came in, what went out,
and what is left — without a spreadsheet full of tabs.

## Highlights

| Feature | What it does |
| --- | --- |
| **One inbox for money** | Bank alerts, forwarded emails and statement files (CSV, Excel, PDF) arrive in one queue. |
| **Smart categorisation** | Rules and AI suggestions learn your categories; you only confirm what is new. |
| **Three calm views** | Pending, Month and History — each with a single job. |
| **Duplicate protection** | Reference, date and amount matching stops the same payment landing twice. |
| **Plain-English Telegram assistant** | Text it like a person; it previews changes, asks when unsure, and undoes in one tap. |
| **Shareable summary** | A password-protected, read-only page for the people who need the headline, not the keyboard. |
| **Offline-ready PWA** | Install it on your phone; the shell opens instantly. |
| **Your data, your sheet** | Stored in your own Google Sheet — no vendor lock-in. |
| **Private by default** | Single-owner access key, secret webhook and an allow-listed Telegram chat. |

## How it works

1. **Capture** — bank alerts, forwarded emails and statement files land in one place.
2. **Confirm** — Pending asks only for the bucket and category it does not know; one tap.
3. **Understand** — Month and History show money in, money out, what is left, and where it went.
4. **Share (optional)** — a password-protected summary for family or a partner.

## The three views

| View | What it is for |
| --- | --- |
| **Pending** | New payments that need a decision — nothing else. |
| **Month** | In, out, business vs personal, and what is left. |
| **History** | Every transaction, searchable, editable, colour-coded. |

## Built for calm

- Fast, single-purpose screens.
- Plain language, not accounting jargon.
- Green for money in, red for money out.
- Notes, categories, and a hide-from-shared-view flag when you need them.
- Nothing is deleted silently; every action can be undone.

## Under the hood

A static PWA, a small serverless API, Google Sheets as the database, Telegram for
the conversational layer, and an AI model that only *suggests* — the server
validates every change.

## Privacy & security

- One owner key protects the app API.
- The Telegram webhook is secret-protected and only the configured chat is allowed.
- No third-party analytics.
- Your transactions live in your own Google Sheet.

## Technical guide

Setup, architecture, the sheet layout, the API and deployment live in
**[TECHNICAL.md](TECHNICAL.md)**.

## License

MIT — see [LICENSE](./LICENSE).
