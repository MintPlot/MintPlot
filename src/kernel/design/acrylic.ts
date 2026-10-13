import { ref } from 'vue'
import type { MpTheme } from './theme'
import type { MpColorFamilyId } from './color-families'

/**
 * Theme v3 material recipes (replica route): the values below are extracted
 * verbatim from the approved mockup (mp-mint-v2-reference.html / the original
 * five-variant carousel). The aurora is REAL blurred DOM blobs — never a
 * gradient approximation; the feel dies in that translation.
 *
 * Families without a mockup variant (cyan/forest/vermilion/rose) follow the
 * same structure derived from their color-families hues (noted in the plan).
 */

export interface AuroraBlob {
  readonly hex: string
  readonly alpha: number
}

export interface MaterialMode {
  /** Base gradient behind the blobs — verbatim from the mockup (per-mode
   *  angle AND mid-stop: mint light 46% vs dark 44%, ocean light 48%). */
  readonly base: string
  readonly blobs: readonly [AuroraBlob, AuroraBlob, AuroraBlob, AuroraBlob]
  /** Frosted chrome fill, full rgba() as in the mockup. */
  readonly surf: string
  readonly hairline: string
  readonly edge: string
  readonly surfShadow: string
  /** AI floor bubble fill (translucent, blurred via .mp-bubble). */
  readonly aiBubble: string
  /** Accent gradient bright end (user bubble / send button). */
  readonly accentHi: string
  readonly accentShadow: string
}

export type MaterialRecipe = Readonly<{ light: MaterialMode; dark: MaterialMode }>

const recipe = (light: MaterialMode, dark: MaterialMode): MaterialRecipe => ({ light, dark })
const mode = (
  base: string,
  blobs: readonly [AuroraBlob, AuroraBlob, AuroraBlob, AuroraBlob],
  surf: string,
  hairline: string,
  edge: string,
  surfShadow: string,
  aiBubble: string,
  accentHi: string,
  accentShadow: string,
): MaterialMode => ({ base, blobs, surf, hairline, edge, surfShadow, aiBubble, accentHi, accentShadow })

const b = (hex: string, alpha: number): AuroraBlob => ({ hex, alpha })

/** Blob geometry — viewport-relative translation of the mockup's pixel blobs
 *  (300px-wide screen): 120%/48% top-left, 107%/58% right, 110%/43.5%
 *  bottom-left, 77%/37% bottom-right; blur stays a fixed 55px. */
export const AURORA_BLOB_GEOMETRY = [
  { width: '120%', height: '48.4%', left: '-23.3%', top: '-14.5%' },
  { width: '106.7%', height: '58.1%', right: '-43.3%', top: '17.7%' },
  { width: '110%', height: '43.5%', left: '-16.7%', bottom: '-11.3%' },
  { width: '76.7%', height: '37.1%', right: '-16.7%', bottom: '21%' },
] as const

export const MATERIAL_RECIPES: Record<MpColorFamilyId, MaterialRecipe> = {
  mint: recipe(
    mode('linear-gradient(168deg, #EDF6F1 0%, #F6FBF8 46%, #EBF4EF 100%)',
      [b('#8DEAC4', 0.5), b('#2BB39B', 0.24), b('#7BD8E8', 0.3), b('#8DEAC4', 0.18)],
      'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0.85)',
      'rgba(16,40,34,0.18)', 'rgba(255,255,255,0.62)', '#46C7AC', 'rgba(43,179,155,0.35)'),
    mode('linear-gradient(170deg, #071310 0%, #0A1815 44%, #060F0D 100%)',
      [b('#146E5F', 0.55), b('#1B6F70', 0.38), b('#2BB39B', 0.14), b('#0F8A9E', 0.16)],
      'rgba(12,24,21,0.55)', 'rgba(200,235,220,0.14)', 'rgba(140,240,200,0.08)',
      'rgba(0,0,0,0.45)', 'rgba(16,32,28,0.5)', '#35C4A8', 'rgba(43,179,155,0.4)'),
  ),
  ocean: recipe(
    mode('linear-gradient(160deg, #D8E8F6 0%, #E9F1F8 48%, #DFE9F3 100%)',
      [b('#7BB8E8', 0.6), b('#3D7FC4', 0.34), b('#8DE0E8', 0.42), b('#E8D9B8', 0.3)],
      'rgba(255,255,255,0.52)', 'rgba(255,255,255,0.65)', 'rgba(255,255,255,0.8)',
      'rgba(23,42,66,0.22)', 'rgba(255,255,255,0.6)', '#57A0E6', 'rgba(46,124,214,0.4)'),
    mode('linear-gradient(168deg, #0A1424 0%, #0C172A 46%, #081020 100%)',
      [b('#1E5FA8', 0.5), b('#0FA3C6', 0.26), b('#2D6EB8', 0.34), b('#7A5A28', 0.16)],
      'rgba(13,22,40,0.52)', 'rgba(255,255,255,0.12)', 'rgba(160,200,255,0.1)',
      'rgba(0,0,0,0.45)', 'rgba(18,30,52,0.55)', '#4E97DA', 'rgba(61,127,196,0.45)'),
  ),
  cyan: recipe(
    mode('linear-gradient(168deg, #E0F0EE 0%, #EDF7F5 46%, #DCEEEB 100%)',
      [b('#7DD8CB', 0.5), b('#0E9488', 0.24), b('#7BC8E8', 0.3), b('#A8E8CE', 0.18)],
      'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0.85)',
      'rgba(10,40,36,0.18)', 'rgba(255,255,255,0.62)', '#2BBFAF', 'rgba(14,148,136,0.35)'),
    mode('linear-gradient(170deg, #061110 0%, #0A1817 44%, #050D0B 100%)',
      [b('#0B6E64', 0.55), b('#116F70', 0.38), b('#2BB39B', 0.14), b('#0F8A9E', 0.16)],
      'rgba(10,22,20,0.55)', 'rgba(200,235,230,0.14)', 'rgba(140,235,225,0.08)',
      'rgba(0,0,0,0.45)', 'rgba(14,30,28,0.5)', '#2DD4BF', 'rgba(11,110,100,0.4)'),
  ),
  forest: recipe(
    mode('linear-gradient(168deg, #E9F1E4 0%, #F3F8EF 46%, #E4EFE0 100%)',
      [b('#94C88A', 0.5), b('#43875F', 0.24), b('#B4D896', 0.3), b('#96D8BE', 0.18)],
      'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0.85)',
      'rgba(20,40,24,0.18)', 'rgba(255,255,255,0.62)', '#55A374', 'rgba(67,135,95,0.35)'),
    mode('linear-gradient(170deg, #0A120C 0%, #0F1A12 44%, #080F0A 100%)',
      [b('#356B4C', 0.55), b('#4C8A5E', 0.38), b('#7CC08B', 0.14), b('#6E8A4A', 0.16)],
      'rgba(14,22,16,0.55)', 'rgba(220,240,225,0.14)', 'rgba(180,235,190,0.08)',
      'rgba(0,0,0,0.45)', 'rgba(20,30,23,0.5)', '#7CC08B', 'rgba(53,107,76,0.4)'),
  ),
  amber: recipe(
    mode('linear-gradient(162deg, #F4ECD9 0%, #FAF4E7 46%, #F1E8D4 100%)',
      [b('#E8C173', 0.42), b('#D9924E', 0.3), b('#F2E3C2', 0.55), b('#B8C4D9', 0.22)],
      'rgba(255,255,255,0.5)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.8)',
      'rgba(60,45,20,0.2)', 'rgba(255,255,255,0.58)', '#DA9534', 'rgba(192,122,29,0.35)'),
    mode('linear-gradient(166deg, #110D07 0%, #171109 46%, #0F0B06 100%)',
      [b('#8A5A1E', 0.5), b('#B8802A', 0.3), b('#E5A54B', 0.14), b('#8A4A3E', 0.14)],
      'rgba(30,22,12,0.55)', 'rgba(240,230,210,0.13)', 'rgba(240,200,140,0.09)',
      'rgba(0,0,0,0.45)', 'rgba(36,27,15,0.52)', '#C68A28', 'rgba(162,103,18,0.4)'),
  ),
  vermilion: recipe(
    mode('linear-gradient(168deg, #F4EBE2 0%, #FBF5ED 46%, #F2E9DE 100%)',
      [b('#E09A82', 0.5), b('#B85450', 0.24), b('#EAC8B0', 0.3), b('#C8D8E8', 0.18)],
      'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0.85)',
      'rgba(60,30,24,0.18)', 'rgba(255,255,255,0.62)', '#C96B66', 'rgba(184,84,80,0.35)'),
    mode('linear-gradient(170deg, #120D0B 0%, #181110 44%, #0D0908 100%)',
      [b('#9C4541', 0.55), b('#D4756B', 0.38), b('#8A6A28', 0.14), b('#8A4A3E', 0.16)],
      'rgba(24,17,15,0.55)', 'rgba(240,225,220,0.14)', 'rgba(240,190,180,0.08)',
      'rgba(0,0,0,0.45)', 'rgba(34,24,22,0.5)', '#D4756B', 'rgba(156,69,65,0.4)'),
  ),
  rose: recipe(
    mode('linear-gradient(168deg, #F5EAF0 0%, #FBF4F8 46%, #F2E7EE 100%)',
      [b('#E096B8', 0.5), b('#C2577F', 0.24), b('#F2D0DE', 0.3), b('#A8C8E8', 0.18)],
      'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0.85)',
      'rgba(60,26,40,0.18)', 'rgba(255,255,255,0.62)', '#CE6F94', 'rgba(194,87,127,0.35)'),
    mode('linear-gradient(170deg, #130D11 0%, #191218 44%, #0E0A0D 100%)',
      [b('#A04A6E', 0.55), b('#DA7FA7', 0.38), b('#7A5A9E', 0.14), b('#8A4A3E', 0.16)],
      'rgba(25,17,21,0.55)', 'rgba(240,225,235,0.14)', 'rgba(240,190,215,0.08)',
      'rgba(0,0,0,0.45)', 'rgba(36,24,30,0.5)', '#DA7FA7', 'rgba(160,74,110,0.4)'),
  ),
  violet: recipe(
    mode('linear-gradient(166deg, #EEECF4 0%, #F5F4F9 46%, #EBE9F2 100%)',
      [b('#B9AEE8', 0.38), b('#8F7CC8', 0.28), b('#D9A8C4', 0.26), b('#A8D8E8', 0.22)],
      'rgba(255,255,255,0.52)', 'rgba(255,255,255,0.65)', 'rgba(255,255,255,0.8)',
      'rgba(30,26,50,0.2)', 'rgba(255,255,255,0.6)', '#8A79D2', 'rgba(113,96,190,0.35)'),
    mode('linear-gradient(166deg, #0B0A12 0%, #0E0D17 46%, #090810 100%)',
      [b('#4A3A8C', 0.5), b('#6F5AB8', 0.3), b('#B06A9C', 0.2), b('#3A6E9E', 0.18)],
      'rgba(19,17,29,0.55)', 'rgba(230,225,245,0.13)', 'rgba(210,200,255,0.09)',
      'rgba(0,0,0,0.45)', 'rgba(26,23,38,0.52)', '#7C6BD0', 'rgba(95,81,168,0.4)'),
  ),
}

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

/* ── Builders ── */

const RGBA = /^rgba\((\d+),(\d+),(\d+),([0-9.]+)\)$/

const rgbaParts = (rgba: string): { rgb: [number, number, number]; alpha: number } => {
  const m = RGBA.exec(rgba.replace(/\s+/g, ''))
  if (!m) throw new Error(`[acrylic] invalid rgba in recipe: ${rgba}`)
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) }
}

const rgbaOf = (rgb: readonly [number, number, number], alpha: number): string =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.round(alpha * 100) / 100})`

const HEX6 = /^#[0-9a-fA-F]{6}$/

const rgbOf = (hex: string): [number, number, number] => {
  if (!HEX6.test(hex)) throw new Error(`[acrylic] invalid hex: ${hex}`)
  const v = Number.parseInt(hex.slice(1), 16)
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

/** '#46C7AC' → '70 199 172' (tokens.css RGB-triplet discipline). */
const hexTriplet = (hex: string): string => {
  const [r, g, b2] = rgbOf(hex)
  return `${r} ${g} ${b2}`
}

/** Glass chrome fill alpha — no backdrop-filter (it leaks rectangular bands
 *  on some chromium compositors, user-confirmed), so the fill itself carries
 *  the frosted read: more opaque than the mockup's 0.55, anchored so the
 *  transparency slider's default (45%) lands on 0.78.
 *  The bubble keeps its mockup translucency — it only ever floats over the
 *  static aurora, where the blur had nothing to show anyway. */
const chromeAlphaOf = (transparencyPercent: number): number =>
  clamp(1.23 - transparencyPercent / 100, 0.5, 0.95)

/** Bubble fill ratio around the mockup anchor (t=45 → 1). */
const glassRatioOf = (transparencyPercent: number): number =>
  clamp((1 - transparencyPercent / 100) / (1 - GLASS_T_DEFAULT / 100), 0.5, 1.73)

/** CSS variables for the frosted surfaces (consumed by base.css classes). */
export function buildMaterialVars(
  familyId: MpColorFamilyId,
  mode: MpTheme,
  transparencyPercent: number = GLASS_T_DEFAULT,
): Record<string, string> {
  const material = MATERIAL_RECIPES[familyId][mode]
  const ratio = glassRatioOf(transparencyPercent)
  const surf = rgbaParts(material.surf)
    const surfAlpha = chromeAlphaOf(transparencyPercent)
  const ai = rgbaParts(material.aiBubble)
  return {
    '--mp-aurora-base': material.base,
    '--mp-glass-bg': rgbaOf(surf.rgb, surfAlpha),
    '--mp-glass-border': material.hairline,
    '--mp-glass-edge': material.edge,
    '--mp-glass-shadow': material.surfShadow,
    '--mp-accent-shadow': material.accentShadow,
    '--mp-surface-ai-bubble': rgbaOf(ai.rgb, clamp(ai.alpha * ratio, 0.35, 0.95)),
    '--mp-c-primary-hi': hexTriplet(material.accentHi),
    '--mp-card-fill-alpha': String(Math.round(clamp(1.17 - transparencyPercent / 100 + (mode === 'dark' ? 0.02 : 0), 0.45, 0.95) * 100) / 100),
  }
}

/** Every inline material variable a family application may own. */
export const MATERIAL_VARS = [
  '--mp-aurora-base',
  '--mp-glass-bg',
  '--mp-glass-border',
  '--mp-glass-edge',
  '--mp-glass-shadow',
  '--mp-accent-shadow',
  '--mp-surface-ai-bubble',
  '--mp-c-primary-hi',
  '--mp-card-fill-alpha',
] as const

/** Blob fills for AuroraLayer — glow scales each blob's alpha; at glow 0 the
 *  blobs go fully transparent and only the base gradient remains. */
export function auroraBlobStyles(
  familyId: MpColorFamilyId,
  mode: MpTheme,
  glowPercent: number = GLOW_DEFAULT,
): string[] {
  const glow = clamp(glowPercent, GLOW_MIN, GLOW_MAX) / 100
  return MATERIAL_RECIPES[familyId][mode].blobs.map((blob) => {
    const alpha = Math.round(blob.alpha * glow * 100) / 100
    return alpha < 0.01 ? 'transparent' : rgbaOf(rgbOf(blob.hex), alpha)
  })
}
