/** USGS real-time feed: every M2.5+ earthquake worldwide in the last 24 hours (one small file, refreshed each minute upstream). */

export interface Quake { id: string; mag: number; place: string; time: number; lat: number; lon: number; depthKm: number; url: string; tsunami: boolean }

const FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'
const TTL = 5 * 60 * 1000
let cache: { at: number; quakes: Quake[] } | null = null

type F = { id: string; properties: { mag: number | null; place: string | null; time: number; url: string; tsunami: number }; geometry: { coordinates: [number, number, number] } }

export async function getQuakes(): Promise<Quake[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.quakes
  const r = await fetch(FEED, { headers: { 'user-agent': 'vigil-globe/1.0' }, signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`USGS ${r.status}`)
  const body = (await r.json()) as { features: F[] }
  const quakes = body.features
    .filter((f) => f.properties.mag != null)
    .map((f) => ({
      id: f.id, mag: Math.round(f.properties.mag! * 10) / 10, place: f.properties.place ?? 'Unnamed area', time: f.properties.time,
      lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depthKm: Math.round(f.geometry.coordinates[2]),
      url: f.properties.url, tsunami: f.properties.tsunami === 1,
    }))
  cache = { at: Date.now(), quakes }
  return quakes
}
