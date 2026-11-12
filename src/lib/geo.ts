const R = 6371.0088
const rad = Math.PI / 180

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Geodesic circle as a GeoJSON polygon ring. */
export function circle(lat: number, lon: number, km: number, steps = 128): [number, number][] {
  const d = km / R
  const la = lat * rad, lo = lon * rad
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const b = (i / steps) * 2 * Math.PI
    const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b))
    const lon2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2))
    ring.push([((lon2 / rad + 540) % 360) - 180, lat2 / rad])
  }
  return ring
}

/** Zoom that fits a radius on screen. */
export const zoomForRadius = (km: number) => Math.max(3, Math.min(11, 9.6 - Math.log2(km / 10)))

/**
 * The night half of the planet for a given instant, as a polygon.
 * Solar declination and hour angle from the low-precision NOAA formulas; plenty for a shade layer.
 */
export function nightPolygon(date = new Date()): [number, number][] {
  const jd = date.getTime() / 86400000 + 2440587.5
  const n = jd - 2451545.0
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) * rad
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad
  const eps = (23.439 - 0.0000004 * n) * rad
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24
  const subLon = ((ra / rad - gmst * 15) % 360 + 540) % 360 - 180

  const ring: [number, number][] = []
  for (let lon = -180; lon <= 180; lon += 2) {
    const ha = (lon - subLon) * rad
    const lat = Math.atan(-Math.cos(ha) / Math.tan(dec)) / rad
    ring.push([lon, Math.max(-85, Math.min(85, lat))])
  }
  const pole = dec > 0 ? -85 : 85
  ring.push([180, pole], [-180, pole], ring[0])
  return ring
}

export const fmtKm = (km: number) => (km < 1 ? '<1 km' : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en')} km`)

export function fmtCoord(lat: number, lon: number, digits = 2) {
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(digits)}° ${lon >= 0 ? 'E' : 'W'}`
}

export function ago(iso: string | number, now = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  const m = Math.round((now - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d > 1 ? 's' : ''} ago`
}

export const dayLabel = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
