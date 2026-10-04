/**
 * tts plugin entry — ported from the decoupling-line tts organ (baseline
 * main 81ef0b8; the ADR-001 Phase 1 pilot plugin). Activation order matters:
 *  1. register both engines on the kernel tts.engine seam (the service
 *     resolves them by providerId);
 *  2. register the settings section (TtsSettings is loaded when the settings
 *     page renders it — MP keeps the section component import direct, the
 *     chunking is Vite's per-entry concern now);
 *  3. create the service and mount the singleton.
 * Deactivation revokes every registration through the kernel disposer (R-04)
 * and tears down the service singleton.
 */

import { definePlugin } from '@contracts'
import rawManifest from './manifest.json'
import type { PluginManifest } from '@contracts'
import nativeEngine from './tts-engine'
import cloudEngine from './tts-cloud-engine'
import { createTtsService } from './service'
import { setTtsService } from './service-instance'
import TtsSettings from './TtsSettings.vue'

// JSON imports widen string literals; validateManifest at load is the
// authoritative gate.
const manifest = rawManifest as PluginManifest

export default definePlugin({
  manifest,
  activate(ctx) {
    ctx.registerSeamProvider('tts.engine', nativeEngine, 'system')
    ctx.registerSeamProvider('tts.engine', cloudEngine, 'cloud')

    ctx.registerSettingsSection({
      id: 'tts',
      title: '语音设置',
      component: TtsSettings,
      // Plugin feature surface (M3-h IA): renders inside the tts accordion
      // entry on the tools tab, not on the user-configuration settings tab.
      placement: 'plugin',
    })

    const service = createTtsService(ctx)
    setTtsService(service)

    // M4-c floor speak button: the kernel chat page emits the intent with the
    // floor text (red line — the view never imports this plugin); the bus
    // subscription auto-unsubscribes with the activation bag.
    ctx.on('tts.speak.requested', (event) => {
      void service.toggleSpeakContent({ id: event.messageId, content: event.text })
    })

    ctx.onDeactivate(() => {
      setTtsService(null)
    })
  },
})
