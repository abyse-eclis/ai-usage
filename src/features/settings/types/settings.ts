import type { UsageThresholds } from "../../../shared/utils/thresholds"
import type { WidgetSizeMode } from "../../widget/types/widget"

export interface TaskbarCompanionSettings {
  primaryProvider: "claude"
  timeFormat: "24-hour" | "12-hour"
  hoverPopupEnabled: boolean
  clickToPinEnabled: boolean
  showFiveHour: boolean
  showWeekly: boolean
  showFable: boolean
  /** Windows display device name to dock to. Empty string follows the primary monitor. */
  taskbarMonitorId: string
}

/**
 * Which presentation windows are enabled. Each mode is independent: enabling
 * or disabling one must never show/hide another. `mainWidgetEnabled` doubles
 * as "open on next launch" -- it is only changed by explicitly opening/
 * closing the Main Widget (tray action or its close button), never as a
 * side effect of Taskbar Companion or Edge Dock changing.
 */
export interface PresentationSettings {
  mainWidgetEnabled: boolean
  taskbarCompanionEnabled: boolean
  edgeDockEnabled: boolean
}

/**
 * Commands run to make a provider's CLI write a fresh reading to disk.
 *
 * Both CLIs only record usage as a side effect of a real request, so running
 * one spends quota. That is why these are empty by default, are edited by the
 * user rather than guessed, and fire only on an explicit reload -- never on the
 * automatic refresh interval.
 */
export interface CliRefreshSettings {
  claudeCommand: string
  codexCommand: string
}

export interface AppSettings {
  launchAtStartup: boolean
  refreshIntervalMinutes: 1 | 3 | 5 | 10 | 15 | 30
  minimizeToTray: boolean
  alwaysOnTop: boolean
  lockPosition: boolean
  snapToEdge: boolean
  autoCollapseWhenDocked: boolean
  hideFromTaskbar: boolean
  sizeMode: WidgetSizeMode
  appearance: "system" | "dark" | "light"
  opacity: number
  backgroundBlur: boolean
  demoMode: boolean
  debugLogs: boolean
  experimentalProviders: boolean
  thresholds: UsageThresholds
  notificationsEnabled: boolean
  taskbarCompanion: TaskbarCompanionSettings
  cliRefresh: CliRefreshSettings
  presentation: PresentationSettings
}
