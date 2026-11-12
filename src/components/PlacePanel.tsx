import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Conditions, EonetEvent, Hotspot, Place } from '../lib/types'
import { catOf, FIRE_GLYPH } from '../lib/categories'
import { ago, fmtCoord, fmtKm } from '../lib/geo'
import { api } from '../lib/api'
import { Count, Glyph, Icon } from './bits'

export const RADII = [25, 50, 100, 250, 500]

export interface Nearby {
  events: (EonetEvent & { km: number })[]
  fires: (Hotspot & { km?: number })[]
  nearestFireKm: number
}

interface Props {
  place: Place
  radiusKm: number
  near: Nearby
  firesLoaded: boolean
  onRadius(km: number): void
  onPickEvent(e: EonetEvent): void
  onAlert(): void
  onClose(): void
}

const ease = [0.23, 1, 0.32, 1] as const

/** WMO weather interpretation codes, as Open-Meteo reports them. */
function sky(code: number) {
  if (code === 0) return 'Clear'
  if (code <= 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code <= 48) return 'Fog'
  if (code <= 57) return 'Drizzle'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Showers'
  if (code <= 86) return 'Snow showers'
  return 'Thunderstorm'
}

const AQI = [
  { max: 50, label: 'Good', color: '#9fd8b8' },
  { max: 100, label: 'Moderate', color: '#e8d27a' },
  { max: 150, label: 'Unhealthy for sensitive groups', color: '#f0a35a' },
  { max: 200, label: 'Unhealthy', color: '#ff7a66' },
  { max: 300, label: 'Very unhealthy', color: '#c77dbb' },
  { max: Infinity, label: 'Hazardous', color: '#a2445e' },
]
const aqiBand = (v: number) => AQI.find((b) => v <= b.max)!

function useConditions(place: Place, radiusKm: number) {
  const [state, set] = useState<{ key: string; data: Conditions | null; failed: boolean }>({ key: '', data: null, failed: false })
  const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)},${radiusKm}`
  useEffect(() => {
    const ac = new AbortController()
    api.conditions(place.lat, place.lon, radiusKm, ac.signal)
      .then((data) => set({ key, data, failed: false }))
      .catch((e: Error) => { if (e.name !== 'AbortError') set({ key, data: null, failed: true }) })
    return () => ac.abort()
  }, [key, place.lat, place.lon, radiusKm])
  const fresh = state.key === key
  return { data: fresh ? state.data : null, loading: !fresh, failed: fresh && state.failed }
}

export function PlacePanel(p: Props) {
  const { events, fires } = p.near
  const c = useConditions(p.place, p.radiusKm)
  const quakes = c.data?.quakes ?? []
  const hazards = c.data?.hazards ?? []
  const quiet = !events.length && !fires.length && !quakes.length && !hazards.length

  const hist = useMemo(() => {
    const bins = new Array(24).fill(0)
    const now = Date.now()
    for (const h of fires) {
      const ago = Math.floor((now - h[5]) / 3600000)
      bins[Math.max(0, Math.min(23, 23 - ago))]++
    }
    return bins
  }, [fires])
  const histMax = Math.max(1, ...hist)
  const high = fires.filter((h) => h[3] === 2).length
  const peak = fires.reduce((m, h) => Math.max(m, h[2]), 0)
  const w = c.data?.weather
  const air = c.data?.air

  return (
    <div className="place">
      <header className="place-head">
        <div className="eyebrow row-between">
          <span>Inspecting</span>
          <button className="icon-btn" onClick={p.onClose} aria-label="Close place"><Icon name="close" /></button>
        </div>
        <motion.h2 key={p.place.name} initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.4, ease }}>
          {p.place.name}
        </motion.h2>
        {p.place.context && <p className="place-ctx">{p.place.context}</p>}
        <p className="mono place-coord">{fmtCoord(p.place.lat, p.place.lon, 3)}</p>

        <div className="seg" role="radiogroup" aria-label="Radius">
          {RADII.map((r) => (
            <button key={r} role="radio" aria-checked={p.radiusKm === r} className={p.radiusKm === r ? 'is-on' : ''} onClick={() => p.onRadius(r)}>
              <span>{r}</span>
            </button>
          ))}
          <span className="seg-unit">km</span>
        </div>
      </header>

      <div className="place-body">
        <AnimatePresence mode="wait" initial={false}>
          {quiet && !c.loading ? (
            <motion.section key="quiet" className="verdict is-quiet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <span className="verdict-dot" />
              <h3>All quiet.</h3>
              <p>
                Within {p.radiusKm} km: no open natural events, {p.firesLoaded ? 'no fire detections in 24 hours' : 'no fire data yet'}
                {c.data?.quakes ? ', no earthquakes above M2.5 in 30 days' : ''}{c.data ? ', and no weather or air warnings.' : '.'}
                {Number.isFinite(p.near.nearestFireKm) && <> The nearest fire is <b>{fmtKm(p.near.nearestFireKm)}</b> away.</>}
              </p>
            </motion.section>
          ) : (
            <motion.section key="busy" className="verdict" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <div className="tally three">
                <div><span className="display-num"><Count value={events.length} /></span><span className="tally-l">open event{events.length === 1 ? '' : 's'}</span></div>
                <div><span className="display-num ember"><Count value={fires.length} /></span><span className="tally-l">fires · 24 h</span></div>
                <div><span className="display-num quake">{c.loading ? <span className="dim">–</span> : <Count value={quakes.length} />}</span><span className="tally-l">quakes · 30 d</span></div>
              </div>
              {hazards.length > 0 && (
                <ul className="hazards">
                  {hazards.map((h, i) => (
                    <motion.li key={h.text} className={`lv${h.level}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.25, ease }}>
                      <i />{h.text}
                    </motion.li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {/* ── now: weather + air ── */}
        <section className="block">
          <h4 className="eyebrow">Conditions now</h4>
          {c.loading ? (
            <div className="skel"><span /><span /><span /></div>
          ) : !w && !air ? (
            <p className="fine">Weather and air quality are unavailable right now.</p>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
              {w && (
                <>
                  <div className="wx">
                    <span className="display-num">{Math.round(w.temp)}<small>°C</small></span>
                    <span className="wx-l">{sky(w.code)}<small>feels like {Math.round(w.feels)}°</small></span>
                  </div>
                  <dl className="facts">
                    <div><dt>Wind</dt><dd>{Math.round(w.wind)}<small> km/h</small></dd></div>
                    <div><dt>Gusts</dt><dd>{Math.round(w.gusts)}<small> km/h</small></dd></div>
                    <div><dt>Humidity</dt><dd>{Math.round(w.humidity)}<small>%</small></dd></div>
                  </dl>
                  <ol className="days">
                    {w.days.map((d, i) => (
                      <li key={d.date}>
                        <span className="mono">{i === 0 ? 'Today' : new Date(d.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                        <span className="days-sky">{sky(d.code)}</span>
                        <span className="mono days-t">{Math.round(d.max)}° <em>{Math.round(d.min)}°</em></span>
                        <span className="mono days-r" title="Rain">{d.rain >= 0.5 ? `${Math.round(d.rain)} mm` : '—'}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {air && (
                <div className="aqi">
                  <div className="row-between aqi-head">
                    <span className="eyebrow">Air quality</span>
                    <span className="mono" style={{ color: aqiBand(air.aqi).color }}>AQI {Math.round(air.aqi)}</span>
                  </div>
                  <div className="aqi-bar" aria-hidden>
                    <motion.i initial={{ left: '0%' }} animate={{ left: `${Math.min(100, (air.aqi / 300) * 100)}%` }} transition={{ duration: 0.6, ease }} />
                  </div>
                  <p className="aqi-sub"><b style={{ color: aqiBand(air.aqi).color }}>{aqiBand(air.aqi).label}</b>
                    <span className="mono">PM2.5 {Math.round(air.pm25)} · PM10 {Math.round(air.pm10)} µg/m³{air.dust >= 50 ? ` · dust ${Math.round(air.dust)}` : ''}</span></p>
                </div>
              )}
            </motion.div>
          )}
        </section>

        {events.length > 0 && (
          <section className="block">
            <h4 className="eyebrow">Natural events within {p.radiusKm} km</h4>
            <ul className="near-list">
              {events.slice(0, 12).map((e) => {
                const cat = catOf(e.category)
                return (
                  <li key={e.id}>
                    <button onClick={() => p.onPickEvent(e)}>
                      <span style={{ color: cat.color }}><Glyph d={cat.glyph} /></span>
                      <span className="near-t">{e.title}<small>{cat.label} · {ago(e.date)}</small></span>
                      <span className="mono near-d">{fmtKm(e.km)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {quakes.length > 0 && (
          <section className="block">
            <h4 className="eyebrow">Earthquakes within {p.radiusKm} km · 30 days</h4>
            <ul className="near-list">
              {[...quakes].sort((a, b) => b.mag - a.mag || b.time - a.time).slice(0, 8).map((q) => (
                <li key={q.id}>
                  <a href={q.url} target="_blank" rel="noreferrer">
                    <span className={`mag ${q.mag >= 6 ? 'm6' : q.mag >= 4.5 ? 'm4' : ''}`}>{q.mag.toFixed(1)}</span>
                    <span className="near-t">{q.place}<small>{ago(q.time)} · {q.depthKm} km deep{q.tsunami ? ' · tsunami flag' : ''}</small></span>
                    <span className="mono near-d">{fmtKm(q.km)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {fires.length > 0 && (
          <section className="block">
            <h4 className="eyebrow"><Glyph d={FIRE_GLYPH} color="#ff8a3d" size={12} /> Fire detections, last 24 h</h4>
            <div className="hist" aria-label="Detections per hour">
              {hist.map((n, i) => (
                <motion.span key={i} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: i * 0.012, duration: 0.35, ease }}
                  style={{ height: `${Math.max(4, (n / histMax) * 100)}%`, opacity: n ? 1 : 0.18 }} title={`${n} detections`} />
              ))}
            </div>
            <div className="hist-axis mono"><span>−24 h</span><span>now</span></div>
            <dl className="facts">
              <div><dt>Nearest</dt><dd>{fmtKm(p.near.nearestFireKm)}</dd></div>
              <div><dt>High confidence</dt><dd>{high}</dd></div>
              <div><dt>Peak power</dt><dd>{Math.round(peak)} MW</dd></div>
            </dl>
          </section>
        )}

        <p className="fine src">Events: NASA EONET · fires: NASA FIRMS · weather &amp; air: Open-Meteo · earthquakes: USGS</p>
      </div>

      <footer className="place-foot">
        <button className="btn-primary" onClick={p.onAlert}>
          <Icon name="bell" />
          <span>Alert me about this place</span>
          <Icon name="arrow" />
        </button>
        <p className="fine">Email, Telegram, WhatsApp, SMS, Discord or Slack. Checked every 15 minutes.</p>
      </footer>
    </div>
  )
}
