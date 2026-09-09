import { create } from "zustand"
import { persist } from "zustand/middleware"
import { defaultThresholds } from "../../../shared/utils/thresholds"
import type { AppSettings } from "../types/settings"

const envDemo = import.meta.env.VITE_DEMO_MODE !== "false"

const defaults: AppSettings = {
  launchAtStartup: false,
  refreshIntervalMinutes: 5,
  minimizeToTray: true,
  alwaysOnTop: true,
  lockPosition: false,
  snapToEdge: true,
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
      name: "ai-usage-settings"
    }
  )
)
