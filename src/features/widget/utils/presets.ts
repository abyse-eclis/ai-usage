import type { WidgetLayoutSnapshot, WidgetPreset, WidgetSizeMode } from "../types/widget"

export const widgetPresets: Record<Exclude<WidgetSizeMode, "custom">, WidgetPreset> = {
  small: { mode: "small", width: 220, height: 180 },
  medium: { mode: "medium", width: 250, height: 240 },
  large: { mode: "large", width: 300, height: 360 }
}

export function inferWidgetMode(size: WidgetLayoutSnapshot): WidgetSizeMode {
  if (size.width < 235 || size.height < 210) return "small"
  if (size.width >= 285 && size.height >= 330) return "large"
  return "medium"
}

export function presetFromSize(size: WidgetLayoutSnapshot): WidgetSizeMode {
  const tolerance = 16
  for (const preset of Object.values(widgetPresets)) {
    const matchesWidth = Math.abs(size.width - preset.width) <= tolerance
    const matchesHeight = Math.abs(size.height - preset.height) <= tolerance
    if (matchesWidth && matchesHeight) return preset.mode
  }
  return "custom"
}
