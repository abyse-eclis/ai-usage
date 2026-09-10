/**
 * Colour for a remaining-percent reading, shared by the strip and the popup.
 *
 * This lives outside the component files on purpose: exporting a plain helper
 * alongside a component breaks React Fast Refresh, which then falls back to a
 * full page reload on every edit.
 */
export function remainingColor(remainingPercent?: number) {
  if (remainingPercent === undefined) return "text-[#a9a9a9]"
  if (remainingPercent <= 10) return "text-[hsl(var(--state-critical))]"
  if (remainingPercent <= 20) return "text-[hsl(var(--state-warning))]"
  return "text-white"
}
