import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

interface Step { label: string; value: string | null; failed?: boolean }

const out = [0.23, 1, 0.32, 1] as const
const inOut = [0.77, 0, 0.175, 1] as const
/* the equator ring, drawn from its left end through the front (bottom) half first */
const ORBIT = 'M8 100 a92 30 0 1 0 184 0 a92 30 0 1 0 -184 0'

export function Intro({ steps, onDone }: { steps: Step[]; onDone(): void }) {
  const reduce = useReducedMotion()
  const [minElapsed, setMinElapsed] = useState(false)
  const allIn = steps.every((s) => s.value !== null || s.failed)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const a = setTimeout(() => setMinElapsed(true), reduce ? 300 : 2000)
    const b = setTimeout(() => done.current(), 7000) // never hold anyone hostage
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [reduce])

  useEffect(() => {
    if (minElapsed && allIn) { const t = setTimeout(() => done.current(), 350); return () => clearTimeout(t) }
  }, [minElapsed, allIn])

  const draw = (delay: number, opacity = 0.55) => reduce
    ? { initial: { opacity: 0 }, animate: { opacity }, transition: { duration: 0.3 } }
    : { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity }, transition: { pathLength: { delay, duration: 1.2, ease: inOut }, opacity: { delay, duration: 0.2 } } }

  return (
    <motion.div className="intro" onClick={onDone}
      exit={reduce ? { opacity: 0, transition: { duration: 0.25 } } : { clipPath: 'inset(0 0 100% 0)', transition: { duration: 0.7, ease: inOut } }}>
      <div className="intro-inner">
        <div className="intro-stage">
          <svg className="intro-orbit" viewBox="0 0 200 200" aria-hidden>
            <motion.circle cx="100" cy="100" r="92" {...draw(0)} />
            <motion.ellipse cx="100" cy="100" rx="92" ry="30" {...draw(0.2, 0.45)} />
            <motion.ellipse cx="100" cy="100" rx="30" ry="92" {...draw(0.35, 0.3)} />
          </svg>

          <div className="intro-title">
            <h1 className="intro-word" aria-label="Vigil">
              {'Vigil'.split('').map((l, i) => (
                <motion.span key={i} aria-hidden
                  initial={reduce ? { opacity: 0 } : { opacity: 0, transform: 'translateY(0.28em)', filter: 'blur(6px)' }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0em)', filter: 'blur(0px)' }}
                  transition={{ delay: 0.3 + i * 0.06, duration: 0.7, ease: out }}>{l}</motion.span>
              ))}
            </h1>
            <motion.p className="intro-tag" initial={{ opacity: 0, transform: 'translateY(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }}
              transition={{ delay: 0.75, duration: 0.5, ease: out }}>
              A live watch over Earth
            </motion.p>
          </div>

          {/* drawn above the word; dimmed on the far side of the ring so it reads as passing behind */}
          {!reduce && (
            <svg className="intro-orbit is-front" viewBox="0 0 200 200" aria-hidden>
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.4 }}>
                <circle className="intro-sat" r="2.4">
                  <animateMotion dur="5.5s" repeatCount="indefinite" path={ORBIT} />
                  <animate attributeName="opacity" values="1;1;0.12;0.12;1" keyTimes="0;0.46;0.54;0.96;1" dur="5.5s" repeatCount="indefinite" />
                </circle>
              </motion.g>
            </svg>
          )}
        </div>

        <ul className="intro-steps">
          {steps.map((s, i) => {
            const text = s.failed ? 'unavailable' : s.value ?? 'reading'
            return (
              <motion.li key={s.label} initial={{ opacity: 0, transform: 'translateY(6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }}
                transition={{ delay: 0.9 + i * 0.07, duration: 0.4, ease: out }}>
                <span className={`led ${s.failed ? 'fail' : s.value !== null ? 'ok' : ''}`} />
                <span>{s.label}</span>
                <span className="dots" />
                <motion.b key={text} className={s.value === null && !s.failed ? 'is-pending' : ''}
                  initial={{ opacity: 0, filter: 'blur(3px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.25, ease: out }}>
                  {text}
                </motion.b>
              </motion.li>
            )
          })}
        </ul>
      </div>
      <motion.span className="intro-skip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 0.4 }}>click to skip</motion.span>
    </motion.div>
  )
}
