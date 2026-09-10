import type { UsageThresholds } from "../../../shared/utils/thresholds"
import type { WidgetSizeMode } from "../../widget/types/widget"

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
}
