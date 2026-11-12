import type { Watch } from '../store.js'
import type { EonetEvent } from '../data/eonet.js'
import type { Quake } from '../data/quakes.js'
import type { Hazard } from '../data/conditions.js'
import { env } from '../env.js'

export interface NearEvent extends EonetEvent { distanceKm: number }
export interface FireSummary { count: number; nearestKm: number; maxFrp: number; high: number }
export interface NearQuake extends Quake { distanceKm: number }

export interface Digest {
  kind: 'welcome' | 'alert' | 'test'
  watch: Pick<Watch, 'id' | 'token' | 'place' | 'radiusKm'>
  events: NearEvent[]
  fires: FireSummary | null
  quakes: NearQuake[]
  hazards: Hazard[]
}

const km = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toString()) + ' km'
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export const mapUrl = (d: Digest) =>
  `${env.publicUrl}/?lat=${d.watch.place.lat.toFixed(4)}&lon=${d.watch.place.lon.toFixed(4)}&r=${d.watch.radiusKm}`
export const stopUrl = (d: Digest) => `${env.publicUrl}/u/${d.watch.id}/${d.watch.token}`

const HAZARD_LABEL: Record<Hazard['kind'], string> = {
  heat: 'Heat warning', cold: 'Cold warning', rain: 'Heavy rain warning', wind: 'Wind warning',
  storm: 'Thunderstorm warning', air: 'Air quality warning', uv: 'UV warning', quake: 'Earthquake',
}
const quakeLine = (q: NearQuake) => `M${q.mag.toFixed(1)} earthquake · ${km(q.distanceKm)} away · ${q.depthKm} km deep · ${q.place}${q.tsunami ? ' · tsunami flag' : ''}`

function headline(d: Digest) {
  const p = d.watch.place.name
  if (d.kind === 'test') return `Test signal for ${p}`
  if (d.kind === 'welcome') return `Now watching ${p}`
  const n = d.events.length + (d.fires ? 1 : 0) + d.quakes.length + d.hazards.length
  if (n === 1) {
    if (d.events.length) return `${d.events[0].categoryTitle} near ${p}`
    if (d.fires) return `${d.fires.count} fire hotspot${d.fires.count > 1 ? 's' : ''} near ${p}`
    if (d.quakes.length) return `M${d.quakes[0].mag.toFixed(1)} earthquake ${km(d.quakes[0].distanceKm)} from ${p}`
    return `${HAZARD_LABEL[d.hazards[0].kind]} for ${p}`
  }
  return `${n} new signals near ${p}`
}

function statusLine(d: Digest) {
  if (d.kind === 'alert') return ''
  if (!d.events.length && !d.fires && !d.quakes.length && !d.hazards.length) return `All quiet within ${d.watch.radiusKm} km right now.`
  const parts: string[] = []
  if (d.events.length) parts.push(`${d.events.length} active event${d.events.length > 1 ? 's' : ''}`)
  if (d.fires) parts.push(`${d.fires.count} fire hotspot${d.fires.count > 1 ? 's' : ''} in the last 24 h`)
  if (d.quakes.length) parts.push(`${d.quakes.length} earthquake${d.quakes.length > 1 ? 's' : ''} in the last 24 h`)
  if (d.hazards.length) parts.push(`${d.hazards.length} weather or air warning${d.hazards.length > 1 ? 's' : ''}`)
  return `Right now: ${parts.join(', ')} within ${d.watch.radiusKm} km.`
}

function lines(d: Digest) {
  const out = d.hazards.map((h) => `${HAZARD_LABEL[h.kind]}: ${h.text}`)
  out.push(...d.quakes.slice(0, 4).map(quakeLine))
  if (d.quakes.length > 4) out.push(`+${d.quakes.length - 4} more earthquakes`)
  out.push(...d.events.slice(0, 6).map((e) => `${e.categoryTitle}: ${e.title} · ${km(e.distanceKm)} away · ${day(e.date)}`))
  if (d.events.length > 6) out.push(`+${d.events.length - 6} more`)
  if (d.fires) out.push(`Fire hotspots (24 h): ${d.fires.count}, nearest ${km(d.fires.nearestKm)}, peak ${Math.round(d.fires.maxFrp)} MW`)
  return out
}

export function plain(d: Digest, short = false) {
  const body = [`VIGIL · ${headline(d)}`]
  const st = statusLine(d)
  if (st) body.push(st)
  body.push(...(short ? lines(d).slice(0, 2) : lines(d)))
  body.push(`Map: ${mapUrl(d)}`)
  if (!short || d.kind !== 'test') body.push(`Stop: ${stopUrl(d)}`)
  return body.join('\n')
}

export function telegramHtml(d: Digest) {
  const out = [`<b>${esc(headline(d))}</b>`]
  const st = statusLine(d)
  if (st) out.push(`<i>${esc(st)}</i>`)
  if (lines(d).length) out.push('', ...lines(d).map((l) => '· ' + esc(l)))
  out.push('', `<a href="${mapUrl(d)}">Open the globe</a>  ·  <a href="${stopUrl(d)}">Stop watching</a>`)
  return out.join('\n')
}

export function emailSubject(d: Digest) {
  return `Vigil · ${headline(d)}`
}

export function emailHtml(d: Digest) {
  const row = (color: string, kicker: string, title: string, sub: string) => `
      <tr><td style="padding:14px 0;border-top:1px solid #2a2823">
        <div style="font:600 11px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:${color}">${esc(kicker)}</div>
        <div style="font:400 18px/1.35 Georgia,serif;color:#efe8d8;margin-top:4px">${esc(title)}</div>
        ${sub ? `<div style="font:12px/1.5 ui-monospace,Menlo,monospace;color:#8f897b;margin-top:2px">${esc(sub)}</div>` : ''}
      </td></tr>`
  const rows = [
    ...d.hazards.map((h) => h.kind === 'air'
      ? row(h.level === 2 ? '#ff7a66' : '#f0a35a', HAZARD_LABEL.air, h.text, 'Current reading · Open-Meteo (CAMS)')
      : row(h.level === 2 ? '#ff7a66' : '#f0a35a', HAZARD_LABEL[h.kind] + ' · forecast', h.text, 'Open-Meteo forecast for the next 3 days')),
    ...d.quakes.slice(0, 8).map((q) => row(q.mag >= 6 ? '#ff7a66' : '#c9a6ff', `Earthquake · ${km(q.distanceKm)}`, `M${q.mag.toFixed(1)} · ${q.place}`,
      `${q.depthKm} km deep · ${new Date(q.time).toISOString().slice(0, 16).replace('T', ' ')} UTC${q.tsunami ? ' · tsunami flag' : ''}`)),
    ...d.events.slice(0, 10).map((e) => `
      <tr><td style="padding:14px 0;border-top:1px solid #2a2823">
        <div style="font:600 11px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#d9a35b">${esc(e.categoryTitle)} · ${km(e.distanceKm)}</div>
        <div style="font:400 18px/1.35 Georgia,serif;color:#efe8d8;margin-top:4px">${esc(e.title)}</div>
        <div style="font:12px/1.5 ui-monospace,Menlo,monospace;color:#8f897b;margin-top:2px">${e.lat.toFixed(2)}°, ${e.lon.toFixed(2)}° · last seen ${day(e.date)}</div>
      </td></tr>`),
    d.fires ? `
      <tr><td style="padding:14px 0;border-top:1px solid #2a2823">
        <div style="font:600 11px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#ff6a2b">Fire hotspots · last 24 h</div>
        <div style="font:400 18px/1.35 Georgia,serif;color:#efe8d8;margin-top:4px">${d.fires.count} detections, nearest ${km(d.fires.nearestKm)}</div>
        <div style="font:12px/1.5 ui-monospace,Menlo,monospace;color:#8f897b;margin-top:2px">${d.fires.high} high-confidence · peak radiative power ${Math.round(d.fires.maxFrp)} MW</div>
      </td></tr>` : '',
  ].join('')
  const st = statusLine(d)
  return `<!doctype html><html><body style="margin:0;background:#0b0c0e;padding:32px 16px">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#111215;border:1px solid #24231f;border-radius:4px">
    <tr><td style="padding:28px 28px 8px">
      <div style="font:italic 400 26px/1 Georgia,serif;color:#efe8d8">Vigil</div>
      <div style="font:11px/1.6 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#8f897b;margin-top:6px">${esc(d.watch.place.name)} · ${d.watch.radiusKm} km radius</div>
    </td></tr>
    <tr><td style="padding:8px 28px 4px">
      <div style="font:400 28px/1.2 Georgia,serif;color:#efe8d8">${esc(headline(d))}</div>
      ${st ? `<div style="font:15px/1.5 Helvetica,Arial,sans-serif;color:#b9b2a2;margin-top:8px">${esc(st)}</div>` : ''}
    </td></tr>
    <tr><td style="padding:8px 28px"><table role="presentation" width="100%">${rows}</table></td></tr>
    <tr><td style="padding:16px 28px 28px">
      <a href="${mapUrl(d)}" style="display:inline-block;background:#efe8d8;color:#0b0c0e;font:600 14px/1 Helvetica,Arial,sans-serif;padding:12px 18px;border-radius:2px;text-decoration:none">Open the globe</a>
      <div style="font:12px/1.6 Helvetica,Arial,sans-serif;color:#6f6a5f;margin-top:20px">Data: NASA EONET and FIRMS, USGS earthquakes, Open-Meteo forecasts. Events can lag the real world by hours. In an emergency, follow your local authorities.<br><a href="${stopUrl(d)}" style="color:#8f897b">Stop watching this place</a></div>
    </td></tr>
  </table></body></html>`
}

export function discordPayload(d: Digest) {
  return {
    username: 'Vigil',
    embeds: [{
      title: headline(d),
      url: mapUrl(d),
      description: [statusLine(d), ...lines(d).map((l) => '• ' + l)].filter(Boolean).join('\n'),
      color: 0xff6a2b,
      footer: { text: `${d.watch.place.name} · ${d.watch.radiusKm} km · NASA · USGS · Open-Meteo` },
    }],
  }
}

export function slackPayload(d: Digest) {
  const text = [`*${headline(d)}*`, statusLine(d), ...lines(d).map((l) => '• ' + l), `<${mapUrl(d)}|Open the globe> · <${stopUrl(d)}|Stop watching>`]
    .filter(Boolean).join('\n')
  return { text }
}
