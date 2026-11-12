# Vigil · a live watch over Earth

A 3D globe of what the planet is doing right now, built entirely on NASA open data, with alerts for the places you care about.

- **NASA EONET**: open natural events (wildfires, storms with their tracks, volcanoes, icebergs, floods…), refreshed every 10 min
- **NASA FIRMS**: every satellite fire detection from the last 24 h (~50k points) as a heatmap that resolves into individual hotspots
- **A detailed 3D Earth**: cloud-free Sentinel-2 imagery (EOX) that hands over to Esri World Imagery up close, real terrain (AWS Terrain Tiles), sharp OpenFreeMap labels, and Google Earth-style tilted fly-ins
- **NASA GIBS** overlays: today's VIIRS satellite pass, cloud cover, cloud-top temperature, precipitation, smoke/aerosols, city lights, borders and labels, with a 30-day timeline you can scrub or play
- **Search any place** (or click anywhere on the globe): Vigil frames it and tells you what's happening within 25–500 km: natural events, fires, earthquakes (USGS), current weather and 3-day forecast, air quality (Open-Meteo), and plain-language warnings for heat, cold, heavy rain, wind, storms and bad air
- **Alerts** by Email, Telegram, WhatsApp, SMS, Discord or Slack. The server checks every watched place every 15 minutes and only notifies about *new* events.

## Run it

```bash
npm install
npm run dev          # web on http://localhost:5173, API on :8787
```

Nothing needs a key to run. Every alert channel without credentials runs in **dry-run** mode: the exact message is printed in the API log, so you can try the whole flow before signing up for anything.

## Turning on real alerts

Copy `.env.example` to `.env` and fill in only the channels you want, then restart the server.

| Channel | What you need | Where to get it |
|---|---|---|
| Email | Any SMTP account (`SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`) | Resend, Brevo, Postmark, SES, or a Gmail app password |
| Telegram | `TELEGRAM_BOT_TOKEN` | Message **@BotFather** → `/newbot`. No webhook needed: the server long-polls, and users link their chat with a "Start" button |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` | twilio.com console → buy an SMS-capable number |
| WhatsApp | same Twilio credentials + `TWILIO_WHATSAPP_FROM` | Start with the Twilio WhatsApp sandbox (each recipient sends the join code once). Production needs an approved WhatsApp sender and message templates |
| Discord / Slack | nothing on the server | Users paste their own incoming-webhook URL |
| FIRMS (optional) | `FIRMS_MAP_KEY` | firms.modaps.eosdis.nasa.gov/api/map_key. Without it Vigil uses FIRMS' public 24-hour files |

Set `PUBLIC_URL` to your real domain so the "Open the globe" and "Stop watching" links in messages point at it.

## Deploying

**Free, recommended:** Vercel (site + API) + Supabase (database + 15-minute scheduler). Follow **[DEPLOY.md](DEPLOY.md)**, about 20 minutes.

**Self-hosted (any VM, e.g. Oracle Cloud Always Free):**
```bash
docker build -t vigil .
docker run -p 8787:8787 --env-file .env -v vigil-data:/app/data vigil
```
One process serves the site and the API, and runs the 15-minute timer itself. It uses Supabase if configured, otherwise `data/watches.json`.

## NASA API keys

Vigil doesn't call `api.nasa.gov`, so the NASA developer key (and its 1,000 requests/hour limit) doesn't apply.
EONET, GIBS and FIRMS' public files are open services with no key. The server caches EONET and FIRMS at the CDN,
so NASA receives roughly the same handful of requests per hour whether 10 or 10,000 people are watching.
Imagery tiles come from GIBS' own CDN in each browser. Get an api.nasa.gov key only if you add APOD, NeoWs, DONKI or EPIC.

## How it fits together

```
src/                    React + MapLibre GL (globe projection)
  components/Globe.tsx   all map layers: GIBS rasters, fire heatmap, events, tracks, night side, watch radius
  components/*.tsx       ledger, search, place panel, alert sheet, timeline, layers, intro
  lib/gibs.ts            GIBS layer catalogue and tile URLs
server/
  data/eonet.ts          EONET fetch + normalise + cache
  data/firms.ts          FIRMS CSV → compact hotspots, with satellite fallbacks
  alerts/engine.ts       matching (any track point inside the radius), de-duplication, 15-min sweep
  alerts/channels.ts     email (SMTP), Telegram, Twilio SMS/WhatsApp, Discord, Slack
  alerts/telegram-bot.ts deep-link chat linking (webhook in production, polling locally)
  app.ts                 the HTTP API (Express), shared by Vercel (api/index.ts) and local/self-hosted (index.ts)
  store.ts               Supabase Postgres, or a JSON file locally
supabase/                schema.sql (tables) and cron.sql (15-minute scheduler)
```

Typefaces: Newsreader (display), Schibsted Grotesk (interface), Fragment Mono (data), all self-hosted through Fontsource.
Place search: Photon / OpenStreetMap.

Vigil is not an emergency service. NASA feeds can lag reality by hours; always follow local authorities.
