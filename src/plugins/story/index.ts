/**
 * story plugin entry (M4-e) — 故事引擎的工具区开关行(M3-h shape),与
 * variables 插件同构:引擎本体是内核设施,开关即功能。
 *
 * Deliberately no service: the prompt-block builder (src/kernel/app/
 * story-prompt.ts) and the request-side injection live kernel-side because
 * the request pipeline (ChatSessionView) consumes them there and the red
 * line forbids kernel→plugin imports. The 故事设置 panel is REGISTERED BY
 * THE HOST (App.vue) with placement 'plugin' under this plugin's id.
 * Disabling flips the runtime state to 'registered'; the chat page reads
 * that state and skips the block — settings keys are never touched.
 */

import { definePlugin } from '@contracts'
import manifest from './manifest.json'
import type { PluginManifest } from '@contracts'

const pluginManifest = manifest as PluginManifest

export default definePlugin({
  manifest: pluginManifest,
  activate() {
    // Nothing to mount: the config keys ride mp_settings (host-written by
    // the kernel-side panel); the chat page gates the injection on this
    // plugin's runtime state.
  },
})
