# Provider icons

Every provider is identified in the UI by an **image icon**. Letter badges such
as `[C]` or `[G]` are not used anywhere, including as a fallback.

`ProviderIcon` (`src/shared/components/ProviderIcon.tsx`) discovers the files in
this folder by name at build time, so replacing the artwork is a drop-in: add or
overwrite a file here and nothing else changes.

## Filenames

| File               | Role                                                    |
| ------------------ | ------------------------------------------------------- |
| `claude.svg`       | Primary artwork. SVG is preferred.                      |
| `claude.png`       | Raster fallback, used only if the SVG fails to load.    |
| `claude.dark.svg`  | Variant for dark surfaces (the taskbar strip, popup).   |
| `claude.light.svg` | Variant for light surfaces.                             |
| `generic.svg`      | Neutral placeholder for an unknown or broken provider.  |

The base name is the provider id: `claude`, `chatgpt`, `codex`.

## Resolution order

For a given provider and surface, the first file that exists and loads wins:

1. `<provider>.<surface>.svg`
2. `<provider>.<surface>.png`
3. `<provider>.svg`
4. `<provider>.png`
5. `generic.svg`, `generic.png`

If every candidate fails, the icon is dropped from the layout and the usage text
stays. It never degrades to a text badge.

## Artwork guidelines

- Square, drawn on a 32x32 (or larger) viewBox. It renders at 14-16 px, so keep
  shapes simple and avoid hairlines that disappear when scaled down.
- Must read on a **dark** taskbar. Bake the contrast into the asset, or ship a
  `.dark` variant.
- Monochrome artwork that only works on the opposite surface can be inverted
  instead of duplicated, via `providerIconTraits` in `ProviderIcon.tsx`. A real
  `.dark`/`.light` file always beats inverting, because inversion also shifts
  brand colours.
- PNGs should be at least 32x32 (64x64 for high-DPI displays) to stay crisp.

## What ships today

`claude.svg` is the brand mark in Anthropic's orange, which reads on both light
and dark surfaces, so it needs no variant.

The OpenAI and Codex marks are monochrome and ship as a pair each: the base file
carries the dark ink for light surfaces, and the `.dark` file carries white ink
for the taskbar strip, the hover popup, and the widget. Without the `.dark`
variant those two marks would render near-black on the dark taskbar and
disappear.

`generic.svg` is the neutral placeholder. Replacing any of these with different
artwork requires no code change.
