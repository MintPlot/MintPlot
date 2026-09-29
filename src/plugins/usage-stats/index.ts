/**
 * usage-stats plugin entry — ported from the decoupling-line organ
 * (baseline main 81ef0b8). Activation registers the tool-tab view and mounts
 * the service singleton; the write side (recordApiUsage) is consumed by the
 * kernel LLM pipeline via dependency injection, same call surface as before
 * the port.
 */

import { definePlugin } from '@contracts'
import manifest from './manifest.json'
import type { PluginManifest } from '@contracts'
import { createUsageStatsService } from './service'
import { setUsageStatsService } from './service-instance'
import UsageStatsPanel from './UsageStatsPanel.vue'

// JSON imports widen string literals; validateManifest at load is the
// authoritative gate.
const pluginManifest = manifest as PluginManifest

export default definePlugin({
  manifest: pluginManifest,
  activate(ctx) {
    ctx.registerView({
      id: 'usage',
      title: '用量统计',
      component: UsageStatsPanel,
    })

    const service = createUsageStatsService(ctx)
    setUsageStatsService(service)

    ctx.onDeactivate(() => {
      setUsageStatsService(null)
    })
  },
})
