<p align="center"><img src="avatar.png" width="110" alt="Finance avatar"></p>

# Deb Finance Tracker

A simple money tracker for our PG/hostel.

Bank alerts and statements come into one place, get sorted into **Business** or
**Personal**, and show what came in, what went out, and what is left — without
opening a spreadsheet.

## What it does

- **Pending** — every new payment waits here until you give it a bucket and a
  category. One tap confirms it.
- **Month** — money received, business income and spend, personal spending, and
  what is left over.
- **History** — every transaction, searchable and editable, with money in green
  and money out red.
- **Import** — drop in a bank statement (CSV, Excel or PDF) and it fills the
  gaps.
- **Telegram** — text the bot in plain English ("KSS Mart is personal
  cigarettes", "hide this from family view"); it sorts the payment, adds notes,
  and asks when it is unsure.
- **Family view** — a password-protected page with the month's totals and a
  simple money-in / money-out list.

## The three screens

| Screen | What it is for |
| --- | --- |
| Pending | New payments that still need a category |
| Month | This month's numbers at a glance |
| History | All transactions, searchable |

## Using it

Open **https://deb-finance.vercel.app** on your phone and enter the access key
once. It then stays on your phone like an app.

The family page lives at **/mom.html** and has its own password.

The access key, passwords and setup details are not kept in this file.

## Technical guide

Everything technical — setup, the Google Sheet layout, the API, deployment and
troubleshooting — is in **[TECHNICAL.md](TECHNICAL.md)**.

## License

MIT — see [LICENSE](./LICENSE).
