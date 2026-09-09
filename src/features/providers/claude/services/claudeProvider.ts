import type { ProviderUsage, UsageProvider } from "../../../../shared/types/usage"

export const claudeProvider: UsageProvider = {
  id: "claude",
  name: "Claude",
  connect: async () => undefined,
  disconnect: async () => undefined,
  isConnected: async () => false,
  fetchUsage: async (): Promise<ProviderUsage> => ({
    provider: "claude",
    status: "disconnected",
    updatedAt: new Date().toISOString(),
    limits: [],
    error: {
      code: "UNVERIFIED_SOURCE",
      message: "Claude usage extraction is not enabled until a reliable local or official source is verified."
    }
  })
}
