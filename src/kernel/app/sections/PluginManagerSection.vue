<script setup lang="ts">
// 插件管理分区(M2 walking skeleton):插件启停真实生效 —— 开关直接驱动
// runtime activate/deactivate,偏好持久化在内核 KV(plugin-states)。
import { computed, inject, ref } from 'vue'
import { PLUGIN_RUNTIME_KEY, PLUGIN_SETTINGS_STORE_KEY } from '@/kernel/app/runtime-key'
import type { PluginStateProjection } from '@/kernel/runtime/runtime'

const runtime = inject(PLUGIN_RUNTIME_KEY, null)
const store = inject(PLUGIN_SETTINGS_STORE_KEY, null)

const items = computed(() => runtime?.projection() ?? [])
const busy = ref<string | null>(null)
const error = ref('')

async function persistEnabled(id: string, enabled: boolean): Promise<void> {
  if (!store) return
  const current = (await store.get<Record<string, boolean>>('plugin-states')) ?? {}
  await store.set('plugin-states', { ...current, [id]: enabled })
}

async function toggle(plugin: PluginStateProjection): Promise<void> {
  if (!runtime || busy.value) return
  busy.value = plugin.id
  error.value = ''
  try {
    if (plugin.state === 'active') {
      await runtime.deactivate(plugin.id)
      await persistEnabled(plugin.id, false)
    } else {
      await runtime.activate(plugin.id)
      await persistEnabled(plugin.id, true)
    }
  } catch (cause) {
    error.value = String(cause instanceof Error ? cause.message : cause)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div v-if="runtime">
    <p
      v-if="error"
      class="border-b border-line bg-danger-wash px-4 py-2 text-xs text-danger"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="items.length === 0"
      class="px-4 py-6 text-center text-xs text-ink-3"
    >
      尚无插件入驻(M2+ 移植件随构建期注册表加载)
    </p>
    <ul>
      <li
        v-for="plugin in items"
        :key="plugin.id"
        class="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
      >
        <div class="min-w-0">
          <p class="truncate text-sm text-ink">
            {{ plugin.id }}
            <span class="font-mono text-xs text-ink-3">v{{ plugin.version }}</span>
          </p>
          <p class="truncate text-xs text-ink-3">
            {{ plugin.activation === 'eager' ? 'eager' : 'lazy' }} ·
            {{ plugin.permissions.length }} 项权限 ·
            {{ plugin.state === 'active' ? '已启用' : plugin.state === 'degraded' ? '已降级' : '未启用' }}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="plugin.state === 'active'"
          :disabled="busy !== null"
          class="min-h-[44px] min-w-[64px] rounded-input border px-3 text-sm"
          :class="plugin.state === 'active'
            ? 'border-primary bg-primary text-on-primary'
            : 'border-line-strong bg-card text-ink-2'"
          @click="toggle(plugin)"
        >
          {{ busy === plugin.id ? '…' : plugin.state === 'active' ? '停用' : '启用' }}
        </button>
      </li>
    </ul>
  </div>
  <p
    v-else
    class="px-4 py-6 text-center text-xs text-ink-3"
  >
    插件运行时未接入(组合根未提供)
  </p>
</template>
