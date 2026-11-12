/**
 * Points your Telegram bot at the deployed site. Run once after the first deploy:
 *   npx tsx scripts/telegram-webhook.ts https://your-app.vercel.app
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from .env (or the environment).
 * Pass --delete to remove the webhook and go back to local polling.
 */
try { process.loadEnvFile('.env') } catch { /* use the environment */ }

const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
const arg = process.argv[2] ?? process.env.PUBLIC_URL
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set')

const api = `https://api.telegram.org/bot${token}`
if (arg === '--delete') {
  console.log(await (await fetch(`${api}/deleteWebhook`)).json())
} else {
  if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET is not set (any random string, also set in Vercel)')
  if (!arg?.startsWith('https://')) throw new Error('Give the https:// address of the deployed site')
  const url = `${arg.replace(/\/$/, '')}/api/telegram/webhook`
  const res = await fetch(`${api}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true }),
  })
  console.log(await res.json())
  console.log((await (await fetch(`${api}/getWebhookInfo`)).json()))
}
