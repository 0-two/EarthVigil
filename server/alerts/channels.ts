import nodemailer from 'nodemailer'
import { configured, env } from '../env.js'
import type { ChannelId, Watch } from '../store.js'
import * as fmt from './format.js'
import type { Digest } from './format.js'

export interface SendResult { channel: ChannelId; ok: boolean; dryRun?: boolean; detail?: string }

const mailer = configured.email
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null

async function twilio(from: string, to: string, body: string) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilio.sid}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${env.twilio.sid}:${env.twilio.token}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

export async function telegramSend(chatId: number, html: string) {
  const res = await fetch(`https://api.telegram.org/bot${env.telegram.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

async function webhook(url: string, payload: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Webhook ${res.status}`)
}

function dry(channel: ChannelId, to: string, d: Digest): SendResult {
  console.log(`\n┌─ [dry-run ${channel} → ${to}]\n│ ${fmt.plain(d).split('\n').join('\n│ ')}\n└─`)
  return { channel, ok: true, dryRun: true, detail: `${channel} isn't configured on the server yet, so the message was written to the server log` }
}

async function attempt(channel: ChannelId, fn: () => Promise<void>): Promise<SendResult> {
  try {
    await fn()
    return { channel, ok: true }
  } catch (err) {
    console.error(`[send:${channel}]`, (err as Error).message)
    return { channel, ok: false, detail: (err as Error).message }
  }
}

export async function deliver(channels: Watch['channels'], d: Digest): Promise<SendResult[]> {
  const jobs: Promise<SendResult>[] = []
  const c = channels

  if (c.email) {
    const to = c.email
    jobs.push(mailer
      ? attempt('email', async () => { await mailer.sendMail({ from: env.smtp.from, to, subject: fmt.emailSubject(d), text: fmt.plain(d), html: fmt.emailHtml(d) }) })
      : Promise.resolve(dry('email', to, d)))
  }
  if (c.sms) {
    const to = c.sms
    jobs.push(configured.sms ? attempt('sms', () => twilio(env.twilio.smsFrom, to, fmt.plain(d, true))) : Promise.resolve(dry('sms', to, d)))
  }
  if (c.whatsapp) {
    const to = c.whatsapp
    const from = env.twilio.waFrom.startsWith('whatsapp:') ? env.twilio.waFrom : `whatsapp:${env.twilio.waFrom}`
    jobs.push(configured.whatsapp ? attempt('whatsapp', () => twilio(from, `whatsapp:${to}`, fmt.plain(d))) : Promise.resolve(dry('whatsapp', to, d)))
  }
  if (c.telegram) {
    const chat = c.telegram.chatId
    if (chat && configured.telegram) jobs.push(attempt('telegram', () => telegramSend(chat, fmt.telegramHtml(d))))
    else if (!configured.telegram) jobs.push(Promise.resolve(dry('telegram', 'bot not configured', d)))
    else jobs.push(Promise.resolve({ channel: 'telegram', ok: false, detail: 'Waiting for you to press Start in Telegram' }))
  }
  if (c.discord) { const u = c.discord; jobs.push(attempt('discord', () => webhook(u, fmt.discordPayload(d)))) }
  if (c.slack) { const u = c.slack; jobs.push(attempt('slack', () => webhook(u, fmt.slackPayload(d)))) }

  return Promise.all(jobs)
}
