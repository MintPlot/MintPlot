import { ref } from 'vue'
import type { MpTheme } from './theme'
import type { MpColorFamily, MpColorFamilyId } from './color-families'

/**
 * Acrylic material layer (theme v3): aurora background stacks + glass
 * recipes per color family, modulated by two user sliders (glow intensity,
 * glass transparency). The aurora is pure CSS background layers on body —
 * no DOM nodes, no blur filters. Frosted surfaces come from .mp-glass
 * (fixed chrome, backdrop-filter) and .mp-surface (scrolling content,
 * translucent only) in base.css.
 */

export interface AuroraBlob {
  readonly hex: string
  readonly alpha: number
}

export interface AuroraMode {
  /** Base gradient stops (0% / 46% / 100%). */
  readonly base: readonly [string, string, string]
  /** Four hue blobs: main / neighbor / variant / counterpoint. */
  readonly blobs: readonly [AuroraBlob, AuroraBlob, AuroraBlob, AuroraBlob]
  /** Dark-mode inner top highlight for glass; light always uses white. */
  readonly edge: string
}

export interface AuroraRecipe {
  readonly light: AuroraMode
  readonly dark: AuroraMode
}

const b = (hex: string, alpha: number): AuroraBlob => ({ hex, alpha })
const mode = (
  base: readonly [string, string, string],
  blobs: readonly [AuroraBlob, AuroraBlob, AuroraBlob, AuroraBlob],
  edge: string,
): AuroraMode => ({ base, blobs, edge })

/** Hand-tuned per family/mode; mint + ocean mirror the approved preview. */
export const AURORA_RECIPES: Record<MpColorFamilyId, AuroraRecipe> = {
  mint: {
    light: mode(
      ['#EDF6F1', '#F6FBF8', '#EBF4EF'],
      [b('#8DEAC4', 0.5), b('#2BB39B', 0.24), b('#7BD8E8', 0.3), b('#8DEAC4', 0.18)],
      'rgba(140,240,200,0.08)',
    ),
    dark: mode(
      ['#071310', '#0A1815', '#060F0D'],
      [b('#146E5F', 0.55), b('#1B6F70', 0.38), b('#2BB39B', 0.14), b('#0F8A9E', 0.16)],
      'rgba(140,240,200,0.08)',
    ),
  },
  ocean: {
    light: mode(
      ['#D8E8F6', '#E9F1F8', '#DFE9F3'],
      [b('#7BB8E8', 0.6), b('#3D7FC4', 0.34), b('#8DE0E8', 0.42), b('#E8D9B8', 0.3)],
      'rgba(160,200,255,0.1)',
    ),
    dark: mode(
      ['#0A1424', '#0C172A', '#081020'],
      [b('#1E5FA8', 0.5), b('#0FA3C6', 0.26), b('#2D6EB8', 0.34), b('#7A5A28', 0.16)],
      'rgba(160,200,255,0.1)',
    ),
  },
  cyan: {
    light: mode(
      ['#E4F2F1', '#EDF7F6', '#E0F0EE'],
      [b('#7BD8CB', 0.45), b('#0E9488', 0.26), b('#8DD8E8', 0.34), b('#B8E8D9', 0.2)],
      'rgba(140,235,225,0.08)',
    ),
    dark: mode(
      ['#081413', '#0B1917', '#06110F'],
      [b('#0B6E64', 0.5), b('#0FA3A8', 0.26), b('#128A7C', 0.32), b('#0F7A9E', 0.15)],
      'rgba(140,235,225,0.08)',
    ),
  },
  forest: {
    light: mode(
      ['#EAF2E6', '#F2F8EF', '#E6EFE1'],
      [b('#A8D89C', 0.42), b('#43875F', 0.24), b('#C8E8B8', 0.34), b('#9CD8C8', 0.18)],
      'rgba(180,235,190,0.07)',
    ),
    dark: mode(
      ['#0B140E', '#0E1A12', '#08110B'],
      [b('#2F6347', 0.48), b('#4C8A5E', 0.28), b('#356B4C', 0.3), b('#6E8A4A', 0.14)],
      'rgba(180,235,190,0.07)',
    ),
  },
  amber: {
    light: mode(
      ['#F4ECD9', '#FAF4E7', '#F1E8D4'],
      [b('#E8C173', 0.42), b('#D9924E', 0.3), b('#F2E3C2', 0.55), b('#B8C4D9', 0.22)],
      'rgba(240,200,140,0.09)',
    ),
    dark: mode(
      ['#110D07', '#171109', '#0F0B06'],
      [b('#8A5A1E', 0.5), b('#B8802A', 0.3), b('#E5A54B', 0.14), b('#8A4A3E', 0.14)],
      'rgba(240,200,140,0.09)',
    ),
  },
  vermilion: {
    light: mode(
      ['#F5EEE4', '#FAF4EC', '#F1E9DC'],
      [b('#E0A898', 0.36), b('#B85450', 0.22), b('#EAC8B0', 0.42), b('#9CB8D0', 0.18)],
      'rgba(240,190,180,0.08)',
    ),
    dark: mode(
      ['#120E0C', '#181210', '#0E0B09'],
      [b('#7A3A36', 0.48), b('#9C4541', 0.28), b('#D4756B', 0.13), b('#8A6A28', 0.12)],
      'rgba(240,190,180,0.08)',
    ),
  },
  rose: {
    light: mode(
      ['#F5ECF0', '#FBF4F7', '#F1E8ED'],
      [b('#E8B0C8', 0.4), b('#C2577F', 0.22), b('#F2D0DE', 0.42), b('#B8D0E8', 0.2)],
      'rgba(240,190,215,0.08)',
    ),
    dark: mode(
      ['#120D10', '#181115', '#0E0A0C'],
      [b('#8A3A5C', 0.48), b('#A04A6E', 0.26), b('#DA7FA7', 0.14), b('#7A5A9E', 0.14)],
      'rgba(240,190,215,0.08)',
    ),
  },
  violet: {
    light: mode(
      ['#EEECF4', '#F5F4F9', '#EBE9F2'],
      [b('#B9AEE8', 0.38), b('#8F7CC8', 0.28), b('#D9A8C4', 0.26), b('#A8D8E8', 0.22)],
      'rgba(210,200,255,0.09)',
    ),
    dark: mode(
      ['#0B0A12', '#0E0D17', '#090810'],
      [b('#4A3A8C', 0.5), b('#6F5AB8', 0.3), b('#B06A9C', 0.2), b('#3A6E9E', 0.18)],
      'rgba(210,200,255,0.09)',
    ),
  },
}

/** Fixed blob geometry (viewport-relative ellipses, shared by all recipes). */
const BLOB_LAYERS = [
  'radial-gradient(56% 44% at 6% -6%, %C 0%, transparent 72%)',
  'radial-gradient(50% 46% at 106% 32%, %C 0%, transparent 72%)',
  'radial-gradient(54% 42% at -8% 106%, %C 0%, transparent 72%)',
  'radial-gradient(38% 36% at 96% 76%, %C 0%, transparent 72%)',
] as const

const BASE_ANGLE = 168

/* ── Slider state (shell-level appearance domain, same as mp_color_family) ── */

export const GLOW_MIN = 0
export const GLOW_MAX = 150
export const GLOW_DEFAULT = 100
export const GLASS_T_MIN = 10
export const GLASS_T_MAX = 70
export const GLASS_T_DEFAULT = 45

const GLOW_KEY = 'mp_acrylic_glow'
const GLASS_KEY = 'mp_acrylic_glass'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const readStoredInt = (key: string, min: number, max: number, fallback: number): number => {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = Number.parseInt(localStorage.getItem(key) ?? '', 10)
    return Number.isFinite(raw) ? clamp(raw, min, max) : fallback
  } catch {
    return fallback
  }
}

export const acrylicGlow = ref(GLOW_DEFAULT)
export const acrylicTransparency = ref(GLASS_T_DEFAULT)

/** Composition-root bootstrap: re-read persisted slider values. */
export function initAcrylicSliders(): void {
  acrylicGlow.value = readStoredInt(GLOW_KEY, GLOW_MIN, GLOW_MAX, GLOW_DEFAULT)
  acrylicTransparency.value = readStoredInt(GLASS_KEY, GLASS_T_MIN, GLASS_T_MAX, GLASS_T_DEFAULT)
}

/** True when no inline material overrides are needed for the default family. */
export function slidersAtDefault(): boolean {
  return acrylicGlow.value === GLOW_DEFAULT && acrylicTransparency.value === GLASS_T_DEFAULT
}

export function useAcrylicSliders() {
  const setGlow = (value: number): void => {
    acrylicGlow.value = clamp(Math.round(value), GLOW_MIN, GLOW_MAX)
    try {
      localStorage.setItem(GLOW_KEY, String(acrylicGlow.value))
    } catch {
      /* persistence failure must not block the tweak */
    }
  }
  const setTransparency = (value: number): void => {
    acrylicTransparency.value = clamp(Math.round(value), GLASS_T_MIN, GLASS_T_MAX)
    try {
      localStorage.setItem(GLASS_KEY, String(acrylicTransparency.value))
    } catch {
      /* persistence failure must not block the tweak */
    }
  }
  return { glow: acrylicGlow, transparency: acrylicTransparency, setGlow, setTransparency }
}

/* ── Material variable builder ── */

const HEX6 = /^#[0-9a-fA-F]{6}$/

const rgbOf = (hex: string): [number, number, number] => {
  if (!HEX6.test(hex)) throw new Error(`[acrylic] invalid hex: ${hex}`)
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

const fmtAlpha = (alpha: number): string => String(Math.round(alpha * 100) / 100)

const rgbaOf = (rgb: readonly [number, number, number], alpha: number): string =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${fmtAlpha(alpha)})`

/**
 * Transparency percent → surface alpha. Chrome glass runs the raw mapping;
 * scrolling content stays slightly more opaque for text readability
 * (dark mode +0.02 vs light, matching the approved dark preview).
 */
const chromeAlphaOf = (transparency: number): number => clamp(1 - transparency, 0.3, 0.9)
const contentAlphaOf = (transparency: number, mode: MpTheme): number =>
  clamp(1.17 - transparency + (mode === 'dark' ? 0.02 : 0), 0.45, 0.95)

export function buildMaterialVars(
  family: MpColorFamily,
  mode: MpTheme,
  glowPercent: number = GLOW_DEFAULT,
  transparencyPercent: number = GLASS_T_DEFAULT,
): Record<string, string> {
  const aurora = AURORA_RECIPES[family.id][mode]
  const glow = glowPercent / 100
  const layers = [
    `linear-gradient(${BASE_ANGLE}deg, ${aurora.base[0]} 0%, ${aurora.base[1]} 46%, ${aurora.base[2]} 100%)`,
  ]
  aurora.blobs.forEach((blob, index) => {
    const alpha = Math.min(1, blob.alpha * glow)
    if (alpha < 0.01) return // glow at zero drops the layer entirely
    const layer = BLOB_LAYERS[index]!
    layers.push(layer.replace('%C', rgbaOf(rgbOf(blob.hex), alpha)))
  })

  const transparency = transparencyPercent / 100
  const chromeAlpha = chromeAlphaOf(transparency)
  const contentAlpha = contentAlphaOf(transparency, mode)
  const surfaceRgb: readonly [number, number, number] =
    mode === 'dark' ? rgbOf(family.dark.bg) : [255, 255, 255]
  const accent = rgbOf(family[mode].accent)
  const primaryHi: readonly [number, number, number] = [
    Math.round(accent[0]! + 0.2 * (255 - accent[0]!)),
    Math.round(accent[1]! + 0.2 * (255 - accent[1]!)),
    Math.round(accent[2]! + 0.2 * (255 - accent[2]!)),
  ]

  return {
    '--mp-bg-image': layers.join(', '),
    '--mp-glass-bg': rgbaOf(surfaceRgb, chromeAlpha),
    '--mp-glass-border':
      mode === 'dark' ? rgbaOf(rgbOf(family.dark.ink), 0.16) : 'rgba(255,255,255,0.7)',
    '--mp-glass-solid': rgbaOf(surfaceRgb, 0.88),
    '--mp-glass-edge': mode === 'dark' ? aurora.edge : 'rgba(255,255,255,0.8)',
    '--mp-card-fill-alpha': fmtAlpha(contentAlpha),
    '--mp-surface-ai-bubble': rgbaOf(rgbOf(family[mode].aiBubble), contentAlpha),
    '--mp-c-primary-hi': primaryHi.join(' '),
  }
}

/** Every inline material variable a family application may own. */
export const MATERIAL_VARS = [
  '--mp-bg-image',
  '--mp-glass-bg',
  '--mp-glass-border',
  '--mp-glass-solid',
  '--mp-glass-edge',
  '--mp-card-fill-alpha',
  '--mp-surface-ai-bubble',
  '--mp-c-primary-hi',
] as const
