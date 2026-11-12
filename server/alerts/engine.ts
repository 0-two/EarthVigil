import { createHash } from 'node:crypto'
import { getEvents, type EonetEvent } from '../data/eonet.js'
import { getFires, type Hotspot } from '../data/firms.js'
import { boxFilter, distanceKm } from '../geo.js'
import { store, type Watch } from '../store.js'
import { deliver } from './channels.js'
import type { Digest, FireSummary, NearEvent } from './format.js'

const RECENT_MS = 30 * 24 * 3600 * 1000

export function match(
  w: Pick<Watch, 'place' | 'radiusKm' | 'categories' | 'fires' | 'minFireConfidence'>,
  events: EonetEvent[],
  hotspots: Hotspot[],
) {
  const { lat, lon } = w.place
  const inBox = boxFilter(lat, lon, w.radiusKm)
  const cats = new Set(w.categories)
  const now = Date.now()

  const near: NearEvent[] = []
  for (const e of events) {
    if (cats.size && !cats.has(e.category)) continue
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
  return { events: near, fires }
}

const fireKey = () => `fires:${new Date().toISOString().slice(0, 10)}`

export async function snapshot() {
  const [events, fireSet] = await Promise.all([
    getEvents(),
    getFires().catch(() => ({ hotspots: [] as Hotspot[] })),
  ])
  return { events, hotspots: fireSet.hotspots }
}

/** Builds the "now watching" digest and marks everything currently nearby as seen. */
export async function welcome(w: Watch): Promise<Digest> {
  const { events, hotspots } = await snapshot()
  const m = match(w, events, hotspots)
  w.seen = [...m.events.map((e) => e.id), ...(m.fires ? [fireKey()] : [])]
  w.lastCheckedAt = new Date().toISOString()
  await store.save(w)
  return { kind: 'welcome', watch: w, ...m }
}

function fingerprint(day: string, events: EonetEvent[], hotspots: Hotspot[]) {
  const h = createHash('sha1').update(day)
  for (const e of events) h.update(`${e.id}@${e.date};`)
  let latest = 0
  for (const x of hotspots) if (x[5] > latest) latest = x[5]
  return h.update(`fires:${hotspots.length}:${latest}`).digest('base64url')
}

/** Runs `fn` over `items` with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

export interface SweepStats { watches: number; alerted: number; failed: number; ms: number; skipped?: string }

let running = false
/** One pass over every active watch. Safe to call from a timer or from an HTTP cron hook. */
export async function sweep(): Promise<SweepStats> {
  if (running) return { watches: 0, alerted: 0, failed: 0, ms: 0, skipped: 'already running' }
  running = true
  const started = Date.now()
  let alerted = 0, failed = 0
  try {
    const { events, hotspots } = await snapshot()
    const fk = fireKey()
    // NASA's feeds change every half hour or so, not every sweep. When nothing changed, skip reading
    // the watches at all: that is most of the database egress on a free plan.
    const fp = fingerprint(fk, events, hotspots)
    if ((await store.getMeta('sweep_fp')) === fp) {
      return { watches: 0, alerted: 0, failed: 0, ms: Date.now() - started, skipped: 'no new NASA data since the last sweep' }
    }
    const watches = await store.active()
    await pool(watches, 8, async (w) => {
      try {
        const m = match(w, events, hotspots)
        const seen = new Set(w.seen)
        const fresh = m.events.filter((e) => !seen.has(e.id))
        const newFires = m.fires && !seen.has(fk) ? m.fires : null
        if (!fresh.length && !newFires) return // no write: keeps a 15-minute sweep cheap for thousands of watches

        await deliver(w.channels, { kind: 'alert', watch: w, events: fresh, fires: newFires })
        // keep the seen list bounded: only ids still nearby plus today's fire key
        const still = new Set(m.events.map((e) => e.id))
        w.seen = [...new Set([...w.seen.filter((k) => still.has(k) || k === fk), ...fresh.map((e) => e.id), ...(newFires ? [fk] : [])])]
        w.lastAlertAt = w.lastCheckedAt = new Date().toISOString()
        await store.save(w)
        alerted++
      } catch (err) {
        failed++
        console.error(`[watch] ${w.id} failed:`, (err as Error).message)
      }
    })
    if (!failed) await store.setMeta('sweep_fp', fp)
    await store.prune().catch(() => {})
    const stats = { watches: watches.length, alerted, failed, ms: Date.now() - started }
    console.log(`[watch] swept ${stats.watches} place(s), ${alerted} alert(s), ${failed} failure(s), ${stats.ms} ms`)
    return stats
  } finally {
    running = false
  }
}
