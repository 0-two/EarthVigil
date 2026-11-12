# Putting Vigil online

**Stack:** Vercel (site + API, free) · Supabase (database + 15-minute scheduler, free) · GitHub (source, free).
Time: about 20 minutes. Cost: $0.

```
 visitors ──► Vercel CDN ──► static site (cached worldwide)
                  │
                  ├──► /api/events, /api/fires   cached 10–30 min at the edge → NASA sees ~10 requests/hour total
                  ├──► /api/watches …            serverless function ──► Supabase Postgres
                  └──► /api/cron/sweep  ◄── Supabase pg_cron, every 15 min (sends alerts)
 GIBS imagery tiles load straight from NASA's own CDN in each visitor's browser.
```

---

## 1 · Supabase: the database

1. Sign up at **supabase.com** → **New project**. Pick a region near your users and save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and press **Run**.
3. Go to **Project Settings → API** and copy two values:
   - **Project URL** → this becomes `SUPABASE_URL`
   - **service_role** secret key → this becomes `SUPABASE_SERVICE_ROLE_KEY` (server-only, never paste it into frontend code)

## 2 · GitHub: the source

```bash
git remote add origin https://github.com/<you>/vigil.git
git push -u origin main
```
(Create the empty repository on github.com first. Keep it private if you like; Vercel can read private repos.)

## 3 · Vercel: the site and API

1. Sign up at **vercel.com** with GitHub → **Add New → Project** → import the repository.
   Vercel reads `vercel.json`, so leave the framework and build settings as they are.
2. Before pressing Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
   | `CRON_SECRET` | a long random string, made with: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |

   Add channel keys now or later (see step 5). Every change to a variable needs a **Redeploy** to take effect.
3. **Deploy.** Then open `https://<your-app>.vercel.app/api/health`. It should show `"storage":"supabase"`.

## 4 · Supabase: the 15-minute alert sweep

Vercel's free plan only runs cron jobs once a day (that daily job is already in `vercel.json` as a backup).
Supabase's built-in scheduler runs the real one.

1. Open [`supabase/cron.sql`](supabase/cron.sql). Replace `https://YOUR-APP.vercel.app` with your URL and `YOUR_CRON_SECRET` with the value from step 3.
2. Paste it into **SQL Editor** and run it.
3. After 15 minutes, check that it fired:
   ```sql
   select status_code, left(content::text, 120), created from net._http_response order by created desc limit 5;
   ```
   You want `200` and something like `{"watches":0,"alerted":0,...}`.

This job also keeps the free Supabase project active, so it won't auto-pause after a quiet week.

## 5 · Alert channels (add whenever you're ready)

Add the variables in Vercel → **Settings → Environment Variables**, then **Redeploy**.

- **Email:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.
  Resend's free plan (3,000 emails/month) works over SMTP: host `smtp.resend.com`, user `resend`, password = your API key. Verify your domain there so mail doesn't land in spam.
- **Telegram:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (any random string). After the redeploy, register the webhook once from your machine:
  ```bash
  npm run telegram:webhook -- https://<your-app>.vercel.app
  ```
- **SMS / WhatsApp:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_WHATSAPP_FROM`.
  These are paid per message (no free tier beyond trial credit). WhatsApp to the public needs an approved sender and templates.
- **Discord / Slack:** nothing to configure.

## 6 · Your own domain (optional)

Vercel → **Settings → Domains** → add `yourdomain.com` and follow the DNS instructions. HTTPS is automatic.
Set `PUBLIC_URL=https://yourdomain.com` and redeploy, so links inside alerts use it. Update the URL in `supabase/cron.sql` too and run it again.

---

## Free-tier headroom

| Limit | Free allowance | What Vigil uses |
|---|---|---|
| Vercel CDN requests | ~1M / month | about 12 per new visitor (page, scripts, fonts, 3 API calls). Roughly 80k visits a month |
| Vercel bandwidth | 100 GB / month | about 1.2 MB per first visit, less on return visits |
| Vercel functions | ~1M invocations, 300 s max | cached data calls don't invoke the function; a sweep of thousands of watches takes seconds |
| Supabase database | 500 MB | about 1–2 KB per watch, so hundreds of thousands of watches |
| Supabase egress | 5 GB / month | a sweep reads every watch (about 0.6 KB each), but only when NASA's data changed since the last one (about 30–50 times a day). Comfortable up to roughly 5,000 watches; beyond that, Supabase Pro has 250 GB |
| NASA | no key needed | ~10 requests/hour total, thanks to the CDN cache |
| USGS earthquakes | no key needed | one 30 KB feed per sweep, shared by every watch |
| Open-Meteo (weather & air) | 10,000 calls/day, non-commercial | 2 calls per watch with warnings on, every 6 hours: about 8 a day each, so roughly 1,200 such watches. Each sweep checks at most 150 places, oldest first |

**Watch out:** Vercel's Hobby plan is for **non-commercial** use. Once Vigil earns money (ads, paid alerts), move to Vercel Pro ($20/month). That also unlocks per-minute crons, so the Supabase scheduler becomes optional.

When you outgrow it: Supabase Pro ($25/month) or Neon for the database. Or self-host on any VM with the included `Dockerfile` (Oracle Cloud's Always Free VM works), where the server runs its own 15-minute timer.

## Before you announce it

- [ ] `/api/health` shows `"storage":"supabase"`
- [ ] Create a watch with your own email and Telegram, then press **Send a test signal**
- [ ] Open the **Stop watching** link from the email and confirm it removes the watch
- [ ] `net._http_response` shows a `200` every 15 minutes
- [ ] Share the link in a chat to check the preview image appears
