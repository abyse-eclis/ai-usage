import { useMemo, useState } from "react"
import type { ProviderId } from "../types/usage"

/**
 * Provider icons are real image assets, never letter badges. Assets are picked
 * up from `src/assets/providers` by filename, so dropping a better artwork in
 * that folder replaces the icon with no code change:
 *
 *   claude.svg          primary artwork (SVG preferred)
 *   claude.png          raster fallback, used only if the SVG fails to load
 *   claude.dark.svg     variant for dark surfaces (the taskbar)
 *   claude.light.svg    variant for light surfaces
 *   generic.svg         neutral placeholder for an unknown/broken provider
 *
 * If every candidate fails the icon is dropped from the layout and the usage
 * text stays -- it must never fall back to a "[C]" style text badge.
 */
const assetUrls = import.meta.glob("../../assets/providers/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default"
}) as Record<string, string>

/** Filename (without directory) -> bundled URL, e.g. "claude.dark.svg". */
const assetsByName = new Map<string, string>(
  Object.entries(assetUrls).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url])
)

export type IconSurface = "dark" | "light"

export const providerDisplayNames: Record<ProviderId, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  codex: "Codex"
}

/**
 * Per-provider artwork tweaks. `invertOn` is for monochrome artwork that only
 * reads on the opposite surface; a real `.dark`/`.light` variant file always
 * wins over inverting, because inversion also shifts brand colours.
 */
const providerIconTraits: Partial<Record<ProviderId, { invertOn?: IconSurface }>> = {}

/** Asset base names tried in order, most specific first. */
function candidateNames(provider: ProviderId, surface: IconSurface) {
  const bases = [provider, "generic"]
  const names: string[] = []
  for (const base of bases) {
    for (const suffix of [`.${surface}`, ""]) {
      for (const ext of ["svg", "png"]) names.push(`${base}${suffix}.${ext}`)
    }
  }
  return names
}

export function resolveProviderIconSources(provider: ProviderId, surface: IconSurface = "dark") {
  const seen = new Set<string>()
  const sources: string[] = []
  for (const name of candidateNames(provider, surface)) {
    const url = assetsByName.get(name)
    if (url && !seen.has(url)) {
      seen.add(url)
      sources.push(url)
    }
  }
  return sources
}

interface ProviderIconProps {
  provider: ProviderId
  /** Rendered edge length in CSS pixels. 14-16 suits the taskbar strip. */
  size?: number
  /** Surface the icon sits on, used to pick a light/dark variant. */
  surface?: IconSurface
  className?: string
}

export function ProviderIcon({ provider, size = 16, surface = "dark", className = "" }: ProviderIconProps) {
  const sources = useMemo(() => resolveProviderIconSources(provider, surface), [provider, surface])
  const [failed, setFailed] = useState(0)
  const src = sources[failed]

  // Every asset failed: keep the usage text, drop the icon. Never a letter.
  if (!src) return null

  const invert = providerIconTraits[provider]?.invertOn === surface

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={providerDisplayNames[provider]}
      data-provider-icon={provider}
      draggable={false}
      decoding="sync"
      className={`inline-block shrink-0 select-none rounded-[3px] object-contain align-middle drop-shadow-[0_1px_1px_rgb(0_0_0/0.45)] ${invert ? "invert" : ""} ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed((index) => index + 1)}
    />
  )
}
