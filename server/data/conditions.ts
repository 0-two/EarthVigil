/**
 * Everything else worth knowing about a place, beyond EONET and FIRMS:
 * weather and forecast (Open-Meteo), air quality (Open-Meteo / CAMS) and earthquakes (USGS).
 * All three are free, keyless and allow CORS-free server use.
 */

export interface Conditions {
  weather: {
    temp: number; feels: number; humidity: number; wind: number; gusts: number; precip: number; code: number; isDay: boolean
    days: { date: string; max: number; min: number; rain: number; rainChance: number; gusts: number; uv: number; code: number }[]
  } | null
  air: { aqi: number; pm25: number; pm10: number; dust: number } | null
  quakes: { id: string; mag: number; place: string; time: number; depthKm: number; km: number; url: string; tsunami: boolean }[] | null
  /** plain-language warnings derived from the numbers above */
  hazards: { kind: 'heat' | 'cold' | 'rain' | 'wind' | 'air' | 'uv' | 'quake' | 'storm'; level: 1 | 2; text: string }[]
}

const get = async <T>(url: string): Promise<T> => {
  const r = await fetch(url, { headers: { 'user-agent': 'vigil-globe/1.0' }, signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`)
  return (await r.json()) as T
}

const toRad = (d: number) => (d * Math.PI) / 180
const km = (a: number, b: number, c: number, d: number) => {
  const x = Math.sin(toRad(c - a) / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(toRad(d - b) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(x))
}

async function weather(lat: number, lon: number): Promise<Conditions['weather']> {
  type R = {
    current: Record<'temperature_2m' | 'apparent_temperature' | 'relative_humidity_2m' | 'wind_speed_10m' | 'wind_gusts_10m' | 'precipitation' | 'weather_code' | 'is_day', number>
    daily: { time: string[] } & Record<'temperature_2m_max' | 'temperature_2m_min' | 'precipitation_sum' | 'precipitation_probability_max' | 'wind_gusts_10m_max' | 'uv_index_max' | 'weather_code', number[]>
  }
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), timezone: 'auto', forecast_days: '3', wind_speed_unit: 'kmh',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,uv_index_max,weather_code',
  })
  const r = await get<R>(`https://api.open-meteo.com/v1/forecast?${q}`)
  const c = r.current, d = r.daily
  return {
    temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m,
    gusts: c.wind_gusts_10m, precip: c.precipitation, code: c.weather_code, isDay: c.is_day === 1,
    days: d.time.map((date, i) => ({
      date, max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], rain: d.precipitation_sum[i] ?? 0,
      rainChance: d.precipitation_probability_max[i] ?? 0, gusts: d.wind_gusts_10m_max[i] ?? 0, uv: d.uv_index_max[i] ?? 0, code: d.weather_code[i],
    })),
  }
}

async function air(lat: number, lon: number): Promise<Conditions['air']> {
  type R = { current: Record<'us_aqi' | 'pm2_5' | 'pm10' | 'dust', number | null> }
  const r = await get<R>(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5,pm10,dust`)
  if (r.current.us_aqi == null) return null
  return { aqi: r.current.us_aqi, pm25: r.current.pm2_5 ?? 0, pm10: r.current.pm10 ?? 0, dust: r.current.dust ?? 0 }
}

async function quakes(lat: number, lon: number, radiusKm: number): Promise<Conditions['quakes']> {
  type F = { id: string; properties: { mag: number; place: string; time: number; url: string; tsunami: number }; geometry: { coordinates: [number, number, number] } }
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const q = new URLSearchParams({
    format: 'geojson', latitude: String(lat), longitude: String(lon), maxradiuskm: String(Math.min(radiusKm, 20001)),
    minmagnitude: '2.5', starttime: since, orderby: 'time', limit: '40',
  })
  const r = await get<{ features: F[] }>(`https://earthquake.usgs.gov/fdsnws/event/1/query?${q}`)
  return r.features.map((f) => {
    const [qlon, qlat, depth] = f.geometry.coordinates
    return {
      id: f.id, mag: Math.round(f.properties.mag * 10) / 10, place: f.properties.place ?? 'Unnamed area', time: f.properties.time,
      depthKm: Math.round(depth), km: Math.round(km(lat, lon, qlat, qlon)), url: f.properties.url, tsunami: f.properties.tsunami === 1,
    }
  })
}

function hazards(c: Omit<Conditions, 'hazards'>): Conditions['hazards'] {
  const out: Conditions['hazards'] = []
  const w = c.weather
  if (w) {
    const hot = Math.max(w.feels, ...w.days.map((d) => d.max))
    if (hot >= 45) out.push({ kind: 'heat', level: 2, text: `Extreme heat, up to ${Math.round(hot)}°C` })
    else if (hot >= 39) out.push({ kind: 'heat', level: 1, text: `Very hot, up to ${Math.round(hot)}°C` })
    const cold = Math.min(...w.days.map((d) => d.min))
    if (cold <= -25) out.push({ kind: 'cold', level: 2, text: `Extreme cold, down to ${Math.round(cold)}°C` })
    else if (cold <= -15) out.push({ kind: 'cold', level: 1, text: `Severe cold, down to ${Math.round(cold)}°C` })
    const wet = Math.max(...w.days.map((d) => d.rain))
    if (wet >= 100) out.push({ kind: 'rain', level: 2, text: `Extreme rain forecast, ${Math.round(wet)} mm in a day` })
    else if (wet >= 40) out.push({ kind: 'rain', level: 1, text: `Heavy rain forecast, ${Math.round(wet)} mm in a day` })
    const gust = Math.max(w.gusts, ...w.days.map((d) => d.gusts))
    if (gust >= 100) out.push({ kind: 'wind', level: 2, text: `Damaging gusts to ${Math.round(gust)} km/h` })
    else if (gust >= 65) out.push({ kind: 'wind', level: 1, text: `Strong gusts to ${Math.round(gust)} km/h` })
    if ([95, 96, 99].includes(w.code) || w.days.some((d) => [95, 96, 99].includes(d.code))) out.push({ kind: 'storm', level: 1, text: 'Thunderstorms in the forecast' })
    const uv = Math.max(...w.days.map((d) => d.uv))
    if (uv >= 11) out.push({ kind: 'uv', level: 1, text: `Extreme UV index, ${Math.round(uv)}` })
  }
  if (c.air) {
    if (c.air.aqi > 200) out.push({ kind: 'air', level: 2, text: `Very unhealthy air, AQI ${Math.round(c.air.aqi)}` })
    else if (c.air.aqi > 150) out.push({ kind: 'air', level: 1, text: `Unhealthy air, AQI ${Math.round(c.air.aqi)}` })
  }
  const big = c.quakes?.filter((q) => q.mag >= 5 && Date.now() - q.time < 7 * 86400000).sort((a, b) => b.mag - a.mag)[0]
  if (big) out.push({ kind: 'quake', level: big.mag >= 6 ? 2 : 1, text: `M${big.mag} earthquake ${big.km} km away this week` })
  return out.sort((a, b) => b.level - a.level)
}

export async function getConditions(lat: number, lon: number, radiusKm: number): Promise<Conditions> {
  const [w, a, q] = await Promise.allSettled([weather(lat, lon), air(lat, lon), quakes(lat, lon, radiusKm)])
  for (const r of [w, a, q]) if (r.status === 'rejected') console.error('[conditions]', (r.reason as Error).message)
  const base = {
    weather: w.status === 'fulfilled' ? w.value : null,
    air: a.status === 'fulfilled' ? a.value : null,
    quakes: q.status === 'fulfilled' ? q.value : null,
  }
  return { ...base, hazards: hazards(base) }
}
