<script setup lang="ts">
// 外观分区(仿 Edge 外观色彩系统):明暗三档(浅色 / 深色 / 跟随系统)+ 配色
// 主题卡网格(迷你预览、单选高亮);"自定义"保留四通道独立选色,不与主题绑定。
// 配色背景即主题底色,按钮与界面颜色随背景联动。
import { computed, ref } from 'vue'
import { useMpTheme } from '@/kernel/design/theme'
import type { MpThemePref } from '@/kernel/design/theme'
import { CHAT_COLOR_SLOTS, CHAT_PRESETS, CHAT_SWATCH_OPTIONS, activePresetId, useMpChatPalette } from '@/kernel/design/chat-palette'
import type { MpChatColorKey } from '@/kernel/design/chat-palette'

const { pref, theme, setPref } = useMpTheme()
const { chatPalette, setColor, applyPreset, resetToTheme } = useMpChatPalette()
const expanded = ref(false)

const THEME_OPTIONS: readonly { value: MpThemePref; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

const themeLabel = computed(() =>
  pref.value === 'system' ? `跟随系统 · 当前${theme.value === 'dark' ? '深色' : '浅色'}` : THEME_OPTIONS.find((opt) => opt.value === pref.value)?.label ?? '',
)

interface ThemeCard {
  readonly id: string
  readonly label: string
  /** null = 薄荷默认:预览取当前主题令牌,点击回落跟随主题。 */
  readonly colors: Readonly<Record<MpChatColorKey, string>> | null
}

const THEME_CARDS: readonly ThemeCard[] = [
  { id: 'default', label: '薄荷默认', colors: null },
  ...CHAT_PRESETS.map((preset) => ({ id: preset.id, label: preset.label, colors: { ...preset.colors } })),
]

const THEME_VAR: Readonly<Record<MpChatColorKey, string>> = {
  bg: 'rgb(var(--mp-c-bg))',
  bubbleUser: 'rgb(var(--mp-c-bubble-user))',
  bubbleAi: 'rgb(var(--mp-c-bubble-ai))',
  accent: 'rgb(var(--mp-c-chat-accent))',
}

const cardColor = (card: ThemeCard, key: MpChatColorKey): string => (card.colors ? card.colors[key] : THEME_VAR[key]!)

const activeId = computed(() => activePresetId(chatPalette))

const pickCard = (card: ThemeCard): void => {
  if (card.colors) applyPreset(card.id)
  else resetToTheme()
}
</script>

<template>
  <div>
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="block min-w-0">
        <span class="block text-sm text-ink">主题与配色</span>
        <span class="block text-xs text-ink-3">浅色 / 深色 / 跟随系统；配色主题联动全局界面</span>
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
      class="border-t border-line"
    >
      <div class="px-4 py-3">
        <div class="flex items-center justify-between">
          <p class="text-sm text-ink">
            主题
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

      <div class="border-t border-line px-4 py-3">
        <p class="text-sm text-ink">
          配色
        </p>
        <p class="text-xs text-ink-3">
          背景即主题底色，按钮与界面颜色随背景联动
        </p>

        <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            v-for="card in THEME_CARDS"
            :key="card.id"
            type="button"
            class="rounded-card border p-2 text-left transition-shadow"
            :class="activeId === card.id ? 'border-primary ring-1 ring-primary' : 'border-line-strong'"
            :aria-pressed="activeId === card.id"
            @click="pickCard(card)"
          >
            <span
              class="relative block h-14 overflow-hidden rounded-input border border-line"
              :style="{ background: cardColor(card, 'bg') }"
            >
              <span
                class="absolute left-1.5 top-1.5 h-1 w-7 rounded-full"
                :style="{ background: cardColor(card, 'accent') }"
              />
              <span
                class="absolute right-1.5 top-5 h-2.5 w-9 rounded-full"
                :style="{ background: cardColor(card, 'bubbleUser') }"
              />
              <span
                class="absolute left-1.5 top-9 h-2.5 w-11 rounded-full"
                :style="{ background: cardColor(card, 'bubbleAi') }"
              />
            </span>
            <span class="mt-1.5 block text-xs text-ink-2">{{ card.label }}</span>
          </button>
        </div>

        <p class="mt-4 text-xs text-ink-3">
          自定义 —— 四通道可分开选择
        </p>
        <div
          v-for="slot in CHAT_COLOR_SLOTS"
          :key="slot.key"
          class="mt-2"
        >
          <p class="text-xs text-ink-2">
            {{ slot.label }}
          </p>
          <div class="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="min-h-[32px] rounded-full border border-dashed border-line-strong px-3 py-1 text-xs text-ink-3"
              :class="chatPalette[slot.key] === null ? 'ring-2 ring-primary' : ''"
              :aria-pressed="chatPalette[slot.key] === null"
              @click="setColor(slot.key, null)"
            >
              跟随
            </button>
            <button
              v-for="opt in CHAT_SWATCH_OPTIONS[slot.key]"
              :key="opt.hex"
              type="button"
              class="h-9 w-9 rounded-full border border-line-strong"
              :class="chatPalette[slot.key] === opt.hex ? 'ring-2 ring-primary ring-offset-2 ring-offset-card' : ''"
              :style="{ background: opt.hex }"
              :title="opt.label"
              :aria-label="`${slot.label}:${opt.label}`"
              :aria-pressed="chatPalette[slot.key] === opt.hex"
              @click="setColor(slot.key, opt.hex)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
