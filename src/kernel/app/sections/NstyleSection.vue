<script setup lang="ts">
// 叙事风格配置器 (M4-nstyle) — 预设 / 12 项滑块 / 叙述方式 / 风格标签 /
// 自定义风格管理(存取复制删除) / 双模式预览(本地模拟 + AI 测试)。
//
// 作用域: 全局默认 / 指定故事(卡域覆盖) / 当前会话临时(内存)。
// 请求侧优先级: 会话临时 > 故事级 > 全局 > 内置默认(ChatSessionView 解析)。
// 提示词构建复用正式管线同一个 buildNarrativeStyleBlock(规范 5.4)。
import { computed, inject, onMounted, ref } from 'vue'
import {
  CHARACTER_STORE_KEY,
  NSTYLE_STORE_KEY,
  SEAM_REGISTRY_KEY,
} from '@/kernel/app/chat-keys'
import type { NstyleStore } from '@/kernel/nstyle/nstyle-store'
import { getTempOverride, setTempOverride } from '@/kernel/nstyle/nstyle-store'
import type { NstyleConfig, NstyleProfile } from '@/kernel/nstyle/types'
import {
  DEFAULT_STORY_CONFIG,
  NSTYLE_BUILTIN_TAGS,
  NSTYLE_LANGUAGES,
  NSTYLE_LENGTHS,
  NSTYLE_MONOLOGUES,
  NSTYLE_MODES,
  NSTYLE_PARAM_META,
  NSTYLE_PORTRAYALS,
  NSTYLE_PRESETS,
  NSTYLE_TENSES,
  NSTYLE_TRANSITIONS,
  NSTYLE_VIEWPOINTS,
} from '@/kernel/nstyle/types'
import { buildNarrativeStyleBlock } from '@/kernel/nstyle/prompt'
import { buildStyleSample } from '@/kernel/nstyle/sample'
import { parseProfile } from '@/kernel/nstyle/validate'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import type { CharacterStore } from '@/kernel/characters/character-store'
import { uiService } from '@/kernel/ui/toasts'

const store = inject<NstyleStore | null>(NSTYLE_STORE_KEY, null)
const seams = inject(SEAM_REGISTRY_KEY, null)
const characterStore = inject<CharacterStore | null>(CHARACTER_STORE_KEY, null)

type ScopeKind = 'global' | 'card' | 'temp'
const scopeKind = ref<ScopeKind>('global')
const scopeCardId = ref('')
const cards = ref<Array<{ id: string; name: string }>>([])

const deepCopy = (config: NstyleConfig): NstyleConfig => JSON.parse(JSON.stringify(config)) as NstyleConfig
const config = ref<NstyleConfig>(deepCopy(DEFAULT_STORY_CONFIG))
const savedSnapshot = ref(JSON.stringify(config.value))
const loadedFrom = ref('内置默认')
const activeCustomId = ref('')
const customName = ref('')
const customDesc = ref('')
const customs = ref<NstyleProfile[]>([])
const customTagInput = ref('')

const dirty = computed(() => JSON.stringify(config.value) !== savedSnapshot.value)

const loadScopeConfig = (): void => {
  if (!store) return
  let loaded: NstyleConfig | null = null
  if (scopeKind.value === 'global') {
    loaded = store.getGlobalSync()
    loadedFrom.value = loaded ? '已保存的全局风格' : '内置默认'
  } else if (scopeKind.value === 'card' && scopeCardId.value) {
    loaded = store.getCardOverrideSync(scopeCardId.value)
    loadedFrom.value = loaded ? '已保存的故事风格' : '内置默认'
  } else if (scopeKind.value === 'temp') {
    loaded = getTempOverride()
    loadedFrom.value = '当前会话临时'
  }
  config.value = loaded ? deepCopy(loaded) : deepCopy(DEFAULT_STORY_CONFIG)
  savedSnapshot.value = JSON.stringify(config.value)
  const matchCustom = customs.value.find((profile) => JSON.stringify(profile.config) === savedSnapshot.value)
  activeCustomId.value = matchCustom?.id ?? ''
  customName.value = matchCustom?.name ?? ''
  customDesc.value = matchCustom?.description ?? ''
}

const refreshCards = async (): Promise<void> => {
  if (!characterStore) return
  const list = await characterStore.list()
  cards.value = list.map((card) => ({ id: card.id, name: card.name }))
}

onMounted(async () => {
  if (!store) return
  await store.hydrated
  customs.value = store.listCustomsSync()
  await refreshCards()
  loadScopeConfig()
})

const switchScope = async (kind: ScopeKind, cardId = ''): Promise<void> => {
  if (kind === 'card' && !cardId && cards.value.length > 0) cardId = cards.value[0]!.id
  if (kind === 'card' && !cardId) {
    uiService.toast('shell', '还没有可用的故事：先在「角色」页导入角色卡', { tone: 'error' })
    return
  }
  if (dirty.value) {
    const confirmed = await uiService.confirm('shell', {
      title: '有未保存的修改',
      message: '切换作用范围将丢弃当前未保存的修改，继续吗？',
      confirmLabel: '丢弃并切换',
    })
    if (!confirmed) return
  }
  scopeKind.value = kind
  scopeCardId.value = cardId
  loadScopeConfig()
}

const setParam = (key: keyof typeof NSTYLE_PARAM_META, value: number): void => {
  config.value = { ...config.value, params: { ...config.value.params, [key]: Math.min(100, Math.max(0, Math.round(value))) } }
}

const setNarration = (key: keyof NstyleConfig['narration'], value: string): void => {
  config.value = { ...config.value, narration: { ...config.value.narration, [key]: value } }
}

const toggleTag = (tag: string): void => {
  const has = config.value.tags.includes(tag)
  config.value = { ...config.value, tags: has ? config.value.tags.filter((entry) => entry !== tag) : [...config.value.tags, tag] }
}

const addCustomTag = (): void => {
  const tag = customTagInput.value.trim().slice(0, 16)
  if (!tag || config.value.tags.includes(tag)) return
  config.value = { ...config.value, tags: [...config.value.tags, tag] }
  customTagInput.value = ''
}

const applyPreset = (profile: NstyleProfile): void => {
  config.value = deepCopy(profile.config)
  activeCustomId.value = ''
  loadedFrom.value = `预设「${profile.name}」（未保存）`
}

const restoreDefaults = (): void => {
  config.value = deepCopy(DEFAULT_STORY_CONFIG)
  activeCustomId.value = ''
  loadedFrom.value = '内置默认（未保存）'
}

const saveToScope = async (): Promise<void> => {
  if (!store) return
  const snapshot = JSON.stringify(config.value)
  if (scopeKind.value === 'temp') {
    setTempOverride(deepCopy(config.value))
    savedSnapshot.value = snapshot
    uiService.toast('shell', '已应用到当前会话（临时，不落盘）', { tone: 'success' })
    return
  }
  if (scopeKind.value === 'global') await store.setGlobal(deepCopy(config.value))
  else if (scopeCardId.value) await store.setCardOverride(scopeCardId.value, deepCopy(config.value))
  savedSnapshot.value = snapshot
  uiService.toast('shell', scopeKind.value === 'global' ? '已保存为全局默认风格' : '已保存为该故事的独立风格', { tone: 'success' })
}

const saveAsCustom = async (): Promise<void> => {
  if (!store) return
  const name = customName.value.trim()
  if (!name) {
    uiService.toast('shell', '请先填写风格名称', { tone: 'error' })
    return
  }
  if (customs.value.some((profile) => profile.name === name && profile.id !== activeCustomId.value)) {
    uiService.toast('shell', `已存在同名风格「${name}」`, { tone: 'error' })
    return
  }
  const saved = await store.saveCustom({
    id: loadedFrom.value.startsWith('自定义') ? activeCustomId.value : '',
    name,
    description: customDesc.value.trim(),
    config: deepCopy(config.value),
    builtin: false,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
  })
  customs.value = store.listCustomsSync()
  activeCustomId.value = saved.id
  loadedFrom.value = `自定义「${saved.name}」`
  savedSnapshot.value = JSON.stringify(config.value)
  uiService.toast('shell', '已保存为自定义风格', { tone: 'success' })
}

const loadProfile = (profile: NstyleProfile): void => {
  config.value = deepCopy(profile.config)
  customName.value = profile.name
  customDesc.value = profile.description
  activeCustomId.value = profile.builtin ? '' : profile.id
  loadedFrom.value = profile.builtin ? `预设「${profile.name}」（未保存）` : `自定义「${profile.name}」（未保存）`
}

const copyProfile = async (profile: NstyleProfile): Promise<void> => {
  if (!store) return
  const saved = await store.saveCustom({
    ...profile,
    id: '',
    name: `${profile.name} 副本`,
    builtin: false,
    createdAt: 0,
    updatedAt: 0,
  })
  customs.value = store.listCustomsSync()
  loadProfile(saved)
  uiService.toast('shell', `已复制为「${saved.name}」`, { tone: 'success' })
}

const removeCustom = async (profile: NstyleProfile): Promise<void> => {
  if (!store) return
  const confirmed = await uiService.confirm('shell', {
    title: '删除风格',
    message: `将删除自定义风格「${profile.name}」，不可恢复。`,
    confirmLabel: '删除',
  })
  if (!confirmed) return
  await store.deleteCustom(profile.id)
  customs.value = store.listCustomsSync()
  if (activeCustomId.value === profile.id) activeCustomId.value = ''
  uiService.toast('shell', '已删除', { tone: 'success' })
}

const exportCurrent = async (): Promise<void> => {
  const payload = JSON.stringify({ version: 1, kind: 'mintplot-nstyle', name: customName.value || '未命名', config: config.value }, null, 2)
  try {
    await navigator.clipboard.writeText(payload)
    uiService.toast('shell', '风格 JSON 已复制到剪贴板，粘贴到下方导入框即可分享', { tone: 'success' })
  } catch {
    uiService.toast('shell', '剪贴板不可用：请从预览框手动复制', { tone: 'error' })
  }
}

const importText = ref('')
const importError = ref('')
const importProfile = async (): Promise<void> => {
  let parsed: ReturnType<typeof parseProfile>
  try {
    parsed = parseProfile(JSON.parse(importText.value))
  } catch {
    importError.value = '不是合法的 JSON'
    return
  }
  if (!parsed.ok || !parsed.profile) {
    importError.value = parsed.reason ?? '配置无效'
    return
  }
  if (!store) return
  const saved = await store.saveCustom(parsed.profile)
  customs.value = store.listCustomsSync()
  importError.value = ''
  importText.value = ''
  loadProfile(saved)
  uiService.toast('shell', `已导入「${saved.name}」`, { tone: 'success' })
}

// ── 叙述方式行（键/标签/选项，模板按行渲染）──
const NARRATION_ROWS: ReadonlyArray<{ key: keyof NstyleConfig['narration']; label: string; options: Record<string, string> }> = [
  { key: 'viewpoint', label: '叙事视角', options: NSTYLE_VIEWPOINTS },
  { key: 'tense', label: '叙事时态', options: NSTYLE_TENSES },
  { key: 'monologue', label: '内心独白', options: NSTYLE_MONOLOGUES },
  { key: 'mode', label: '叙述方式', options: NSTYLE_MODES },
  { key: 'length', label: '篇幅偏好', options: NSTYLE_LENGTHS },
  { key: 'portrayal', label: '角色描写方式', options: NSTYLE_PORTRAYALS },
  { key: 'transition', label: '场景转换', options: NSTYLE_TRANSITIONS },
  { key: 'language', label: '语言复杂度', options: NSTYLE_LANGUAGES },
]

// ── 预览 ──
const previewMode = ref<'local' | 'ai'>('local')
const previewScene = ref('雨夜的站台，末班车已经开走。她撑着伞站在灯下，看见我时愣了一下。')
const aiText = ref('')
const aiBusy = ref(false)
const aiError = ref('')
const localSample = computed(() => buildStyleSample(config.value))
const styleBlockPreview = computed(() => buildNarrativeStyleBlock(config.value))

const runAiPreview = async (): Promise<void> => {
  const provider = seams?.resolve<LlmProvider>('llm.provider')?.implementation
  if (!provider) {
    aiError.value = 'AI 运行时未接入'
    return
  }
  if (!previewScene.value.trim()) {
    aiError.value = '请先填写一段场景描述'
    return
  }
  aiBusy.value = true
  aiError.value = ''
  aiText.value = ''
  try {
    const messages = [
      { role: 'system' as const, content: `${buildNarrativeStyleBlock(config.value)}\n\n【测试任务】这是只为风格预览生成的独立片段，不属于任何故事。` },
      { role: 'user' as const, content: `请按以上叙事风格，为下面的场景写一段正文：\n${previewScene.value.trim()}` },
    ]
    const result = await provider.stream(messages, {})
    aiText.value = result.content
  } catch (error) {
    aiError.value = (error as Error)?.message || '未知错误'
  } finally {
    aiBusy.value = false
  }
}
</script>

<template>
  <div
    v-if="store"
    class="flex flex-col gap-4 px-4 py-4"
    @change="saveToScope"
  >
    <div>
      <p class="text-sm font-bold text-ink">
        叙事风格配置器
      </p>
      <p class="mt-0.5 text-xs text-ink-3">
        当前来源：{{ loadedFrom }}<span
          v-if="dirty"
          class="ml-1 font-bold text-danger"
        >（有未保存的修改）</span>
      </p>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="min-h-[32px] rounded-full border px-3 py-1 text-xs"
        :class="scopeKind === 'global' ? 'border-primary bg-primary font-bold text-on-primary' : 'border-line-strong bg-card text-ink-2'"
        @click="switchScope('global')"
      >
        全局默认
      </button>
      <button
        v-for="card in cards"
        :key="card.id"
        type="button"
        class="max-w-[160px] min-h-[32px] truncate rounded-full border px-3 py-1 text-xs"
        :class="scopeKind === 'card' && scopeCardId === card.id ? 'border-primary bg-primary font-bold text-on-primary' : 'border-line-strong bg-card text-ink-2'"
        @click="switchScope('card', card.id)"
      >
        故事：{{ card.name }}
      </button>
      <button
        type="button"
        class="min-h-[32px] rounded-full border border-dashed px-3 py-1 text-xs"
        :class="scopeKind === 'temp' ? 'border-primary bg-primary font-bold text-on-primary' : 'border-line-strong bg-card text-ink-2'"
        @click="switchScope('temp')"
      >
        当前会话临时
      </button>
    </div>
    <div class="flex gap-2">
      <button
        type="button"
        class="min-h-[36px] flex-1 rounded-input bg-primary text-xs font-bold text-on-primary"
        :disabled="!dirty"
        :class="dirty ? '' : 'opacity-40'"
        @click="saveToScope"
      >
        保存到当前范围
      </button>
      <button
        type="button"
        class="min-h-[36px] flex-1 rounded-input border border-line-strong bg-card text-xs text-ink-2"
        @click="restoreDefaults"
      >
        恢复默认值
      </button>
    </div>

    <div>
      <div class="mb-1 text-xs font-medium text-ink-3">
        内置风格预设（选择后自动填充参数，可继续修改）
      </div>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="preset in NSTYLE_PRESETS"
          :key="preset.id"
          type="button"
          class="rounded-card border p-2 text-left"
          :class="loadedFrom === `预设「${preset.name}」（未保存）` ? 'border-primary' : 'border-line-strong'"
          @click="applyPreset(preset)"
        >
          <span class="block text-xs font-bold text-ink">{{ preset.name }}</span>
          <span class="mt-0.5 block text-[11px] leading-snug text-ink-3">{{ preset.description }}</span>
        </button>
      </div>
    </div>

    <div>
      <div class="mb-1 text-xs font-medium text-ink-3">
        核心叙事参数
      </div>
      <div class="flex flex-col gap-2">
        <div
          v-for="(meta, key) in NSTYLE_PARAM_META"
          :key="key"
        >
          <div class="flex items-center justify-between text-xs">
            <span class="text-ink-2">{{ meta }}</span>
            <span class="font-mono text-ink-3">{{ config.params[key] }}</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            :value="config.params[key]"
            class="h-1.5 w-full accent-primary"
            :aria-label="meta"
            @input="setParam(key, Number(($event.target as HTMLInputElement).value))"
          >
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <div class="text-xs font-medium text-ink-3">
        叙述方式
      </div>
      <div
        v-for="row in NARRATION_ROWS"
        :key="row.key"
      >
        <div class="mb-0.5 text-[11px] text-ink-3">
          {{ row.label }}
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="(label, optionKey) in row.options"
            :key="optionKey"
            type="button"
            class="min-h-[30px] rounded-full border px-2.5 text-[11px]"
            :class="config.narration[row.key] === optionKey ? 'border-primary bg-primary font-bold text-on-primary' : 'border-line-strong bg-card text-ink-2'"
            @click="setNarration(row.key, String(optionKey))"
          >
            {{ label }}
          </button>
        </div>
      </div>
    </div>

    <div>
      <div class="mb-1 text-xs font-medium text-ink-3">
        风格标签（可多选组合；自定义标签回车添加）
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="tag in NSTYLE_BUILTIN_TAGS"
          :key="tag"
          type="button"
          class="min-h-[30px] rounded-full border px-2.5 text-[11px]"
          :class="config.tags.includes(tag) ? 'border-primary bg-primary/10 font-bold text-primary' : 'border-line-strong bg-card text-ink-2'"
          @click="toggleTag(tag)"
        >
          {{ tag }}
        </button>
        <button
          v-for="tag in config.tags.filter((entry) => !NSTYLE_BUILTIN_TAGS.includes(entry))"
          :key="tag"
          type="button"
          class="min-h-[30px] rounded-full border border-primary bg-primary/10 px-2.5 text-[11px] font-bold text-primary"
          :aria-label="`移除自定义标签 ${tag}`"
          @click="toggleTag(tag)"
        >
          {{ tag }} ✕
        </button>
      </div>
      <div class="mt-1.5 flex gap-1.5">
        <input
          v-model="customTagInput"
          placeholder="自定义标签…"
          class="min-h-[32px] flex-1 rounded-input border border-line bg-bg px-2 text-xs text-ink outline-none focus:border-primary"
          @keydown.enter.prevent="addCustomTag"
        >
        <button
          type="button"
          class="min-h-[32px] rounded-input border border-line-strong bg-card px-3 text-xs text-ink-2"
          @click="addCustomTag"
        >
          添加
        </button>
      </div>
    </div>

    <div>
      <div class="mb-1 text-xs font-medium text-ink-3">
        自定义风格（{{ customs.length }}）
      </div>
      <div class="flex flex-col gap-1.5">
        <div
          v-for="profile in customs"
          :key="profile.id"
          class="flex items-center gap-1.5 rounded-card border border-line bg-bg p-2"
        >
          <button
            type="button"
            class="min-w-0 flex-1 text-left"
            @click="loadProfile(profile)"
          >
            <span class="block truncate text-xs font-bold text-ink">{{ profile.name }}</span>
            <span class="block truncate text-[11px] text-ink-3">{{ profile.description || '无描述' }}</span>
          </button>
          <button
            type="button"
            class="min-h-[30px] rounded-input border border-line px-2 text-[11px] text-ink-2"
            @click="copyProfile(profile)"
          >
            复制
          </button>
          <button
            type="button"
            class="min-h-[30px] rounded-input border border-line px-2 text-[11px] text-danger"
            @click="removeCustom(profile)"
          >
            删除
          </button>
        </div>
        <p
          v-if="customs.length === 0"
          class="text-[11px] text-ink-3"
        >
          还没有自定义风格：调好参数后在下方命名保存。
        </p>
      </div>
      <div class="mt-2 flex flex-col gap-1.5">
        <input
          v-model="customName"
          placeholder="风格名称（保存自定义时必填）"
          class="min-h-[36px] rounded-input border border-line bg-bg px-2 text-xs text-ink outline-none focus:border-primary"
        >
        <input
          v-model="customDesc"
          placeholder="风格描述（可选）"
          class="min-h-[32px] rounded-input border border-line bg-bg px-2 text-xs text-ink outline-none focus:border-primary"
        >
        <button
          type="button"
          class="min-h-[36px] rounded-input bg-primary text-xs font-bold text-on-primary"
          @click="saveAsCustom"
        >
          {{ loadedFrom.startsWith('自定义') ? '更新该自定义风格' : '另存为自定义风格' }}
        </button>
      </div>
    </div>

    <div>
      <div class="mb-1 flex items-center justify-between text-xs font-medium text-ink-3">
        <span>导入 / 导出（JSON，粘贴分享）</span>
        <button
          type="button"
          class="text-[11px] text-primary"
          @click="exportCurrent"
        >
          复制当前配置 JSON
        </button>
      </div>
      <textarea
        v-model="importText"
        rows="3"
        placeholder="粘贴风格 JSON 后点导入…"
        class="w-full resize-y rounded-input border border-line bg-bg px-2 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-primary"
      />
      <div class="mt-1 flex items-center justify-between">
        <span
          v-if="importError"
          class="text-[11px] text-danger"
        >{{ importError }}</span>
        
        <button
          type="button"
          class="min-h-[30px] rounded-input border border-line-strong bg-card px-3 text-xs text-ink-2"
          @click="importProfile"
        >
          导入
        </button>
      </div>
    </div>

    <div class="rounded-card border border-line bg-bg p-3">
      <div class="flex items-center justify-between">
        <p class="text-xs font-bold text-ink">
          预览
        </p>
        <div class="flex overflow-hidden rounded-full border border-line">
          <button
            type="button"
            class="px-2.5 py-1 text-[11px]"
            :class="previewMode === 'local' ? 'bg-primary font-bold text-on-primary' : 'bg-card text-ink-2'"
            @click="previewMode = 'local'"
          >
            本地模拟
          </button>
          <button
            type="button"
            class="px-2.5 py-1 text-[11px]"
            :class="previewMode === 'ai' ? 'bg-primary font-bold text-on-primary' : 'bg-card text-ink-2'"
            @click="previewMode = 'ai'"
          >
            AI 测试
          </button>
        </div>
      </div>

      <div
        v-if="previewMode === 'local'"
        class="mt-2"
      >
        <p class="text-[11px] text-ink-3">
          本地模拟示例（非 AI 生成）——按当前配置从固定场景「雨夜站台」拼装，用于感受参数方向：
        </p>
        <div class="mt-1 whitespace-pre-wrap rounded-card border border-line bg-card p-2.5 text-xs leading-relaxed text-ink">
          {{ localSample }}
        </div>
      </div>

      <div
        v-else
        class="mt-2"
      >
        <p class="text-[11px] text-ink-3">
          用当前配置真实调用 AI 生成测试片段（每次点击 = 一次请求）：
        </p>
        <textarea
          v-model="previewScene"
          rows="2"
          class="mt-1 w-full resize-none rounded-input border border-line bg-bg px-2 py-1.5 text-xs text-ink outline-none focus:border-primary"
        />
        <button
          type="button"
          class="mt-1 min-h-[36px] w-full rounded-input bg-primary text-xs font-bold text-on-primary disabled:opacity-40"
          :disabled="aiBusy"
          @click="runAiPreview"
        >
          {{ aiBusy ? '生成中…' : '生成测试片段' }}
        </button>
        <p
          v-if="aiError"
          class="mt-1 text-[11px] text-danger"
        >
          生成失败：{{ aiError }}（当前配置不受影响）
        </p>
        <div
          v-if="aiText"
          class="mt-1 whitespace-pre-wrap rounded-card border border-line bg-card p-2.5 text-xs leading-relaxed text-ink"
        >
          {{ aiText }}
        </div>
      </div>

      <details class="mt-2">
        <summary class="cursor-pointer text-[11px] text-ink-3">
          查看将注入请求的叙事指令
        </summary>
        <pre class="mt-1 whitespace-pre-wrap rounded-card border border-line bg-card p-2 text-[11px] leading-relaxed text-ink-2">{{ styleBlockPreview }}</pre>
      </details>
    </div>
  </div>
  <div
    v-else
    class="px-4 py-4 text-xs text-ink-3"
  >
    叙事风格存储未接入
  </div>
</template>
