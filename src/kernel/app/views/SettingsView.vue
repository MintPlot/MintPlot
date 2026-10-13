<script setup lang="ts">
// 设置 tab(M2):设置注册表投影 —— 分区随内核与插件注册入驻/撤销,壳不认识任何具体分区。
// M0 占位件的临时主题按钮已迁入「外观」分区( AppearanceSection)。
// 1.0.x:全卡折叠手风琴 —— 除「用户设定」外默认收起;展开集合持久在
// localStorage(显式 id 列表:存的是「当前展开的全部」,默认展开项首次
// 触碰时随之落盘,故未触碰的默认项不会因别处的开合而意外收起;新注册
// 分区不在列表 = 收起)。
import { ref } from 'vue'
import { useSettingsProjection } from '@/kernel/app/settings-registry'

const sections = useSettingsProjection()

const EXPANDED_KEY = 'mp_settings_expanded'
const DEFAULT_EXPANDED = ['kernel:persona']

const readExpanded = (): string[] => {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (!raw) return [...DEFAULT_EXPANDED]
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [...DEFAULT_EXPANDED]
  } catch {
    return [...DEFAULT_EXPANDED]
  }
}

const expandedIds = ref<string[]>(readExpanded())

const isExpanded = (id: string): boolean => expandedIds.value.includes(id)

const toggleSection = (id: string): void => {
  expandedIds.value = isExpanded(id)
    ? expandedIds.value.filter((entry) => entry !== id)
    : [...expandedIds.value, id]
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(expandedIds.value))
  } catch {
    // Storage unavailable (private mode): the session keeps the state.
  }
}
</script>

<template>
  <section class="relative h-full">
    <div class="absolute inset-0 overflow-y-auto px-4 pt-[98px] pb-[calc(104px+env(safe-area-inset-bottom))]">
      <div class="mx-auto flex max-w-xl flex-col gap-3">
        <section
          v-for="section in sections"
          :key="section.id"
          class="overflow-hidden rounded-card border border-line bg-card"
        >
          <h2>
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left"
              :aria-expanded="isExpanded(section.id)"
              :aria-controls="`${section.id}-body`"
              @click="toggleSection(section.id)"
            >
              <span class="text-sm font-semibold text-ink-2">{{ section.title }}</span>
              <svg
                class="h-4 w-4 flex-shrink-0 text-ink-3 transition-transform"
                :class="isExpanded(section.id) ? 'rotate-180' : ''"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </h2>
          <div
            v-show="isExpanded(section.id)"
            :id="`${section.id}-body`"
            class="border-t border-line"
          >
            <component :is="section.component" />
          </div>
        </section>

        <p
          v-if="sections.length === 0"
          class="py-16 text-center text-sm text-ink-3"
        >
          设置注册表为空(M2+ 分区随内核与插件注册入驻)
        </p>
      </div>
    </div>

    <header class="mp-glass absolute inset-x-3 top-3 rounded-panel px-4 py-2.5">
      <h1 class="py-3 text-lg">
        设置
      </h1>
    </header>
  </section>
</template>
