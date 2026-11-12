import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'

interface Step { label: string; value: string | null; failed?: boolean }

export function Intro({ steps, onDone }: { steps: Step[]; onDone(): void }) {
  const [minElapsed, setMinElapsed] = useState(false)
  const allIn = steps.every((s) => s.value !== null || s.failed)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const a = setTimeout(() => setMinElapsed(true), reduce ? 300 : 2300)
    const b = setTimeout(() => done.current(), 7000) // never hold anyone hostage
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [])

  useEffect(() => {
    if (minElapsed && allIn) { const t = setTimeout(() => done.current(), 450); return () => clearTimeout(t) }
  }, [minElapsed, allIn])

  const letters = 'Vigil'.split('')
  return (
    <motion.div className="intro" onClick={onDone}
      exit={{ clipPath: 'inset(0 0 100% 0)', transition: { duration: 0.9, ease: [0.76, 0, 0.24, 1] } }}>
      <div className="intro-inner">
        <svg className="intro-orbit" viewBox="0 0 200 200" aria-hidden>
          <motion.circle cx="100" cy="100" r="92" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.8, ease: [0.65, 0, 0.35, 1] }} />
          <motion.ellipse cx="100" cy="100" rx="92" ry="30" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.5 }} transition={{ delay: 0.4, duration: 1.6, ease: [0.65, 0, 0.35, 1] }} />
          <motion.ellipse cx="100" cy="100" rx="30" ry="92" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.35 }} transition={{ delay: 0.7, duration: 1.6, ease: [0.65, 0, 0.35, 1] }} />
          <motion.circle className="intro-sat" r="2.6" initial={{ opacity: 0 }} animate={{ opacity: 1, cx: [100 + 92, 100, 100 - 92, 100, 100 + 92], cy: [100, 130, 100, 70, 100] }}
            transition={{ opacity: { delay: 1.2 }, cx: { duration: 4, repeat: Infinity, ease: 'linear' }, cy: { duration: 4, repeat: Infinity, ease: 'linear' } }} />
        </svg>

        <h1 className="intro-word" aria-label="Vigil">
          {letters.map((l, i) => (
            <motion.span key={i} initial={{ opacity: 0, y: '0.35em', filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.35 + i * 0.08, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}>{l}</motion.span>
          ))}
        </h1>
        <motion.p className="intro-tag" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
          A live watch over Earth
        </motion.p>

        <ul className="intro-steps">
          {steps.map((s, i) => (
            <motion.li key={s.label} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.1 + i * 0.18 }}>
              <span className={`led ${s.failed ? 'fail' : s.value !== null ? 'ok' : ''}`} />
              <span>{s.label}</span>
              <span className="dots" />
              <b>{s.failed ? 'unavailable' : s.value ?? 'reading'}</b>
            </motion.li>
          ))}
        </ul>
      </div>
      <motion.span className="intro-skip" initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} transition={{ delay: 2 }}>click to skip</motion.span>
    </motion.div>
  )
}
