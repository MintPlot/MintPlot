/**
 * update-checker plugin entry — first organ through the MP porting pipeline
 * (RP baseline 4fedffd). Activation is the single registration window: the
 * ctx-bound service is created, the settings section registered, and the
 * service's own teardown (auto-check timer) joins the activation bag so
 * deactivate revokes everything for real.
 */

import { definePlugin } from '@contracts'
import type { PluginManifest } from '@contracts'
import rawManifest from './manifest.json'
import { createUpdateCheckerService, setActiveService } from './service-instance'
import UpdateCheckerSection from './UpdateCheckerSection.vue'

// JSON imports widen string literals; the runtime re-validates the manifest
// at load (validateManifest), which is the authoritative gate.
const manifest = rawManifest as PluginManifest

export default definePlugin({
  manifest,
  activate(ctx) {
    const service = createUpdateCheckerService(ctx)
    setActiveService(service)

    ctx.registerSettingsSection({
      id: 'update-checker',
      title: '关于与更新',
      component: UpdateCheckerSection,
      // Panel placement declared 'settings': its function belongs on the
      // settings tab, not inside the plugin entry (M3-h plugin shape rule —
      // the three built-ins demonstrate the three surfaces).
      placement: 'settings',
    })

    ctx.onDeactivate(() => {
      service.dispose()
      setActiveService(null)
    })
  },
})
