<script setup lang="ts">
// 工具 tab(M3-f):插件领地聚合页 —— 插件管理 + 插件功能分区(placement 'tools')
// + 插件注册视图,全部为注册表投影,壳不认识任何具体插件。
import { usePluginViewsProjection } from '@/kernel/app/plugin-views'
import { useToolsSectionProjection } from '@/kernel/app/settings-registry'

const sections = useToolsSectionProjection()
const views = usePluginViewsProjection()
</script>

<template>
  <section class="flex h-full flex-col">
    <header class="shrink-0 border-b border-line bg-card px-4">
      <h1 class="py-3 text-lg">
        工具
      </h1>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div class="mx-auto flex max-w-xl flex-col gap-3">
        <section
          v-for="section in sections"
          :key="section.id"
          class="overflow-hidden rounded-card border border-line bg-card"
        >
          <h2 class="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink-2">
            {{ section.title }}
          </h2>
          <component :is="section.component" />
        </section>

        <section
          v-for="view in views"
          :key="view.id"
          class="overflow-hidden rounded-card border border-line bg-card"
        >
          <h2 class="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink-2">
            {{ view.title }}
          </h2>
          <component :is="view.component" />
        </section>

        <p
          v-if="sections.length === 0 && views.length === 0"
          class="py-16 text-center text-sm text-ink-3"
        >
          尚无工具入驻(插件启停后在设置外的工具页出现)
        </p>
      </div>
    </div>
  </section>
</template>
