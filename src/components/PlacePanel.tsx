import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { EonetEvent, Hotspot, Place } from '../lib/types'
import { catOf, FIRE_GLYPH } from '../lib/categories'
import { ago, fmtCoord, fmtKm } from '../lib/geo'
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

export function PlacePanel(p: Props) {
  const { events, fires } = p.near
  const quiet = !events.length && !fires.length

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

  return (
    <div className="place">
      <header className="place-head">
        <div className="eyebrow row-between">
          <span>Inspecting</span>
          <button className="icon-btn" onClick={p.onClose} aria-label="Close place"><Icon name="close" /></button>
        </div>
        <motion.h2 key={p.place.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
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
          {quiet ? (
            <motion.section key="quiet" className="verdict is-quiet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="verdict-dot" />
              <h3>All quiet.</h3>
              <p>
                No open natural events and {p.firesLoaded ? 'no fire detections' : 'no fire data yet'} within {p.radiusKm} km in the last 24 hours.
                {Number.isFinite(p.near.nearestFireKm) && <> The nearest hotspot is <b>{fmtKm(p.near.nearestFireKm)}</b> away.</>}
              </p>
            </motion.section>
          ) : (
            <motion.section key="busy" className="verdict" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="tally">
                <div><span className="display-num"><Count value={events.length} /></span><span className="tally-l">open event{events.length === 1 ? '' : 's'}</span></div>
                <div><span className="display-num ember"><Count value={fires.length} /></span><span className="tally-l">fire hotspots · 24 h</span></div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {events.length > 0 && (
          <section className="block">
            <h4 className="eyebrow">Events within {p.radiusKm} km</h4>
            <ul className="near-list">
              {events.slice(0, 12).map((e) => {
                const c = catOf(e.category)
                return (
                  <li key={e.id}>
                    <button onClick={() => p.onPickEvent(e)}>
                      <span style={{ color: c.color }}><Glyph d={c.glyph} /></span>
                      <span className="near-t">{e.title}<small>{c.label} · {ago(e.date)}</small></span>
                      <span className="mono near-d">{fmtKm(e.km)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {fires.length > 0 && (
          <section className="block">
            <h4 className="eyebrow"><Glyph d={FIRE_GLYPH} color="#ff8a3d" size={12} /> Fire detections, last 24 h</h4>
            <div className="hist" aria-label="Detections per hour">
              {hist.map((n, i) => (
                <motion.span key={i} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: i * 0.015, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
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
