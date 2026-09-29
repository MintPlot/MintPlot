<script setup lang="ts">
// 设置 tab(M2):设置注册表投影 —— 分区随内核与插件注册入驻/撤销,壳不认识任何具体分区。
// M0 占位件的临时主题按钮已迁入「外观」分区( AppearanceSection)。
import { useSettingsProjection } from '@/kernel/app/settings-registry'

const sections = useSettingsProjection()
</script>

<template>
  <section class="flex h-full flex-col">
    <header class="shrink-0 border-b border-line bg-card px-4">
      <h1 class="py-3 text-lg">
        设置
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

        <p
          v-if="sections.length === 0"
          class="py-16 text-center text-sm text-ink-3"
        >
          设置注册表为空(M2+ 分区随内核与插件注册入驻)
        </p>
      </div>
    </div>
  </section>
</template>
