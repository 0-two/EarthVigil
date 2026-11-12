import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { OVERLAYS, lastDays } from '../lib/gibs'
import { dayLabel } from '../lib/geo'
import type { EonetEvent, Hotspot, SavedWatch } from '../lib/types'
import { catOf, FIRE_GLYPH } from '../lib/categories'
import { ago, fmtCoord } from '../lib/geo'
import { Glyph, Icon } from './bits'

/* ── Layers ─────────────────────────────────────────────────────── */
export function LayerDock({ overlays, onToggle, nightShade, onNightShade, open, onOpen }: {
  overlays: Record<string, boolean>
  onToggle(id: string): void
  nightShade: boolean
  onNightShade(): void
  open: boolean
  onOpen(v: boolean): void
}) {
  const on = OVERLAYS.filter((l) => overlays[l.id]).length + (nightShade ? 1 : 0)
  return (
    <div className="dock">
      <button className={`dock-btn ${open ? 'is-on' : ''}`} onClick={() => onOpen(!open)} aria-expanded={open}>
        <Icon name="layers" /> <span>Layers</span> <b className="mono">{on}</b>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="panel dock-panel" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} style={{ originY: 1, originX: 0 }}>
            <div className="eyebrow">Map layers</div>
            <ul>
              {OVERLAYS.map((l) => (
                <li key={l.id}>
                  <button className={`layer ${overlays[l.id] ? 'is-on' : ''}`} onClick={() => onToggle(l.id)} aria-pressed={!!overlays[l.id]}>
                    <span className="switch" />
                    <span className="layer-t">{l.label}<small>{l.note}</small></span>
                    <span className="swatch" style={{ background: l.legend }} />
                  </button>
                </li>
              ))}
              <li>
                <button className={`layer ${nightShade ? 'is-on' : ''}`} onClick={onNightShade} aria-pressed={nightShade}>
                  <span className="switch" />
                  <span className="layer-t">Night side<small>Where the sun has set, right now</small></span>
                  <span className="swatch" style={{ background: 'linear-gradient(90deg,#c8d2e0,#0b1220)' }} />
                </button>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Imagery timeline ───────────────────────────────────────────── */
const DAYS = lastDays(30)

export function Timeline({ date, onDate }: { date: string; onDate(d: string): void }) {
  const [playing, setPlaying] = useState(false)
  const track = useRef<HTMLDivElement>(null)
  const idx = Math.max(0, DAYS.indexOf(date))

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      const i = DAYS.indexOf(date)
      if (i >= DAYS.length - 2) { setPlaying(false); return }
      onDate(DAYS[i + 1])
    }, 1400)
    return () => clearInterval(t)
  }, [playing, date, onDate])

  const fromPointer = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    const k = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    onDate(DAYS[Math.round(k * (DAYS.length - 1))])
  }

  return (
    <div className="timeline panel">
      <button className="icon-btn play" onClick={() => {
        if (!playing && idx >= DAYS.length - 2) onDate(DAYS[0])
        setPlaying(!playing)
      }} aria-label={playing ? 'Pause' : 'Play the last 30 days'}>
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <div className="tl-main">
        <div className="tl-label">
          <span className="eyebrow">Imagery date</span>
          <motion.span key={date} className="tl-date" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>{dayLabel(date)}</motion.span>
        </div>
        <div
          ref={track}
          className="tl-track"
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={DAYS.length - 1}
          aria-valuenow={idx}
          aria-valuetext={dayLabel(date)}
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setPlaying(false); fromPointer(e.clientX) }}
          onPointerMove={(e) => { if (e.buttons) fromPointer(e.clientX) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') onDate(DAYS[Math.max(0, idx - 1)])
            if (e.key === 'ArrowRight') onDate(DAYS[Math.min(DAYS.length - 1, idx + 1)])
          }}
        >
          {DAYS.map((d, i) => {
            const day = new Date(d + 'T00:00:00Z')
            const monday = day.getUTCDay() === 1
            return <i key={d} className={`${i <= idx ? 'past' : ''} ${monday ? 'major' : ''}`} style={{ left: `${(i / (DAYS.length - 1)) * 100}%` }} />
          })}
          <motion.span className="tl-thumb" animate={{ left: `${(idx / (DAYS.length - 1)) * 100}%` }} transition={{ type: 'spring', stiffness: 600, damping: 45 }} />
        </div>
      </div>
    </div>
  )
}

/* ── Floating cards ─────────────────────────────────────────────── */
export function EventCard({ e, onClose, onWatch }: { e: EonetEvent; onClose(): void; onWatch(): void }) {
  const c = catOf(e.category)
  const first = Date.parse(e.firstDate), last = Date.parse(e.date)
  const days = Math.max(1, Math.round((last - first) / 86400000))
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
      <div className="card-top" style={{ '--c': c.color } as React.CSSProperties}>
        <span className="card-cat"><Glyph d={c.glyph} color={c.color} size={13} /> {c.label}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button>
      </div>
      <h3>{e.title}</h3>
      <dl className="facts compact">
        <div><dt>Last seen</dt><dd>{ago(e.date)}</dd></div>
        <div><dt>Tracked for</dt><dd>{days} day{days > 1 ? 's' : ''}</dd></div>
        {e.magnitude != null && <div><dt>Magnitude</dt><dd>{e.magnitude.toLocaleString('en')} {e.magnitudeUnit}</dd></div>}
        {e.track.length > 1 && <div><dt>Observations</dt><dd>{e.track.length}</dd></div>}
      </dl>
      <p className="mono card-coord">{fmtCoord(e.lat, e.lon)}</p>
      <div className="card-actions">
        <button className="btn-small" onClick={onWatch}><Icon name="bell" size={14} /> Watch this area</button>
        {e.sources[0] && <a className="link" href={e.sources[0].url} target="_blank" rel="noreferrer">{e.sources[0].id} <Icon name="ext" size={12} /></a>}
      </div>
    </motion.div>
  )
}

export function FireCard({ h, onClose, onWatch }: { h: Hotspot; onClose(): void; onWatch(): void }) {
  const [lon, lat, frp, conf, day, t] = h
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
      <div className="card-top" style={{ '--c': '#ff8a3d' } as React.CSSProperties}>
        <span className="card-cat"><Glyph d={FIRE_GLYPH} color="#ff8a3d" size={13} /> Thermal anomaly</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button>
      </div>
      <h3>Fire hotspot</h3>
      <dl className="facts compact">
        <div><dt>Detected</dt><dd>{ago(t)}</dd></div>
        <div><dt>Pass</dt><dd>{day ? 'Daytime' : 'Night-time'}</dd></div>
        <div><dt>Radiative power</dt><dd>{frp} MW</dd></div>
        <div><dt>Confidence</dt><dd>{['Low', 'Nominal', 'High'][conf]}</dd></div>
      </dl>
      <p className="mono card-coord">{fmtCoord(lat, lon, 3)}</p>
      <div className="card-actions">
        <button className="btn-small" onClick={onWatch}><Icon name="bell" size={14} /> Watch this area</button>
      </div>
    </motion.div>
  )
}

/* ── Your watches ───────────────────────────────────────────────── */
export function Watches({ list, onGo, onRemove, onClose }: { list: SavedWatch[]; onGo(w: SavedWatch): void; onRemove(w: SavedWatch): void; onClose(): void }) {
  return (
    <motion.div className="panel watches" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
      <div className="eyebrow row-between"><span>Your watches</span><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button></div>
      {list.length === 0 ? (
        <p className="fine">None yet. Search a place, then choose <b>Alert me about this place</b>.</p>
      ) : (
        <ul>
          {list.map((w) => (
            <li key={w.id}>
              <button className="w-go" onClick={() => onGo(w)}>
                <span>{w.name}</span>
                <small className="mono">{w.radiusKm} km · {fmtCoord(w.lat, w.lon, 1)}</small>
              </button>
              <button className="icon-btn" onClick={() => onRemove(w)} aria-label={`Stop watching ${w.name}`} title="Stop watching"><Icon name="trash" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="fine">Saved in this browser. Every alert also carries its own stop link.</p>
    </motion.div>
  )
}
