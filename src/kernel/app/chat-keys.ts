/**
 * Shell injection keys for kernel-owned surfaces consumed by the chatbox UI
 * (kernel components — plugins never receive these directly).
 */

import type { InjectionKey } from 'vue'
import type { ChatboxStore } from '@/kernel/sessions/chatbox-store'
import type { SeamRegistry } from '@/kernel/runtime/seam-registry'
import type { SettingsState } from '@/kernel/settings/settings-state'

export const CHATBOX_STORE_KEY: InjectionKey<ChatboxStore> = Symbol('chatbox-store')

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
