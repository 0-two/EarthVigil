import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import * as maplibregl from 'maplibre-gl'
import { type GeoJSONSource, type Map as MLMap, type RasterTileSource, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

// MapLibre builds its worker URL at runtime, which the production bundler can't see; hand it the emitted file instead.
maplibregl.setWorkerUrl(workerUrl)
import type { EonetEvent, FireSet, Hotspot, Place } from '../lib/types'
import { OVERLAYS, SOURCES, tileUrl, type Overlay } from '../lib/gibs'
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
  deferMs?: number
  children?: (map: MLMap) => ReactNode
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const catColor = ['match', ['get', 'cat'], ...CATEGORIES.flatMap((c) => [c.id, c.color]), '#a7a39a'] as unknown as maplibregl.ExpressionSpecification

const name = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']] as unknown as maplibregl.ExpressionSpecification
const halo = { 'text-halo-color': 'rgba(5,6,8,0.82)', 'text-halo-width': 1.3, 'text-halo-blur': 0.4 }
const notSea = ['!=', ['get', 'maritime'], 1]

function style(date: string): StyleSpecification {
  const sources: StyleSpecification['sources'] = {
    s2: {
      type: 'raster', tiles: [SOURCES.s2], tileSize: 256, maxzoom: 14,
      attribution: 'Sentinel-2 cloudless 2024 by EOX (contains modified Copernicus Sentinel data)',
    },
    /* no source minzoom: in a tilted view the far tiles load at lower zooms and must still be covered, or a seam shows */
    esri: { type: 'raster', tiles: [SOURCES.esri], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' },
    'dem-terrain': { type: 'raster-dem', tiles: [SOURCES.dem], tileSize: 256, maxzoom: 14, encoding: 'terrarium' },
    'dem-shade': { type: 'raster-dem', tiles: [SOURCES.dem], tileSize: 256, maxzoom: 12, encoding: 'terrarium' },
    ofm: { type: 'vector', url: SOURCES.vector, attribution: '© OpenStreetMap contributors · OpenFreeMap' },
  }
  for (const l of OVERLAYS) if (l.gibs) sources[l.id] = { type: 'raster', tiles: [tileUrl(l, date)], tileSize: 256, maxzoom: l.gibs.maxzoom }
  const raster = (l: Overlay): maplibregl.LayerSpecification => ({
    id: l.id, type: 'raster', source: l.id, layout: { visibility: 'none' }, metadata: { group: l.id },
    paint: { 'raster-opacity': l.opacity, 'raster-fade-duration': 300, 'raster-resampling': 'linear' },
  })
  const g = (group: string) => ({ metadata: { group } })
  const hidden = { visibility: 'none' as const }

  return {
    version: 8,
    projection: { type: 'globe' },
    glyphs: SOURCES.glyphs,
    terrain: { source: 'dem-terrain', exaggeration: 1.35 },
    sky: {
      'sky-color': '#0b1a2e',
      'horizon-color': '#4a7aa6',
      'fog-color': '#0a1424',
      'sky-horizon-blend': 0.55,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.85,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 0.9, 8, 0.25, 11, 0],
    },
    sources,
    layers: [
      { id: 'space', type: 'background', paint: { 'background-color': '#0a1220' } },
      { id: 's2', type: 'raster', source: 's2', paint: { 'raster-fade-duration': 250, 'raster-resampling': 'linear', 'raster-contrast': 0.06, 'raster-saturation': 0.04 } },
      {
        id: 'esri', type: 'raster', source: 'esri', minzoom: 8,
        paint: { 'raster-fade-duration': 250, 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 8.5, 0, 11, 1] },
      },
      {
        id: 'relief', type: 'hillshade', source: 'dem-shade', maxzoom: 12,
        paint: {
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 2, 0.35, 9, 0.2, 12, 0],
          'hillshade-shadow-color': 'rgba(4,8,14,0.55)', 'hillshade-highlight-color': 'rgba(255,248,235,0.10)', 'hillshade-accent-color': 'rgba(0,0,0,0)',
        },
      },
      ...OVERLAYS.filter((l) => l.gibs).map(raster),

      /* borders & roads */
      { id: 'roads-major', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 7, ...g('labels'), layout: hidden,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false],
        paint: { 'line-color': '#f2d49b', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.25, 12, 0.55], 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 7, 0.4, 12, 1.6, 16, 5] } },
      { id: 'roads-minor', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 11, ...g('labels'), layout: hidden,
        filter: ['match', ['get', 'class'], ['secondary', 'tertiary', 'minor'], true, false],
        paint: { 'line-color': '#ffffff', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.12, 15, 0.4], 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 0.3, 16, 2.5] } },
      { id: 'bd-state', type: 'line', source: 'ofm', 'source-layer': 'boundary', minzoom: 3.5, ...g('labels'), layout: hidden,
        filter: ['all', ['==', ['get', 'admin_level'], 4], notSea],
        paint: { 'line-color': '#efe8d8', 'line-opacity': 0.3, 'line-width': 0.7, 'line-dasharray': [3, 2] } },
      { id: 'bd-country', type: 'line', source: 'ofm', 'source-layer': 'boundary', ...g('labels'), layout: hidden,
        filter: ['all', ['==', ['get', 'admin_level'], 2], notSea],
        paint: { 'line-color': '#efe8d8', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 6, 0.7], 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.3, 12, 2.2] } },

      /* names */
      { id: 'nm-water', type: 'symbol', source: 'ofm', 'source-layer': 'water_name', ...g('names'),
        filter: ['match', ['get', 'class'], ['ocean', 'sea', 'bay', 'strait', 'lake'], true, false],
        layout: { ...hidden, 'text-field': name, 'text-font': ['Noto Sans Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 8, 14], 'text-letter-spacing': 0.12, 'text-max-width': 8 },
        paint: { 'text-color': '#93b6cc', ...halo } },
      { id: 'nm-minor', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 11, ...g('names'),
        filter: ['match', ['get', 'class'], ['village', 'suburb', 'neighbourhood', 'quarter', 'hamlet'], true, false],
        layout: { ...hidden, 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 14], 'text-max-width': 8 },
        paint: { 'text-color': 'rgba(239,232,216,0.85)', ...halo } },
      { id: 'nm-town', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 8, ...g('names'),
        filter: ['==', ['get', 'class'], 'town'],
        layout: { ...hidden, 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 15], 'text-max-width': 8 },
        paint: { 'text-color': '#efe8d8', ...halo } },
      { id: 'nm-state', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 4, maxzoom: 9, ...g('names'),
        filter: ['==', ['get', 'class'], 'state'],
        layout: { ...hidden, 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-transform': 'uppercase', 'text-letter-spacing': 0.16, 'text-max-width': 7 },
        paint: { 'text-color': 'rgba(239,232,216,0.6)', ...halo } },
      { id: 'nm-city', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 2.5, ...g('names'),
        filter: ['==', ['get', 'class'], 'city'],
        layout: { ...hidden, 'text-field': name, 'text-font': ['Noto Sans Regular'], 'symbol-sort-key': ['get', 'rank'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10.5, 8, 14, 12, 18], 'text-max-width': 8 },
        paint: { 'text-color': '#fbf6ea', ...halo } },
      { id: 'nm-country', type: 'symbol', source: 'ofm', 'source-layer': 'place', maxzoom: 7, ...g('names'),
        filter: ['==', ['get', 'class'], 'country'],
        layout: { ...hidden, 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9.5, 5, 13], 'text-transform': 'uppercase', 'text-letter-spacing': 0.2, 'text-max-width': 7 },
        paint: { 'text-color': '#efe8d8', ...halo } },
    ] as maplibregl.LayerSpecification[],
  }
}

/** Every style layer that belongs to a layer-dock entry. */
const groupLayers = (m: MLMap, id: string) =>
  m.getStyle().layers.filter((l) => (l.metadata as { group?: string } | undefined)?.group === id).map((l) => l.id)

/** Google Earth's camera: accelerate away, glide, settle gently. */
const glide = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

/** Closer views tilt more, so terrain reads as terrain. */
const pitchFor = (km: number) => (km <= 25 ? 60 : km <= 50 ? 54 : km <= 100 ? 46 : km <= 250 ? 32 : 14)

export function Globe(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MLMap | null>(null)
  const props = useRef(p)
  props.current = p
  const spinRef = useRef(false)

  /* ── create once, after deferMs so building the WebGL globe doesn't stall the intro ── */
  useEffect(() => {
    let created: MLMap | undefined
    const t = setTimeout(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: style(p.date),
      center: [-30, 18],
      zoom: 0.2,
      minZoom: 0.8,
      maxZoom: 18.5,
      maxPitch: 72,
      attributionControl: false,
      renderWorldCopies: false,
      fadeDuration: 200,
      maxTileCacheSize: 600,
      canvasContextAttributes: { antialias: true },
    })
    created = m

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

    }, p.deferMs ?? 0)
    return () => { clearTimeout(t); created?.remove(); setMap(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── imperative camera ── */
  useImperativeHandle(p.ref, () => ({
    flyTo(lat, lon, zoom) {
      spinRef.current = false
      map?.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(map.getZoom(), 5), pitch: 28, bearing: 0, speed: 0.9, curve: 1.5, maxDuration: 5000, easing: glide, essential: true })
    },
    frame(place, radiusKm) {
      spinRef.current = false
      map?.flyTo({
        center: [place.lon, place.lat], zoom: zoomForRadius(radiusKm), pitch: pitchFor(radiusKm), bearing: 0,
        speed: 0.85, curve: 1.5, maxDuration: 5500, easing: glide, padding: framePadding(), essential: true,
      })
    },
    zoomBy(d) { map?.easeTo({ zoom: map.getZoom() + d, duration: 300 }) },
    home() { map?.flyTo({ center: [map.getCenter().lng, 12], zoom: homeZoom(), pitch: 0, bearing: 0, speed: 1.1, easing: glide }) },
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
    for (const l of OVERLAYS) for (const id of groupLayers(map, l.id)) map.setLayoutProperty(id, 'visibility', p.overlays[l.id] ? 'visible' : 'none')
  }, [map, p.overlays])

  useEffect(() => {
    if (!map) return
    for (const l of OVERLAYS) if (l.gibs?.dated) (map.getSource(l.id) as RasterTileSource).setTiles([tileUrl(l, p.date)])
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

