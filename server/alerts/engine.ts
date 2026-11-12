import { createHash } from 'node:crypto'
import { getEvents, type EonetEvent } from '../data/eonet.js'
import { getFires, type Hotspot } from '../data/firms.js'
import { getQuakes, type Quake } from '../data/quakes.js'
import { getHazards, type Hazard } from '../data/conditions.js'
import { boxFilter, distanceKm } from '../geo.js'
import { store, type Watch } from '../store.js'
import { deliver } from './channels.js'
import type { Digest, FireSummary, NearEvent, NearQuake } from './format.js'

const RECENT_MS = 30 * 24 * 3600 * 1000
/** Forecast-based warnings change slowly; checking each place 4 times a day keeps Open-Meteo's free quota comfortable. */
const HAZARD_EVERY_MS = 6 * 3600 * 1000
/** Upper bound on forecast lookups per sweep, so one sweep always fits inside a serverless time limit. */
const HAZARD_BUDGET = 150
/** Even when no feed changed, do a full pass this often so forecast checks keep their schedule. */
const FULL_PASS_MS = 60 * 60 * 1000

type Matchable = Pick<Watch, 'place' | 'radiusKm' | 'categories' | 'fires' | 'minFireConfidence' | 'quakes' | 'minQuakeMag'>

export function match(w: Matchable, events: EonetEvent[], hotspots: Hotspot[], quakes: Quake[] = []) {
  const { lat, lon } = w.place
  const inBox = boxFilter(lat, lon, w.radiusKm)
  const cats = new Set(w.categories)
  const now = Date.now()

  const near: NearEvent[] = []
  for (const e of events) {
    if (!cats.has(e.category)) continue // no categories chosen means no NASA events, not all of them
    if (now - Date.parse(e.date) > RECENT_MS) continue
    // An event counts if any recent observation of it (a storm track, say) passes inside the radius
    let best = Infinity
    for (const [lo, la, when] of e.track) {
      if (now - Date.parse(when) > RECENT_MS || !inBox(la, lo)) continue
      best = Math.min(best, distanceKm(lat, lon, la, lo))
    }
    if (best <= w.radiusKm) near.push({ ...e, distanceKm: best })
  }
  near.sort((a, b) => a.distanceKm - b.distanceKm)

  let fires: FireSummary | null = null
  if (w.fires) {
    let count = 0, nearestKm = Infinity, maxFrp = 0, high = 0
    for (const h of hotspots) {
      if (h[3] < w.minFireConfidence || !inBox(h[1], h[0])) continue
      const d = distanceKm(lat, lon, h[1], h[0])
      if (d > w.radiusKm) continue
      count++
      nearestKm = Math.min(nearestKm, d)
      maxFrp = Math.max(maxFrp, h[2])
      if (h[3] === 2) high++
    }
    if (count) fires = { count, nearestKm, maxFrp, high }
  }

  const nearQuakes: NearQuake[] = []
  if (w.quakes) {
    const min = w.minQuakeMag ?? 4
    for (const q of quakes) {
      if (q.mag < min || !inBox(q.lat, q.lon)) continue
      const d = distanceKm(lat, lon, q.lat, q.lon)
      if (d <= w.radiusKm) nearQuakes.push({ ...q, distanceKm: d })
    }
    nearQuakes.sort((a, b) => b.mag - a.mag)
  }
  return { events: near, fires, quakes: nearQuakes }
}

const today = () => new Date().toISOString().slice(0, 10)
const fireKey = () => `fires:${today()}`
const quakeKey = (q: Quake) => `q:${q.id}`
/** One message per kind of warning per day, and another if it escalates to the higher level. */
const hazardKey = (h: Hazard) => `hz:${h.kind}${h.level}:${today()}`

export async function snapshot() {
  const [events, fireSet, quakes] = await Promise.all([
    getEvents(),
    getFires().catch(() => ({ hotspots: [] as Hotspot[] })),
    getQuakes().catch((err) => { console.error('[quakes]', (err as Error).message); return [] as Quake[] }),
  ])
  return { events, hotspots: fireSet.hotspots, quakes }
}

async function hazardsFor(w: Watch): Promise<Hazard[]> {
  if (!w.hazards) return []
  return getHazards(w.place.lat, w.place.lon)
}

/** Everything around a watch right now (used by the welcome message and the test button). */
export async function current(w: Watch) {
  const { events, hotspots, quakes } = await snapshot()
  const hazards = await hazardsFor(w).catch(() => [] as Hazard[])
  return { ...match(w, events, hotspots, quakes), hazards }
}

/** Builds the "now watching" digest and marks everything currently nearby as seen. */
export async function welcome(w: Watch, persist = true): Promise<Digest> {
  const m = await current(w)
  w.seen = [...m.events.map((e) => e.id), ...(m.fires ? [fireKey()] : []), ...m.quakes.map(quakeKey), ...m.hazards.map(hazardKey)]
  w.lastCheckedAt = new Date().toISOString()
  if (w.hazards) w.lastHazardCheckAt = w.lastCheckedAt
  if (persist) await store.save(w)
  return { kind: 'welcome', watch: w, ...m }
}

function fingerprint(day: string, events: EonetEvent[], hotspots: Hotspot[], quakes: Quake[]) {
  const h = createHash('sha1').update(day)
  for (const e of events) h.update(`${e.id}@${e.date};`)
  let latest = 0
  for (const x of hotspots) if (x[5] > latest) latest = x[5]
  h.update(`fires:${hotspots.length}:${latest};`)
  for (const q of quakes) h.update(`${q.id};`)
  return h.digest('base64url')
}

/** Runs `fn` over `items` with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

export interface SweepStats { watches: number; alerted: number; failed: number; forecasts: number; ms: number; skipped?: string }

let running = false
/** One pass over every active watch. Safe to call from a timer or from an HTTP cron hook. */
export async function sweep(): Promise<SweepStats> {
  if (running) return { watches: 0, alerted: 0, failed: 0, forecasts: 0, ms: 0, skipped: 'already running' }
  running = true
  const started = Date.now()
  let alerted = 0, failed = 0, forecasts = 0
  try {
    const { events, hotspots, quakes } = await snapshot()
    const fk = fireKey()
    // The feeds change every few minutes to half an hour, not every sweep. When nothing changed and a full
    // pass ran recently, skip reading the watches at all: that is most of the database egress on a free plan.
    const fp = fingerprint(fk, events, hotspots, quakes)
    const lastFull = Number(await store.getMeta('sweep_full_at')) || 0
    if ((await store.getMeta('sweep_fp')) === fp && started - lastFull < FULL_PASS_MS) {
      return { watches: 0, alerted: 0, failed: 0, forecasts: 0, ms: Date.now() - started, skipped: 'no new data since the last sweep' }
    }
    const watches = await store.active()
    // the longest-unchecked places get their forecast first when the budget runs out
    const due = new Set(watches
      .filter((w) => w.hazards && started - Date.parse(w.lastHazardCheckAt ?? '1970-01-01') >= HAZARD_EVERY_MS)
      .sort((a, b) => Date.parse(a.lastHazardCheckAt ?? '1970-01-01') - Date.parse(b.lastHazardCheckAt ?? '1970-01-01'))
      .slice(0, HAZARD_BUDGET)
      .map((w) => w.id))

    await pool(watches, 8, async (w) => {
      try {
        const m = match(w, events, hotspots, quakes)
        let hazards: Hazard[] = []
        let checked = false
        if (due.has(w.id)) {
          try { hazards = await hazardsFor(w); checked = true; forecasts++ } catch (err) { console.error(`[forecast] ${w.id}:`, (err as Error).message) }
        }
        const seen = new Set(w.seen)
        const fresh = m.events.filter((e) => !seen.has(e.id))
        const newFires = m.fires && !seen.has(fk) ? m.fires : null
        const newQuakes = m.quakes.filter((q) => !seen.has(quakeKey(q)))
        const newHazards = hazards.filter((h) => !seen.has(hazardKey(h)))
        const now = new Date().toISOString()

        if (fresh.length || newFires || newQuakes.length || newHazards.length) {
          await deliver(w.channels, { kind: 'alert', watch: w, events: fresh, fires: newFires, quakes: newQuakes, hazards: newHazards })
          w.lastAlertAt = now
          alerted++
        } else if (!checked) {
          return // nothing new and no forecast bookkeeping: no write, keeps a 15-minute sweep cheap for thousands of watches
        }
        // keep the seen list bounded: ids still nearby, quakes still in the 24 h feed, today's fire and warning keys
        const still = new Set([...m.events.map((e) => e.id), ...quakes.map(quakeKey)])
        const day = today()
        w.seen = [...new Set([
          ...w.seen.filter((k) => still.has(k) || k === fk || (k.startsWith('hz:') && k.endsWith(day))),
          ...fresh.map((e) => e.id), ...(newFires ? [fk] : []), ...newQuakes.map(quakeKey), ...newHazards.map(hazardKey),
        ])]
        w.lastCheckedAt = now
        if (checked) w.lastHazardCheckAt = now
        await store.save(w)
      } catch (err) {
        failed++
        console.error(`[watch] ${w.id} failed:`, (err as Error).message)
      }
    })
    if (!failed) {
      await store.setMeta('sweep_fp', fp)
      await store.setMeta('sweep_full_at', String(started))
    }
    await store.prune().catch(() => {})
    const stats = { watches: watches.length, alerted, failed, forecasts, ms: Date.now() - started }
    console.log(`[watch] swept ${stats.watches} place(s), ${alerted} alert(s), ${forecasts} forecast(s), ${failed} failure(s), ${stats.ms} ms`)
    return stats
  } finally {
    running = false
  }
}
