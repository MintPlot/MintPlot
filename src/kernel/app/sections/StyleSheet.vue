<script setup lang="ts">
// 风格面板(叙事风格维度系统 S3,planning style-dimension-presets-plan D7):
// 卡域顶栏轻面板——跟随全局开关 + 六维度选择 chips(单选维度互斥、多选自由)
// + 装配披露(当前搭配将注入的完整文本,来源标注 全局/本卡;与世界书激活披
// 露同哲学,不做 AI 预览 D10)。选择经 save 事件交视图持久化进 CardSession
// .style;条目库与方案管理在工具页预设面板,本面板只做选择不编辑。
import { computed, ref } from 'vue'
import type { PresetSnapshot } from '@/kernel/presets/preset-store'
import { STYLE_DIMENSIONS } from '@/kernel/presets/style-dimensions'
import { resolveStyleBlock, type CardStyleSelection } from '@/kernel/presets/style-assembly'

const props = defineProps<{
  selection: CardStyleSelection | null
  snapshot: PresetSnapshot | null
}>()
const emit = defineEmits<{ save: [selection: CardStyleSelection]; close: [] }>()

const followGlobal = ref(props.selection ? props.selection.followGlobal : true)
const picks = ref<CardStyleSelection['picks']>(
  props.selection ? JSON.parse(JSON.stringify(props.selection.picks)) as CardStyleSelection['picks'] : {},
)

const dimensionEntries = (dimension: string) =>
  (props.snapshot?.entries ?? []).filter((entry) => entry.dimension === dimension)

const isPicked = (dimension: string, entryId: string): boolean =>
  (picks.value[dimension as keyof typeof picks.value] ?? []).includes(entryId)

/** Single-select dimensions replace the pick (re-click = back to 不约束);
 *  multi-select dimensions toggle membership freely. */
const togglePick = (dimension: string, entryId: string, multi: boolean): void => {
  const key = dimension as keyof typeof picks.value
  const current = [...(picks.value[key] ?? [])]
  if (multi) {
    const next = current.includes(entryId) ? current.filter((id) => id !== entryId) : [...current, entryId]
    picks.value = { ...picks.value, [key]: next }
    return
  }
  picks.value = { ...picks.value, [key]: current.includes(entryId) ? [] : [entryId] }
}

const restoreGlobal = (): void => {
  followGlobal.value = true
  emitSave()
}

const savedFlash = ref(false)
const emitSave = (): void => {
  emit('save', { followGlobal: followGlobal.value, picks: JSON.parse(JSON.stringify(picks.value)) as CardStyleSelection['picks'] })
  savedFlash.value = true
  window.setTimeout(() => { savedFlash.value = false }, 1500)
}

/** Disclosure = exactly what the request assembly resolves (same pure
 *  functions, D10: 可见性 not AI preview). Draft drives it so unsaved tweaks
 *  preview live. */
const disclosure = computed(() =>
  props.snapshot
    ? resolveStyleBlock(props.snapshot, { followGlobal: followGlobal.value, picks: picks.value }, true)
    : [])

const globalSummary = computed(() =>
  props.snapshot ? resolveStyleBlock(props.snapshot, null, true) : [])
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
    @click.self="emit('close')"
  >
    <div class="mp-mo-sheet-panel max-h-[80vh] overflow-y-auto rounded-t-2xl mp-glass-bar border-t border-line px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-bold">
          叙事
        </h2>
        <button
          type="button"
          class="rounded-input px-2 py-1 text-xs text-ink-2"
          @click="emit('close')"
        >
          完成
        </button>
      </div>

      <!-- 跟随全局:开=吃全局当前搭配(只读摘要);关=本卡独立选择 -->
      <div class="mb-3 flex items-center gap-2 rounded-input border border-line bg-bg px-3 py-2">
        <label class="flex min-w-0 flex-1 items-center gap-2 text-xs text-ink">
          <span class="min-w-0 flex-1">跟随全局搭配</span>
          <button
            type="button"
            class="relative h-5 w-9 flex-shrink-0 rounded-full transition-colors"
            :class="followGlobal ? 'bg-primary' : 'bg-line'"
            aria-label="切换跟随全局"
            @click="followGlobal = !followGlobal"
          >
            <span
              class="absolute top-0.5 h-4 w-4 rounded-full bg-card transition-all"
              :class="followGlobal ? 'left-[18px]' : 'left-0.5'"
            />
          </button>
        </label>
        <button
          v-if="!followGlobal"
          type="button"
          class="flex-shrink-0 rounded-input border border-line px-2 py-0.5 text-[10px] text-ink-3"
          @click="restoreGlobal"
        >
          恢复跟随
        </button>
      </div>

      <p
        v-if="followGlobal"
        class="mb-3 rounded-input border border-line bg-bg px-3 py-2 text-[11px] leading-relaxed text-ink-2"
      >
        <template v-if="globalSummary.length > 0">
          当前全局:{{ globalSummary.map((item) => item.entry?.name).join(' · ') }}
        </template>
        <template v-else>
          全局暂未启用任何风格条目(工具页 → 插件 → 提示词预设 可配置)
        </template>
      </p>

      <template v-else>
        <div
          v-for="meta in STYLE_DIMENSIONS"
          :key="meta.id"
          class="mb-2"
        >
          <div class="mb-1 flex items-baseline gap-1.5">
            <span class="text-xs font-bold text-ink">{{ meta.label }}</span>
            <span class="text-[10px] text-ink-3">{{ meta.multi ? '可多选' : '单选·可不选' }}</span>
          </div>
          <p
            v-if="dimensionEntries(meta.id).length === 0"
            class="text-[10px] text-ink-3"
          >
            暂无条目(可在工具页预设面板新建)
          </p>
          <div
            v-else
            class="flex flex-wrap gap-1.5"
          >
            <button
              v-for="entry in dimensionEntries(meta.id)"
              :key="entry.id"
              type="button"
              class="rounded-full border px-2.5 py-1 text-xs transition-colors"
              :class="isPicked(meta.id, entry.id) ? 'border-primary/40 bg-primary/10 text-primary' : 'border-line bg-bg text-ink-2'"
              :aria-label="`选择${meta.label}「${entry.name}」`"
              @click="togglePick(meta.id, entry.id, meta.multi)"
            >
              {{ entry.name }}
            </button>
          </div>
        </div>
      </template>

      <!-- 装配披露:与请求装配同一纯函数,展示将注入的完整文本 -->
      <div class="mt-3 rounded-input border border-line bg-bg px-3 py-2">
        <p class="text-[11px] font-bold text-ink-2">
          装配披露<template v-if="!followGlobal">
            （未保存的调整也实时预览）
          </template>
        </p>
        <p
          v-if="disclosure.length === 0"
          class="mt-1 text-[11px] text-ink-3"
        >
          当前搭配不注入任何风格文本
        </p>
        <ul class="mt-1 flex flex-col gap-1.5">
          <li
            v-for="(item, index) in disclosure"
            :key="`${item.dimension}-${item.entry?.id ?? `missing-${index}`}`"
            class="text-[11px] leading-relaxed"
          >
            <span class="font-bold text-ink">{{ item.entry?.name ?? '条目已删除' }}</span>
            <span class="ml-1 rounded-full border border-line bg-card px-1.5 py-0.5 text-[9px] text-ink-3">
              {{ item.source === 'card' ? '本卡' : '全局' }}
            </span>
            <span
              v-if="item.entry"
              class="ml-1 text-ink-3"
            >{{ item.entry.content }}</span>
          </li>
        </ul>
      </div>

      <button
        v-if="!followGlobal"
        type="button"
        class="mt-3 w-full rounded-input py-2 text-sm font-bold"
        :class="savedFlash ? 'bg-primary/15 text-primary' : 'bg-primary text-onAccent'"
        @click="emitSave"
      >
        {{ savedFlash ? '已保存' : '保存本卡风格' }}
      </button>
    </div>
  </div>
</template>
