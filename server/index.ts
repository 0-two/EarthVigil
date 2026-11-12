/** Local / self-hosted entry point: one long-running process (dev, Docker, a VM). */
import { configured, env } from './env.js'
import express from 'express'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { app } from './app.js'
import { store } from './store.js'
import { sweep } from './alerts/engine.js'
import { startPolling } from './alerts/telegram-bot.js'

// Self-hosted production: serve the built client from the same process
const dist = resolve('dist')
if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '7d', index: false }))
  app.get(/^\/(?!api\/|u\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')))
}

app.listen(env.port, () => {
  const on = Object.entries(configured).filter(([, v]) => v).map(([k]) => k).join(', ')
  console.log(`[vigil] api on http://localhost:${env.port} · storage: ${store.kind} · live channels: ${on} · others dry-run to this log`)
  setTimeout(() => void sweep().catch(() => {}), 20_000)
  setInterval(() => void sweep().catch(() => {}), env.intervalMin * 60_000)
  console.log(`[watch] checking every ${env.intervalMin} min`)
  void startPolling()
})
