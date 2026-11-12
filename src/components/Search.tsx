import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { geocode } from '../lib/api'
import type { Place } from '../lib/types'
import { Icon } from './bits'

const SUGGEST = ['Lisbon', 'Kathmandu', 'Los Angeles', 'Mount Etna', 'Darwin, Australia', 'Kerala']

export function Search({ onPlace, onLocate }: { onPlace(p: Place): void; onLocate(): void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Place[]>([])
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  /* "/" or Ctrl/⌘-K focuses the search, like a command line */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select')
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setBusy(false); return }
    const ctl = new AbortController()
    setBusy(true)
    const t = setTimeout(() => {
      geocode(q, ctl.signal)
        .then((r) => { setResults(r); setActive(0) })
        .catch(() => {})
        .finally(() => setBusy(false))
    }, 220)
    return () => { clearTimeout(t); ctl.abort() }
  }, [q])

  const choose = (p: Place) => {
    onPlace(p)
    setQ(p.name)
    setOpen(false)
    input.current?.blur()
  }

  const pickSuggestion = (s: string) => { setQ(s); input.current?.focus() }

  return (
    <div className={`search ${open ? 'is-open' : ''}`}>
      <label className="search-field">
        <Icon name="search" />
        <input
          ref={input}
          value={q}
          placeholder="Search a city, region or coordinates"
          spellCheck={false}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 140)}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
            if (e.key === 'Enter' && results[active]) choose(results[active])
            if (e.key === 'Escape') input.current?.blur()
          }}
          aria-label="Search for a place"
        />
        {busy ? <span className="search-busy" aria-hidden /> : <kbd>/</kbd>}
        <button className="search-locate" type="button" title="Use my location" onMouseDown={(e) => e.preventDefault()} onClick={onLocate}>
          <Icon name="locate" />
        </button>
      </label>

      <AnimatePresence>
        {open && (
          <motion.div className="search-drop" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
            {results.length > 0 ? (
              <ul role="listbox">
                {results.map((r, i) => (
                  <li key={`${r.lat},${r.lon},${i}`} role="option" aria-selected={i === active}
                    className={i === active ? 'is-active' : ''}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(r)}>
                    <span className="sr-name">{r.name}</span>
                    <span className="sr-ctx">{r.context}</span>
                    <span className="sr-coord">{r.lat.toFixed(2)}, {r.lon.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="search-empty">
                <span className="eyebrow">{q.trim().length >= 2 && !busy ? 'Nothing by that name' : 'Try'}</span>
                <div className="chips">
                  {SUGGEST.map((s) => (
                    <button key={s} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSuggestion(s)}>{s}</button>
                  ))}
                </div>
                <p className="hint">Or click anywhere on the globe to inspect that spot.</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
