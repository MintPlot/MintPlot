<script setup lang="ts">
// Appearance section (Edge-style): tri-mode theme + one curated hue row.
// Each dot is split light/dark (135°) previewing both modes of the family;
// families follow the resolved theme mode, mint clears to tokens.css defaults.
import { computed, ref } from 'vue'
import { useMpTheme } from '@/kernel/design/theme'
import type { MpThemePref } from '@/kernel/design/theme'
import { COLOR_FAMILIES, useMpColorFamily } from '@/kernel/design/color-families'

const { pref, theme, setPref } = useMpTheme()
const { familyId, setFamily } = useMpColorFamily()
const expanded = ref(false)

const THEME_OPTIONS: readonly { value: MpThemePref; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

const themeLabel = computed(() =>
  pref.value === 'system' ? `跟随系统 · 当前${theme.value === 'dark' ? '深色' : '浅色'}` : THEME_OPTIONS.find((opt) => opt.value === pref.value)?.label ?? '',
)
</script>

<template>
  <div>
    <!-- 设置层级分区(用户示意 图4):设置页卡片 > 通用设置 > 主题 —— 内层
         折叠区包成内嵌圆角子卡,三层嵌套肉眼可见,而不是平铺一行。 -->
    <div class="mx-3 mb-3 rounded-card border border-line">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded-card px-3 py-2.5 text-left"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <span class="block min-w-0">
          <span class="block text-sm text-ink">主题</span>
        </span>
        <svg
          class="h-4 w-4 flex-shrink-0 text-ink-3 transition-transform"
          :class="expanded ? 'rotate-180' : ''"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      <div
        v-show="expanded"
        class="rounded-b-card border-t border-line"
      >
        <div class="px-3 py-3">
          <div class="flex items-center justify-between">
            <p class="text-sm text-ink">
              整体外观
            </p>
            <p class="text-xs text-ink-3">
              {{ themeLabel }}
            </p>
          </div>
          <div
            class="mt-2 flex rounded-full border border-line-strong p-1"
            role="radiogroup"
            aria-label="主题明暗"
          >
            <button
              v-for="opt in THEME_OPTIONS"
              :key="opt.value"
              type="button"
              role="radio"
              class="min-h-[36px] flex-1 rounded-full text-xs transition-colors"
              :class="pref === opt.value ? 'bg-primary font-medium text-on-primary' : 'text-ink-2'"
              :aria-checked="pref === opt.value"
              @click="setPref(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <div class="rounded-b-card border-t border-line px-3 py-3">
          <p class="text-sm text-ink">
            配色
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <button
              v-for="family in COLOR_FAMILIES"
              :key="family.id"
              type="button"
              class="h-9 w-9 rounded-full border border-line-strong transition-transform hover:scale-105"
              :class="familyId === family.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-card' : ''"
              :style="{ background: `linear-gradient(135deg, ${family.light.accent} 50%, ${family.dark.accent} 50%)` }"
              :title="family.label"
              :aria-label="family.label"
              :aria-pressed="familyId === family.id"
              @click="setFamily(family.id)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
