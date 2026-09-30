<script setup lang="ts">
// 变量面板(M3-q,评审 Q6 最小落地):卡域会话页的「变量」段位 —— 值表
// (名称/值/来源/更新时间)、手改/增删(source=manual 事件)、删除确认。
// 卡默认值行(updatedAt 0)标记「卡默认」,同样可改可删;改动经 store 落账,
// 父视图监听 changed 同步展开态。
import { computed, inject, onMounted, ref } from 'vue'
import type { VariableValue } from '@contracts'
import { VARIABLE_STORE_KEY } from '@/kernel/app/chat-keys'
import { manualValueFromInput } from '@/kernel/variables/variable-engine'
import type { VariableSnapshot } from '@/kernel/variables/variable-store'
import { uiService } from '@/kernel/ui/toasts'

const props = defineProps<{ cardId: string }>()
const emit = defineEmits<{ changed: [snapshot: VariableSnapshot]; close: [] }>()

const store = inject(VARIABLE_STORE_KEY, null)
const snapshot = ref<VariableSnapshot | null>(null)
// Per-row edit drafts — the input binds the draft, 保存 applies when it differs.
const drafts = ref<Record<string, string>>({})
const draftName = ref('')
const draftValue = ref('')
const saving = ref(false)

const sourceLabels: Record<string, string> = { ai: 'AI', manual: '手动', regex: '正则' }

const rows = computed(() => Object.entries(snapshot.value?.state ?? {}))

const load = async (): Promise<void> => {
  snapshot.value = (await store?.get(props.cardId)) ?? null
  drafts.value = {}
}

onMounted(load)

const sourceOf = (sourceEventId: string): string =>
  sourceEventId === 'seed' ? '卡默认' : (sourceLabels[snapshot.value?.events.find((event) => event.id === sourceEventId)?.source ?? ''] ?? '手动')

const timeOf = (updatedAt: number): string => (updatedAt > 0 ? new Date(updatedAt).toLocaleString() : '建档时播种')

const isDirty = (name: string): boolean => drafts.value[name] !== undefined && drafts.value[name] !== String(snapshot.value?.state[name]?.value ?? '')

const saveRow = async (name: string): Promise<void> => {
  if (!store || saving.value) return
  const raw = manualValueFromInput(drafts.value[name] ?? '')
  if (raw === null) return
  saving.value = true
  try {
    const next = await store.apply(props.cardId, [{ name, raw }], { source: 'manual' })
    snapshot.value = next
    emit('changed', next)
    // Clear the consumed draft so the input falls back to showing the
    // current value as its placeholder.
    delete drafts.value[name]
  } finally {
    saving.value = false
  }
}

const addVariable = async (): Promise<void> => {
  if (!store || saving.value) return
  const name = draftName.value.trim()
  const raw = manualValueFromInput(draftValue.value)
  if (!name || raw === null) return
  saving.value = true
  try {
    const next = await store.apply(props.cardId, [{ name, raw }], { source: 'manual' })
    snapshot.value = next
    emit('changed', next)
    draftName.value = ''
    draftValue.value = ''
  } finally {
    saving.value = false
  }
}

const removeVariable = async (name: string): Promise<void> => {
  if (!store || saving.value) return
  const confirmed = await uiService.confirm('shell', {
    title: '删除变量',
    message: `删除变量「${name}」?`,
    confirmLabel: '删除',
  })
  if (!confirmed) return
  saving.value = true
  try {
    const next = await store.apply(props.cardId, [{ name, raw: null }], { source: 'manual' })
    snapshot.value = next
    emit('changed', next)
  } finally {
    saving.value = false
  }
}

const displayValue = (value: VariableValue): string => String(value)
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
    @click.self="emit('close')"
  >
    <div class="max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-line bg-card px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-bold">
          变量
        </h2>
        <button
          type="button"
          class="rounded-input px-2 py-1 text-xs text-ink-2"
          @click="emit('close')"
        >
          完成
        </button>
      </div>

      <p
        v-if="rows.length === 0"
        class="py-6 text-center text-xs text-ink-3"
      >
        暂无变量 —— AI 回复带 &lt;setvars&gt; 块时自动记录,也可在下方手动添加
      </p>

      <ul class="flex flex-col gap-2">
        <li
          v-for="[name, variable] in rows"
          :key="name"
          class="rounded-input border border-line bg-bg px-3 py-2"
        >
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-sm text-ink">{{ name }}</span>
            <span class="flex-shrink-0 text-[10px] text-ink-3">{{ sourceOf(variable.sourceEventId) }}</span>
            <button
              type="button"
              class="flex-shrink-0 text-xs text-ink-3 active:text-danger"
              :aria-label="`删除变量「${name}」`"
              @click="removeVariable(name)"
            >
              ✕
            </button>
          </div>
          <div class="mt-1 flex items-center gap-2">
            <input
              v-model="drafts[name]"
              :placeholder="displayValue(variable.value)"
              class="min-w-0 flex-1 rounded-input border border-line bg-card px-2 py-1 text-sm text-ink outline-none focus:border-primary"
              @keydown.enter="isDirty(name) && saveRow(name)"
            >
            <button
              v-if="isDirty(name)"
              type="button"
              class="flex-shrink-0 rounded-input bg-primary px-2 py-1 text-xs font-bold text-on-primary"
              @click="saveRow(name)"
            >
              保存
            </button>
          </div>
          <p class="mt-1 text-[10px] text-ink-3">
            {{ timeOf(variable.updatedAt) }}
          </p>
        </li>
      </ul>

      <div class="mt-3 flex items-center gap-2">
        <input
          v-model="draftName"
          placeholder="名称"
          class="w-24 rounded-input border border-line bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-primary"
        >
        <input
          v-model="draftValue"
          placeholder="值(支持 +10 增量)"
          class="min-w-0 flex-1 rounded-input border border-line bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-primary"
          @keydown.enter="addVariable"
        >
        <button
          type="button"
          class="flex-shrink-0 rounded-input bg-primary px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-40"
          :disabled="!draftName.trim() || draftValue.trim() === ''"
          @click="addVariable"
        >
          添加
        </button>
      </div>
    </div>
  </div>
</template>
