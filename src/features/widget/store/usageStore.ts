import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { ProviderId, ProviderUsage, UsageCacheRecord } from "../../../shared/types/usage"
import { getUsageProviders } from "../../providers/shared/providerRegistry"

interface UsageStore {
  usage: Partial<Record<ProviderId, ProviderUsage>>
  cache: Partial<Record<ProviderId, UsageCacheRecord>>
  isRefreshing: boolean
  refreshFailed: boolean
  lastRefreshError?: string
  refreshUsage: (demoMode: boolean) => Promise<void>
}

export const useUsageStore = create<UsageStore>()(
  persist(
    (set, get) => ({
      usage: {},
      cache: {},
      isRefreshing: false,
      refreshFailed: false,
      refreshUsage: async (demoMode) => {
        set({ isRefreshing: true, refreshFailed: false, lastRefreshError: undefined })
        const providers = getUsageProviders(demoMode)
        const results = await Promise.allSettled(providers.map((provider) => provider.fetchUsage()))
        const usage = { ...get().usage }
        const cache = { ...get().cache }
        let refreshFailed = false
        let lastRefreshError: string | undefined

        results.forEach((result, index) => {
          const provider = providers[index]
          if (result.status === "fulfilled") {
            const nextUsage = result.value
            if (nextUsage.status === "error") {
              refreshFailed = true
              lastRefreshError = nextUsage.error?.message
            }
            usage[provider.id] = nextUsage
            if (nextUsage.status === "connected") {
              cache[provider.id] = {
                provider: provider.id,
                usage: nextUsage,
                updatedAt: nextUsage.updatedAt,
                lastSuccessfulAt: nextUsage.lastSuccessfulAt ?? nextUsage.updatedAt
              }
            }
            return
          }

          refreshFailed = true
          lastRefreshError = result.reason instanceof Error ? result.reason.message : "Refresh failed"
          const cached = cache[provider.id]?.usage
          usage[provider.id] =
            cached ??
            ({
              provider: provider.id,
              status: "error",
              limits: [],
              updatedAt: new Date().toISOString(),
              error: { message: lastRefreshError }
            } satisfies ProviderUsage)
        })

        set({ usage, cache, isRefreshing: false, refreshFailed, lastRefreshError })
      }
    }),
    {
      name: "ai-usage-cache",
      partialize: (state) => ({ cache: state.cache, usage: state.usage })
    }
  )
)
