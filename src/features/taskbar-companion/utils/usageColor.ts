import { getUsageSeverity, type UsageThresholds } from "../../../shared/utils/thresholds"

/**
 * Colour for a usage reading, shared by the strip and the popup.
 *
 * The companion shows how much of a window has been consumed, so a high number
 * is the alarming one. Severity comes from the same thresholds the Main Widget
 * uses, so a limit that reads as critical in one place reads that way in both.
 *
 * This lives outside the component files on purpose: exporting a plain helper
 * alongside a component breaks React Fast Refresh, which then falls back to a
 * full page reload on every edit.
 */
export function usageColor(usedPercent?: number, thresholds?: UsageThresholds) {
  if (usedPercent === undefined) return "text-[#a9a9a9]"
  const severity = getUsageSeverity(usedPercent, thresholds)
  if (severity === "critical") return "text-[hsl(var(--state-critical))]"
  if (severity === "high" || severity === "warning") return "text-[hsl(var(--state-warning))]"
  return "text-white"
}
