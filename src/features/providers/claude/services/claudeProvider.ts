import type { ProviderUsage, UsageProvider } from "../../../../shared/types/usage"
import {
  errorMessage,
  hasRolledOver,
  isDesktopRuntime,
  readClaudeUsage,
  toUsageLimit
} from "../../shared/services/localUsageSource"

const planLabels: Record<string, string> = {
  default_claude_max_5x: "Max 5x",
  default_claude_max_20x: "Max 20x",
  default_claude_pro: "Pro"
}

/**
 * Claude Code caches the account utilization it receives from Anthropic into
 * `~/.claude.json`. That cache is the only local source that reports a real
 * percentage, so it refreshes whenever Claude Code itself runs.
 */
export const claudeProvider: UsageProvider = {
  id: "claude",
  name: "Claude",
  connect: async () => undefined,
  disconnect: async () => undefined,
  isConnected: async () => {
    if (!isDesktopRuntime()) return false
    try {
      const snapshot = await readClaudeUsage()
      return snapshot.windows.length > 0
    } catch {
      return false
    }
  },
  fetchUsage: async (): Promise<ProviderUsage> => {
    const updatedAt = new Date().toISOString()

    if (!isDesktopRuntime()) {
      return {
        provider: "claude",
        status: "disconnected",
        updatedAt,
        limits: [],
        error: {
          code: "DESKTOP_ONLY",
          message: "Local usage files are only readable from the desktop app."
        }
      }
    }

    try {
      const snapshot = await readClaudeUsage()
      const session = snapshot.windows.find((entry) => entry.id === "five-hour")
      const stale = session !== undefined && hasRolledOver(session)
      const plan = snapshot.plan ? (planLabels[snapshot.plan] ?? snapshot.plan) : undefined

      const notes = [
        plan ? `Plan ${plan}.` : undefined,
        stale
          ? "The cached 5-hour window already reset. Run Claude Code to refresh the reading."
          : `Read from ${snapshot.source}.`
      ].filter(Boolean)

      return {
        provider: "claude",
        status: "connected",
        updatedAt,
        lastSuccessfulAt: snapshot.fetchedAtMs
          ? new Date(snapshot.fetchedAtMs).toISOString()
          : updatedAt,
        limits: snapshot.windows.map(toUsageLimit),
        error: { code: stale ? "STALE_CACHE" : "SOURCE_INFO", message: notes.join(" ") }
      }
    } catch (error) {
      return {
        provider: "claude",
        status: "disconnected",
        updatedAt,
        limits: [],
        error: {
          code: "LOCAL_SOURCE_UNAVAILABLE",
          message: errorMessage(error, "Claude usage could not be read from the local cache.")
        }
      }
    }
  }
}
