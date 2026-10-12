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

/** Hand-tuned per family/mode; blobs sit mostly on-canvas and read clearly in
 *  both modes (the first cut parked them in the corners where they vanished). */
export const AURORA_RECIPES: Record<MpColorFamilyId, AuroraRecipe> = {
  mint: {
    light: mode(
      ['#DCEFE6', '#EFF9F3', '#E2F1EA'],
      [b('#5FD8AE', 0.5), b('#2BB39B', 0.28), b('#7BD8E8', 0.38), b('#A5E8C8', 0.3)],
      'rgba(140,240,200,0.08)',
    ),
    dark: mode(
      ['#08150F', '#0B1C16', '#061009'],
      [b('#17B08D', 0.38), b('#0F4A40', 0.55), b('#0D6E5E', 0.38), b('#0B5E72', 0.3)],
      'rgba(140,240,200,0.1)',
    ),
  },
  ocean: {
    light: mode(
      ['#D3E6F6', '#E8F1F9', '#DBE8F4'],
      [b('#6FB1E8', 0.55), b('#3D7FC4', 0.32), b('#8DE0E8', 0.4), b('#E8D9B8', 0.26)],
      'rgba(160,200,255,0.1)',
    ),
    dark: mode(
      ['#081020', '#0A1628', '#060C18'],
      [b('#2E7CD6', 0.4), b('#123B66', 0.55), b('#1E5FA8', 0.36), b('#0FA3C6', 0.26)],
      'rgba(160,200,255,0.1)',
    ),
  },
  cyan: {
    light: mode(
      ['#D8EEEB', '#EBF7F5', '#DDEEEB'],
      [b('#54CBBB', 0.48), b('#0E9488', 0.26), b('#7BC8E8', 0.34), b('#A8E8CE', 0.22)],
      'rgba(140,235,225,0.08)',
    ),
    dark: mode(
      ['#061110', '#081715', '#050D0B'],
      [b('#0FA08F', 0.36), b('#0C443E', 0.55), b('#0B6E64', 0.36), b('#0C6E8A', 0.24)],
      'rgba(140,235,225,0.08)',
    ),
  },
  forest: {
    light: mode(
      ['#DFEED8', '#EFF7EA', '#E2EFDC'],
      [b('#8CCB7E', 0.45), b('#43875F', 0.24), b('#C8E8B8', 0.34), b('#8CD8C0', 0.2)],
      'rgba(180,235,190,0.07)',
    ),
    dark: mode(
      ['#080F0A', '#0B140D', '#060B07'],
      [b('#3F9E62', 0.34), b('#1C4429', 0.55), b('#2F6B47', 0.36), b('#3E6E2F', 0.24)],
      'rgba(180,235,190,0.07)',
    ),
  },
  amber: {
    light: mode(
      ['#F0E3C8', '#F8F1E2', '#EFE2CB'],
      [b('#E0B45E', 0.5), b('#D9924E', 0.3), b('#F2E3C2', 0.5), b('#A8BCDD', 0.22)],
      'rgba(240,200,140,0.09)',
    ),
    dark: mode(
      ['#0D0A05', '#120D07', '#0A0704'],
      [b('#C88A2E', 0.36), b('#4A3312', 0.55), b('#8A5E1E', 0.36), b('#7A4028', 0.24)],
      'rgba(240,200,140,0.09)',
    ),
  },
  vermilion: {
    light: mode(
      ['#F2E4D8', '#FAF2EA', '#F0E3D6'],
      [b('#E09A82', 0.45), b('#B85450', 0.22), b('#EAC8B0', 0.4), b('#9CB8D0', 0.2)],
      'rgba(240,190,180,0.08)',
    ),
    dark: mode(
      ['#0F0A08', '#140D0B', '#0B0706'],
      [b('#C05A4A', 0.34), b('#4A211C', 0.55), b('#8A3A32', 0.36), b('#7A5A20', 0.22)],
      'rgba(240,190,180,0.08)',
    ),
  },
  rose: {
    light: mode(
      ['#F2E2EA', '#FAF1F5', '#EFE1E9'],
      [b('#E096B8', 0.45), b('#C2577F', 0.22), b('#F2D0DE', 0.4), b('#A8C8E8', 0.2)],
      'rgba(240,190,215,0.08)',
    ),
    dark: mode(
      ['#100A0D', '#150D11', '#0C070A'],
      [b('#C05888', 0.34), b('#4A1F32', 0.55), b('#8A3A5C', 0.36), b('#5E3A7A', 0.24)],
      'rgba(240,190,215,0.08)',
    ),
  },
  violet: {
    light: mode(
      ['#E4E0F0', '#F1EFF8', '#E6E2F1'],
      [b('#A494E0', 0.45), b('#7160BE', 0.26), b('#D9A8C4', 0.3), b('#94C8E0', 0.24)],
      'rgba(210,200,255,0.09)',
    ),
    dark: mode(
      ['#0A0812', '#0E0B18', '#070610'],
      [b('#7C68D0', 0.36), b('#2C2350', 0.55), b('#584698', 0.36), b('#2E5E8A', 0.24)],
      'rgba(210,200,255,0.09)',
    ),
  },
}

/** Fixed blob geometry — ellipses parked on-canvas (the corner-parked first
 *  cut swallowed the glows); shared by all recipes. */
const BLOB_LAYERS = [
  'radial-gradient(52% 44% at 12% 4%, %C 0%, transparent 70%)',
  'radial-gradient(46% 42% at 94% 24%, %C 0%, transparent 70%)',
  'radial-gradient(50% 44% at 4% 80%, %C 0%, transparent 70%)',
  'radial-gradient(42% 38% at 88% 90%, %C 0%, transparent 70%)',
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
