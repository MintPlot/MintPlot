/**
 * Injection keys for the kernel services consumed by shell components.
 * The composition root (src/main.ts) provides them; shell components inject.
 */

import type { InjectionKey } from 'vue'
import type { PluginRuntime } from '@/kernel/runtime/runtime'
import type { KvStore } from '@/kernel/store/kv-store'

export const PLUGIN_RUNTIME_KEY: InjectionKey<PluginRuntime> = Symbol('plugin-runtime')

/** Kernel root KV — the plugin manager persists enable/disable preferences here. */
export const PLUGIN_SETTINGS_STORE_KEY: InjectionKey<KvStore> = Symbol('plugin-settings-store')
