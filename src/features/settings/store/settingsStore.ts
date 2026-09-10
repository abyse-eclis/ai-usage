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
  notificationsEnabled: true,
  taskbarCompanion: {
    primaryProvider: "claude",
    timeFormat: "24-hour",
    hoverPopupEnabled: true,
    clickToPinEnabled: true,
    showFiveHour: true,
    showWeekly: true,
    showFable: true,
    taskbarMonitorId: ""
  },
  // Presentation modes are independent windows. This is the local mirror of
  // Rust's persisted state (the actual source of truth for visibility); it
  // is hydrated/kept in sync via windowManager's restorePresentationState
  // and the "presentation-state-changed" event so Settings UI stays live.
  presentation: {
    mainWidgetEnabled: false,
    taskbarCompanionEnabled: true,
    edgeDockEnabled: false
  }
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
      version: 6,
      // v1 shipped with demo mode forced on. Clear that stored preference once so
      // existing installs land on the real providers.
      migrate: (persisted, version) => {
        const state = persisted as { settings?: AppSettings } | undefined
        if (!state?.settings) return state
        const legacyTaskbarCompanion = state.settings.taskbarCompanion as
          | (Partial<AppSettings["taskbarCompanion"]> & { enabled?: boolean })
          | undefined
        const settings = {
          ...state.settings,
          autoCollapseWhenDocked: state.settings.autoCollapseWhenDocked ?? defaults.autoCollapseWhenDocked,
          taskbarCompanion: {
            ...defaults.taskbarCompanion,
            ...legacyTaskbarCompanion
          },
          // v5 splits window visibility ("presentation") out from feature
          // settings. Carry forward the old taskbarCompanion.enabled flag if
          // this install predates that split.
          presentation: {
            ...defaults.presentation,
            ...state.settings.presentation,
            ...(version < 5 && legacyTaskbarCompanion?.enabled !== undefined
              ? { taskbarCompanionEnabled: legacyTaskbarCompanion.enabled }
              : {})
          }
        }
        if (version < 2) settings.demoMode = envDemo
        return { ...state, settings }
      }
    }
  )
)
