import type { ProviderUsage, UsageProvider } from "../../../../shared/types/usage"

export interface CodexUsageSource {
  id: string
  name: string
  detect(): Promise<boolean>
  fetchUsage(): Promise<ProviderUsage>
}

export const cliUsageSource: CodexUsageSource = {
  id: "cli",
  name: "Codex CLI",
  detect: async () => false,
  fetchUsage: async () => ({
    provider: "codex",
    status: "error",
    updatedAt: new Date().toISOString(),
    limits: [],
    error: {
      code: "CLI_USAGE_UNAVAILABLE",
      message: "Codex CLI usage output has not been verified as a stable source."
    }
  })
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
  isConnected: async () => false,
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
