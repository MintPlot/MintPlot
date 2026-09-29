import { createApp } from 'vue'
import './main.css'
import App from './App.vue'
import { initMpTheme } from '@/kernel/design/theme'
import { createKernel } from '@/kernel/bootstrap'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createDefaultEngine } from '@/kernel/store/idb-engine'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createOpenAiCompatibleProvider } from '@/kernel/llm/llm-provider'
import { PLUGIN_BUS_KEY, PLUGIN_RUNTIME_KEY, PLUGIN_SETTINGS_STORE_KEY } from '@/kernel/app/runtime-key'
import { CHATBOX_STORE_KEY, SEAM_REGISTRY_KEY, SETTINGS_STATE_KEY, USAGE_RECORDER_KEY } from '@/kernel/app/chat-keys'
import UpdateCheckerPlugin from '@/plugins/update-checker'
import UsageStatsPlugin from '@/plugins/usage-stats'
import { getUsageStatsService } from '@/plugins/usage-stats/service-instance'
import TtsPlugin from '@/plugins/tts'

initMpTheme()

// Composition root — the only module allowed to see both the kernel and the
// plugins; src/kernel/** stays free of plugin imports (red line).
const kernel = createKernel()

// Kernel-owned default LLM provider (R-09) on the public seam; plugins may
// override via ctx.registerSeamProvider('llm.provider', …).
kernel.services.seams.register('kernel', 'llm.provider', createOpenAiCompatibleProvider(kernel.services.settings))

// Chatbox domain persistence over the kind-scoped repository (ADR-003 keys).
const chatboxStore = createChatboxStore(createStorageRepository(createDefaultEngine()))

// Usage write side: the composition root bridges the kernel pipeline's
// records into the usage-stats organ when it is active.
const recordUsage = (usage: unknown, meta: Record<string, string>): void => {
  getUsageStatsService()?.recordApiUsage(usage, meta)
}

kernel.runtime.load(UpdateCheckerPlugin)
kernel.runtime.load(UsageStatsPlugin)
kernel.runtime.load(TtsPlugin)

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
app.provide(SEAM_REGISTRY_KEY, kernel.services.seams)
app.provide(SETTINGS_STATE_KEY, kernel.services.settings)
app.provide(USAGE_RECORDER_KEY, recordUsage)
app.mount('#app')
