<script setup lang="ts">
// 世界书面板(M3-u 轻管理,D7):条目列表(名/蓝绿灯标签/启停开关/字数)+搜索
// +激活披露(本次注入了哪些/预算丢了多少——RP/ST 都静默丢弃,MP 用可见性差异
// 化)+预算/扫描深度设置。启停 = 设备库覆盖层(worldbook-store),永不回写卡
// 记录;预算走 mp_settings(0=不限)。
import { computed, inject, onMounted, ref } from 'vue'
import type { WorldbookEntry } from '@/kernel/worldinfo/worldbook-engine'
import type { WorldbookActivationReport } from '@/kernel/worldinfo/worldbook-engine'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'
import type { SettingsState } from '@/kernel/settings/settings-state'

const props = defineProps<{
  entries: WorldbookEntry[]
  disabledUids: ReadonlySet<number>
  report: WorldbookActivationReport | null
}>()
const emit = defineEmits<{ toggle: [uid: number]; close: [] }>()

const settingsState = inject<SettingsState | null>(SETTINGS_STATE_KEY, null)
const tokenBudget = ref(4000)
const scanDepth = ref(2)

onMounted(() => {
  if (!settingsState) return
  const scope = settingsState.scope(['worldInfoTokenBudget', 'worldInfoScanDepth'])
  tokenBudget.value = Math.max(0, Number(scope.worldInfoTokenBudget ?? 4000) || 0)
  scanDepth.value = Math.min(20, Math.max(1, Number(scope.worldInfoScanDepth ?? 2) || 2))
})

const persist = (): void => {
  if (!settingsState) return
  const scope = settingsState.scope(['worldInfoTokenBudget', 'worldInfoScanDepth'])
  scope.worldInfoTokenBudget = Math.max(0, Math.round(tokenBudget.value))
  scope.worldInfoScanDepth = Math.min(20, Math.max(1, Math.round(scanDepth.value)))
}

const search = ref('')
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return props.entries
  return props.entries.filter(
    (entry) => entry.comment.toLowerCase().includes(query) || entry.keys.some((key) => key.toLowerCase().includes(query)),
  )
})

const charCount = (entry: WorldbookEntry): string => {
  const length = entry.content.length
  return length >= 10000 ? `${Math.round(length / 1000)}k 字` : `${length} 字`
}

const toggle = (entry: WorldbookEntry): void => emit('toggle', entry.uid)
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
    @click.self="emit('close')"
  >
    <div class="max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-line bg-card px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-bold">
          世界书
        </h2>
        <button
          type="button"
          class="rounded-input px-2 py-1 text-xs text-ink-2"
          @click="emit('close')"
        >
          完成
        </button>
      </div>

      <!-- 激活披露:本次请求的注入与丢弃(可见性差异化) -->
      <div
        v-if="report"
        class="mb-2 rounded-input border border-line bg-bg px-3 py-2 text-[11px] leading-relaxed text-ink-2"
      >
        <p>
          本次请求:注入
          <b class="text-ink">{{ report.injected.length }}</b>
          条<template v-if="report.droppedByBudget > 0">
            · 预算丢弃
            <b class="text-danger">{{ report.droppedByBudget }}</b>
            条
          </template><template v-if="report.notTriggered > 0">
            · 未触发
            {{ report.notTriggered }}
            条
          </template>
        </p>
        <p
          v-if="report.droppedByBudget > 0"
          class="mt-0.5 text-[10px] text-ink-3"
        >
          预算按优先级整条丢弃(生态惯例)——可在设置调大世界书预算
        </p>
        <ul
          v-if="report.injected.length > 0"
          class="mt-1 flex flex-wrap gap-1"
        >
          <li
            v-for="item in report.injected"
            :key="`${item.comment}-${item.position}`"
            class="rounded-full bg-bg px-1.5 py-0.5 text-[10px] text-ink-3"
          >
            {{ item.comment || '条目' }}
          </li>
        </ul>
      </div>

      <!-- 预算与扫描深度(本次会话即生效,下一轮请求起用) -->
      <div
        v-if="settingsState"
        class="mb-2 flex items-center gap-3 rounded-input border border-line bg-bg px-3 py-2 text-[11px] text-ink-2"
        @change="persist"
      >
        <label class="flex min-w-0 flex-1 items-center gap-1.5">
          预算
          <input
            v-model.number="tokenBudget"
            type="number"
            min="0"
            step="500"
            class="w-20 rounded-input border border-line bg-card px-1.5 py-0.5 text-ink outline-none focus:border-primary"
          >
        </label>
        <label class="flex min-w-0 flex-1 items-center gap-1.5">
          扫描楼层
          <input
            v-model.number="scanDepth"
            type="number"
            min="1"
            max="20"
            class="w-14 rounded-input border border-line bg-card px-1.5 py-0.5 text-ink outline-none focus:border-primary"
          >
        </label>
        <span class="flex-shrink-0 text-[10px] text-ink-3">预算 0=不限</span>
      </div>

      <input
        v-model="search"
        placeholder="搜索名称或关键词…"
        class="mb-2 w-full rounded-input border border-line bg-bg px-3 py-1.5 text-sm text-ink outline-none focus:border-primary"
      >

      <p
        v-if="filtered.length === 0"
        class="py-6 text-center text-xs text-ink-3"
      >
        {{ props.entries.length === 0 ? '这张卡没有自带世界书' : '没有匹配的条目' }}
      </p>

      <ul class="flex flex-col gap-2">
        <li
          v-for="entry in filtered"
          :key="entry.uid"
          class="rounded-input border border-line bg-bg px-3 py-2"
        >
          <div class="flex items-center gap-2">
            <span
              class="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
              :class="entry.constant ? 'border border-primary/40 bg-primary/10 text-primary' : 'border border-line bg-card text-ink-3'"
            >
              {{ entry.constant ? '蓝灯' : '绿灯' }}
            </span>
            <span class="min-w-0 flex-1 truncate text-sm text-ink">
              {{ entry.comment || `条目 ${entry.uid + 1}` }}
            </span>
            <span class="flex-shrink-0 text-[10px] text-ink-3">{{ charCount(entry) }}</span>
            <button
              type="button"
              class="relative h-5 w-9 flex-shrink-0 rounded-full transition-colors"
              :class="entry.enabled && !disabledUids.has(entry.uid) ? 'bg-primary' : 'bg-line'"
              :aria-label="`切换条目「${entry.comment || entry.uid + 1}」`"
              @click="toggle(entry)"
            >
              <span
                class="absolute top-0.5 h-4 w-4 rounded-full bg-card transition-all"
                :class="entry.enabled && !disabledUids.has(entry.uid) ? 'left-[18px]' : 'left-0.5'"
              />
            </button>
          </div>
          <p
            v-if="entry.keys.length > 0"
            class="mt-1 truncate text-[10px] text-ink-3"
          >
            关键词: {{ entry.keys.join(' / ') }}
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>
