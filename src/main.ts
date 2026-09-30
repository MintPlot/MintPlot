import { createApp } from 'vue'
import './main.css'
import App from './App.vue'
import { initMpTheme } from '@/kernel/design/theme'
import { createKernel } from '@/kernel/bootstrap'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createDefaultEngine } from '@/kernel/store/idb-engine'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createVariableStore } from '@/kernel/variables/variable-store'
import { createOpenAiCompatibleProvider } from '@/kernel/llm/llm-provider'
import { PLUGIN_BUS_KEY, PLUGIN_RUNTIME_KEY, PLUGIN_SETTINGS_STORE_KEY } from '@/kernel/app/runtime-key'
import {
  CARD_SESSION_STORE_KEY,
  CHATBOX_STORE_KEY,
  CHARACTER_STORE_KEY,
  SEAM_REGISTRY_KEY,
  SESSION_PROJECTION_KEY,
  SETTINGS_STATE_KEY,
  USAGE_RECORDER_KEY,
  VARIABLE_STORE_KEY,
} from '@/kernel/app/chat-keys'
import UpdateCheckerPlugin from '@/plugins/update-checker'
import UsageStatsPlugin from '@/plugins/usage-stats'
import { getUsageStatsService } from '@/plugins/usage-stats/service-instance'
import TtsPlugin from '@/plugins/tts'
import VariablesPlugin from '@/plugins/variables'

initMpTheme()

// Composition root — the only module allowed to see both the kernel and the
// plugins; src/kernel/** stays free of plugin imports (red line).
const kernel = createKernel()

// Kernel-owned default LLM provider (R-09) on the public seam; plugins may
// override via ctx.registerSeamProvider('llm.provider', …).
kernel.services.seams.register('kernel', 'llm.provider', createOpenAiCompatibleProvider(kernel.services.settings))

// Chatbox domain persistence over the kind-scoped repository (ADR-003 keys).
const chatboxStore = createChatboxStore(createStorageRepository(createDefaultEngine()))

// Character card library (card-domain library records, `character:<id>` keys)
// and its one-session-per-card conversation store (M3-i, `chat:card:*` keys).
const characterStore = createCharacterStore(createStorageRepository(createDefaultEngine()))
const cardSessionStore = createCardSessionStore(createStorageRepository(createDefaultEngine()))
// Card-session variables ledger (M3-q, `variables:card:*` keys) — card domain
// only; the chatbox domain never sees variables (review Q4 isolation).
const variableStore = createVariableStore(createStorageRepository(createDefaultEngine()))

// Usage write side: the composition root bridges the kernel pipeline's
// records into the usage-stats organ when it is active.
const recordUsage = (usage: unknown, meta: Record<string, string>): void => {
  getUsageStatsService()?.recordApiUsage(usage, meta)
}

kernel.runtime.load(UpdateCheckerPlugin)
kernel.runtime.load(UsageStatsPlugin)
kernel.runtime.load(TtsPlugin)
// Variables system (M3-q2): the plugin is the management surface (tools-area
// entry + toggle); engine/ledger stay kernel-side and gate on runtime state.
kernel.runtime.load(VariablesPlugin)

// Boot policy: every loaded plugin starts enabled unless the user disabled it
// (the plugin manager persists the preference under 'plugin-states').
async function bootPlugins(): Promise<void> {
  const prefs = (await kernel.storage.get<Record<string, boolean>>('plugin-states')) ?? {}
  for (const plugin of kernel.runtime.projection()) {
    if (prefs[plugin.id] === false) continue
    try {
      await kernel.runtime.activate(plugin.id)
    } catch (error) {
      console.error(`[boot] plugin "${plugin.id}" failed to activate:`, error)
    }
  }
}
void bootPlugins()

const app = createApp(App)
app.provide(PLUGIN_RUNTIME_KEY, kernel.runtime)
app.provide(PLUGIN_SETTINGS_STORE_KEY, kernel.storage)
app.provide(PLUGIN_BUS_KEY, kernel.services.bus)
app.provide(CHATBOX_STORE_KEY, chatboxStore)
app.provide(CHARACTER_STORE_KEY, characterStore)
app.provide(CARD_SESSION_STORE_KEY, cardSessionStore)
app.provide(VARIABLE_STORE_KEY, variableStore)
app.provide(SESSION_PROJECTION_KEY, kernel.services.session)
app.provide(SEAM_REGISTRY_KEY, kernel.services.seams)
app.provide(SETTINGS_STATE_KEY, kernel.services.settings)
app.provide(USAGE_RECORDER_KEY, recordUsage)
app.mount('#app')
