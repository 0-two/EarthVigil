try {
  process.loadEnvFile('.env')
} catch {
  /* no .env file: on Vercel the variables come from the project settings */
}

const s = (k: string) => (process.env[k] ?? '').trim()

export const env = {
  port: Number(s('PORT') || 8787),
  publicUrl: (s('PUBLIC_URL') || (s('VERCEL_PROJECT_PRODUCTION_URL') ? `https://${s('VERCEL_PROJECT_PRODUCTION_URL')}` : 'http://localhost:5173')).replace(/\/$/, ''),
  intervalMin: Math.max(2, Number(s('ALERT_INTERVAL_MIN') || 15)),
  serverless: Boolean(s('VERCEL')),
  firmsKey: s('FIRMS_MAP_KEY'),
  /** Shared secret for the scheduled sweep endpoint (Vercel Cron and Supabase pg_cron send it as a Bearer token). */
  cronSecret: s('CRON_SECRET'),
  supabase: { url: s('SUPABASE_URL'), key: s('SUPABASE_SERVICE_ROLE_KEY') },
  smtp: {
    host: s('SMTP_HOST'),
    port: Number(s('SMTP_PORT') || 587),
    user: s('SMTP_USER'),
    pass: s('SMTP_PASS'),
    from: s('MAIL_FROM') || 'Vigil <alerts@example.com>',
  },
  telegram: {
    token: s('TELEGRAM_BOT_TOKEN'),
    username: s('TELEGRAM_BOT_USERNAME').replace(/^@/, ''),
    webhookSecret: s('TELEGRAM_WEBHOOK_SECRET'),
  },
  twilio: {
    sid: s('TWILIO_ACCOUNT_SID'),
    token: s('TWILIO_AUTH_TOKEN'),
    smsFrom: s('TWILIO_SMS_FROM'),
    waFrom: s('TWILIO_WHATSAPP_FROM'),
  },
}

export const configured = {
  email: Boolean(env.smtp.host),
  telegram: Boolean(env.telegram.token),
  sms: Boolean(env.twilio.sid && env.twilio.token && env.twilio.smsFrom),
  whatsapp: Boolean(env.twilio.sid && env.twilio.token && env.twilio.waFrom),
  discord: true,
  slack: true,
}
