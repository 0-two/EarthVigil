/**
 * Imagery catalogue.
 * The base globe is a cloud-free Sentinel-2 mosaic (EOX) that hands over to Esri World Imagery up close,
 * with AWS Terrain Tiles for relief. NASA GIBS layers sit on top as switchable overlays,
 * and borders/names are OpenFreeMap vector tiles so they stay sharp at every zoom.
 */

export interface Overlay {
  id: string
  label: string
  note: string
  opacity: number
  /** CSS gradient for the legend swatch */
  legend: string
  /** GIBS raster layers; absent on vector groups */
  gibs?: { layer: string; tms: string; ext: 'jpg' | 'jpeg' | 'png'; maxzoom: number; dated: boolean; fixed?: string }
}

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'

export const SOURCES = {
  s2: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
  esri: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  dem: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  vector: 'https://tiles.openfreemap.org/planet',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
}

export const OVERLAYS: Overlay[] = [
  {
    id: 'truecolor', label: "Today's satellite pass", note: 'NOAA-20 VIIRS · daily, with swath seams', opacity: 1,
    legend: 'linear-gradient(90deg,#1d3b5a,#e9eef2 55%,#7c8b5b)',
    gibs: { layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', tms: 'GoogleMapsCompatible_Level9', ext: 'jpg', maxzoom: 9, dated: true },
  },
  {
    id: 'clouds', label: 'Cloud cover', note: 'MODIS Terra · daytime cloud fraction', opacity: 0.72,
    legend: 'linear-gradient(90deg,#1b2b44,#6b8bb0,#ffffff)',
    gibs: { layer: 'MODIS_Terra_Cloud_Fraction_Day', tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxzoom: 6, dated: true },
  },
  {
    id: 'cloudtop', label: 'Cloud-top temperature', note: 'Colder tops mean taller storms', opacity: 0.75,
    legend: 'linear-gradient(90deg,#fff,#f8d,#53f,#0af,#2c4)',
    gibs: { layer: 'MODIS_Terra_Cloud_Top_Temp_Day', tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxzoom: 6, dated: true },
  },
  {
    id: 'rain', label: 'Precipitation', note: 'GPM IMERG · rain rate', opacity: 0.8,
    legend: 'linear-gradient(90deg,#2a8,#ee3,#e52,#a2a)',
    gibs: { layer: 'IMERG_Precipitation_Rate', tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxzoom: 6, dated: true },
  },
  {
    id: 'aerosol', label: 'Smoke & aerosols', note: 'Aerosol optical depth', opacity: 0.75,
    legend: 'linear-gradient(90deg,#fef3b0,#f9a34a,#b4271d,#4a0d14)',
    gibs: { layer: 'MODIS_Combined_Value_Added_AOD', tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxzoom: 6, dated: true },
  },
  {
    id: 'night', label: 'City lights', note: 'VIIRS Black Marble · 2016', opacity: 0.9,
    legend: 'linear-gradient(90deg,#000,#3a2a10,#f6c56a,#fff7dd)',
    gibs: { layer: 'VIIRS_Black_Marble', tms: 'GoogleMapsCompatible_Level8', ext: 'png', maxzoom: 8, dated: false, fixed: '2016-01-01' },
  },
  { id: 'labels', label: 'Borders & roads', note: 'OpenStreetMap · sharp at any zoom', opacity: 1, legend: 'linear-gradient(90deg,transparent 45%,#efe8d8 45% 55%,transparent 55%)' },
  { id: 'names', label: 'Place names', note: 'Countries, cities, towns, seas', opacity: 1, legend: 'linear-gradient(90deg,#efe8d8,#efe8d8)' },
]

export function tileUrl(l: Overlay, date: string) {
  const g = l.gibs!
  const t = g.dated ? date : g.fixed ?? 'default'
  return `${GIBS}/${g.layer}/default/${t}/${g.tms}/{z}/{y}/{x}.${g.ext}`
}

/** Yesterday (UTC): today's daily composite is still being stitched together. */
export function defaultImageryDate() {
  const d = new Date(Date.now() - 86400000)
  return d.toISOString().slice(0, 10)
}

export function lastDays(n: number) {
  const out: string[] = []
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
  for (let i = n; i >= 1; i--) out.push(new Date(today - i * 86400000).toISOString().slice(0, 10))
  out.push(new Date(today).toISOString().slice(0, 10))
  return out
}
