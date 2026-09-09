import type { WidgetLayoutSnapshot, WidgetPreset, WidgetSizeMode } from "../types/widget"

export const widgetPresets: Record<Exclude<WidgetSizeMode, "custom">, WidgetPreset> = {
  small: { mode: "small", width: 320, height: 240 },
  medium: { mode: "medium", width: 420, height: 560 },
  large: { mode: "large", width: 640, height: 760 }
}

export function inferWidgetMode(size: WidgetLayoutSnapshot): WidgetSizeMode {
  if (size.width < 380 || size.height < 340) return "small"
  if (size.width >= 580 && size.height >= 660) return "large"
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
