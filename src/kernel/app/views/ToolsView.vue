<script setup lang="ts">
// 工具 tab(M3-h):插件区 + 插件视图区(如用量统计),两大区初始折叠、
// 可展开(状态持久化在内核 KV tools-ui-state);插件区内部还有 组/条目 两级
// 折叠(见 PluginArea)。全部为注册表投影,壳不认识任何具体插件。
import { computed, inject, provide } from 'vue'
import { PLUGIN_SETTINGS_STORE_KEY } from '@/kernel/app/runtime-key'
import { usePluginViewsProjection } from '@/kernel/app/plugin-views'
import { TOOLS_UI_KEY, createToolsUi } from '@/kernel/app/tools-ui-state'
import PluginArea from '@/kernel/app/sections/PluginArea.vue'

const store = inject(PLUGIN_SETTINGS_STORE_KEY, null)

// Single owner of the accordion state; PluginArea joins via provide.
const toolsUi = createToolsUi(store)
provide(TOOLS_UI_KEY, toolsUi)

const views = usePluginViewsProjection()

const areaOpen = (key: string): boolean => toolsUi.state.areas[key] ?? false
const toggleArea = (key: string): void => {
  toolsUi.state.areas[key] = !areaOpen(key)
  toolsUi.persist()
}
const areaViews = computed(() => views.value.map((view) => ({ key: `view:${view.id}`, view })))
</script>

<template>
  <section class="relative h-full">
    <div class="absolute inset-0 overflow-y-auto px-4 pt-[98px] pb-[calc(104px+env(safe-area-inset-bottom))]">
      <div class="mx-auto flex max-w-xl flex-col gap-3">
        <section class="overflow-hidden rounded-card border border-line bg-card">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-4 py-3 text-left"
            :aria-expanded="areaOpen('plugins')"
            @click="toggleArea('plugins')"
          >
            <svg
              class="h-4 w-4 text-ink-3 transition-transform"
              :class="areaOpen('plugins') ? 'rotate-90' : ''"
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
            <span class="flex-1 text-sm font-semibold text-ink">插件</span>
          </button>
          <div
            class="mp-mo-collapse"
            :class="areaOpen('plugins') ? 'mp-mo-collapse-open' : ''"
          >
            <div
              class="mp-mo-collapse-inner"
              :class="areaOpen('plugins') ? 'border-t border-line' : ''"
            >
              <PluginArea />
            </div>
          </div>
        </section>

        <section
          v-for="{ key, view } in areaViews"
          :key="key"
          class="overflow-hidden rounded-card border border-line bg-card"
        >
          <button
            type="button"
            class="flex w-full items-center gap-2 px-4 py-3 text-left"
            :aria-expanded="areaOpen(key)"
            @click="toggleArea(key)"
          >
            <svg
              class="h-4 w-4 text-ink-3 transition-transform"
              :class="areaOpen(key) ? 'rotate-90' : ''"
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
            <span class="flex-1 text-sm font-semibold text-ink">{{ view.title }}</span>
          </button>
          <div
            class="mp-mo-collapse"
            :class="areaOpen(key) ? 'mp-mo-collapse-open' : ''"
          >
            <div
              class="mp-mo-collapse-inner"
              :class="areaOpen(key) ? 'border-t border-line' : ''"
            >
              <component :is="view.component" />
            </div>
          </div>
        </section>
      </div>
    </div>

    <header class="mp-glass absolute inset-x-3 top-3 rounded-panel px-4 py-2.5">
      <h1 class="py-3 text-lg">
        工具
      </h1>
    </header>
  </section>
</template>
