import type { ProviderUsage, UsageProvider } from "../../../../shared/types/usage"
import {
  errorMessage,
  isDesktopRuntime,
  readCodexUsage,
  toUsageLimit
} from "../../shared/services/localUsageSource"

export interface CodexUsageSource {
  id: string
  name: string
  detect(): Promise<boolean>
  fetchUsage(): Promise<ProviderUsage>
}

/**
 * Every Codex CLI rollout records a `token_count` event whose `rate_limits`
 * block carries the account percentages straight from OpenAI. Reading the most
 * recent one avoids guessing at an API that is not published.
 */
export const cliUsageSource: CodexUsageSource = {
  id: "cli",
  name: "Codex CLI",
  detect: async () => isDesktopRuntime(),
  fetchUsage: async () => {
    const updatedAt = new Date().toISOString()
    try {
      const snapshot = await readCodexUsage()
      const notes = [
        snapshot.plan ? `Plan ${snapshot.plan}.` : undefined,
        snapshot.hasCredits && snapshot.creditBalance
          ? `Credits ${snapshot.creditBalance}.`
          : undefined,
        `Read from the latest Codex CLI session.`
      ].filter(Boolean)

      return {
        provider: "codex",
        status: "connected",
        updatedAt,
        lastSuccessfulAt: snapshot.observedAtIso ?? updatedAt,
        limits: snapshot.windows.map(toUsageLimit),
        error: { code: "SOURCE_INFO", message: notes.join(" ") }
      }
    } catch (error) {
      return {
        provider: "codex",
        status: "disconnected",
        updatedAt,
        limits: [],
        error: {
          code: "CLI_USAGE_UNAVAILABLE",
          message: errorMessage(error, "No Codex CLI session reported usage on this machine.")
        }
      }
    }
  }
}

export const browserUsageSource: CodexUsageSource = {
  id: "browser",
  name: "OpenAI account session",
  detect: async () => false,
  fetchUsage: async () => ({
    provider: "codex",
    status: "disconnected",
    updatedAt: new Date().toISOString(),
    limits: [],
    error: {
      code: "BROWSER_SOURCE_DISABLED",
      message: "Browser extraction is experimental and disabled by default."
    }
  })
}

export const codexProvider: UsageProvider = {
  id: "codex",
  name: "Codex",
  connect: async () => undefined,
  disconnect: async () => undefined,
  isConnected: async () => {
    if (!(await cliUsageSource.detect())) return false
    const usage = await cliUsageSource.fetchUsage()
    return usage.status === "connected"
  },
  fetchUsage: async () => {
    for (const source of [cliUsageSource, browserUsageSource]) {
      if (await source.detect()) return source.fetchUsage()
    }
    return {
      provider: "codex",
      status: "disconnected",
      updatedAt: new Date().toISOString(),
      limits: [],
      error: {
        code: "NO_VERIFIED_SOURCE",
        message: "No verified Codex usage source is available on this machine."
      }
    }
  }
}
