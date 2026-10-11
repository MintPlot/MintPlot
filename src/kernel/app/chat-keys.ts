/**
 * Shell injection keys for kernel-owned surfaces consumed by the tab views
 * (kernel components — plugins never receive these directly).
 */

import type { InjectionKey } from 'vue'
import type { ChatboxStore } from '@/kernel/sessions/chatbox-store'
import type { CardSessionStore } from '@/kernel/sessions/card-session-store'
import type { CharacterStore } from '@/kernel/characters/character-store'
import type { HostSessionProjection } from '@/kernel/sessions/session-projection'
import type { SeamRegistry } from '@/kernel/runtime/seam-registry'
import type { SettingsState } from '@/kernel/settings/settings-state'
import type { VariableStore } from '@/kernel/variables/variable-store'
import type { WorldbookStore } from '@/kernel/worldinfo/worldbook-store'
import type { RegexStore } from '@/kernel/regex/regex-store'
import type { PresetStore } from '@/kernel/presets/preset-store'
import type { NstyleStore } from '@/kernel/nstyle/nstyle-store'
import type { MemoryStore } from '@/kernel/memory/memory-store'

export const CHATBOX_STORE_KEY: InjectionKey<ChatboxStore> = Symbol('chatbox-store')

/** Character card library access for the characters tab (M3-f). */
export const CHARACTER_STORE_KEY: InjectionKey<CharacterStore> = Symbol('character-store')

/** Card-domain session persistence, one session per card (M3-i). */
export const CARD_SESSION_STORE_KEY: InjectionKey<CardSessionStore> = Symbol('card-session-store')

/** Card-session variables ledger (M3-q) — card domain only, never chatbox. */
export const VARIABLE_STORE_KEY: InjectionKey<VariableStore> = Symbol('variable-store')

/** Worldbook per-entry toggle overrides (M3-u) — card domain only. */
export const WORLDBOOK_STORE_KEY: InjectionKey<WorldbookStore> = Symbol('worldbook-store')

/** Regex per-script toggle overrides (M3-v) — card domain only. */
export const REGEX_STORE_KEY: InjectionKey<RegexStore> = Symbol('regex-store')

/** Prompt presets (M3-w) — app-level configuration, every domain. */
export const PRESET_STORE_KEY: InjectionKey<PresetStore> = Symbol('preset-store')

/** 叙事风格配置器（M4-nstyle）— 自定义风格 CRUD、全局与故事级配置，app-level。 */
export const NSTYLE_STORE_KEY: InjectionKey<NstyleStore> = Symbol('nstyle-store')

/** Rolling-summary memory ledger (M4-e, `memory:<kind>:<id>`) — card domain
 *  first (the plugin declares sessions:['card']). */
export const MEMORY_STORE_KEY: InjectionKey<MemoryStore> = Symbol('memory-store')

/**
 * Host session projection — the card session page activates card-domain
 * values on mount (M3-i); TTS-style plugin consumers read them via ctx.
 */
export const SESSION_PROJECTION_KEY: InjectionKey<HostSessionProjection> = Symbol('session-projection')

/** Seam registry access for the chat page's provider resolution. */
export const SEAM_REGISTRY_KEY: InjectionKey<SeamRegistry> = Symbol('seam-registry')

/** Host settings state — kernel-owned sections bind the API config here. */
export const SETTINGS_STATE_KEY: InjectionKey<SettingsState> = Symbol('settings-state')

/**
 * Usage recording hook — the composition root wires the usage-stats organ's
 * recordApiUsage here (kernel modules must not import plugin modules; the
 * red line stays intact because the composition root is the only bridge).
 */
export type UsageRecorder = (usage: unknown, meta: Record<string, string>) => void
export const USAGE_RECORDER_KEY: InjectionKey<UsageRecorder> = Symbol('usage-recorder')
