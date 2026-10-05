/**
 * memory plugin entry (M4-e) — the management surface of the rolling-summary
 * memory system: tools-area entry row + enable toggle (M3-h shape), card
 * domain only (`sessions: ['card']`).
 *
 * Deliberately no service, same shape as variables (M3-q2) / worldinfo
 * (M3-u) / regex (M3-v): the summary pipeline, ledger store and injection
 * engine live kernel-side (src/kernel/memory/) because ChatSessionView
 * consumes them there and the red line forbids kernel→plugin imports.
 * Disabling this plugin flips the runtime state to 'registered'; the chat
 * page reads that state and the whole memory layer goes dormant — no
 * injection, no pruning, no background summary, no panel entry. The ledger
 * data is never touched.
 */

import { definePlugin } from '@contracts'
import manifest from './manifest.json'
import type { PluginManifest } from '@contracts'

const pluginManifest = manifest as PluginManifest

export default definePlugin({
  manifest: pluginManifest,
  activate() {
    // Nothing to mount: the engine is kernel infra; the toggle is the feature.
  },
})
