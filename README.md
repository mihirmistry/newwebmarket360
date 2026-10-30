# Market360X website

Marketing site plus the **Nifty 50 market sentiment dashboard** and its admin panel.

**Stack:** TypeScript · Node.js (Express) · PostgreSQL · EJS server-rendered pages.

## What's where

| Path | Purpose |
|---|---|
| `src/server.ts`, `src/app.ts` | Server entry point and Express app (security headers, routes) |
| `src/routes/` | Marketing pages, public API, admin pages + admin API |
| `src/services/alerts.ts` | Alert queries, validation, transactional bulk save |
| `src/shared/sentiment.ts` | **The sentiment formula**, shared by server, dashboard and admin preview |
| `src/shared/indicators.ts` | Automatic indicators: the built-in list, RSI/MACD/EMA/ROC maths and the +1 / 0 / −1 rule |
| `src/services/angelone.ts`, `src/services/auto-indicators.ts` | Angel One SmartAPI client (TOTP login, candles, quotes, PCR) and the 15-minute refresh |
| `src/client/` | Browser scripts (dashboard auto-refresh, admin editor), bundled to `public/js/` |
| `views/pages/` | The site pages (`home`, `about`, `features`, `nifty-alert`, `contact`, `checkout`, `legal`, `options`, `algo`, `stocks`, `crypto`) |
| `src/site/legal.ts` | Text of the five legal policy pages (rendered by `views/pages/legal.ejs`) |
| `views/partials/` | Shared head, header (nav), footer and the sentiment dashboard |
| `views/admin/` | Admin login and alerts editor |
| `migrations/` | Database schema (SQL), applied by `npm run migrate` |
| `public/` | Static files: CSS, images, fonts, vendor scripts |
| `tests/` | Unit tests (formula) and integration tests (real PostgreSQL) |

Pages use clean URLs (`/about`, `/nifty-alert`, ...). Old `.html` links redirect automatically.

## Run it locally

Requires Node.js 20.11+.

```bash
npm install
cp .env.example .env          # then set SESSION_SECRET (see the file for a generator command)
npm run db:local              # terminal 1: local PostgreSQL, no install needed; keep it running
npm run migrate               # terminal 2: create tables + the 9 starter indicators
npm run create-admin -- --email you@example.com   # asks for a password (min 12 characters)
npm run dev                   # http://localhost:3000
```

- Public dashboard: `http://localhost:3000/#sentiment`
- Admin panel: `http://localhost:3000/admin`

## Deploy to production

You need a Node.js host (VPS, Render, Railway, Fly.io, etc.) and a PostgreSQL database
(managed Postgres from the host, Neon, Supabase, AWS RDS, ...).

1. Set environment variables on the host:
   - `NODE_ENV=production`
   - `DATABASE_URL=postgres://user:password@host:5432/dbname`
   - `DATABASE_SSL=true` if your provider requires SSL (most managed ones do)
   - `SESSION_SECRET=` a long random string (48+ random bytes). **Keep it the same forever**: it also encrypts the
     SMTP password saved in Admin > Settings (changing it means re-entering that password).
   - `TRUST_PROXY=true` if HTTPS is terminated by a proxy or load balancer (most platforms)
   - `PORT` if your host doesn't set it
   - Optional settings (payment QR, customer accounts, `.env` email fallback) are listed in `.env.example`.
2. Build and prepare (Node.js 20.11+):
   ```bash
   npm ci --include=dev   # the build needs TypeScript/esbuild even when NODE_ENV=production
   npm run build
   npm run migrate:prod   # creates/updates the database tables; safe to run on every deploy
   ADMIN_PASSWORD='...' npm run create-admin:prod -- --email you@example.com
   ```
3. Start: `npm start` (keep it running with your host's process manager, e.g. PM2 or systemd on a VPS)
4. Sign in at `/admin`, open **Settings** and set up email (SMTP + where order/message notifications go).

Serve the site over **HTTPS**: admin session cookies are marked `Secure` in production.
Running `create-admin` again with the same email resets that admin's password.
The site needs no external services besides PostgreSQL; the header index strip fetches public data from Yahoo Finance,
so outbound HTTPS from the server must be allowed.

## QR checkout (how plans are bought right now)

1. Plan buttons ("Get weekly / monthly / yearly") open `/checkout?plan=weekly|monthly|yearly`.
2. The customer pays by UPI using the business QR (`public/images/payment/qr-market360x.webp`, payee shown as
   `PAYMENT_UPI_NAME`) and types the plan amount, which the page highlights. Optionally set `PAYMENT_UPI_ID` and the site
   draws a QR with the exact amount filled in instead. `PAYMENT_QR_IMAGE=none` (and no UPI ID) shows "contact us".
3. They fill in name, email, mobile, years in the market, an optional UPI transaction ID, and tick "I have paid".
4. The order is saved in `plan_orders` and emailed to the addresses set in **Admin > Settings**; the customer sees
   "Thank you... you will receive your login credentials within 24 hours".
5. The admin checks the payment, creates the login, emails the credentials, and marks the order done at `/admin/orders`.
   Orders show up there even if email isn't configured or fails.

Prices always come from `src/site/plans.ts` on the server, never from the browser.

**Email setup:** sign in to the admin panel and open **Settings**: enter the SMTP server, port, security, username
and password (stored encrypted with a key derived from `SESSION_SECRET`), choose who receives notifications (up to 5
addresses) and whether new orders and/or Contact messages are emailed, then use **Send test email**. The `SMTP_*` /
`ADMIN_EMAIL` values in `.env` are only a fallback until settings are saved there.

**Gmail as the sender:** `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=you@gmail.com`,
`SMTP_PASS=` a 16-character [App Password](https://myaccount.google.com/apppasswords) (needs 2-step verification).

## Customer accounts (switched off for now)

Log in / sign up, the header profile menu and the customer dashboard (`/account`, `/account/profile`, `/account/plan`)
are built but hidden. Set `CUSTOMER_ACCOUNTS=true` to bring them back: plan buttons then open a Log in / Sign up popup,
and checkout pre-fills the signed-in customer's details. Passwords need 8+ characters, a capital letter, a number and a
symbol (`PASSWORD_RULES` in `src/shared/customer-rules.ts`). Customer logins are separate from admin logins.

Icons come from [Lucide](https://lucide.dev) (`lucide-static`), inlined by the server: `<%- icon("mail") %>` in any view.

## Admin panel

`/admin` is a sidebar dashboard: **Dashboard** (orders waiting, completed revenue, new messages, Nifty sentiment,
recent activity, email status), **Nifty alerts**, **Orders**, **Messages** and **Settings** (SMTP + notification emails,
and the Angel One SmartAPI login for automatic indicators).
Sidebar badges show waiting orders and new messages. Cards use at most 10px rounded corners.

## Dark and light mode

The sun/moon button in the header switches the public site between light (default) and dark. The choice is saved in
the visitor's browser. `/js/theme.js` runs in the page head so the saved theme applies before the page paints.
Colours in our CSS come from theme variables (`--t-ink`, `--t-surface`, `--t-page`, ... in `main.css`); dark mode
redefines them under `html[data-theme="dark"]`. When adding styles, use those variables instead of fixed colours.

## Header index strip

The dark bar at the top of every page scrolls NIFTY, SENSEX, BANKNIFTY, FINNIFTY, BANKEX and MIDCPNIFTY with their change
since the previous close. The server fetches them from Yahoo Finance (`src/services/market-quotes.ts`, no API key), caches
them for 60 seconds and serves them at `/api/market/indices`; the browser refreshes every minute. If the source is down,
the last good numbers stay on screen. Yahoo's data is unofficial and may be delayed, so for a production trading service
consider switching the provider to an official broker/exchange data API (e.g. Upstox, Angel One SmartAPI, Kite Connect):
only `createYahooMarketQuotes` needs replacing.

## Legal policy pages

The footer links five policies, each at its own URL: `/terms-and-conditions`, `/privacy-policy`, `/refund-policy`,
`/gdpr-compliance` and `/risk-disclosure`. Their text lives in `src/site/legal.ts` (one entry per page, one block per section;
the table of contents is built from the sections). Change `LEGAL_UPDATED` there whenever the wording changes.

## Contact page

`/contact` has a form (name, email, optional mobile, topic, message) that saves to the `contact_messages` table.
Admins read, mark as handled and delete messages at `/admin/messages`. The form is CSRF-protected, rate-limited
(5 per 15 minutes) and has a hidden honeypot field against bots.

## How the sentiment is calculated

For enabled alerts only: bullish strength **B** = sum of positive values, bearish strength **D** = sum of
absolute negative values. Sentiment = (B − D) ÷ (B + D) × 100, rounded to a whole number; 0% when there
are no non-zero values. Above 0% is Bullish, below 0% is Bearish, 0% is Neutral. Example: +2, +1, +2, +1,
−2, −1 gives +33% Bullish. This measures the balance of configured signals; it is not a prediction.

The public dashboard refreshes from `/api/nifty-sentiment` every 20 seconds.

## Automatic indicators (Angel One SmartAPI)

An alert row is either **entered by hand** (the admin types its value) or **automatic**: one of the built-in
indicators in `src/shared/indicators.ts` (RSI 14, MACD histogram, 20-day EMA, 10-day rate of change, Nifty 50 close,
India VIX, Nifty put-call ratio, Supertrend 10/3, Nifty 50 advance / decline). Every automatic indicator uses the same rule: today's value is
compared with the previous close; a change within the row's threshold scores **0**, otherwise **+1** if it moved the
bullish way and **−1** if it moved the bearish way ("Rise = bullish", or "Rise = bearish" for India VIX). The score
becomes the row's signal value, so the sentiment formula above is unchanged. Supertrend's value is the Nifty close minus
the Supertrend line (positive in an uptrend, negative in a downtrend), so a trend flip is a large change. Advance /
decline is advancing minus declining Nifty 50 stocks (−50 to +50), each stock's live price against its previous close:
the stock list comes from NSE's published Nifty 50 file and the tokens from Angel One's public instrument list
(downloaded about once a week), and one quote call prices all 50. It is stored per day (`market_series_daily`); when
the previous trading day is missing it is worked out once from the 50 stocks' daily candles (about 20 seconds).
An indicator marked `available: false` in `src/shared/indicators.ts` shows in the Source list as "coming soon".
Angel One limits how often each API can be called; the client waits and retries when it answers "exceeding access rate".

Setup: create an app at smartapi.angelbroking.com (its **static IP** must be the public IP of the machine running
the site), enable TOTP and copy the text under the QR code, then enter the client code, API key, PIN and TOTP secret
in **Admin → Settings → Angel One** (stored encrypted with `SESSION_SECRET`) and tick "Update indicators automatically".
The server then logs in by itself and updates every 15 minutes from 9:15 AM to 3:35 PM IST on weekdays, plus once after
the close; **Refresh now** on the Nifty alerts page updates on demand. Values are calculated from Nifty 50 and India VIX
daily candles (with today's live price as the latest close). The put-call ratio is stored once per trading day
(`market_series_daily`), so it scores from its second day. Adding a new kind of indicator is a code change in
`src/shared/indicators.ts`; admins can then add, remove and reorder rows of it freely.

## Security notes

- Admin pages and API check the signed-in session on the server for every request.
- Passwords are hashed with scrypt; sessions are stored in PostgreSQL; the session id rotates on login.
- All state-changing requests require a CSRF token; login attempts are rate-limited.
- Strict Content-Security-Policy (no inline scripts); all SQL uses parameters; inputs are validated with zod.

## Tests

```bash
npm test        # unit + integration tests (starts a throwaway PostgreSQL automatically)
npm run typecheck
```
