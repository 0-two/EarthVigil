import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Globe, Pinned, type GlobeHandle, type Selection } from './components/Globe'
import { Search } from './components/Search'
import { Ledger } from './components/Ledger'
import { PlacePanel, type Nearby } from './components/PlacePanel'
import { AlertSheet } from './components/AlertSheet'
import { EventCard, FireCard, LayerDock, Timeline, Watches } from './components/Controls'
import { Intro } from './components/Intro'
import { Icon, useClock } from './components/bits'
import { api, reverseGeocode, saved } from './lib/api'
import { defaultImageryDate, OVERLAYS } from './lib/gibs'
import { distanceKm } from './lib/geo'
import type { EonetEvent, FireSet, Place, SavedWatch, ServerConfig } from './lib/types'

const ease = [0.22, 1, 0.36, 1] as const

function useIsNarrow() {
  const [narrow, set] = useState(() => matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const m = matchMedia('(max-width: 760px)')
    const on = () => set(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

export default function App() {
  const globe = useRef<GlobeHandle>(null)
  const narrow = useIsNarrow()

  /* ── data ── */
  const [events, setEvents] = useState<EonetEvent[]>([])
  const [eventsErr, setEventsErr] = useState<string | null>(null)
  const [fires, setFires] = useState<FireSet | null>(null)
  const [firesErr, setFiresErr] = useState<string | null>(null)
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    const load = () => {
      api.events().then((e) => { setEvents(e); setEventsErr(null) }).catch((e: Error) => setEventsErr(e.message))
      api.fires().then((f) => { setFires(f); setFiresErr(null) }).catch((e: Error) => setFiresErr(e.message))
    }
    load()
    api.config().then(setConfig).catch(() => {})
    const t = setInterval(load, 10 * 60_000)
    return () => clearInterval(t)
  }, [])

  /* ── view state ── */
  const [intro, setIntro] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [showFires, setShowFires] = useState(true)
  const [overlays, setOverlays] = useState<Record<string, boolean>>({ truecolor: true, labels: true, names: true })
  const [nightShade, setNightShade] = useState(true)
  const [date, setDate] = useState(defaultImageryDate)
  const [spinning, setSpinning] = useState(true)
  const [place, setPlace] = useState<Place | null>(null)
  const [radiusKm, setRadiusKm] = useState(100)
  const [mode, setMode] = useState<'place' | 'alert'>('place')
  const [selection, setSelection] = useState<Selection>(null)
  const [layersOpen, setLayersOpen] = useState(false)
  const [ledgerOpen, setLedgerOpen] = useState(!narrow)
  const [watchesOpen, setWatchesOpen] = useState(false)
  const [watchList, setWatchList] = useState<SavedWatch[]>(saved.list)

  useEffect(() => setLedgerOpen(!narrow), [narrow])

  const shown = useMemo(() => events.filter((e) => !hidden.has(e.category)), [events, hidden])
  const selectedEvent = selection?.kind === 'event' ? events.find((e) => e.id === selection.id) ?? null : null

  const near: Nearby = useMemo(() => {
    if (!place) return { events: [], fires: [], nearestFireKm: Infinity }
    const ev = shown
      .map((e) => ({ ...e, km: Math.min(...e.track.map(([lo, la]) => distanceKm(place.lat, place.lon, la, lo))) }))
      .filter((e) => e.km <= radiusKm)
      .sort((a, b) => a.km - b.km)
    let nearest = Infinity
    const fs: Nearby['fires'] = []
    if (showFires && fires) {
      for (const h of fires.hotspots) {
        if (Math.abs(h[1] - place.lat) > 12) continue
        const d = distanceKm(place.lat, place.lon, h[1], h[0])
        if (d < nearest) nearest = d
        if (d <= radiusKm) fs.push(h)
      }
    }
    return { events: ev, fires: fs, nearestFireKm: nearest }
  }, [place, radiusKm, shown, fires, showFires])

  /* ── actions ── */
  const stopSpin = useCallback(() => setSpinning(false), [])

  const openPlace = useCallback((p: Place, km = radiusKm) => {
    setPlace(p)
    setMode('place')
    setSelection(null)
    setSpinning(false)
    setLayersOpen(false)
    if (narrow) setLedgerOpen(false)
    globe.current?.frame(p, km)
  }, [radiusKm, narrow])

  const pickPoint = useCallback(async (lat: number, lon: number) => {
    const temp: Place = { name: 'Locating…', lat, lon }
    openPlace(temp)
    const named = await reverseGeocode(lat, lon)
    setPlace((cur) => (cur && cur.lat === lat && cur.lon === lon ? named : cur))
  }, [openPlace])

  const locate = useCallback(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => void pickPoint(pos.coords.latitude, pos.coords.longitude),
      () => alert('Location permission was declined. You can still search for a place.'),
      { timeout: 10_000 },
    )
  }, [pickPoint])

  const pickEvent = useCallback((e: EonetEvent) => {
    setSelection({ kind: 'event', id: e.id })
    setSpinning(false)
    if (narrow) setLedgerOpen(false)
    globe.current?.flyTo(e.lat, e.lon, 4.6)
  }, [narrow])

  const watchAt = useCallback(async (lat: number, lon: number) => {
    setSelection(null)
    const named = await reverseGeocode(lat, lon)
    openPlace(named)
    setMode('alert')
  }, [openPlace])

  const changeRadius = (km: number) => {
    setRadiusKm(km)
    if (place) globe.current?.frame(place, km)
  }

  const saveWatch = (w: SavedWatch) => {
    const list = [w, ...watchList.filter((x) => x.id !== w.id)]
    setWatchList(list)
    saved.put(list)
  }
  const removeWatch = async (w: SavedWatch) => {
    if (!confirm(`Stop watching ${w.name}? No more alerts will be sent for it.`)) return
    await api.removeWatch(w).catch(() => {})
    const list = watchList.filter((x) => x.id !== w.id)
    setWatchList(list)
    saved.put(list)
  }

  /* deep links from alert messages: /?lat=..&lon=..&r=.. */
  const deepLinked = useRef(false)
  useEffect(() => {
    if (intro || !mapReady || deepLinked.current) return
    deepLinked.current = true
    const q = new URLSearchParams(location.search)
    const lat = Number(q.get('lat')), lon = Number(q.get('lon'))
    if (q.has('lat') && Number.isFinite(lat) && Number.isFinite(lon)) {
      const r = Number(q.get('r'))
      if ([25, 50, 100, 250, 500].includes(r)) setRadiusKm(r)
      history.replaceState(null, '', location.pathname)
      reverseGeocode(lat, lon).then((p) => openPlace(p, r || radiusKm))
    } else {
      globe.current?.home()
    }
  }, [intro, mapReady, openPlace, radiusKm])

  /* Esc closes the top-most thing */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement)?.closest('input')) return
      if (selection) setSelection(null)
      else if (mode === 'alert') setMode('place')
      else if (place) setPlace(null)
      else setLayersOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, mode, place])

  const clock = useClock()
  const utc = clock.toISOString().slice(11, 19)

  return (
    <div className={`app ${intro ? 'is-intro' : ''}`}>
      <div className="stars" aria-hidden />
      <Globe
        ref={globe}
        events={shown}
        fires={fires}
        showEvents
        showFires={showFires}
        overlays={overlays}
        date={date}
        nightShade={nightShade}
        spinning={spinning && !intro}
        place={place}
        radiusKm={radiusKm}
        selection={selection}
        onSelect={(s) => { setSelection(s); setSpinning(false) }}
        onPick={(lat, lon) => { if (selection) setSelection(null); else void pickPoint(lat, lon) }}
        onInteract={stopSpin}
        onReady={() => setMapReady(true)}
      >
        {(map) => (
          <AnimatePresence>
            {selectedEvent && (
              <Pinned key={selectedEvent.id} map={map} lat={selectedEvent.lat} lon={selectedEvent.lon}>
                <EventCard e={selectedEvent} onClose={() => setSelection(null)} onWatch={() => void watchAt(selectedEvent.lat, selectedEvent.lon)} />
              </Pinned>
            )}
            {selection?.kind === 'fire' && (
              <Pinned key={selection.h.join()} map={map} lat={selection.h[1]} lon={selection.h[0]}>
                <FireCard h={selection.h} onClose={() => setSelection(null)} onWatch={() => void watchAt(selection.h[1], selection.h[0])} />
              </Pinned>
            )}
          </AnimatePresence>
        )}
      </Globe>
      <div className="vignette" aria-hidden />

      {/* ── masthead ── */}
      <motion.header className="mast" initial={{ opacity: 0, y: -12 }} animate={intro ? {} : { opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.2 }}>
        <div className="brand">
          <span className="wordmark">Vigil</span>
          <span className="tagline">A live watch<br />over Earth</span>
        </div>
        <Search onPlace={(p) => openPlace(p)} onLocate={locate} />
        <div className="mast-right">
          <span className="clock mono" title="Coordinated Universal Time"><i className="live" /> {utc} UTC</span>
          <button className={`chip-btn ${watchesOpen ? 'is-on' : ''}`} onClick={() => setWatchesOpen(!watchesOpen)}>
            <Icon name="bell" size={14} /> <span>Watches</span> <b className="mono">{watchList.length}</b>
          </button>
          <AnimatePresence>
            {watchesOpen && (
              <Watches list={watchList} onClose={() => setWatchesOpen(false)} onRemove={removeWatch}
                onGo={(w) => { setWatchesOpen(false); setRadiusKm(w.radiusKm); openPlace({ name: w.name, lat: w.lat, lon: w.lon }, w.radiusKm) }} />
            )}
          </AnimatePresence>
        </div>
      </motion.header>

      {/* ── ledger ── */}
      <AnimatePresence>
        {!intro && ledgerOpen && (
          <motion.div className="ledger-wrap" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.6, ease, delay: 0.1 }}>
            <Ledger
              all={events} shown={shown} fires={fires} hidden={hidden} showFires={showFires}
              selectedId={selection?.kind === 'event' ? selection.id : null}
              loading={!events.length && !eventsErr}
              error={eventsErr && 'NASA EONET did not answer. Retrying shortly.'}
              onToggleCat={(id) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n })}
              onToggleFires={() => setShowFires((v) => !v)}
              onPick={pickEvent}
              onClose={narrow ? () => setLedgerOpen(false) : undefined}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── place / alert panel ── */}
      <AnimatePresence>
        {place && !intro && (
          <motion.aside key="side" className="panel side" initial={narrow ? { y: '100%' } : { opacity: 0, x: 32 }} animate={narrow ? { y: 0 } : { opacity: 1, x: 0 }}
            exit={narrow ? { y: '100%' } : { opacity: 0, x: 32 }} transition={{ duration: 0.55, ease }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={mode} className="side-inner" initial={{ opacity: 0, x: mode === 'alert' ? 24 : -24 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: mode === 'alert' ? -24 : 24 }} transition={{ duration: 0.32, ease }}>
                {mode === 'place' ? (
                  <PlacePanel place={place} radiusKm={radiusKm} near={near} firesLoaded={!!fires}
                    onRadius={changeRadius} onPickEvent={pickEvent} onAlert={() => setMode('alert')}
                    onClose={() => setPlace(null)} />
                ) : (
                  <AlertSheet place={place} radiusKm={radiusKm} config={config} onRadius={changeRadius}
                    onBack={() => setMode('place')} onSaved={saveWatch} />
                )}
              </motion.div>
            </AnimatePresence>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── bottom rail ── */}
      <motion.footer className="rail" initial={{ opacity: 0, y: 16 }} animate={intro ? {} : { opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.35 }}>
        <div className="rail-left">
          {narrow && (
            <button className="dock-btn" onClick={() => setLedgerOpen(!ledgerOpen)}><Icon name="list" /> <span>Ledger</span> <b className="mono">{events.length}</b></button>
          )}
          <LayerDock overlays={overlays} open={layersOpen} onOpen={setLayersOpen}
            onToggle={(id) => setOverlays((o) => ({ ...o, [id]: !o[id] }))}
            nightShade={nightShade} onNightShade={() => setNightShade((v) => !v)} />
        </div>
        <Timeline date={date} onDate={setDate} />
        <div className="rail-right">
          <div className="zoom">
            <button className="icon-btn" onClick={() => globe.current?.zoomBy(1)} aria-label="Zoom in"><Icon name="plus" /></button>
            <button className="icon-btn" onClick={() => globe.current?.zoomBy(-1)} aria-label="Zoom out"><Icon name="minus" /></button>
            <button className={`icon-btn ${spinning ? 'is-on' : ''}`} onClick={() => { if (!spinning) globe.current?.home(); setSpinning(!spinning) }} aria-label="Spin the globe" title="Spin"><Icon name="spin" /></button>
          </div>
          <p className="credit">
            {fires ? <>{fires.source} · fires updated {new Date(fires.fetchedAt).toISOString().slice(11, 16)} UTC</> : firesErr ? 'Fire feed unavailable' : 'Reading fire feed…'}
            <br />
            NASA <a href="https://eonet.gsfc.nasa.gov/" target="_blank" rel="noreferrer">EONET</a> · <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">FIRMS</a> · <a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api" target="_blank" rel="noreferrer">GIBS</a> · labels © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OSM</a>
          </p>
        </div>
      </motion.footer>

      <AnimatePresence>
        {intro && (
          <Intro
            onDone={() => setIntro(false)}
            steps={[
              { label: 'EONET natural events', value: events.length ? `${events.length} open` : null, failed: !!eventsErr },
              { label: 'FIRMS fire hotspots', value: fires ? fires.hotspots.length.toLocaleString('en') : null, failed: !!firesErr },
              { label: 'GIBS imagery', value: mapReady ? `${OVERLAYS.filter((l) => overlays[l.id]).length + 1} layers` : null },
            ]}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
