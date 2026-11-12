import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import * as maplibregl from 'maplibre-gl'
import { type GeoJSONSource, type Map as MLMap, type RasterTileSource, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { EonetEvent, FireSet, Hotspot, Place } from '../lib/types'
import { BASE, OVERLAYS, tileUrl } from '../lib/gibs'
import { CATEGORIES } from '../lib/categories'
import { circle, distanceKm, nightPolygon, zoomForRadius } from '../lib/geo'

export type Selection = { kind: 'event'; id: string } | { kind: 'fire'; h: Hotspot } | null

export interface GlobeHandle {
  flyTo(lat: number, lon: number, zoom?: number): void
  frame(place: Place, radiusKm: number): void
  zoomBy(d: number): void
  home(): void
}

interface Props {
  ref?: Ref<GlobeHandle>
  events: EonetEvent[]
  fires: FireSet | null
  showEvents: boolean
  showFires: boolean
  overlays: Record<string, boolean>
  date: string
  nightShade: boolean
  spinning: boolean
  place: Place | null
  radiusKm: number
  selection: Selection
  onSelect(s: Selection): void
  onPick(lat: number, lon: number): void
  onInteract(): void
  onReady(): void
  children?: (map: MLMap) => ReactNode
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const catColor = ['match', ['get', 'cat'], ...CATEGORIES.flatMap((c) => [c.id, c.color]), '#a7a39a'] as unknown as maplibregl.ExpressionSpecification

function style(date: string): StyleSpecification {
  const sources: StyleSpecification['sources'] = {
    [BASE.id]: { type: 'raster', tiles: [tileUrl(BASE, date)], tileSize: 256, maxzoom: BASE.maxzoom },
  }
  for (const l of OVERLAYS) sources[l.id] = { type: 'raster', tiles: [tileUrl(l, date)], tileSize: 256, maxzoom: l.maxzoom }
  const raster = (id: string, opacity: number): maplibregl.LayerSpecification => ({
    id, type: 'raster', source: id, layout: { visibility: 'none' },
    paint: { 'raster-opacity': opacity, 'raster-fade-duration': 400, 'raster-resampling': 'linear' },
  })
  const o = Object.fromEntries(OVERLAYS.map((l) => [l.id, l]))
  return {
    version: 8,
    projection: { type: 'globe' },
    sky: {
      'sky-color': '#05070a',
      'horizon-color': '#24496b',
      'fog-color': '#05070a',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.9,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.9, 7, 0],
    },
    sources,
    layers: [
      { id: 'space', type: 'background', paint: { 'background-color': '#0a1220' } },
      { id: BASE.id, type: 'raster', source: BASE.id, paint: { 'raster-fade-duration': 0, 'raster-saturation': -0.15, 'raster-brightness-max': 0.92 } },
      raster('truecolor', o.truecolor.opacity),
      raster('clouds', o.clouds.opacity),
      raster('cloudtop', o.cloudtop.opacity),
      raster('rain', o.rain.opacity),
      raster('aerosol', o.aerosol.opacity),
      raster('night', o.night.opacity),
      raster('labels', o.labels.opacity),
      raster('names', o.names.opacity),
    ],
  }
}

export function Globe(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MLMap | null>(null)
  const props = useRef(p)
  props.current = p
  const spinRef = useRef(false)

  /* ── create once ── */
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: style(p.date),
      center: [-30, 18],
      zoom: 0.2,
      minZoom: 0.8,
      maxZoom: 12,
      attributionControl: false,
      renderWorldCopies: false,
      fadeDuration: 200,
      canvasContextAttributes: { antialias: true },
    })
    m.dragRotate.disable()
    m.touchZoomRotate.disableRotation()

    m.on('load', () => {
      m.addSource('night-shade', { type: 'geojson', data: EMPTY })
      m.addLayer({ id: 'night-shade', type: 'fill', source: 'night-shade', paint: { 'fill-color': '#020409', 'fill-opacity': 0.5, 'fill-antialias': false } }, 'night')

      m.addSource('fires', { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'fire-heat', type: 'heatmap', source: 'fires', maxzoom: 8,
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'frp'], 0, 0.2, 40, 0.6, 300, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 6, 1.8],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2.2, 3, 5, 6, 12],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(255,106,43,0)', 0.15, 'rgba(255,90,30,0.45)', 0.45, '#ff6a2b', 0.75, '#ffb36b', 1, '#fff1d6'],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.95, 7.5, 0],
        },
      })
      m.addLayer({
        id: 'fire-pts', type: 'circle', source: 'fires', minzoom: 5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            5, ['min', 4, ['+', 1.2, ['*', 0.02, ['get', 'frp']]]],
            10, ['min', 12, ['+', 3.5, ['*', 0.05, ['get', 'frp']]]]],
          'circle-color': ['match', ['get', 'c'], 2, '#ffd9b0', 1, '#ff8a3d', '#c4522a'],
          'circle-blur': 0.35,
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 6.2, 0.95],
          'circle-stroke-color': '#2a0e04',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 9, 0.8],
        },
      })

      m.addSource('tracks', { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'tracks', type: 'line', source: 'tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': catColor, 'line-width': 1.4, 'line-opacity': 0.75, 'line-dasharray': [0.2, 2.2] },
      })
      m.addSource('track-pts', { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'track-pts', type: 'circle', source: 'track-pts',
        paint: { 'circle-radius': 1.8, 'circle-color': catColor, 'circle-opacity': 0.8 },
      })

      m.addSource('place', { type: 'geojson', data: EMPTY })
      m.addLayer({ id: 'place-fill', type: 'fill', source: 'place', paint: { 'fill-color': '#efe8d8', 'fill-opacity': 0.05 } })
      m.addLayer({ id: 'place-casing', type: 'line', source: 'place', paint: { 'line-color': '#050608', 'line-width': 3.4, 'line-opacity': 0.55 } })
      m.addLayer({ id: 'place-line', type: 'line', source: 'place', paint: { 'line-color': '#ffd2a8', 'line-width': 1.4, 'line-opacity': 0.95, 'line-dasharray': [3, 2.5] } })

      m.addSource('events', { type: 'geojson', data: EMPTY, promoteId: 'id' })
      m.addLayer({
        id: 'ev-pulse', type: 'circle', source: 'events', filter: ['==', ['get', 'recent'], true],
        paint: { 'circle-radius': 6, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': catColor, 'circle-stroke-width': 1.2, 'circle-stroke-opacity': 0.8, 'circle-pitch-alignment': 'map' },
      })
      m.addLayer({
        id: 'ev-dot', type: 'circle', source: 'events',
        paint: {
          'circle-radius': ['case', ['boolean', ['feature-state', 'sel'], false], 7.5, ['boolean', ['feature-state', 'hover'], false], 6.5, ['boolean', ['feature-state', 'near'], false], 6, 4.6],
          'circle-color': catColor,
          'circle-stroke-color': ['case', ['boolean', ['feature-state', 'sel'], false], '#efe8d8', '#07080a'],
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.2, 1.4],
          'circle-radius-transition': { duration: 220 },
          'circle-pitch-alignment': 'map',
        },
      })

      /* interaction */
      const hit = (pt: maplibregl.PointLike, layers: string[]) => {
        const { x, y } = pt as maplibregl.Point
        return m.queryRenderedFeatures([[x - 6, y - 6], [x + 6, y + 6]], { layers: layers.filter((l) => m.getLayer(l)) })
      }
      let hovered: string | number | undefined
      m.on('mousemove', (e) => {
        const f = hit(e.point, ['ev-dot'])[0]
        const fire = !f && m.getZoom() >= 5.5 ? hit(e.point, ['fire-pts'])[0] : undefined
        m.getCanvas().style.cursor = f || fire ? 'pointer' : ''
        if (hovered !== undefined && hovered !== f?.id) m.setFeatureState({ source: 'events', id: hovered }, { hover: false })
        hovered = f?.id
        if (hovered !== undefined) m.setFeatureState({ source: 'events', id: hovered }, { hover: true })
      })
      m.on('click', (e) => {
        const f = hit(e.point, ['ev-dot'])[0]
        if (f) return props.current.onSelect({ kind: 'event', id: String(f.properties.id) })
        const fire = m.getZoom() >= 5.5 ? hit(e.point, ['fire-pts'])[0] : undefined
        if (fire) {
          const pr = fire.properties
          return props.current.onSelect({ kind: 'fire', h: [pr.lon, pr.lat, pr.frp, pr.c, pr.dn, pr.t] })
        }
        props.current.onPick(e.lngLat.lat, e.lngLat.lng)
      })
      for (const ev of ['mousedown', 'touchstart', 'wheel'] as const) m.on(ev, () => props.current.onInteract())

      setMap(m)
      props.current.onReady()
    })

    return () => { m.remove(); setMap(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── imperative camera ── */
  useImperativeHandle(p.ref, () => ({
    flyTo(lat, lon, zoom) {
      spinRef.current = false
      map?.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(map.getZoom(), 5), speed: 1.1, curve: 1.6, essential: true })
    },
    frame(place, radiusKm) {
      spinRef.current = false
      map?.flyTo({ center: [place.lon, place.lat], zoom: zoomForRadius(radiusKm), speed: 1.05, curve: 1.7, padding: framePadding(), essential: true })
    },
    zoomBy(d) { map?.easeTo({ zoom: map.getZoom() + d, duration: 300 }) },
    home() { map?.flyTo({ center: [map.getCenter().lng, 12], zoom: homeZoom(), speed: 1.2 }) },
  }), [map])

  /* ── events ── */
  useEffect(() => {
    if (!map) return
    const now = Date.now()
    const show = p.showEvents ? p.events : []
    ;(map.getSource('events') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: show.map((e) => ({
        type: 'Feature', id: e.id,
        geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
        properties: { id: e.id, cat: e.category, recent: now - Date.parse(e.date) < 4 * 86400000 },
      })),
    })
    const tracks = show.filter((e) => e.track.length > 1 && e.category !== 'wildfires')
    ;(map.getSource('tracks') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: tracks.map((e) => ({
        type: 'Feature', geometry: { type: 'LineString', coordinates: unwrap(e.track.map(([x, y]) => [x, y])) }, properties: { cat: e.category },
      })),
    })
    ;(map.getSource('track-pts') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: tracks.flatMap((e) => e.track.slice(0, -1).map(([x, y]) => ({
        type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [x, y] }, properties: { cat: e.category },
      }))),
    })
  }, [map, p.events, p.showEvents])

  /* ── fires ── */
  useEffect(() => {
    if (!map) return
    const hs = p.showFires && p.fires ? p.fires.hotspots : []
    ;(map.getSource('fires') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: hs.map(([lon, lat, frp, c, dn, t]) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { lon, lat, frp, c, dn, t },
      })),
    })
  }, [map, p.fires, p.showFires])

  /* ── imagery ── */
  useEffect(() => {
    if (!map) return
    for (const l of OVERLAYS) map.setLayoutProperty(l.id, 'visibility', p.overlays[l.id] ? 'visible' : 'none')
  }, [map, p.overlays])

  useEffect(() => {
    if (!map) return
    for (const l of OVERLAYS) if (l.dated) (map.getSource(l.id) as RasterTileSource).setTiles([tileUrl(l, p.date)])
  }, [map, p.date])

  /* ── night side, refreshed every minute ── */
  useEffect(() => {
    if (!map) return
    const paint = () => (map.getSource('night-shade') as GeoJSONSource).setData(
      p.nightShade ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [nightPolygon()] } } : EMPTY,
    )
    paint()
    const t = setInterval(paint, 60_000)
    return () => clearInterval(t)
  }, [map, p.nightShade])

  /* ── watched place ── */
  useEffect(() => {
    if (!map) return
    ;(map.getSource('place') as GeoJSONSource).setData(
      p.place ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(p.place.lat, p.place.lon, p.radiusKm)] } } : EMPTY,
    )
    for (const e of p.events) map.setFeatureState({ source: 'events', id: e.id }, {
      near: Boolean(p.place && distanceKm(p.place.lat, p.place.lon, e.lat, e.lon) <= p.radiusKm),
    })
    if (!p.place) return
    const dot = document.createElement('div')
    dot.className = 'reticle'
    dot.innerHTML = '<i></i><i></i><b></b>'
    const marker = new maplibregl.Marker({ element: dot }).setLngLat([p.place.lon, p.place.lat]).addTo(map)
    return () => { marker.remove() }
  }, [map, p.place, p.radiusKm, p.events])

  /* ── selection ── */
  useEffect(() => {
    if (!map || p.selection?.kind !== 'event') return
    const id = p.selection.id
    map.setFeatureState({ source: 'events', id }, { sel: true })
    return () => { if (map.getSource('events')) map.setFeatureState({ source: 'events', id }, { sel: false }) }
  }, [map, p.selection])

  /* ── breathing rings on recent events ── */
  useEffect(() => {
    if (!map) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    let raf = 0, last = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      if (t - last < 40 || document.hidden) return
      last = t
      const k = (t % 2400) / 2400
      map.setPaintProperty('ev-pulse', 'circle-radius', 5 + k * 17)
      map.setPaintProperty('ev-pulse', 'circle-stroke-opacity', 0.85 * (1 - k) ** 1.6)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [map])

  /* ── idle spin ──
     Starting any camera move fires 'moveend' on the one it interrupts, so the spin loop
     reads a ref that camera commands clear synchronously, before React re-renders. */
  useEffect(() => {
    spinRef.current = p.spinning
    if (!map || !p.spinning) return
    const spin = () => {
      if (!spinRef.current || map.getZoom() > 3.2) return
      const c = map.getCenter()
      c.lng -= 2.4
      map.easeTo({ center: c, duration: 1000, easing: (n) => n })
    }
    map.on('moveend', spin)
    spin()
    return () => { map.off('moveend', spin) }
  }, [map, p.spinning])

  return (
    <div className="globe">
      <div ref={el} className="globe-canvas" />
      {map && p.children?.(map)}
    </div>
  )
}

/** A globe that fills most of the space between the panels, on any screen. */
function homeZoom() {
  const h = window.innerHeight, w = window.innerWidth
  const span = Math.min(h - 140, w < 760 ? w + 60 : w - 720)
  return Math.max(1.2, Math.min(2.6, Math.log2(Math.max(260, span) / 512) + 1.95))
}

/** Leave room for the side panels when framing a place. */
function framePadding() {
  const w = window.innerWidth
  if (w < 760) return { top: 80, bottom: window.innerHeight * 0.45, left: 20, right: 20 }
  return { top: 90, bottom: 120, left: w > 1180 ? 360 : 40, right: 420 }
}

/** Keep a track continuous across the antimeridian so the line doesn't wrap the planet. */
function unwrap(pts: number[][]) {
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    let x = pts[i][0]
    const px = out[i - 1][0]
    while (x - px > 180) x -= 360
    while (x - px < -180) x += 360
    out.push([x, pts[i][1]])
  }
  return out
}

/** A DOM card pinned to a coordinate; hides when the point rolls behind the planet. */
export function Pinned({ map, lat, lon, children }: { map: MLMap; lat: number; lon: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const place = () => {
      const node = ref.current
      if (!node) return
      const c = map.getCenter()
      const behind = distanceKm(c.lat, c.lng, lat, lon) > 8800 && map.getZoom() < 4
      const { x, y } = map.project([lon, lat])
      node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
      node.style.visibility = behind ? 'hidden' : 'visible'
    }
    place()
    map.on('move', place)
    map.on('resize', place)
    return () => { map.off('move', place); map.off('resize', place) }
  }, [map, lat, lon])
  return createPortal(<div ref={ref} className="pinned">{children}</div>, map.getContainer().parentElement!)
}

