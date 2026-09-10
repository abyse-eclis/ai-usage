import { create } from "zustand"
import { persist } from "zustand/middleware"
import { defaultThresholds } from "../../../shared/utils/thresholds"
import type { AppSettings } from "../types/settings"

// Real Claude and Codex readings come from local files, so demo data is now opt-in.
const envDemo = import.meta.env.VITE_DEMO_MODE === "true"

const defaults: AppSettings = {
  launchAtStartup: false,
  refreshIntervalMinutes: 5,
  minimizeToTray: true,
  alwaysOnTop: true,
  lockPosition: false,
  snapToEdge: true,
  autoCollapseWhenDocked: false,
  hideFromTaskbar: true,
  sizeMode: "medium",
  appearance: "dark",
  opacity: 0.92,
  backgroundBlur: true,
  demoMode: envDemo,
  debugLogs: false,
  experimentalProviders: false,
  thresholds: defaultThresholds,
  notificationsEnabled: true
}

interface SettingsStore {
  settings: AppSettings
  updateSettings: (settings: Partial<AppSettings>) => void
  resetSettings: () => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      settings: defaults,
      updateSettings: (settings) =>
        set((state) => ({
          settings: { ...state.settings, ...settings }
        })),
      resetSettings: () => set({ settings: defaults })
    }),
    {
      name: "ai-usage-settings",
      version: 3,
      // v1 shipped with demo mode forced on. Clear that stored preference once so
      // existing installs land on the real providers.
      migrate: (persisted, version) => {
        const state = persisted as { settings?: AppSettings } | undefined
        if (!state?.settings) return state
        const settings = {
          ...state.settings,
          autoCollapseWhenDocked: state.settings.autoCollapseWhenDocked ?? defaults.autoCollapseWhenDocked
        }
        if (version < 2) settings.demoMode = envDemo
        return { ...state, settings }
      }
    }
  )
)
