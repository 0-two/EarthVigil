const R = 6371.0088

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Cheap pre-filter before the haversine: degrees of latitude that cover `km`, plus a longitude allowance. */
export function boxFilter(lat: number, lon: number, km: number) {
  const dLat = km / 110.574
  const dLon = km / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))
  return (la: number, lo: number) => {
    if (Math.abs(la - lat) > dLat) return false
    let d = Math.abs(lo - lon)
    if (d > 180) d = 360 - d
    return d <= dLon
  }
}
