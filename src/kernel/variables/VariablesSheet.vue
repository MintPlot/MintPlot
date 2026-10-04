<script setup lang="ts">
// 变量面板(M3-q 最小落地 → M3-t3 轻管理面):卡域会话页的「变量」段位 ——
// 值表(名称/值/来源/更新时间)、手改/增删(source=manual 事件)、删除确认;
// 模板区升级为轻管理:含脚本标签 + 变量数/记录数 + 变更记录展开 + 分析
// 状态行与「立即分析」(副模型管线入口)。卡默认值行(updatedAt 0)标记
// 「卡默认」,同样可改可删;改动经 store 落账,父视图监听 changed 同步展开态。
import { computed, inject, onMounted, ref, shallowRef, watch } from 'vue'
import type { VariableValue } from '@contracts'
import { VARIABLE_STORE_KEY } from '@/kernel/app/chat-keys'
import { manualValueFromInput } from '@/kernel/variables/variable-engine'
import { hasTemplateScripts } from '@/kernel/render/template-interp'
import type { VariableSnapshot } from '@/kernel/variables/variable-store'
import type { CardUiTemplate } from '@/kernel/characters/character-card'
import { uiService } from '@/kernel/ui/toasts'

const props = defineProps<{
  cardId: string
  templates?: CardUiTemplate[]
  analysisStatus?: string
  /** Live ledger projection from the parent view (M4-a): AI-side applies flow
   * back into the open sheet — close/reopen no longer needed to see updates. */
  live?: Pick<VariableSnapshot, 'state' | 'events'> | null
}>()
const emit = defineEmits<{ changed: [snapshot: VariableSnapshot]; close: []; analyze: [] }>()

const store = inject(VARIABLE_STORE_KEY, null)
// shallowRef — the snapshot is replaced wholesale; a deep ref's UnwrapRef
// explodes on the recursive VariableValue union (TS2589, M3-r lesson).
const snapshot = shallowRef<VariableSnapshot | null>(null)
// Per-row edit drafts — the input binds the draft, 保存 applies when it differs.
const drafts = ref<Record<string, string>>({})
// Per-template JSON drafts (M3-r template tree manual edits).
const templateDrafts = ref<Record<string, string>>({})
const draftName = ref('')
const draftValue = ref('')
const saving = ref(false)

const sourceLabels: Record<string, string> = { ai: 'AI', manual: '手动', regex: '正则' }

// Flat rows exclude template ids — template trees render as their own
// 面板 sections above, not as [object Object] rows.
const rows = computed(() => {
  const templateIds = new Set((props.templates ?? []).map((entry) => entry.id))
  return Object.entries(snapshot.value?.state ?? {}).filter(([name]) => !templateIds.has(name))
})

const templateValue = (entry: CardUiTemplate): VariableValue | undefined => snapshot.value?.state[entry.id]?.value

// 轻管理面计数(对齐 RP 语义):变量数 = 状态树顶层键数;记录数 = 该模板的
// 账本事件数(诚实计数,白名单拒绝不入账)。
const templateVariableCount = (entry: CardUiTemplate): number => {
  const value = templateValue(entry)
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value).length : 0
}
const templateRecordCount = (entry: CardUiTemplate): number => {
  let count = 0
  for (const event of snapshot.value?.events ?? []) {
    if (event.name === entry.id) count += 1
  }
  return count
}
// 变更记录(展开区):该模板的事件按时间倒序 —— 时间/来源/前后值。
const expandedTemplate = ref<string | null>(null)
const toggleTemplateRecords = (entry: CardUiTemplate): void => {
  expandedTemplate.value = expandedTemplate.value === entry.id ? null : entry.id
}
// 变更记录行：事件在折叠处就转成纯展示字段（递归联合的数组方法族会爆
// TS2589，M3-r 已记录的坑——for-of + 显式行对象是已验证的绕法）。
interface TemplateRecordRow {
  id: string
  ts: number
  source: string
  before: string
  after: string
}
const templateRecords = (entry: CardUiTemplate): TemplateRecordRow[] => {
  const rows: TemplateRecordRow[] = []
  for (const event of snapshot.value?.events ?? []) {
    if (event.name !== entry.id) continue
    rows.push({
      id: event.id,
      ts: event.ts,
      source: sourceLabels[event.source] ?? event.source,
      before: shortJson(event.before),
      after: shortJson(event.after),
    })
  }
  return rows.reverse()
}
const shortJson = (value: unknown): string => {
  if (value === null) return '已删除'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

const templateJson = (entry: CardUiTemplate): string =>
  templateDrafts.value[entry.id] ?? JSON.stringify(templateValue(entry) ?? entry.initialVariableState, null, 2)

const templateDirty = (entry: CardUiTemplate): boolean => templateDrafts.value[entry.id] !== undefined

const saveTemplate = async (entry: CardUiTemplate): Promise<void> => {
  if (!store || saving.value) return
  const raw = templateDrafts.value[entry.id]
  if (raw === undefined) return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    uiService.toast('shell', 'JSON 格式有误，未保存', { tone: 'error' })
    return
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    uiService.toast('shell', '变量树必须是 JSON 对象', { tone: 'error' })
    return
  }
  saving.value = true
  try {
    const next = await store.apply(props.cardId, [{ name: entry.id, raw: parsed as VariableValue }], { source: 'manual' })
    snapshot.value = next
    emit('changed', next)
    delete templateDrafts.value[entry.id]
  } finally {
    saving.value = false
  }
}

const load = async (): Promise<void> => {
  const loaded = (await store?.get(props.cardId)) ?? null
  // The parent's live projection is candidate-aware (M4-c); the raw store
  // replay is not — prefer the live state/events whenever it is connected.
  snapshot.value = props.live && loaded
    ? { ...loaded, state: props.live.state, events: props.live.events }
    : loaded
  drafts.value = {}
  templateDrafts.value = {}
}

onMounted(load)

// M4-a 回灌:parent-owned state/events are replaced wholesale on every AI
// apply; merge them into the open sheet. Drafts (row + template JSON) are
// kept — an in-progress manual edit must survive a background ledger update.
watch(
  () => props.live,
  (live) => {
    if (!live || !snapshot.value) return
    snapshot.value = { ...snapshot.value, state: live.state, events: live.events }
  },
)

const sourceOf = (sourceEventId: string): string => {
  if (sourceEventId === 'seed') return '卡默认'
  // Plain loop — Array.find's generic overload blows up on the recursive
  // VariableValue type inside the event payload (TS2589).
  let found: string | undefined
  for (const entry of snapshot.value?.events ?? []) {
    if (entry.id === sourceEventId) {
      found = entry.source
      break
    }
  }
  return sourceLabels[found ?? ''] ?? '手动'
}

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
        v-if="rows.length === 0 && (props.templates?.length ?? 0) === 0"
        class="py-6 text-center text-xs text-ink-3"
      >
        暂无变量 —— AI 回复带 &lt;setvars&gt; 块时自动记录,也可在下方手动添加
      </p>

      <div
        v-for="entry in props.templates"
        :key="entry.id"
        class="mb-2 rounded-input border border-line bg-bg px-3 py-2"
      >
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-sm text-ink">面板·{{ entry.name }}</span>
          <button
            v-if="templateDirty(entry)"
            type="button"
            class="flex-shrink-0 rounded-input bg-primary px-2 py-1 text-xs font-bold text-on-primary"
            @click="saveTemplate(entry)"
          >
            保存
          </button>
        </div>
        <div class="mt-0.5 flex items-center gap-2">
          <span
            v-if="hasTemplateScripts(entry.htmlTemplate)"
            class="flex-shrink-0 rounded-full border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger"
            title="模板含可执行脚本（<script>/内联事件/iframe），在沙箱 iframe 中运行；仅在使用来源可信的卡片时保留"
          >
            含脚本
          </span>
          <button
            type="button"
            class="min-w-0 flex-1 truncate text-left text-[10px] text-ink-3"
            @click="toggleTemplateRecords(entry)"
          >
            {{ templateVariableCount(entry) }} 个变量 · {{ templateRecordCount(entry) }} 条记录
            <span
              v-if="templateRecordCount(entry) > 0"
              class="text-primary"
            >
              {{ expandedTemplate === entry.id ? '▲' : '▼' }}
            </span>
          </button>
        </div>
        <div
          v-if="expandedTemplate === entry.id"
          class="mt-1 rounded-input border border-line bg-card px-2 py-1.5"
        >
          <p
            v-if="templateRecords(entry).length === 0"
            class="py-1 text-center text-[10px] text-ink-3"
          >
            暂无变更记录
          </p>
          <div
            v-for="record in templateRecords(entry)"
            :key="record.id"
            class="border-b border-line/60 py-1 text-[10px] text-ink-2 last:border-b-0"
          >
            <div class="flex items-center gap-2">
              <span class="flex-shrink-0 text-ink-3">{{ new Date(record.ts).toLocaleString() }}</span>
              <span class="flex-shrink-0 rounded-full bg-bg px-1.5 text-[9px] text-ink-3">{{ record.source }}</span>
            </div>
            <div class="mt-0.5 break-all font-mono text-[9px] leading-relaxed text-ink-3">
              {{ record.before }} → {{ record.after }}
            </div>
          </div>
        </div>
        <textarea
          :value="templateJson(entry)"
          rows="8"
          spellcheck="false"
          class="mt-1 w-full resize-y rounded-input border border-line bg-card px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ink outline-none focus:border-primary"
          @input="templateDrafts[entry.id] = ($event.target as HTMLTextAreaElement).value"
        />
        <p class="mt-1 text-[10px] text-ink-3">
          状态树(JSON) —— AI 每轮更新,也可直接改后保存
        </p>
      </div>

      <div
        v-if="(props.templates?.length ?? 0) > 0"
        class="mb-2 flex items-center gap-2 rounded-input border border-line bg-bg px-3 py-2"
      >
        <span class="min-w-0 flex-1 truncate text-xs text-ink-2">
          {{ analysisStatus || '变量分析待命' }}
        </span>
        <button
          type="button"
          class="flex-shrink-0 rounded-input border border-primary px-2 py-1 text-xs text-primary disabled:opacity-40"
          :disabled="!!analysisStatus && analysisStatus.includes('…')"
          @click="emit('analyze')"
        >
          立即分析
        </button>
      </div>

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
