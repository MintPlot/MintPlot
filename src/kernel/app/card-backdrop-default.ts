/**
 * Global card-backdrop default (1.0.x): the blur/dim values an untouched
 * card follows. Shell-level appearance domain — localStorage, same home as
 * the theme prefs (mp_theme_pref/mp_color_family precedent), NOT mp_settings.
 * A card that has its own backdrop tuning in its session envelope overrides
 * this; clearing the per-card tuning (恢复跟随全局) falls back here.
 */
import { ref, watch } from 'vue'

const STORAGE_KEY = 'mp_card_bg'

export interface CardBackdropDefault {
  /** Blur radius in px (0–40). */
  blur: number
  /** Dim overlay opacity in % (0–80). */
  dim: number
}

export const CARD_BG_ABSOLUTE_DEFAULT: CardBackdropDefault = { blur: 40, dim: 45 }

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min

/** Storage/whatever → validated default; corrupt/missing fields fall back to
 *  the shipped values field-wise (a half-written entry must not turn into a
 *  fully bright backdrop). */
export const sanitizeCardBackdropDefault = (raw: unknown): CardBackdropDefault => {
  const base = raw && typeof raw === 'object' ? (raw as Partial<CardBackdropDefault>) : {}
  const num = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
  }
  return {
    blur: num(base.blur, CARD_BG_ABSOLUTE_DEFAULT.blur, 0, 40),
    dim: num(base.dim, CARD_BG_ABSOLUTE_DEFAULT.dim, 0, 80),
  }
}

const readStorage = (): CardBackdropDefault => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...CARD_BG_ABSOLUTE_DEFAULT }
    return sanitizeCardBackdropDefault(JSON.parse(raw))
  } catch {
    return { ...CARD_BG_ABSOLUTE_DEFAULT }
  }
}

/** Reactive module state: the settings section binds to it, the chat view
 *  reads it — a global change restyles untouched cards without reload. */
export const cardBackdropDefault = ref<CardBackdropDefault>(readStorage())

watch(cardBackdropDefault, (value) => {
  const blur = clamp(value.blur, 0, 40)
  const dim = clamp(value.dim, 0, 80)
  // Re-assign only when clamping actually bit — a fresh object every run
  // would re-trigger this watch forever.
  if (blur !== value.blur || dim !== value.dim) {
    cardBackdropDefault.value = { blur, dim }
    return
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ blur, dim }))
  } catch {
    // Storage unavailable (private mode): the session keeps the values in
    // memory only — same graceful fallback the theme prefs accept.
  }
}, { deep: true })
