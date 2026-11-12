/** NASA FIRMS active-fire hotspots for the last 24 h, compacted and cached. */
import { env } from '../env.js'

/** [lon, lat, frp (MW), confidence 0 low · 1 nominal · 2 high, day 1 / night 0, acquired epoch ms] */
export type Hotspot = [number, number, number, number, number, number]

export interface FireSet {
  source: string
  fetchedAt: string
  hotspots: Hotspot[]
}

const PUBLIC = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire'
const FEEDS = [
  { name: 'NOAA-20 VIIRS', url: `${PUBLIC}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv`, api: 'VIIRS_NOAA20_NRT' },
  { name: 'NOAA-21 VIIRS', url: `${PUBLIC}/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv`, api: 'VIIRS_NOAA21_NRT' },
  { name: 'Suomi NPP VIIRS', url: `${PUBLIC}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv`, api: 'VIIRS_SNPP_NRT' },
  { name: 'MODIS', url: `${PUBLIC}/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv`, api: 'MODIS_NRT' },
]

const TTL = 30 * 60 * 1000
/** ~4 MB of JSON before compression: under the serverless response cap even uncompressed */
const MAX = 100_000
let cache: { at: number; set: FireSet } | null = null
let inflight: Promise<FireSet> | null = null

function parse(csv: string): Hotspot[] {
  const lines = csv.split(/\r?\n/)
  const head = (lines[0] ?? '').split(',')
  const ix = (k: string) => head.indexOf(k)
  const iLat = ix('latitude'), iLon = ix('longitude'), iFrp = ix('frp'), iConf = ix('confidence')
  const iDate = ix('acq_date'), iTime = ix('acq_time'), iDn = ix('daynight')
  if (iLat < 0 || iLon < 0) return []
  const out: Hotspot[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    if (c.length < head.length) continue
    const lat = +c[iLat], lon = +c[iLon]
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const rawConf = c[iConf] ?? ''
    const conf = /^\d+$/.test(rawConf)
      ? (+rawConf >= 80 ? 2 : +rawConf >= 30 ? 1 : 0)
      : rawConf.startsWith('h') ? 2 : rawConf.startsWith('n') ? 1 : 0
    const t = (c[iTime] ?? '0000').padStart(4, '0')
    const when = Date.parse(`${c[iDate]}T${t.slice(0, 2)}:${t.slice(2)}:00Z`) || 0
    out.push([
      Math.round(lon * 1000) / 1000,
      Math.round(lat * 1000) / 1000,
      Math.round((+c[iFrp] || 0) * 10) / 10,
      conf,
      c[iDn] === 'N' ? 0 : 1,
      when,
    ])
  }
  return out
}

async function fetchText(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.text()
}

async function load(): Promise<FireSet> {
  for (const feed of FEEDS) {
    try {
      const url = env.firmsKey
        ? `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.firmsKey}/${feed.api}/world/1`
        : feed.url
      let hotspots = parse(await fetchText(url))
      if (hotspots.length > MAX) {
        // peak fire season can pass 150k detections: keep the most certain and most intense ones
        hotspots = hotspots.sort((a, b) => b[3] - a[3] || b[2] - a[2]).slice(0, MAX)
      }
      if (hotspots.length > 200) {
        return { source: feed.name, fetchedAt: new Date().toISOString(), hotspots }
      }
      console.warn(`[firms] ${feed.name} returned only ${hotspots.length} rows, trying next feed`)
    } catch (err) {
      console.warn(`[firms] ${feed.name} failed:`, (err as Error).message)
    }
  }
  throw new Error('All FIRMS feeds failed')
}

export async function getFires(): Promise<FireSet> {
  if (cache && Date.now() - cache.at < TTL) return cache.set
  inflight ??= load()
    .then((set) => { cache = { at: Date.now(), set }; return set })
    .catch((err) => { if (cache) return cache.set; throw err })
    .finally(() => { inflight = null })
  return inflight
}
