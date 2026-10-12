<script setup lang="ts">
// Appearance section (Edge-style): tri-mode theme + one curated hue row.
// Each dot is split light/dark (135°) previewing both modes of the family;
// families follow the resolved theme mode, mint clears to tokens.css defaults.
import { computed, inject, onMounted, ref } from 'vue'
import { useMpTheme } from '@/kernel/design/theme'
import type { MpThemePref } from '@/kernel/design/theme'
import { COLOR_FAMILIES, useMpColorFamily } from '@/kernel/design/color-families'
import { useAcrylicSliders } from '@/kernel/design/acrylic'
import { cardBackdropDefault } from '@/kernel/app/card-backdrop-default'
import { CHARACTER_STORE_KEY } from '@/kernel/app/chat-keys'
import MintCat from '@/kernel/design/assets/MintCat.vue'
import type { CharacterStore } from '@/kernel/characters/character-store'

const { pref, theme, setPref } = useMpTheme()
const { familyId, setFamily } = useMpColorFamily()
const { glow, transparency, setGlow, setTransparency } = useAcrylicSliders()
const expanded = ref(false)

const rangeValue = (event: Event): number => Number((event.target as HTMLInputElement).value)

// Backdrop preview: the newest card cover gives the sliders something real to
// act on; cards without covers (or a bare library) fall back to the brand cat.
const characterStore = inject(CHARACTER_STORE_KEY, null)
const previewCover = ref('')
onMounted(async () => {
  if (!characterStore) return
  const cards = await (characterStore as CharacterStore).list()
  for (const card of cards) {
    const cover = await (characterStore as CharacterStore).getCover(card.id)
    if (cover) {
      previewCover.value = cover
      return
    }
  }
})
const previewImgStyle = computed(() => ({
  filter: `blur(${cardBackdropDefault.value.blur}px)`,
  transform: 'scale(1.1)',
}))
const previewDimStyle = computed(() => ({
  backgroundColor: `rgba(0, 0, 0, ${cardBackdropDefault.value.dim / 100})`,
}))

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
    <div class="m-3 rounded-card border border-line">
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
        <div class="px-3 pb-4 pt-4">
          <div class="flex items-center justify-between">
            <p class="text-sm text-ink">
              整体外观
            </p>
            <p class="text-xs text-ink-3">
              {{ themeLabel }}
            </p>
          </div>
          <div
            class="mt-3 flex rounded-full border border-line-strong p-1"
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

        <div class="rounded-b-card border-t border-line px-3 pb-4 pt-4">
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

        <!-- 材质(主题 v3):辉光 = 极光色斑强度,透明度 = 玻璃表面 alpha;
             两者即时重应用,跨启动持久。 -->
        <div class="rounded-b-card border-t border-line px-3 pb-4 pt-4">
          <p class="text-sm text-ink">
            材质
          </p>
          <label class="mt-3 flex items-center gap-2">
            <span class="w-14 flex-shrink-0 text-xs text-ink-2">辉光强度</span>
            <input
              :value="glow"
              type="range"
              min="0"
              max="150"
              step="5"
              class="min-w-0 flex-1 accent-primary"
              @input="setGlow(rangeValue($event))"
            >
            <span class="w-10 flex-shrink-0 text-right font-mono text-[10px] text-ink-3">{{ glow }}%</span>
          </label>
          <label class="mt-2 flex items-center gap-2">
            <span class="w-14 flex-shrink-0 text-xs text-ink-2">玻璃透明度</span>
            <input
              :value="transparency"
              type="range"
              min="10"
              max="70"
              step="5"
              class="min-w-0 flex-1 accent-primary"
              @input="setTransparency(rangeValue($event))"
            >
            <span class="w-10 flex-shrink-0 text-right font-mono text-[10px] text-ink-3">{{ transparency }}%</span>
          </label>
        </div>
      </div>
    </div>

    <!-- 卡图背景全局默认(1.0.x):未单独调过的卡跟随此处;单独调过的卡
         以会话设置里的随卡值为准(可「恢复跟随全局」退回)。 -->
    <div class="m-3 mt-0 rounded-card border border-line">
      <div class="px-3 py-2.5 text-sm text-ink">
        卡图背景
      </div>
      <div class="rounded-b-card border-t border-line px-3 pb-4 pt-4">
        <div class="relative h-28 overflow-hidden rounded-input border border-line">
          <img
            v-if="previewCover"
            :src="previewCover"
            alt=""
            class="h-full w-full object-cover"
            :style="previewImgStyle"
          >
          <div
            v-else
            class="flex h-full w-full items-center justify-center"
          >
            <MintCat class="h-10 w-10 text-ink-3" />
          </div>
          <div
            class="absolute inset-0"
            :style="previewDimStyle"
          />
          <!-- Mock floors: two small bubbles so the box reads as the chat
               canvas the settings will style, not just a photo widget. -->
          <div class="absolute bottom-2 left-2 h-4 w-16 rounded-bubble-ai bg-card/90" />
          <div class="absolute bottom-7 right-2 h-4 w-12 rounded-bubble-user bg-primary/80" />
        </div>
        <label class="mt-3 flex items-center gap-2">
          <span class="w-8 flex-shrink-0 text-xs text-ink-2">模糊</span>
          <input
            v-model.number="cardBackdropDefault.blur"
            type="range"
            min="0"
            max="40"
            step="2"
            class="min-w-0 flex-1 accent-primary"
          >
          <span class="w-10 flex-shrink-0 text-right font-mono text-[10px] text-ink-3">{{ cardBackdropDefault.blur }}px</span>
        </label>
        <label class="mt-2 flex items-center gap-2">
          <span class="w-8 flex-shrink-0 text-xs text-ink-2">压暗</span>
          <input
            v-model.number="cardBackdropDefault.dim"
            type="range"
            min="0"
            max="80"
            step="5"
            class="min-w-0 flex-1 accent-primary"
          >
          <span class="w-10 flex-shrink-0 text-right font-mono text-[10px] text-ink-3">{{ cardBackdropDefault.dim }}%</span>
        </label>
        <p class="mt-2 text-[10px] text-ink-3">
          未单独调整背景的卡跟随此处默认。
        </p>
      </div>
    </div>
  </div>
</template>
