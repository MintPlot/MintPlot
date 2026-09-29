import { createApp } from 'vue'
import './main.css'
import App from './App.vue'
import { initMpTheme } from '@/kernel/design/theme'
import { createKernel } from '@/kernel/bootstrap'
import { PLUGIN_RUNTIME_KEY, PLUGIN_SETTINGS_STORE_KEY } from '@/kernel/app/runtime-key'

initMpTheme()

// Composition root — the only module allowed to see both the kernel and the
// plugins; src/kernel/** stays free of plugin imports (red line).
const kernel = createKernel()
const app = createApp(App)
app.provide(PLUGIN_RUNTIME_KEY, kernel.runtime)
app.provide(PLUGIN_SETTINGS_STORE_KEY, kernel.storage)
app.mount('#app')
