import type { WidgetLayoutSnapshot, WidgetPreset, WidgetSizeMode } from "../types/widget"

export const widgetPresets: Record<Exclude<WidgetSizeMode, "custom">, WidgetPreset> = {
  small: { mode: "small", width: 260, height: 180 },
  medium: { mode: "medium", width: 320, height: 420 },
  large: { mode: "large", width: 460, height: 600 }
}

export function inferWidgetMode(size: WidgetLayoutSnapshot): WidgetSizeMode {
  if (size.width < 300 || size.height < 260) return "small"
  if (size.width >= 430 && size.height >= 540) return "large"
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
