/**
 * Tools-tab accordion state (M3-h) — the three collapse levels (area /
 * plugin group / plugin entry) persist across launches under the kernel KV
 * key `tools-ui-state`. Absence = collapsed: every level starts folded, the
 * user's toggles opt levels open.
 */

import { reactive } from 'vue'
import type { InjectionKey } from 'vue'
import type { KvStore } from '@/kernel/store/kv-store'

const STORAGE_KEY = 'tools-ui-state'

export interface ToolsUiState {
  /** Region level: 'plugins' | `view:<pluginId>:<viewId>` → open? */
  areas: Record<string, boolean>
  /** Group level: 'system' | 'extension' → open? */
  groups: Record<string, boolean>
  /** Entry level: plugin id → config expanded? */
  plugins: Record<string, boolean>
}

export interface ToolsUi {
  readonly state: ToolsUiState
  persist(): void
}

export const TOOLS_UI_KEY: InjectionKey<ToolsUi> = Symbol('tools-ui')

export function createToolsUi(store: KvStore | null): ToolsUi {
  const state = reactive<ToolsUiState>({ areas: {}, groups: {}, plugins: {} })
  if (store) {
    void store.get<ToolsUiState>(STORAGE_KEY).then((saved) => {
      if (!saved) return
      state.areas = { ...saved.areas }
      state.groups = { ...saved.groups }
      state.plugins = { ...saved.plugins }
    }).catch((error) => {
      console.error('[tools-ui-state] hydrate failed; starting collapsed:', error)
    })
  }
  return {
    state,
    persist() {
      // Reactive proxy must never reach serialization (settings-state lesson).
      void store?.set(STORAGE_KEY, JSON.parse(JSON.stringify(state)))
    },
  }
}
