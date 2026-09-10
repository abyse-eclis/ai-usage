import { create } from "zustand"
import { persist } from "zustand/middleware"
import { emit } from "@tauri-apps/api/event"
import type { ProviderId, ProviderUsage, UsageCacheRecord } from "../../../shared/types/usage"
import { getUsageProviders } from "../../providers/shared/providerRegistry"

export interface UsageStateSnapshot {
  usage: Partial<Record<ProviderId, ProviderUsage>>
  cache: Partial<Record<ProviderId, UsageCacheRecord>>
  refreshFailed: boolean
  lastRefreshError?: string
}

interface UsageStore {
  usage: Partial<Record<ProviderId, ProviderUsage>>
  cache: Partial<Record<ProviderId, UsageCacheRecord>>
  isRefreshing: boolean
  refreshFailed: boolean
  lastRefreshError?: string
  refreshUsage: (demoMode: boolean) => Promise<void>
  applySnapshot: (snapshot: UsageStateSnapshot) => void
  /** Re-broadcasts the current snapshot so a window that opened later (the
   * companion, the hover popup) can render without fetching anything itself. */
  publishSnapshot: () => void
}

export const useUsageStore = create<UsageStore>()(
  persist(
    (set, get) => ({
      usage: {},
      cache: {},
      isRefreshing: false,
      refreshFailed: false,
      publishSnapshot: () => {
        const { usage, cache, refreshFailed, lastRefreshError } = get()
        emit("usage-state-updated", { usage, cache, refreshFailed, lastRefreshError }).catch(() => undefined)
      },
      applySnapshot: (snapshot) =>
        set({
          usage: snapshot.usage,
          cache: snapshot.cache,
          refreshFailed: snapshot.refreshFailed,
          lastRefreshError: snapshot.lastRefreshError
        }),
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

        const snapshot = { usage, cache, refreshFailed, lastRefreshError }
        set({ ...snapshot, isRefreshing: false })
        emit("usage-state-updated", snapshot).catch(() => undefined)
      }
    }),
    {
      name: "ai-usage-cache",
      partialize: (state) => ({ cache: state.cache, usage: state.usage })
    }
  )
)
