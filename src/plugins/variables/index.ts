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

const pluginManifest = manifest as PluginManifest

export default definePlugin({
  manifest: pluginManifest,
  activate() {
    // Nothing to mount: the engine/ledger are kernel infra; the toggle is
    // the feature. The 变量分析 panel is REGISTERED BY THE HOST (App.vue)
    // with placement 'plugin' under this plugin's id — the section component
    // lives kernel-side and plugins must not import kernel modules (red
    // line §3.5.4).
  },
})
