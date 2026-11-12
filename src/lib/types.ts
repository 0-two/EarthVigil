export interface EonetEvent {
  id: string
  title: string
  category: string
  categoryTitle: string
  date: string
  firstDate: string
  lat: number
  lon: number
  magnitude: number | null
  magnitudeUnit: string | null
  sources: { id: string; url: string }[]
  link: string
  track: [number, number, string][]
}

/** [lon, lat, frp MW, confidence 0|1|2, day 1/night 0, epoch ms] */
export type Hotspot = [number, number, number, number, number, number]
export interface FireSet { source: string; fetchedAt: string; hotspots: Hotspot[] }

export interface Place {
  name: string
  context?: string
  lat: number
  lon: number
  bbox?: [number, number, number, number]
}

export type ChannelId = 'email' | 'telegram' | 'whatsapp' | 'sms' | 'discord' | 'slack'

export interface ServerConfig {
  channels: Record<ChannelId, boolean>
  telegramBot: string | null
  intervalMin: number
}

export interface PublicWatch {
  id: string
  place: { name: string; lat: number; lon: number }
  radiusKm: number
  categories: string[]
  fires: boolean
  createdAt: string
  lastCheckedAt?: string
  lastAlertAt?: string
  channels: Partial<Record<ChannelId, string>>
  telegramLink: string | null
}

export interface SendResult { channel: ChannelId; ok: boolean; dryRun?: boolean; detail?: string }

export interface SavedWatch { id: string; token: string; name: string; lat: number; lon: number; radiusKm: number }
