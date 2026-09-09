export type WidgetSizeMode = "small" | "medium" | "large" | "custom"

export interface WidgetPreset {
  mode: Exclude<WidgetSizeMode, "custom">
  width: number
  height: number
}

export interface WidgetLayoutSnapshot {
  width: number
  height: number
}
