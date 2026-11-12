import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../lib/api'
import type { ChannelId, Place, PublicWatch, SavedWatch, SendResult, ServerConfig } from '../lib/types'
import { CATEGORIES, FIRE_GLYPH, catOf } from '../lib/categories'
import { Glyph, Icon } from './bits'
import { RADII } from './PlacePanel'

export const CHANNELS: { id: ChannelId; label: string; glyph: string; field?: { type: string; placeholder: string; hint: string } }[] = [
  { id: 'email', label: 'Email', glyph: 'M1.5 3.5h13v9h-13zM1.5 3.5 8 9l6.5-5.5',
    field: { type: 'email', placeholder: 'you@example.com', hint: 'A full report with distances and a map link.' } },
  { id: 'telegram', label: 'Telegram', glyph: 'M14.5 2 1.5 7.2l4.3 1.6L12 4.5 7.3 9.9v3.6l2.4-2.6 2.9 2.1z' },
  { id: 'whatsapp', label: 'WhatsApp', glyph: 'M8 1.8a6.2 6.2 0 0 0-5.4 9.3L1.8 14.2l3.2-.8A6.2 6.2 0 1 0 8 1.8zM6 5.5c0 2.5 2 4.5 4.5 4.5',
    field: { type: 'tel', placeholder: '+91 98765 43210', hint: 'International format, with the country code.' } },
  { id: 'sms', label: 'SMS', glyph: 'M2 2.5h12v8.5H6l-3.5 3v-3H2zM5 6.5h6',
    field: { type: 'tel', placeholder: '+1 415 555 0123', hint: 'Short text: headline, distance and a link.' } },
  { id: 'discord', label: 'Discord', glyph: 'M3 4.5c1.5-.9 3-1.3 3.5-1.3l.4.8h2.2l.4-.8c.5 0 2 .4 3.5 1.3 1.3 2.3 1.8 4.6 1.6 7-1.2.9-2.4 1.4-3.6 1.7l-.8-1.3M3 4.5c-1.3 2.3-1.8 4.6-1.6 7 1.2.9 2.4 1.4 3.6 1.7l.8-1.3M5 10.4c1.9.8 4.1.8 6 0M6 7.6v.01M10 7.6v.01',
    field: { type: 'url', placeholder: 'https://discord.com/api/webhooks/…', hint: 'Channel settings → Integrations → Webhooks → Copy URL.' } },
  { id: 'slack', label: 'Slack', glyph: 'M6 1.5v13M10 1.5v13M1.5 6h13M1.5 10h13',
    field: { type: 'url', placeholder: 'https://hooks.slack.com/services/…', hint: 'Create an Incoming Webhook for a channel and paste it here.' } },
]

const DEFAULT_CATS = ['wildfires', 'severeStorms', 'volcanoes', 'floods', 'landslides', 'tempExtremes', 'dustHaze']
/* USGS covers earthquakes far better than EONET's occasional entries, so that category is offered through it instead */
const EONET_PICKS = CATEGORIES.filter((c) => !['manmade', 'waterColor', 'earthquakes'].includes(c.id))
const QUAKE = catOf('earthquakes')
const WEATHER_GLYPH = 'M4.5 10.5h7a2.8 2.8 0 0 0 .3-5.6 4 4 0 0 0-7.6.9 2.4 2.4 0 0 0 .3 4.7zM8.5 12l-1.2 2.5M5.5 12l-1.2 2.5M11.5 12l-1.2 2.5'
const MAGS = [2.5, 4, 5, 6]

interface Props {
  place: Place
  radiusKm: number
  config: ServerConfig | null
  onRadius(km: number): void
  onBack(): void
  onSaved(w: SavedWatch): void
}

type Done = { watch: PublicWatch; token: string; results: SendResult[]; now?: { events: number; fires: number; quakes?: number; hazards?: string[] } }

export function AlertSheet(p: Props) {
  const [cats, setCats] = useState<Set<string>>(new Set(DEFAULT_CATS))
  const [fires, setFires] = useState(true)
  const [conf, setConf] = useState(1)
  const [quakes, setQuakes] = useState(true)
  const [minMag, setMinMag] = useState(4)
  const [hazards, setHazards] = useState(true)
  const [chosen, setChosen] = useState<Set<ChannelId>>(new Set(['email']))
  const [values, setValues] = useState<Partial<Record<ChannelId, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [test, setTest] = useState<SendResult[] | null>(null)

  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n }

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      const channels: Record<string, string | boolean> = {}
      for (const c of chosen) channels[c] = c === 'telegram' ? true : (values[c] ?? '')
      const res = await api.createWatch({
        place: { name: [p.place.name, p.place.context].filter(Boolean).join(', '), lat: p.place.lat, lon: p.place.lon },
        radiusKm: p.radiusKm,
        categories: [...cats],
        fires,
        minFireConfidence: conf,
        quakes,
        minQuakeMag: minMag,
        hazards,
        channels,
      })
      setDone(res)
      p.onSaved({ id: res.watch.id, token: res.token, name: p.place.name, lat: p.place.lat, lon: p.place.lon, radiusKm: p.radiusKm })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    if (!done) return
    setTest(null)
    try {
      const r = await api.testWatch({ id: done.watch.id, token: done.token, name: '', lat: 0, lon: 0, radiusKm: 0 })
      setTest(r.results)
    } catch (err) {
      setTest([{ channel: 'email', ok: false, detail: (err as Error).message }])
    }
  }

  if (done) return <Confirmation done={done} place={p.place} test={test} onTest={sendTest} onBack={p.onBack} />

  const ready = chosen.size > 0 && (cats.size > 0 || fires || quakes || hazards) && [...chosen].every((c) => c === 'telegram' || (values[c] ?? '').trim())

  return (
    <div className="sheet">
      <header className="sheet-head">
        <button className="back" onClick={p.onBack}><Icon name="back" /> {p.place.name}</button>
        <h2>Keep watch</h2>
        <p className="place-ctx">Vigil checks NASA, USGS and weather feeds every {p.config?.intervalMin ?? 15} minutes and tells you the moment something new appears near this place.</p>
      </header>

      <div className="sheet-body">
        <section className="block">
          <h4 className="eyebrow"><span className="step">1</span> Radius</h4>
          <div className="seg wide" role="radiogroup">
            {RADII.map((r) => (
              <button key={r} role="radio" aria-checked={p.radiusKm === r} className={p.radiusKm === r ? 'is-on' : ''} onClick={() => p.onRadius(r)}>
                <span>{r}</span>
              </button>
            ))}
            <span className="seg-unit">km</span>
          </div>
        </section>

        <section className="block">
          <h4 className="eyebrow"><span className="step">2</span> What to watch for</h4>
          <p className="pick-l">Live hazards</p>
          <div className="pick-grid">
            <button className={`pick ${fires ? 'is-on' : ''}`} onClick={() => setFires(!fires)} aria-pressed={fires}>
              <Glyph d={FIRE_GLYPH} color="#ff8a3d" /> Fire hotspots
            </button>
            <button className={`pick ${quakes ? 'is-on' : ''}`} onClick={() => setQuakes(!quakes)} aria-pressed={quakes}>
              <Glyph d={QUAKE.glyph} color="#d9b8ff" /> Earthquakes
            </button>
            <button className={`pick span2 ${hazards ? 'is-on' : ''}`} onClick={() => setHazards(!hazards)} aria-pressed={hazards}>
              <Glyph d={WEATHER_GLYPH} color="#8fc3e8" /> Weather &amp; air warnings
            </button>
          </div>
          <AnimatePresence initial={false}>
            {fires && (
              <motion.div key="conf" className="conf" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
                <span className="mono">Fire confidence</span>
                {['Any', 'Nominal +', 'High only'].map((l, i) => (
                  <button key={l} className={`tiny ${conf === i ? 'is-on' : ''}`} onClick={() => setConf(i)}>{l}</button>
                ))}
              </motion.div>
            )}
            {quakes && (
              <motion.div key="mag" className="conf" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
                <span className="mono">Magnitude</span>
                {MAGS.map((m) => (
                  <button key={m} className={`tiny ${minMag === m ? 'is-on' : ''}`} onClick={() => setMinMag(m)}>M{m}+</button>
                ))}
              </motion.div>
            )}
            {hazards && (
              <motion.p key="hz" className="fine pick-note" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
                Extreme heat or cold, heavy rain, damaging wind, thunderstorms and unhealthy air, from the 3-day forecast. Checked every 6 hours, at most one message per warning a day.
              </motion.p>
            )}
          </AnimatePresence>

          <p className="pick-l">NASA natural events</p>
          <div className="pick-grid">
            {EONET_PICKS.map((c) => (
              <button key={c.id} className={`pick ${cats.has(c.id) ? 'is-on' : ''}`} onClick={() => setCats(toggle(cats, c.id))} aria-pressed={cats.has(c.id)}>
                <Glyph d={c.glyph} color={c.color} /> {c.label}
              </button>
            ))}
          </div>
        </section>

        <section className="block">
          <h4 className="eyebrow"><span className="step">3</span> Where to send it</h4>
          <div className="channels">
            {CHANNELS.map((c) => {
              const on = chosen.has(c.id)
              const live = p.config?.channels[c.id] ?? true
              return (
                <button key={c.id} className={`channel ${on ? 'is-on' : ''}`} onClick={() => setChosen(toggle(chosen, c.id))} aria-pressed={on}>
                  <Glyph d={c.glyph} size={18} />
                  <span>{c.label}</span>
                  {!live && <em title="This channel isn't configured on the server yet, so messages are written to the server log">dry run</em>}
                  <i className="tick"><Icon name="check" size={12} /></i>
                </button>
              )
            })}
          </div>

          <div className="fields">
            <AnimatePresence initial={false}>
              {CHANNELS.filter((c) => chosen.has(c.id)).map((c) => (
                <motion.div key={c.id} className="field" layout
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                  {c.field ? (
                    <label>
                      <span className="field-l"><Glyph d={c.glyph} size={13} /> {c.label}</span>
                      <input type={c.field.type} placeholder={c.field.placeholder} value={values[c.id] ?? ''} autoComplete={c.id === 'email' ? 'email' : c.field.type === 'tel' ? 'tel' : 'off'}
                        onChange={(e) => setValues({ ...values, [c.id]: e.target.value })} />
                      <span className="field-h">{c.field.hint}</span>
                    </label>
                  ) : (
                    <div className="field-note">
                      <span className="field-l"><Glyph d={c.glyph} size={13} /> {c.label}</span>
                      <span className="field-h">
                        {p.config?.telegramBot
                          ? <>After you save, you'll get a link to <b>@{p.config.telegramBot}</b>. Press <b>Start</b> there and your chat is linked.</>
                          : <>The Telegram bot isn't set up on this server yet. The watch is saved and starts sending once the bot token is added.</>}
                      </span>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>

        {error && <motion.p className="error" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>{error}</motion.p>}
      </div>

      <footer className="place-foot">
        <button className="btn-primary" disabled={!ready || busy} onClick={submit}>
          {busy ? <span className="spinner" /> : <Icon name="bell" />}
          <span>{busy ? 'Setting the watch…' : `Watch ${p.radiusKm} km around ${p.place.name}`}</span>
        </button>
        <p className="fine">Each message has a one-click stop link. Vigil uses NASA data, which can lag the real world by hours. It is not an emergency service.</p>
      </footer>
    </div>
  )
}

function Confirmation({ done, place, test, onTest, onBack }: { done: Done; place: Place; test: SendResult[] | null; onTest(): void; onBack(): void }) {
  const [testing, setTesting] = useState(false)
  const label = (c: ChannelId) => CHANNELS.find((x) => x.id === c)?.label ?? c
  return (
    <div className="sheet">
      <div className="sheet-body confirm">
        <div className="radar" aria-hidden>
          <span /><span /><span /><i />
        </div>
        <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
          Vigil is watching <em>{place.name}</em>.
        </motion.h2>
        <motion.p className="place-ctx" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}>
          {nowLine(done)}
        </motion.p>

        {done.watch.telegramLink && (
          <a className="btn-primary tg" href={done.watch.telegramLink} target="_blank" rel="noreferrer">
            <Glyph d={CHANNELS[1].glyph} /> <span>Open Telegram and press Start</span> <Icon name="ext" />
          </a>
        )}

        <ul className="results">
          {Object.entries(done.watch.channels).filter(([, v]) => v).map(([c, v]) => {
            const r = (test ?? done.results).find((x) => x.channel === c)
            const status = c === 'telegram' && v === 'pending' && !r ? 'waiting for Start' : r ? (r.ok ? (r.dryRun ? 'logged (dry run)' : 'sent') : 'failed') : 'saved'
            return (
              <li key={c} className={r && !r.ok ? 'bad' : ''} title={r?.detail}>
                <span>{label(c as ChannelId)}</span>
                <span className="mono">{v}</span>
                <b>{status}</b>
              </li>
            )
          })}
        </ul>
        {(test ?? done.results).some((r) => r.dryRun) && (
          <p className="fine">Dry run means the channel isn't configured on the server yet. The message was printed to the server log so you can see exactly what would be sent.</p>
        )}
      </div>
      <footer className="place-foot two">
        <button className="btn-ghost" disabled={testing} onClick={async () => { setTesting(true); await onTest(); setTesting(false) }}>
          {testing ? <span className="spinner" /> : <Icon name="send" />} Send a test signal
        </button>
        <button className="btn-primary" onClick={onBack}><Icon name="check" /> Done</button>
      </footer>
    </div>
  )
}

function nowLine(done: Done) {
  const n = done.now
  const r = done.watch.radiusKm
  if (!n) return `You'll hear the moment something new appears inside ${r} km.`
  const parts: string[] = []
  if (n.events) parts.push(`${n.events} event${n.events > 1 ? 's' : ''}`)
  if (n.fires) parts.push(`${n.fires} fire hotspot${n.fires > 1 ? 's' : ''}`)
  if (n.quakes) parts.push(`${n.quakes} earthquake${n.quakes > 1 ? 's' : ''}`)
  if (n.hazards?.length) parts.push(`${n.hazards.length} weather or air warning${n.hazards.length > 1 ? 's' : ''}`)
  if (!parts.length) return `It's quiet inside ${r} km right now. You'll hear the moment that changes.`
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]
  return `Right now there's ${list} inside ${r} km. You'll only hear about new ones.`
}
