/** NASA GIBS imagery, served as Web-Mercator WMTS tiles. */

export interface GibsLayer {
  id: string
  layer: string
  label: string
  note: string
  tms: string
  ext: 'jpg' | 'jpeg' | 'png'
  maxzoom: number
  dated: boolean
  /** fixed date for layers that are not daily */
  fixed?: string
  opacity: number
  /** CSS gradient for the legend swatch */
  legend: string
}

const root = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'

export const BASE: GibsLayer = {
  id: 'bluemarble', layer: 'BlueMarble_ShadedRelief_Bathymetry', label: 'Blue Marble', note: 'Cloud-free relief & bathymetry',
  tms: 'GoogleMapsCompatible_Level8', ext: 'jpeg', maxzoom: 8, dated: false, opacity: 1, legend: 'linear-gradient(90deg,#0b2545,#2f6a7a,#7a8f5a,#c9b98a)',
}

export const OVERLAYS: GibsLayer[] = [
  {
    id: 'truecolor', layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', label: 'Satellite, true colour', note: 'NOAA-20 VIIRS · one pass a day',
    tms: 'GoogleMapsCompatible_Level9', ext: 'jpg', maxzoom: 9, dated: true, opacity: 1, legend: 'linear-gradient(90deg,#1d3b5a,#e9eef2 55%,#7c8b5b)',
  },
  {
    id: 'clouds', layer: 'MODIS_Terra_Cloud_Fraction_Day', label: 'Cloud cover', note: 'MODIS Terra · daytime cloud fraction',
    tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxzoom: 6, dated: true, opacity: 0.72, legend: 'linear-gradient(90deg,#1b2b44,#6b8bb0,#ffffff)',
  },
  {
    id: 'cloudtop', layer: 'MODIS_Terra_Cloud_Top_Temp_Day', label: 'Cloud-top temperature', note: 'Colder tops mean taller storms',
    tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxzoom: 6, dated: true, opacity: 0.75, legend: 'linear-gradient(90deg,#fff,#f8d,#53f,#0af,#2c4)',
  },
  {
    id: 'rain', layer: 'IMERG_Precipitation_Rate', label: 'Precipitation', note: 'GPM IMERG · rain rate',
    tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxzoom: 6, dated: true, opacity: 0.8, legend: 'linear-gradient(90deg,#2a8,#ee3,#e52,#a2a)',
  },
  {
    id: 'aerosol', layer: 'MODIS_Combined_Value_Added_AOD', label: 'Smoke & aerosols', note: 'Aerosol optical depth',
    tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxzoom: 6, dated: true, opacity: 0.75, legend: 'linear-gradient(90deg,#fef3b0,#f9a34a,#b4271d,#4a0d14)',
  },
  {
    id: 'night', layer: 'VIIRS_Black_Marble', label: 'City lights', note: 'VIIRS Black Marble · 2016',
    tms: 'GoogleMapsCompatible_Level8', ext: 'png', maxzoom: 8, dated: false, fixed: '2016-01-01', opacity: 0.9, legend: 'linear-gradient(90deg,#000,#3a2a10,#f6c56a,#fff7dd)',
  },
  {
    id: 'labels', layer: 'Reference_Features', label: 'Borders & coastlines', note: 'OpenStreetMap-derived reference',
    tms: 'GoogleMapsCompatible_Level9', ext: 'png', maxzoom: 9, dated: false, opacity: 0.55, legend: 'linear-gradient(90deg,transparent 45%,#efe8d8 45% 55%,transparent 55%)',
  },
  {
    id: 'names', layer: 'Reference_Labels', label: 'Place names', note: 'Cities, countries, seas',
    tms: 'GoogleMapsCompatible_Level9', ext: 'png', maxzoom: 9, dated: false, opacity: 0.85, legend: 'linear-gradient(90deg,#efe8d8,#efe8d8)',
  },
]

export function tileUrl(l: GibsLayer, date: string) {
  const t = l.dated ? date : l.fixed ?? 'default'
  return `${root}/${l.layer}/default/${t}/${l.tms}/{z}/{y}/{x}.${l.ext}`
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
