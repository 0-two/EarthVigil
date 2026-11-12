/**
 * The HTTP API as an Express app with no listen() call:
 * Vercel wraps it as a serverless function (api/index.ts); server/index.ts runs it locally.
 */
import { configured, env } from './env.js'
import express, { type Request, type Response } from 'express'
import compression from 'compression'
import { getEvents } from './data/eonet.js'
import { getFires } from './data/firms.js'
import { hashIp, id, store, type Watch } from './store.js'
import { deliver } from './alerts/channels.js'
import { match, snapshot, sweep, welcome } from './alerts/engine.js'
import { botUsername, handleUpdate, type Update } from './alerts/telegram-bot.js'

const CATEGORIES = new Set(['drought', 'dustHaze', 'earthquakes', 'floods', 'landslides', 'manmade', 'seaLakeIce', 'severeStorms', 'snow', 'tempExtremes', 'volcanoes', 'waterColor', 'wildfires'])

export const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)
app.use(compression())
app.use(express.json({ limit: '32kb' }))
app.use(express.urlencoded({ extended: false }))

/**
 * Shared-cache headers. On Vercel the CDN keeps the response for `cdn` seconds and serves a stale copy
 * while it refreshes, so NASA sees a handful of requests an hour however many people are watching.
 */
const cache = (res: Response, browser: number, cdn: number, stale = cdn * 6) =>
  res.set('cache-control', `public, max-age=${browser}, s-maxage=${cdn}, stale-while-revalidate=${stale}`)
const noStore = (res: Response) => res.set('cache-control', 'no-store')

const ipOf = (req: Request) => hashIp(req.ip ?? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0] ?? '?')

/* ── data ───────────────────────────────────────────────────────── */
app.get('/api/events', async (_req, res) => {
  try {
    cache(res, 120, 600).json(await getEvents())
  } catch (err) {
    noStore(res).status(502).json({ error: 'EONET is unreachable right now', detail: (err as Error).message })
  }
})

app.get('/api/fires', async (_req, res) => {
  try {
    cache(res, 300, 1800).json(await getFires())
  } catch (err) {
    noStore(res).status(502).json({ error: 'FIRMS is unreachable right now', detail: (err as Error).message })
  }
})

app.get('/api/config', async (_req, res) => {
  cache(res, 60, 300).json({ channels: configured, telegramBot: await botUsername(), intervalMin: env.intervalMin, storage: store.kind })
})

app.get('/api/health', (_req, res) => { noStore(res).json({ ok: true, storage: store.kind, serverless: env.serverless }) })

/* ── place search (Photon / OpenStreetMap), proxied so repeated queries are served from cache ── */
const PHOTON = 'https://photon.komoot.io'
async function photon(path: string, res: Response) {
  try {
    const r = await fetch(PHOTON + path, { headers: { 'user-agent': 'vigil-globe/1.0' }, signal: AbortSignal.timeout(6000) })
    if (!r.ok) return void noStore(res).status(r.status === 429 ? 429 : 502).json({ features: [] })
    cache(res, 3600, 86400, 604800).type('json').send(await r.text())
  } catch {
    noStore(res).status(502).json({ features: [] })
  }
}
app.get('/api/geocode', (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 120)
  if (q.length < 2) return void res.json({ features: [] })
  void photon(`/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`, res)
})
app.get('/api/reverse', (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return void res.status(400).json({ features: [] })
  void photon(`/reverse?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&lang=en&limit=1`, res)
})

/* ── watches ────────────────────────────────────────────────────── */
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/
const PHONE = /^\+[1-9]\d{6,14}$/
const DISCORD = /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/
const SLACK = /^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/

type Body = {
  place?: { name?: string; lat?: number; lon?: number }
  radiusKm?: number
  categories?: string[]
  fires?: boolean
  minFireConfidence?: number
  channels?: { email?: string; sms?: string; whatsapp?: string; telegram?: boolean; discord?: string; slack?: string }
}

function parseBody(b: Body): { error: string } | { value: Omit<Watch, 'id' | 'token' | 'createdAt' | 'seen' | 'active'> } {
  const p = b.place
  if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number' || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)
    return { error: 'Pick a place on the globe first.' }
  const radiusKm = Math.round(Number(b.radiusKm))
  if (!(radiusKm >= 5 && radiusKm <= 1000)) return { error: 'Radius must be between 5 and 1000 km.' }
  const categories = (b.categories ?? []).filter((c) => CATEGORIES.has(c))
  const c = b.channels ?? {}
  const channels: Watch['channels'] = {}
  const clean = (s?: string) => (s ?? '').trim()
  const phone = (s?: string) => clean(s).replace(/[\s().-]/g, '')

  if (clean(c.email)) { if (!EMAIL.test(clean(c.email))) return { error: 'That email address looks off.' }; channels.email = clean(c.email) }
  if (phone(c.sms)) { if (!PHONE.test(phone(c.sms))) return { error: 'Use the international format for SMS, like +14155550123.' }; channels.sms = phone(c.sms) }
  if (phone(c.whatsapp)) { if (!PHONE.test(phone(c.whatsapp))) return { error: 'Use the international format for WhatsApp, like +919876543210.' }; channels.whatsapp = phone(c.whatsapp) }
  if (clean(c.discord)) { if (!DISCORD.test(clean(c.discord))) return { error: 'That is not a Discord webhook URL.' }; channels.discord = clean(c.discord) }
  if (clean(c.slack)) { if (!SLACK.test(clean(c.slack))) return { error: 'That is not a Slack incoming-webhook URL.' }; channels.slack = clean(c.slack) }
  if (c.telegram) channels.telegram = { startToken: id(12) }
  if (!Object.keys(channels).length) return { error: 'Choose at least one place to send alerts.' }
  if (!categories.length && !b.fires) return { error: 'Choose at least one kind of event to watch.' }

  return {
    value: {
      place: { name: clean(p.name).slice(0, 120) || `${p.lat.toFixed(3)}°, ${p.lon.toFixed(3)}°`, lat: p.lat, lon: p.lon },
      radiusKm,
      categories,
      fires: Boolean(b.fires),
      minFireConfidence: ([0, 1, 2].includes(Number(b.minFireConfidence)) ? Number(b.minFireConfidence) : 1) as 0 | 1 | 2,
      channels,
    },
  }
}

async function publicWatch(w: Watch) {
  const ch = w.channels
  const bot = ch.telegram && !ch.telegram.chatId ? await botUsername() : null
  return {
    id: w.id,
    place: w.place,
    radiusKm: w.radiusKm,
    categories: w.categories,
    fires: w.fires,
    createdAt: w.createdAt,
    lastCheckedAt: w.lastCheckedAt,
    lastAlertAt: w.lastAlertAt,
    channels: {
      email: ch.email?.replace(/^(.).*(@.*)$/, '$1•••$2'),
      sms: ch.sms?.replace(/\d(?=\d{3})/g, '•'),
      whatsapp: ch.whatsapp?.replace(/\d(?=\d{3})/g, '•'),
      telegram: ch.telegram ? (ch.telegram.chatId ? 'linked' : 'pending') : undefined,
      discord: ch.discord ? 'webhook' : undefined,
      slack: ch.slack ? 'webhook' : undefined,
    },
    telegramLink: bot ? `https://t.me/${bot}?start=${ch.telegram!.startToken}` : null,
  }
}

const fail = (res: Response, err: unknown) => {
  console.error('[api]', (err as Error).message)
  noStore(res).status(500).json({ error: 'Something went wrong on our side. Please try again.' })
}

app.post('/api/watches', async (req, res) => {
  noStore(res)
  try {
    const ip = ipOf(req)
    if ((await store.countRecentByIp(ip, 3600_000)) >= 20) return void res.status(429).json({ error: 'Too many watches from here. Try again in an hour.' })
    const parsed = parseBody(req.body ?? {})
    if ('error' in parsed) return void res.status(400).json(parsed)
    const w: Watch = { ...parsed.value, id: id(), token: id(18), createdAt: new Date().toISOString(), seen: [], active: true }
    await store.add(w, ip)
    let results: Awaited<ReturnType<typeof deliver>> = [], now
    try {
      const digest = await welcome(w)
      results = await deliver({ ...w.channels, telegram: undefined }, digest) // telegram greets once linked
      now = { events: digest.events.length, fires: digest.fires?.count ?? 0 }
    } catch (err) {
      console.error('[api] welcome failed:', (err as Error).message)
    }
    res.status(201).json({ watch: await publicWatch(w), token: w.token, results, now })
  } catch (err) { fail(res, err) }
})

async function owned(req: Request, res: Response) {
  const w = await store.get(String(req.params.id))
  if (!w || w.token !== String(req.query.token ?? req.body?.token ?? '')) { res.status(404).json({ error: 'Watch not found' }); return null }
  return w
}

app.get('/api/watches/:id', async (req, res) => {
  noStore(res)
  try { const w = await owned(req, res); if (w) res.json(await publicWatch(w)) } catch (err) { fail(res, err) }
})
app.delete('/api/watches/:id', async (req, res) => {
  noStore(res)
  try { const w = await owned(req, res); if (w) { await store.remove(w.id); res.json({ ok: true }) } } catch (err) { fail(res, err) }
})
app.post('/api/watches/:id/test', async (req, res) => {
  noStore(res)
  try {
    const w = await owned(req, res)
    if (!w) return
    if ((await store.hit(`test:${w.id}`, 3600_000)) > 10) return void res.status(429).json({ error: 'Slow down: 10 test signals per hour.' })
    const { events, hotspots } = await snapshot()
    res.json({ results: await deliver(w.channels, { kind: 'test', watch: w, ...match(w, events, hotspots) }) })
  } catch (err) { fail(res, err) }
})

/* ── scheduled sweep: Vercel Cron, Supabase pg_cron, or any external pinger ── */
app.all('/api/cron/sweep', async (req, res) => {
  noStore(res)
  const auth = req.headers.authorization ?? ''
  if (env.cronSecret ? auth !== `Bearer ${env.cronSecret}` : env.serverless)
    return void res.status(401).json({ error: 'unauthorized' })
  try { res.json(await sweep()) } catch (err) { fail(res, err) }
})

/* ── Telegram webhook ── */
app.post('/api/telegram/webhook', async (req, res) => {
  if (!env.telegram.webhookSecret || req.headers['x-telegram-bot-api-secret-token'] !== env.telegram.webhookSecret)
    return void res.status(401).end()
  try { await handleUpdate(req.body as Update) } catch (err) { console.error('[telegram]', (err as Error).message) }
  res.json({ ok: true }) // always 200, or Telegram retries the same update forever
})

/* ── unsubscribe (GET shows a confirm page so link scanners can't unsubscribe people) ── */
const page = (title: string, body: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Vigil</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0e;color:#efe8d8;font:16px/1.5 Helvetica,Arial,sans-serif;padding:24px}
main{max-width:420px}h1{font:italic 400 40px/1.1 Georgia,serif;margin:0 0 12px}p{color:#b9b2a2}button,a.b{background:#efe8d8;color:#0b0c0e;border:0;font:600 14px Helvetica,Arial;padding:12px 18px;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block}</style><main>${body}</main>`

app.get('/u/:id/:token', async (req, res) => {
  noStore(res)
  const w = await store.get(req.params.id).catch(() => undefined)
  if (!w || w.token !== req.params.token) return void res.status(404).send(page('Not found', '<h1>Already gone.</h1><p>This watch no longer exists.</p><a class="b" href="/">Back to the globe</a>'))
  const name = w.place.name.replace(/[<>&"]/g, '')
  res.send(page('Stop watching', `<h1>Stop watching ${name}?</h1><p>You won't get any more alerts for this place on any channel.</p><form method="post"><button>Yes, stop</button></form>`))
})
app.post('/u/:id/:token', async (req, res) => {
  noStore(res)
  const w = await store.get(req.params.id).catch(() => undefined)
  if (w && w.token === req.params.token) await store.remove(w.id)
  res.send(page('Stopped', '<h1>Done.</h1><p>Vigil has stopped watching that place. You can set a new watch any time.</p><a class="b" href="/">Back to the globe</a>'))
})

export default app
