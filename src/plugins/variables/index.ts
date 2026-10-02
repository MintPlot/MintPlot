/**
 * variables plugin entry (M3-q2) — the management surface of the variables
 * system: tools-area entry row + enable toggle (M3-h shape), card-domain
 * only (`sessions: ['card']`).
 *
 * Deliberately no service: the ledger store, the pure engine and the chat
 * page panel live kernel-side (src/kernel/variables/) because the request
 * pipeline (ChatSessionView) consumes them there and the red line forbids
 * kernel→plugin imports. Disabling this plugin flips the runtime state to
 * 'registered'; the chat page reads that state on mount and goes dormant —
 * no seeding, no tag-block parsing, no {{getvar}} expansion, no [Variables]
 * section, no panel entry. The ledger data itself is never touched.
 */

import { definePlugin } from '@contracts'
import manifest from './manifest.json'
import type { PluginManifest } from '@contracts'
import TemplateAnalysisSection from '@/kernel/app/sections/TemplateAnalysisSection.vue'

const pluginManifest = manifest as PluginManifest

export default definePlugin({
  manifest: pluginManifest,
  activate(ctx) {
    // Management surface (M3-w follow-up, user call): the 变量分析 settings
    // panel folds into the plugin's own tools-area accordion entry
    // (placement 'plugin', same as the presets panel) instead of a
    // settings-tab kernel section.
    ctx.registerSettingsSection({
      id: 'variables-analysis',
      title: '变量分析',
      component: TemplateAnalysisSection,
      placement: 'plugin',
    })
  },
})
