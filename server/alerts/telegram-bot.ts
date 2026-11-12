/**
 * Telegram linking: a person presses Start on t.me/<bot>?start=<token> and we store their chat id.
 * Production receives updates through a webhook (POST /api/telegram/webhook);
 * local development long-polls instead, unless a webhook is already registered for the bot.
 */
import { configured, env } from '../env.js'
import { store } from '../store.js'
import { telegramSend } from './channels.js'
import { telegramHtml } from './format.js'
import { welcome } from './engine.js'

export type Update = { update_id: number; message?: { chat: { id: number }; text?: string } }

const api = () => `https://api.telegram.org/bot${env.telegram.token}`

let username = env.telegram.username
/** The bot's @username, from the env or asked of Telegram once and cached. */
export async function botUsername(): Promise<string | null> {
  if (username || !configured.telegram) return username || null
  try {
    const me = (await (await fetch(`${api()}/getMe`, { signal: AbortSignal.timeout(5000) })).json()) as { ok: boolean; result?: { username: string } }
    if (me.ok && me.result) username = me.result.username
  } catch { /* try again on the next request */ }
  return username || null
}

export async function handleUpdate(u: Update) {
  const text = u.message?.text ?? ''
  const chat = u.message?.chat.id
  if (!chat) return
  const m = text.match(/^\/start\s+(\S+)/)
  if (!m) {
    if (text.startsWith('/start') || text.startsWith('/help'))
      await telegramSend(chat, 'Hi, I am <b>Vigil</b>. Pick a place on the globe, choose Telegram as a channel and press the link it gives you. Your alerts will arrive here.')
    return
  }
  const w = await store.byTelegramStart(m[1])
  if (!w || !w.channels.telegram) { await telegramSend(chat, 'That link has expired. Set the alert again from the globe.'); return }
  w.channels.telegram.chatId = chat
  await store.save(w)
  await telegramSend(chat, telegramHtml(await welcome(w)))
  console.log(`[telegram] linked chat for watch ${w.id}`)
}

/** Local development only. */
export async function startPolling() {
  if (!configured.telegram) return
  console.log(`[telegram] polling as @${(await botUsername()) ?? '?'}`)
  let offset = 0
  for (;;) {
    try {
      const res = await fetch(`${api()}/getUpdates?timeout=50&offset=${offset}&allowed_updates=["message"]`, { signal: AbortSignal.timeout(65_000) })
      if (res.status === 409) {
        console.log('[telegram] a webhook is registered for this bot (production), so local polling is off')
        return
      }
      const body = (await res.json()) as { ok: boolean; result: Update[] }
      for (const u of body.result ?? []) {
        offset = u.update_id + 1
        await handleUpdate(u).catch((e) => console.error('[telegram]', (e as Error).message))
      }
    } catch (err) {
      console.error('[telegram] poll error:', (err as Error).message)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}
