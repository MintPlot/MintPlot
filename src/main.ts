import { createApp } from 'vue'
import { App as CapacitorApp } from '@capacitor/app'
import './main.css'
import App from './App.vue'
import { initMpTheme } from '@/kernel/design/theme'
import { initMpColorFamily } from '@/kernel/design/color-families'
import { createKernel } from '@/kernel/bootstrap'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createDefaultEngine } from '@/kernel/store/idb-engine'
import { createKvStore } from '@/kernel/store/kv-store'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createVariableStore } from '@/kernel/variables/variable-store'
import { createWorldbookStore } from '@/kernel/worldinfo/worldbook-store'
import { createRegexStore } from '@/kernel/regex/regex-store'
import { createPresetStore } from '@/kernel/presets/preset-store'
import { createMemoryStore } from '@/kernel/memory/memory-store'
import { createOpenAiCompatibleProvider } from '@/kernel/llm/llm-provider'
import { createPlatformSecretChannel } from '@/kernel/secrets/platform-secret-channel'
import { attachErrorHubPersistence, errorHub, hydrateErrorHub } from '@/kernel/diagnostics/error-hub'
import { installGlobalErrorHandlers, replayEarlyErrors } from '@/kernel/diagnostics/global-handlers'
import { installRequestDiagnostics } from '@/kernel/diagnostics/request-diagnostics'
// M4-g1 data continuity: the backup service rides its own raw engine (same
// idb; values move verbatim) and the MpFiles SAF bridge (browser fallback).
import { createBackupService } from '@/kernel/dataio/backup-service'
import { setBackupServiceInstance } from '@/kernel/dataio/backup-service-instance'
import { resolveFileBridge } from '@/kernel/dataio/file-bridge'
import { closeConversation, useChatRoute } from '@/kernel/app/chat-router'
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
  WORLDBOOK_STORE_KEY,
  REGEX_STORE_KEY,
  PRESET_STORE_KEY,
  MEMORY_STORE_KEY,
} from '@/kernel/app/chat-keys'
import UpdateCheckerPlugin from '@/plugins/update-checker'
import UsageStatsPlugin from '@/plugins/usage-stats'
import { getUsageStatsService } from '@/plugins/usage-stats/service-instance'
import TtsPlugin from '@/plugins/tts'
import VariablesPlugin from '@/plugins/variables'
import WorldinfoPlugin from '@/plugins/worldinfo'
import RegexPlugin from '@/plugins/regex'
import PresetsPlugin from '@/plugins/presets'
import MemoryPlugin from '@/plugins/memory'
import CotPlugin from '@/plugins/cot'

initMpTheme()
initMpColorFamily()

// Error hub first (M3-err1): the journal is the last thing allowed to die,
// so its nets and seam go up before anything else can throw. Persistence
// rides its own default-engine instance — same degradation ladder as every
// other store; a hub-write failure stays console-only (loop guard).
installRequestDiagnostics(errorHub)
const journalStore = createKvStore(createDefaultEngine())
attachErrorHubPersistence({
  load: () => journalStore.get<unknown>('error-journal'),
  save: async (records) => journalStore.set('error-journal', records),
})
void hydrateErrorHub()
replayEarlyErrors()

setBackupServiceInstance(
  createBackupService({
    engine: createDefaultEngine(),
    fileBridge: resolveFileBridge,
  }),
)

// Composition root — the only module allowed to see both the kernel and the
// plugins; src/kernel/** stays free of plugin imports (red line).
const kernel = createKernel()

// Storage degrade / other fatal events keep the journal durable across the
// app lifecycle — flush on pause. M3-err3 wires the missing emitter: the
// contract events app.pause/app.resume finally have a source (Capacitor
// appStateChange; the web stub rides visibilitychange).
void CapacitorApp.addListener('appStateChange', (state) => {
  kernel.services.bus.emit(state.isActive ? 'app.resume' : 'app.pause', {})
})
kernel.services.bus.on('app.pause', () => {
  void errorHub.flush()
})

// Kernel-owned default LLM provider (R-09) on the public seam; plugins may
// override via ctx.registerSeamProvider('llm.provider', …).
kernel.services.seams.register('kernel', 'llm.provider', createOpenAiCompatibleProvider(kernel.services.settings))

// Chatbox domain persistence over the kind-scoped repository (ADR-003 keys).
const chatboxStore = createChatboxStore(createStorageRepository(createDefaultEngine(), createPlatformSecretChannel()))

// Character card library (card-domain library records, `character:<id>` keys)
// and its one-session-per-card conversation store (M3-i, `chat:card:*` keys).
const characterStore = createCharacterStore(createStorageRepository(createDefaultEngine(), createPlatformSecretChannel()))
const cardSessionStore = createCardSessionStore(createStorageRepository(createDefaultEngine(), createPlatformSecretChannel()))
// Card-session variables ledger (M3-q, `variables:card:*` keys) — card domain
// only; the chatbox domain never sees variables (review Q4 isolation).
const variableStore = createVariableStore(createStorageRepository(createDefaultEngine(), createPlatformSecretChannel()))
// Worldbook per-entry toggles (M3-u, `worldinfo:card:*` keys) — the card's
// verbatim book rides the character record; only overrides live here.
const worldbookStore = createWorldbookStore(createStorageRepository(createDefaultEngine(), createPlatformSecretChannel()))
// Regex per-script toggles (M3-v, `regex:card:*` keys) — the card's verbatim
// regex scripts ride the extensions block; only overrides live here.
const regexStore = createRegexStore(createStorageRepository(createDefaultEngine(), createPlatformSecretChannel()))
// Prompt presets (M3-w) — app-level; the seed sync runs on first read.
const presetStore = createPresetStore(createStorageRepository(createDefaultEngine(), createPlatformSecretChannel()))
// Rolling-summary memory ledger (M4-e, `memory:<kind>:<id>` reserved key)
// — card domain first; the plugin is the tools-area toggle surface.
const memoryStore = createMemoryStore(createStorageRepository(createDefaultEngine(), createPlatformSecretChannel()))

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
// Worldbook (M3-u): same serviceless shape — activation/budget/injection
// engine stays kernel-side; the plugin is the tools-area toggle surface.
kernel.runtime.load(WorldinfoPlugin)
kernel.runtime.load(RegexPlugin)
kernel.runtime.load(PresetsPlugin)
// Memory system (M4-e): same serviceless shape — the summary pipeline,
// ledger and injection engine stay kernel-side; the plugin is the toggle.
kernel.runtime.load(MemoryPlugin)
// Thinking layer (M4-f): same serviceless shape — parser/builder/preset-sync
// stay kernel-side; the plugin is the tools-area toggle surface.
kernel.runtime.load(CotPlugin)

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
      errorHub.record({
        severity: 'error',
        category: 'plugin',
        action: 'activate_failed',
        code: 'MP-PLUGIN-001',
        pluginId: plugin.id,
        message: error instanceof Error ? error.message || error.name : String(error ?? 'unknown'),
      })
    }
  }
}
void bootPlugins()

const app = createApp(App)
installGlobalErrorHandlers(app)

// Android back button (M3-w fix): the WebView session history is unreliable
// on the Android 15 WebView (a bare pushState→back probe never fires
// popstate), so the hardware back is driven explicitly through the
// Capacitor App plugin's dispatcher callback — chat open ⇒ close it (the
// router resets the route and clears the history flag); at the root ⇒ the
// Android convention of leaving the app.
void CapacitorApp.addListener('backButton', () => {
  if (useChatRoute().value.view === 'chat') {
    closeConversation()
    return
  }
  void CapacitorApp.exitApp()
})
app.provide(PLUGIN_RUNTIME_KEY, kernel.runtime)
app.provide(PLUGIN_SETTINGS_STORE_KEY, kernel.storage)
app.provide(PLUGIN_BUS_KEY, kernel.services.bus)
app.provide(CHATBOX_STORE_KEY, chatboxStore)
app.provide(CHARACTER_STORE_KEY, characterStore)
app.provide(CARD_SESSION_STORE_KEY, cardSessionStore)
app.provide(VARIABLE_STORE_KEY, variableStore)
app.provide(WORLDBOOK_STORE_KEY, worldbookStore)
app.provide(REGEX_STORE_KEY, regexStore)
app.provide(PRESET_STORE_KEY, presetStore)
app.provide(MEMORY_STORE_KEY, memoryStore)
app.provide(SESSION_PROJECTION_KEY, kernel.services.session)
app.provide(SEAM_REGISTRY_KEY, kernel.services.seams)
app.provide(SETTINGS_STATE_KEY, kernel.services.settings)
app.provide(USAGE_RECORDER_KEY, recordUsage)
app.mount('#app')
