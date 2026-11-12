import type { Conditions, EonetEvent, FireSet, Place, PublicWatch, SavedWatch, SendResult, ServerConfig } from './types'

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

export const api = {
  events: () => fetch('/api/events').then((r) => json<EonetEvent[]>(r)),
  fires: () => fetch('/api/fires').then((r) => json<FireSet>(r)),
  config: () => fetch('/api/config').then((r) => json<ServerConfig>(r)),
  conditions: (lat: number, lon: number, r: number, signal?: AbortSignal) =>
    fetch(`/api/conditions?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&r=${r}`, { signal }).then((res) => json<Conditions>(res)),
  createWatch: (body: unknown) =>
    fetch('/api/watches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => json<{ watch: PublicWatch; token: string; results: SendResult[]; now?: { events: number; fires: number }; warning?: string }>(r)),
  watch: (w: SavedWatch) => fetch(`/api/watches/${w.id}?token=${w.token}`).then((r) => json<PublicWatch>(r)),
  removeWatch: (w: SavedWatch) => fetch(`/api/watches/${w.id}?token=${w.token}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  testWatch: (w: SavedWatch) =>
    fetch(`/api/watches/${w.id}/test?token=${w.token}`, { method: 'POST' }).then((r) => json<{ results: SendResult[] }>(r)),
}

/* ── geocoding: Photon (OpenStreetMap) via our cached proxy (/api/geocode, /api/reverse) ── */
type PhotonFeature = {
  geometry: { coordinates: [number, number] }
  properties: { name?: string; city?: string; state?: string; country?: string; county?: string; type?: string; osm_value?: string; extent?: [number, number, number, number] }
}

function toPlace(f: PhotonFeature): Place {
  const p = f.properties
  const [lon, lat] = f.geometry.coordinates
  const ctx = [p.city !== p.name ? p.city : undefined, p.state !== p.name ? p.state : undefined, p.country !== p.name ? p.country : undefined]
    .filter(Boolean).join(', ')
  return { name: p.name ?? `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`, context: ctx || undefined, lat, lon, bbox: p.extent }
}

export async function geocode(q: string, signal?: AbortSignal): Promise<Place[]> {
  const coords = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/)
  if (coords) {
    const lat = +coords[1], lon = +coords[2]
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return [{ name: `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`, context: 'Coordinates', lat, lon }]
  }
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(q.trim().toLowerCase())}`, { signal })
  if (!res.ok) return []
  const body = (await res.json()) as { features: PhotonFeature[] }
  return body.features.map(toPlace)
}

export async function reverseGeocode(lat: number, lon: number): Promise<Place> {
  const fallback: Place = { name: `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`, lat, lon }
  try {
    const res = await fetch(`/api/reverse?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`, { signal: AbortSignal.timeout(6000) })
    const f = ((await res.json()) as { features: PhotonFeature[] }).features[0]
    if (!f) return { ...fallback, context: 'Open water or a remote area, no named place nearby' }
    const pr = f.properties
    const fine = ['house', 'street', 'road', 'building', 'residential', 'locality', 'district', 'other'].includes(pr.type ?? '')
    const name = (fine ? pr.city ?? pr.county ?? pr.state : pr.name) ?? pr.name ?? fallback.name
    const context = [pr.state !== name ? pr.state : undefined, pr.country !== name ? pr.country : undefined].filter(Boolean).join(', ')
    return { name, context: context || undefined, lat, lon }
  } catch {
    return fallback
  }
}

/* ── this browser's watches ── */
const KEY = 'vigil.watches'
export const saved = {
  list(): SavedWatch[] {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
  },
  put(list: SavedWatch[]) {
    try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* private mode */ }
  },
}
