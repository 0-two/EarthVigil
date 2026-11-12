import { useEffect, useRef, useState } from 'react'
import { animate } from 'motion'

export function Glyph({ d, color, size = 16, className }: { d: string; color?: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden
      stroke={color ?? 'currentColor'} strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

/** A number that rolls to its new value. */
export function Count({ value, format = (n: number) => Math.round(n).toLocaleString('en') }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { node.textContent = format(value); prev.current = value; return }
    const c = animate(prev.current, value, {
      duration: 1.1, ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { node.textContent = format(v) },
    })
    prev.current = value
    return () => c.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return <span ref={ref} className="num">{format(prev.current)}</span>
}

export function useClock(ms = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  )
}

export const ICONS = {
  search: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  locate: 'M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  layers: 'M8 2 1.5 5.5 8 9l6.5-3.5zM1.5 8.5 8 12l6.5-3.5M1.5 11.5 8 15l6.5-3.5',
  play: 'M5 3.5v9l7-4.5z',
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  bell: 'M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14h3',
  arrow: 'M3 8h10M9 4l4 4-4 4',
  back: 'M13 8H3M7 4 3 8l4 4',
  check: 'M3 8.5 6.5 12 13 4.5',
  spin: 'M13.5 8A5.5 5.5 0 1 1 8 2.5c2 0 3.6 1 4.6 2.5M13 2v3h-3',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  ext: 'M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4',
  trash: 'M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4',
  send: 'M14.5 1.5 7 9M14.5 1.5 10 14.5 7 9 1.5 6z',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z',
} as const
