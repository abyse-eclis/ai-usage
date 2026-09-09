import type { ProviderId, ProviderUsage, UsageProvider } from "../../../../shared/types/usage"
import { addDuration } from "../../../../shared/utils/time"
import { normalizeLimit } from "../../../../shared/utils/usage"

const now = () => new Date()

function usage(provider: ProviderId): ProviderUsage {
  const updatedAt = now().toISOString()
  const data: Record<ProviderId, ProviderUsage> = {
    claude: {
      provider: "claude",
      status: "connected",
      updatedAt,
      lastSuccessfulAt: updatedAt,
      limits: [
        normalizeLimit({
          id: "session",
          label: "Session",
          period: "session",
          usedPercent: 79,
          resetAt: addDuration(now(), { hours: 2, minutes: 2 }),
          unit: "percent"
        }),
        normalizeLimit({ id: "weekly", label: "Weekly", period: "weekly", usedPercent: 61, unit: "percent" }),
        normalizeLimit({ id: "fable", label: "Fable", period: "custom", usedPercent: 69, unit: "percent" })
      ]
    },
    codex: {
      provider: "codex",
      status: "connected",
      updatedAt,
      lastSuccessfulAt: updatedAt,
      limits: [
        normalizeLimit({
          id: "five-hour",
          label: "5-hour",
          period: "custom",
          usedPercent: 55,
          resetAt: addDuration(now(), { hours: 3, minutes: 41 }),
          unit: "percent"
        }),
        normalizeLimit({ id: "weekly", label: "Weekly", period: "weekly", usedPercent: 68, unit: "percent" })
      ]
    },
    chatgpt: {
      provider: "chatgpt",
      status: "connected",
      updatedAt,
      lastSuccessfulAt: updatedAt,
      limits: [
        normalizeLimit({
          id: "gpt-pro",
          label: "GPT Pro",
          period: "weekly",
          used: 31,
          total: 50,
          resetAt: addDuration(now(), { days: 5 }),
          unit: "messages"
        })
      ]
    }
  }
  return data[provider]
}

function makeDemoProvider(id: ProviderId, name: string): UsageProvider {
  return {
    id,
    name,
    connect: async () => undefined,
    disconnect: async () => undefined,
    isConnected: async () => true,
    fetchUsage: async () => usage(id)
  }
}

export const demoProviders: UsageProvider[] = [
  makeDemoProvider("claude", "Claude"),
  makeDemoProvider("codex", "Codex"),
  makeDemoProvider("chatgpt", "ChatGPT")
]
