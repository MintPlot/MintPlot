import { createApp } from 'vue'
import './main.css'
import App from './App.vue'
import { initMpTheme } from '@/kernel/design/theme'
import { createKernel } from '@/kernel/bootstrap'
import { PLUGIN_RUNTIME_KEY, PLUGIN_SETTINGS_STORE_KEY } from '@/kernel/app/runtime-key'
import UpdateCheckerPlugin from '@/plugins/update-checker'

initMpTheme()

// Composition root — the only module allowed to see both the kernel and the
// plugins; src/kernel/** stays free of plugin imports (red line).
const kernel = createKernel()
kernel.runtime.load(UpdateCheckerPlugin)

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
app.mount('#app')
