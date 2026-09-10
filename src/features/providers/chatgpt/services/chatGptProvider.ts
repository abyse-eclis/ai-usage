import type { ProviderUsage, UsageProvider } from "../../../../shared/types/usage"

/**
 * The Codex CLI rollouts expose the Codex quota only. Nothing on this machine
 * records the separate ChatGPT conversation quota, so this provider stays
 * unavailable rather than mirroring the Codex percentages under a second name.
 */
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
      message:
        "ChatGPT conversation limits have no local source. The Codex card shows the OpenAI plan quota."
    }
  })
}
