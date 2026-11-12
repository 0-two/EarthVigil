import { useMemo } from 'react'
import { motion } from 'motion/react'
import type { EonetEvent, FireSet } from '../lib/types'
import { CATEGORIES, catOf, FIRE_GLYPH } from '../lib/categories'
import { ago } from '../lib/geo'
import { Count, Glyph, Icon } from './bits'

interface Props {
  all: EonetEvent[]
  shown: EonetEvent[]
  fires: FireSet | null
  hidden: Set<string>
  showFires: boolean
  selectedId: string | null
  loading: boolean
  error: string | null
  onToggleCat(id: string): void
  onToggleFires(): void
  onPick(e: EonetEvent): void
  onClose?(): void
}

export function Ledger(p: Props) {
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of p.all) m.set(e.category, (m.get(e.category) ?? 0) + 1)
    return CATEGORIES.filter((c) => m.has(c.id)).map((c) => ({ ...c, n: m.get(c.id)! }))
  }, [p.all])

  const now = Date.now()
  const fresh = p.all.filter((e) => now - Date.parse(e.date) < 86400000 * 2).length

  return (
    <aside className="panel ledger" aria-label="Open events">
      <header className="ledger-head">
        <div className="eyebrow row-between">
          <span>Ledger · open events</span>
          {p.onClose && <button className="icon-btn" onClick={p.onClose} aria-label="Close"><Icon name="close" /></button>}
        </div>
        <div className="ledger-total">
          <span className="display-num"><Count value={p.all.length} /></span>
          <span className="ledger-sub">
            natural events open right now<br />
            <em>{fresh} updated in the last 48 h</em>
          </span>
        </div>

        <div className="dist" role="img" aria-label="Events by category">
          {counts.map((c) => (
            <motion.span key={c.id} layout style={{ flexGrow: c.n, background: c.color, opacity: p.hidden.has(c.id) ? 0.18 : 1 }} />
          ))}
        </div>

        <div className="filters">
          {counts.map((c) => (
            <button key={c.id} className={`filter ${p.hidden.has(c.id) ? 'is-off' : ''}`} onClick={() => p.onToggleCat(c.id)} aria-pressed={!p.hidden.has(c.id)}>
              <Glyph d={c.glyph} color={c.color} size={13} />
              <span>{c.label}</span>
              <b>{c.n}</b>
            </button>
          ))}
          <button className={`filter ${p.showFires ? '' : 'is-off'}`} onClick={p.onToggleFires} aria-pressed={p.showFires}>
            <Glyph d={FIRE_GLYPH} color="#ff8a3d" size={13} />
            <span>Fire hotspots, 24 h</span>
            <b>{p.fires ? <Count value={p.fires.hotspots.length} /> : '…'}</b>
          </button>
        </div>
      </header>

      <div className="ledger-list" role="list">
        {p.error && <p className="ledger-note">{p.error}</p>}
        {p.loading && !p.all.length && Array.from({ length: 7 }, (_, i) => <div key={i} className="row skeleton" style={{ animationDelay: `${i * 80}ms` }} />)}
        {!p.loading && !p.error && !p.shown.length && <p className="ledger-note">Every category is filtered out.</p>}
        {p.shown.map((e, i) => {
          const c = catOf(e.category)
          return (
            <motion.button
              key={e.id}
              role="listitem"
              className={`row ${p.selectedId === e.id ? 'is-sel' : ''}`}
              onClick={() => p.onPick(e)}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i, 18) * 0.025, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="row-glyph" style={{ color: c.color }}><Glyph d={c.glyph} /></span>
              <span className="row-main">
                <span className="row-title">{e.title}</span>
                <span className="row-meta">
                  {c.label}
                  {e.magnitude != null && <> · {e.magnitude.toLocaleString('en')} {e.magnitudeUnit}</>}
                </span>
              </span>
              <span className="row-when">{ago(e.date)}</span>
            </motion.button>
          )
        })}
      </div>
    </aside>
  )
}
