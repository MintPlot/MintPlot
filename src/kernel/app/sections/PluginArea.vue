<script setup lang="ts">
// 插件区(M3-h):工具页第一区 —— 系统插件 / 扩展插件两组,每组可收纳;
// 条目 = 名片折叠行(中文名 + 一句话简介)+ 滑杠启用开关,初始只显示这两样;
// 有配置(placement 'plugin' 分区)才有展开箭头,展开渲染配置界面;
// 无配置没有箭头。停用的插件仍可展开,配置区提示启用后可配置。
// 开关直接驱动 runtime activate/deactivate,偏好持久化在内核 KV(plugin-states)。
import { computed, inject, onUnmounted, ref } from 'vue'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import { PLUGIN_BUS_KEY, PLUGIN_RUNTIME_KEY, PLUGIN_SETTINGS_STORE_KEY } from '@/kernel/app/runtime-key'
import { usePluginConfigSections } from '@/kernel/app/settings-registry'
import { TOOLS_UI_KEY } from '@/kernel/app/tools-ui-state'
import ToggleSwitch from '@/kernel/app/ui/ToggleSwitch.vue'
import type { PluginStateProjection } from '@/kernel/runtime/runtime'

const runtime = inject(PLUGIN_RUNTIME_KEY, null)
const bus = inject(PLUGIN_BUS_KEY, null)
const store = inject(PLUGIN_SETTINGS_STORE_KEY, null)
const toolsUi = inject(TOOLS_UI_KEY, null)

// Re-render trigger: bumped on every runtime state broadcast.
const revision = ref(0)
let unsubscribe: (() => void) | null = null
if (bus) {
  unsubscribe = bus.on('plugin.state.changed', () => {
    revision.value += 1
  })
}
onUnmounted(() => unsubscribe?.())

const items = computed(() => {
  void revision.value
  return runtime?.projection() ?? []
})

const groups = computed(() => ({
  system: items.value.filter((plugin) => plugin.category === 'system'),
  extension: items.value.filter((plugin) => plugin.category === 'extension'),
}))

const configSections = usePluginConfigSections()
const hasConfig = (id: string): boolean => (configSections.value.get(id)?.length ?? 0) > 0

const groupOpen = (key: 'system' | 'extension'): boolean => toolsUi?.state.groups[key] ?? false
const toggleGroup = (key: 'system' | 'extension'): void => {
  if (!toolsUi) return
  toolsUi.state.groups[key] = !groupOpen(key)
  toolsUi.persist()
}

const pluginOpen = (id: string): boolean => toolsUi?.state.plugins[id] ?? false
const togglePluginOpen = (id: string): void => {
  if (!toolsUi) return
  toolsUi.state.plugins[id] = !pluginOpen(id)
  toolsUi.persist()
}

const busy = ref<string | null>(null)
const error = ref('')
const enabled = computed(() => new Set(items.value.filter((plugin) => plugin.state === 'active').map((plugin) => plugin.id)))

async function persistEnabled(id: string, value: boolean): Promise<void> {
  if (!store) return
  const current = (await store.get<Record<string, boolean>>('plugin-states')) ?? {}
  await store.set('plugin-states', { ...current, [id]: value })
}

async function setEnabled(plugin: PluginStateProjection, value: boolean): Promise<void> {
  if (!runtime || busy.value) return
  busy.value = plugin.id
  error.value = ''
  try {
    if (value) {
      await runtime.activate(plugin.id)
    } else {
      await runtime.deactivate(plugin.id)
    }
    await persistEnabled(plugin.id, value)
  } catch (cause) {
    const message = String(cause instanceof Error ? cause.message : cause)
    error.value = message
    errorHub.record({
      severity: 'error',
      category: 'plugin',
      action: value ? 'activate_failed' : 'deactivate_failed',
      code: value ? 'MP-PLUGIN-001' : 'MP-PLUGIN-002',
      pluginId: plugin.id,
      message,
    })
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

    <div
      v-for="(plugins, key) in groups"
      :key="key"
      class="border-b border-line last:border-b-0"
    >
      <button
        type="button"
        class="flex w-full items-center gap-2 px-4 py-2.5 text-left"
        :aria-expanded="groupOpen(key as 'system' | 'extension')"
        @click="toggleGroup(key as 'system' | 'extension')"
      >
        <svg
          class="h-3.5 w-3.5 text-ink-3 transition-transform"
          :class="groupOpen(key as 'system' | 'extension') ? 'rotate-90' : ''"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 5l7 7-7 7"
          />
        </svg>
        <span class="text-xs font-bold uppercase tracking-wider text-ink-3">
          {{ key === 'system' ? '系统插件' : '扩展插件' }}
        </span>
        <span class="text-xs text-ink-3">({{ plugins.length }})</span>
      </button>

      <ul v-if="groupOpen(key as 'system' | 'extension')">
        <li
          v-for="plugin in plugins"
          :key="plugin.id"
          class="border-t border-line"
        >
          <div class="flex items-center gap-3 px-4 py-3">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm text-ink">{{ plugin.display.name }}</span>
              <span class="mt-0.5 block truncate text-xs text-ink-3">{{ plugin.display.description }}</span>
            </span>
            <button
              v-if="hasConfig(plugin.id)"
              type="button"
              class="flex h-11 w-9 items-center justify-center text-ink-3"
              :aria-label="pluginOpen(plugin.id) ? '收起配置' : '展开配置'"
              :aria-expanded="pluginOpen(plugin.id)"
              @click="togglePluginOpen(plugin.id)"
            >
              <svg
                class="h-4 w-4 transition-transform"
                :class="pluginOpen(plugin.id) ? 'rotate-90' : ''"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
            <ToggleSwitch
              :model-value="enabled.has(plugin.id)"
              :aria-label="`启用${plugin.display.name}`"
              @update:model-value="(value) => setEnabled(plugin, value)"
            />
          </div>

          <div
            v-if="pluginOpen(plugin.id)"
            class="border-t border-line bg-bg px-4 py-3"
          >
            <p class="mb-2 font-mono text-[10px] text-ink-3">
              {{ plugin.id }} · v{{ plugin.version }} · {{ plugin.permissions.length }} 项权限 ·
              {{ plugin.activation === 'eager' ? 'eager' : 'lazy' }}
            </p>
            <template v-if="enabled.has(plugin.id)">
              <template
                v-for="section in configSections.get(plugin.id) ?? []"
                :key="section.id"
              >
                <p class="mb-1 text-xs font-semibold text-ink-2">
                  {{ section.title }}
                </p>
                <component :is="section.component" />
              </template>
            </template>
            <p
              v-else
              class="py-2 text-center text-xs text-ink-3"
            >
              插件已停用,启用后可配置
            </p>
          </div>
        </li>
      </ul>

      <p
        v-else-if="key === 'extension'"
        class="px-4 pb-3 text-xs text-ink-3"
      >
        外部插件(M4+)安装后出现在这里
      </p>
    </div>

    <p
      v-if="items.length === 0"
      class="px-4 py-6 text-center text-xs text-ink-3"
    >
      尚无插件入驻(M2+ 移植件随构建期注册表加载)
    </p>
  </div>
  <p
    v-else
    class="px-4 py-6 text-center text-xs text-ink-3"
  >
    插件运行时未接入(组合根未提供)
  </p>
</template>
