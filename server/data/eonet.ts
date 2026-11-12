/** NASA EONET v3: open natural events, normalized and cached. */

export interface EonetEvent {
  id: string
  title: string
  category: string
  categoryTitle: string
  date: string // latest observation
  firstDate: string
  lat: number
  lon: number
  magnitude: number | null
  magnitudeUnit: string | null
  sources: { id: string; url: string }[]
  link: string
  /** [lon, lat, isoDate] for every observation, oldest first */
  track: [number, number, string][]
}

type RawGeom = {
  date: string
  type: 'Point' | 'Polygon'
  coordinates: number[] | number[][][]
  magnitudeValue?: number | null
  magnitudeUnit?: string | null
}
type RawEvent = {
  id: string
  title: string
  link: string
  categories: { id: string; title: string }[]
  sources: { id: string; url: string }[]
  geometry: RawGeom[]
}

const TTL = 10 * 60 * 1000
let cache: { at: number; events: EonetEvent[] } | null = null
let inflight: Promise<EonetEvent[]> | null = null

function point(g: RawGeom): [number, number] {
  if (g.type === 'Point') return g.coordinates as [number, number]
  const ring = (g.coordinates as number[][][])[0] ?? []
  let x = 0, y = 0
  for (const [lo, la] of ring) { x += lo; y += la }
  return ring.length ? [x / ring.length, y / ring.length] : [0, 0]
}

async function load(): Promise<EonetEvent[]> {
  const res = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=60', {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`EONET ${res.status}`)
  const body = (await res.json()) as { events: RawEvent[] }
  const out: EonetEvent[] = []
  for (const e of body.events) {
    const geoms = [...(e.geometry ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    if (!geoms.length) continue
    const last = geoms[geoms.length - 1]
    const [lon, lat] = point(last)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const cat = e.categories[0] ?? { id: 'manmade', title: 'Other' }
    out.push({
      id: e.id,
      title: e.title.trim(),
      category: cat.id,
      categoryTitle: cat.title,
      date: last.date,
      firstDate: geoms[0].date,
      lat,
      lon,
      magnitude: last.magnitudeValue ?? null,
      magnitudeUnit: last.magnitudeUnit ?? null,
      sources: e.sources ?? [],
      link: e.link,
      track: geoms.map((g) => { const [x, y] = point(g); return [x, y, g.date] }),
    })
  }
  out.sort((a, b) => b.date.localeCompare(a.date))
  return out
}

export async function getEvents(): Promise<EonetEvent[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.events
  inflight ??= load()
    .then((events) => { cache = { at: Date.now(), events }; return events })
    .catch((err) => { if (cache) { console.warn('[eonet] refresh failed, serving stale:', err.message); return cache.events } throw err })
    .finally(() => { inflight = null })
  return inflight
}
