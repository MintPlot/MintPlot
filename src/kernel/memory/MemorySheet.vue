<script setup lang="ts">
// 记忆面板(M4-e 会话级轻管理,D8):状态行/统计、摘要全文(长/短)、角色档案
// (人物/关系/开放剧情)、批次记录、立即总结与清空重建。账本真源在
// memory:<kind>:<id>,状态由父视图下行;动作只发事件——确认模态与摘要管线
// 都在父视图(与 VariablesSheet 的 analyze 事件同款分工)。
import { computed } from 'vue'
import type { MemoryBatchRecord, MemoryState } from '@/kernel/memory/memory-engine'

const props = defineProps<{
  state: MemoryState | null
  status: string
  busy: boolean
  floorCount: number
}>()
const emit = defineEmits<{ close: []; summarize: []; rebuild: [] }>()

const hasContent = computed(() => {
  const state = props.state
  if (!state) return false
  return Boolean(
    state.short.trim()
    || state.long.trim()
    || state.profile.characters.length > 0
    || state.profile.relations.length > 0
    || state.profile.openPlots.length > 0,
  )
})

const recentBatches = computed<MemoryBatchRecord[]>(() => (props.state?.batches ?? []).slice(-12).reverse())

const batchLabel = (batch: MemoryBatchRecord): string =>
  `${batch.from + 1}–${batch.to} 楼 ${batch.status === 'done' ? '✓' : '✗'}`
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
    @click.self="emit('close')"
  >
    <div class="mp-mo-sheet-panel max-h-[75vh] overflow-y-auto rounded-t-2xl mp-glass-bar border-t border-line px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-bold">
          记忆
        </h2>
        <button
          type="button"
          class="rounded-input px-2 py-1 text-xs text-ink-2"
          @click="emit('close')"
        >
          完成
        </button>
      </div>

      <div class="mb-2 flex items-center justify-between gap-2 rounded-input border border-line bg-bg px-3 py-2 text-xs text-ink-2">
        <span class="min-w-0 flex-1 break-words">{{ status || (hasContent ? '记忆已是最新' : '尚无记忆 · 楼层超出保留窗口后自动整理') }}</span>
        <span class="flex-shrink-0 text-[10px] text-ink-3">已整理 {{ state?.anchor ?? 0 }} / 共 {{ floorCount }} 楼</span>
      </div>

      <div class="mb-3 flex gap-2">
        <button
          type="button"
          class="flex-1 rounded-input border border-line bg-bg py-1.5 text-xs font-bold text-primary disabled:opacity-40"
          :disabled="busy"
          @click="emit('summarize')"
        >
          {{ busy ? '整理中…' : '立即总结' }}
        </button>
        <button
          type="button"
          class="flex-1 rounded-input border border-danger/40 bg-bg py-1.5 text-xs text-danger disabled:opacity-40"
          :disabled="busy"
          @click="emit('rebuild')"
        >
          清空重建
        </button>
      </div>

      <p
        v-if="!hasContent"
        class="py-6 text-center text-xs text-ink-3"
      >
        这张卡还没有记忆。多聊几轮,超出保留窗口的旧楼会自动整理成摘要与档案。
      </p>

      <template v-else>
        <div
          v-if="state?.long.trim()"
          class="mb-2 rounded-input border border-line bg-bg px-3 py-2"
        >
          <p class="mb-1 text-[10px] font-bold text-ink-3">
            长期摘要
          </p>
          <p class="whitespace-pre-wrap text-xs leading-relaxed text-ink">
            {{ state.long }}
          </p>
        </div>
        <div
          v-if="state?.short.trim()"
          class="mb-2 rounded-input border border-line bg-bg px-3 py-2"
        >
          <p class="mb-1 text-[10px] font-bold text-ink-3">
            短期摘要
          </p>
          <p class="whitespace-pre-wrap text-xs leading-relaxed text-ink">
            {{ state.short }}
          </p>
        </div>

        <div
          v-if="state && state.profile.characters.length > 0"
          class="mb-2 rounded-input border border-line bg-bg px-3 py-2"
        >
          <p class="mb-1 text-[10px] font-bold text-ink-3">
            人物
          </p>
          <p
            v-for="entry in state.profile.characters"
            :key="entry.name"
            class="text-xs leading-relaxed text-ink"
          >
            {{ entry.name }}：{{ entry.status }}
          </p>
        </div>
        <div
          v-if="state && state.profile.relations.length > 0"
          class="mb-2 rounded-input border border-line bg-bg px-3 py-2"
        >
          <p class="mb-1 text-[10px] font-bold text-ink-3">
            关系
          </p>
          <p
            v-for="(entry, index) in state.profile.relations"
            :key="index"
            class="text-xs leading-relaxed text-ink"
          >
            {{ entry.from }} → {{ entry.to }}：{{ entry.relation }}
          </p>
        </div>
        <div
          v-if="state && state.profile.openPlots.length > 0"
          class="mb-2 rounded-input border border-line bg-bg px-3 py-2"
        >
          <p class="mb-1 text-[10px] font-bold text-ink-3">
            开放剧情
          </p>
          <p
            v-for="(entry, index) in state.profile.openPlots"
            :key="index"
            class="text-xs leading-relaxed text-ink"
          >
            · {{ entry.summary }}<span
              v-if="entry.deadline"
              class="text-ink-3"
            >（{{ entry.deadline }}）</span>
          </p>
        </div>

        <div
          v-if="recentBatches.length > 0"
          class="rounded-input border border-line bg-bg px-3 py-2"
        >
          <p class="mb-1 text-[10px] font-bold text-ink-3">
            整理记录（最近 {{ recentBatches.length }} 批）
          </p>
          <p
            v-for="(batch, index) in recentBatches"
            :key="index"
            class="text-[10px] leading-relaxed"
            :class="batch.status === 'done' ? 'text-ink-2' : 'text-danger'"
            :title="batch.error"
          >
            {{ batchLabel(batch) }}
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
