/**
 * Watch storage with two backends behind one async interface:
 *  - Supabase Postgres when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (production)
 *  - a JSON file in ./data otherwise (local development)
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env.js'

export type ChannelId = 'email' | 'telegram' | 'sms' | 'whatsapp' | 'discord' | 'slack'

export interface Watch {
  id: string
  token: string
  createdAt: string
  place: { name: string; lat: number; lon: number }
  radiusKm: number
  categories: string[] // EONET category ids
  fires: boolean
  minFireConfidence: 0 | 1 | 2
  channels: {
    email?: string
    sms?: string
    whatsapp?: string
    telegram?: { startToken: string; chatId?: number }
    discord?: string
    slack?: string
  }
  /** keys already notified: EONET event ids, or fires:<yyyy-mm-dd> */
  seen: string[]
  lastCheckedAt?: string
  lastAlertAt?: string
  active: boolean
}

export interface Store {
  readonly kind: 'supabase' | 'file'
  active(): Promise<Watch[]>
  get(id: string): Promise<Watch | undefined>
  byTelegramStart(token: string): Promise<Watch | undefined>
  add(w: Watch, ipHash?: string): Promise<void>
  save(w: Watch): Promise<void>
  remove(id: string): Promise<boolean>
  countRecentByIp(ipHash: string, windowMs: number): Promise<number>
  /** Records one hit for `key` and returns how many hits it has inside the window. */
  hit(key: string, windowMs: number): Promise<number>
  prune(): Promise<void>
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
}

export const id = (n = 9) => randomBytes(n).toString('base64url')
export const hashIp = (ip: string) => createHash('sha256').update(`vigil:${env.cronSecret}:${ip}`).digest('base64url').slice(0, 22)

/* ── Supabase ─────────────────────────────────────────────────────── */
type Row = { id: string; token: string; telegram_start: string | null; active: boolean; ip_hash: string | null; created_at: string; data: Watch }

function supabaseStore(): Store {
  const db: SupabaseClient = createClient(env.supabase.url, env.supabase.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const row = (w: Watch, ipHash?: string) => ({
    id: w.id,
    token: w.token,
    telegram_start: w.channels.telegram?.startToken ?? null,
    active: w.active,
    ...(ipHash ? { ip_hash: ipHash } : {}),
    data: w,
  })
  const fail = (what: string, e: { message: string } | null) => { if (e) throw new Error(`[supabase] ${what}: ${e.message}`) }

  return {
    kind: 'supabase',
    async active() {
      const out: Watch[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('watches').select('data').eq('active', true).order('created_at').range(from, from + 999)
        fail('list', error)
        out.push(...(data as Pick<Row, 'data'>[]).map((r) => r.data))
        if (!data || data.length < 1000) return out
      }
    },
    async get(wid) {
      const { data, error } = await db.from('watches').select('data').eq('id', wid).maybeSingle()
      fail('get', error)
      return (data as Pick<Row, 'data'> | null)?.data
    },
    async byTelegramStart(t) {
      const { data, error } = await db.from('watches').select('data').eq('telegram_start', t).maybeSingle()
      fail('telegram lookup', error)
      return (data as Pick<Row, 'data'> | null)?.data
    },
    async add(w, ipHash) {
      const { error } = await db.from('watches').insert(row(w, ipHash))
      fail('insert', error)
    },
    async save(w) {
      const { error } = await db.from('watches').update(row(w)).eq('id', w.id)
      fail('update', error)
    },
    async remove(wid) {
      const { error, count } = await db.from('watches').delete({ count: 'exact' }).eq('id', wid)
      fail('delete', error)
      return (count ?? 0) > 0
    },
    async countRecentByIp(ipHash, windowMs) {
      const { count, error } = await db.from('watches').select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - windowMs).toISOString())
      fail('rate count', error)
      return count ?? 0
    },
    async hit(key, windowMs) {
      const ins = await db.from('hits').insert({ key })
      fail('hit', ins.error)
      const { count, error } = await db.from('hits').select('id', { count: 'exact', head: true })
        .eq('key', key).gte('at', new Date(Date.now() - windowMs).toISOString())
      fail('hit count', error)
      return count ?? 0
    },
    async prune() {
      const { error } = await db.from('hits').delete().lt('at', new Date(Date.now() - 86400_000).toISOString())
      fail('prune', error)
    },
    async getMeta(key) {
      const { data, error } = await db.from('meta').select('value').eq('key', key).maybeSingle()
      fail('meta get', error)
      return (data as { value: string } | null)?.value ?? null
    },
    async setMeta(key, value) {
      const { error } = await db.from('meta').upsert({ key, value, updated_at: new Date().toISOString() })
      fail('meta set', error)
    },
  }
}

/* ── JSON file (local dev) ────────────────────────────────────────── */
function fileStore(): Store {
  const FILE = resolve('data/watches.json')
  let watches: (Watch & { _ip?: string })[] = []
  try { watches = JSON.parse(readFileSync(FILE, 'utf8')) } catch { watches = [] }
  const hits = new Map<string, number[]>()
  const meta = new Map<string, string>()
  const persist = () => {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE + '.tmp', JSON.stringify(watches, null, 1))
    renameSync(FILE + '.tmp', FILE)
  }
  const clone = <T,>(x: T): T => structuredClone(x)
  return {
    kind: 'file',
    async active() { return clone(watches.filter((w) => w.active)) },
    async get(wid) { const w = watches.find((x) => x.id === wid); return w && clone(w) },
    async byTelegramStart(t) { const w = watches.find((x) => x.channels.telegram?.startToken === t); return w && clone(w) },
    async add(w, ip) { watches.push({ ...clone(w), _ip: ip }); persist() },
    async save(w) { const i = watches.findIndex((x) => x.id === w.id); if (i >= 0) { watches[i] = { ...clone(w), _ip: watches[i]._ip }; persist() } },
    async remove(wid) { const n = watches.length; watches = watches.filter((w) => w.id !== wid); persist(); return n !== watches.length },
    async countRecentByIp(ip, ms) { return watches.filter((w) => w._ip === ip && Date.now() - Date.parse(w.createdAt) < ms).length },
    async hit(key, ms) {
      const now = Date.now()
      const list = (hits.get(key) ?? []).filter((t) => now - t < ms)
      list.push(now)
      hits.set(key, list)
      return list.length
    },
    async prune() { hits.clear() },
    async getMeta(key) { return meta.get(key) ?? null },
    async setMeta(key, value) { meta.set(key, value) },
  }
}

function pick(): Store {
  if (env.supabase.url && env.supabase.key) return supabaseStore()
  if (env.supabase.raw && !env.supabase.url) console.error('[store] SUPABASE_URL must be the Project URL, like https://abcd.supabase.co (Supabase → Project Settings → API), not a postgres:// connection string')
  if (env.serverless) console.error('[store] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing: watches cannot be saved on a serverless host')
  return fileStore()
}

export const store: Store = pick()
