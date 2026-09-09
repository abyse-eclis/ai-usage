import type { ProviderUsage, UsageProvider } from "../../../../shared/types/usage"

export const chatGptProvider: UsageProvider = {
  id: "chatgpt",
  name: "ChatGPT",
  connect: async () => undefined,
  disconnect: async () => undefined,
  isConnected: async () => false,
  fetchUsage: async (): Promise<ProviderUsage> => ({
    provider: "chatgpt",
    status: "disconnected",
    updatedAt: new Date().toISOString(),
    limits: [],
    error: {
      code: "USAGE_UNAVAILABLE",
      message: "This limit is not exposed by ChatGPT through a verified public source."
    }
  })
}
