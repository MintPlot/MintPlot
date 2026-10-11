/**
 * nstyle plugin entry (M4-nstyle) — 叙事风格配置器的工具区开关行,与
 * variables/story 插件同构:提示词构建器(src/kernel/nstyle/prompt.ts)、
 * 作用域解析与注入(request-assembly + ChatSessionView)都是内核设施,
 * 红线禁止内核→插件导入,所以插件本身只承载开关与清单。
 *
 * 配置持久化:nstyle:customs / nstyle:global / nstyle:card:<id>(自有域键,
 * 走 StorageRepository);会话临时配置是内存 ref。面板由 HOST 以
 * placement 'plugin' 注册在本插件的工具区条目下(App.vue)。
 */

import { definePlugin } from '@contracts'
import manifest from './manifest.json'
import type { PluginManifest } from '@contracts'

const pluginManifest = manifest as PluginManifest

export default definePlugin({
  manifest: pluginManifest,
  activate() {
    // Nothing to mount: the configurator panel is host-registered; the
    // request-side injection reads the store mirror and gates on this
    // plugin's runtime state.
  },
})
