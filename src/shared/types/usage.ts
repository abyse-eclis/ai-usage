export type ProviderId = "claude" | "codex" | "chatgpt"

export type ProviderStatus = "connected" | "disconnected" | "loading" | "error"

export type UsagePeriod =
  | "session"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "custom"

export type UsageUnit = "percent" | "messages" | "credits" | "tokens" | "currency"

export interface UsageProvider {
  id: ProviderId
  name: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): Promise<boolean>
  fetchUsage(): Promise<ProviderUsage>
}

export interface ProviderUsage {
  provider: ProviderId
  status: ProviderStatus
  limits: UsageLimit[]
  updatedAt: string
  lastSuccessfulAt?: string
  error?: {
    code?: string
    message: string
  }
}

export interface UsageLimit {
  id: string
  label: string
  period?: UsagePeriod
  used?: number
  total?: number
  usedPercent?: number
  remainingPercent?: number
  resetAt?: string
  resetLabel?: string
  unit?: UsageUnit
  rawValue?: unknown
}

export interface UsageCacheRecord {
  provider: ProviderId
  usage: ProviderUsage
  updatedAt: string
  lastSuccessfulAt: string
}
