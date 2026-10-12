<script setup lang="ts">
// 会话设置面板(M4-g3 parity):chatbox 域 = 会话名称 + 会话级 system prompt
// 编辑 + 模型覆盖;卡域 = 模型覆盖 + 卡图背景调节(1.0.x:开关/模糊/压暗,
// 随卡信封持久)。模型覆盖只换模型名,端点与密钥仍走激活档案;空 = 跟随全局。
// 模型列表经「拉取」按钮从激活档案端点实时获取(M4-b fetchModelList)。
import { computed, ref, watch } from 'vue'
import { fetchModelList } from '@/kernel/llm/api-profiles'
import { resolveApiConfig } from '@/kernel/llm/api-profiles'
import type { SettingsState } from '@/kernel/settings/settings-state'
import type { ChatboxConversation } from '@/kernel/sessions/chatbox-store'
import type { CardBackdrop, CardSession } from '@/kernel/sessions/card-session-store'
import { cardBackdropDefault } from '@/kernel/app/card-backdrop-default'
import ToggleSwitch from '@/kernel/app/ui/ToggleSwitch.vue'

const props = defineProps<{
  domain: 'chatbox' | 'card'
  conversation: ChatboxConversation | null
  cardSession: CardSession | null
  settingsState: SettingsState | null
  cardCover?: string
}>()

// `preview` fires on every slider/switch move — the parent overlays it on the
// live backdrop so tweaks show immediately; cleared on close (revert) and on
// save (the envelope takes over). `reset-bg` drops the per-card tuning so the
// card follows the global default again.
const emit = defineEmits<{
  close: []
  saved: [{ title: string; systemPrompt: string; model: string; bg?: CardBackdrop }]
  preview: [bg: CardBackdrop]
  'reset-bg': []
}>()

/** An untouched card follows the global default — the sheet pre-fills with
 *  those numbers; a card-tuned envelope overrides field by field. */
const backdropDraft = (): CardBackdrop => ({
  enabled: true,
  ...cardBackdropDefault.value,
  ...(props.cardSession?.bg ?? {}),
})

const draftTitle = ref('')
const draftPrompt = ref('')
const draftModel = ref('')
const draftBg = ref<CardBackdrop>(backdropDraft())
const modelOptions = ref<string[]>([])
const fetching = ref(false)
const fetchNote = ref('')

const isChatbox = computed(() => props.domain === 'chatbox')
const hasBackdrop = computed(() => !isChatbox.value && !!props.cardCover)
/** The reset affordance only makes sense when the card has its own tuning. */
const cardTuned = computed(() => !!props.cardSession?.bg)

watch(
  () => [props.conversation, props.cardSession] as const,
  () => {
    draftTitle.value = props.conversation?.title ?? ''
    draftPrompt.value = props.conversation?.systemPrompt ?? ''
    draftModel.value = props.conversation?.model || props.cardSession?.model || ''
    draftBg.value = backdropDraft()
    modelOptions.value = []
    fetchNote.value = ''
  },
  { immediate: true },
)

// Live preview: every draft change rides out to the parent's backdrop.
watch(draftBg, (value) => {
  if (hasBackdrop.value) emit('preview', { ...value })
}, { deep: true })

const resetBackdrop = (): void => {
  draftBg.value = { enabled: true, ...cardBackdropDefault.value }
  emit('preview', { ...draftBg.value })
  emit('reset-bg')
}

const pullModels = async (): Promise<void> => {
  if (!props.settingsState || fetching.value) return
  fetching.value = true
  fetchNote.value = ''
  try {
    const config = resolveApiConfig(props.settingsState.snapshot())
    const models = await fetchModelList(config)
    modelOptions.value = models
    fetchNote.value = models.length > 0 ? `获取到 ${models.length} 个模型` : '端点没有返回模型列表'
  } catch (error) {
    fetchNote.value = `拉取失败:${(error as Error)?.message || '未知错误'}`
  } finally {
    fetching.value = false
  }
}

const save = (): void => {
  // The parent owns the store objects (vue/no-mutating-props) — hand over
  // the drafts; '' = follow the global profile (the seam treats empty as
  // no override) and keep the current title (rename is opt-in). The bg
  // draft only carries in the card domain (chatbox has no backdrop).
  emit('saved', {
    title: draftTitle.value.trim(),
    systemPrompt: draftPrompt.value,
    model: draftModel.value.trim(),
    ...(hasBackdrop.value ? { bg: { ...draftBg.value } } : {}),
  })
  emit('close')
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
    @click.self="emit('close')"
  >
    <div class="max-h-[80vh] overflow-y-auto rounded-t-2xl bg-card px-4 pb-6 pt-3">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-bold text-ink">
          会话设置
        </h2>
        <button
          type="button"
          class="rounded-input px-2 py-1 text-xs text-ink-3"
          @click="emit('close')"
        >
          关闭
        </button>
      </div>

      <template v-if="isChatbox">
        <div class="mb-1 text-xs font-bold text-ink-2">
          会话名称
        </div>
        <input
          v-model="draftTitle"
          placeholder="留空 = 保持原标题"
          class="w-full rounded-input border border-line bg-bg px-2.5 py-2 text-sm text-ink placeholder:text-ink-3"
        >
        <div class="mb-3 mt-1 text-[10px] text-ink-3">
          默认取首句,可随时改名;对话列表同步更新。
        </div>

        <div class="mb-1 text-xs font-bold text-ink-2">
          会话 system prompt
        </div>
        <textarea
          v-model="draftPrompt"
          rows="4"
          placeholder="留空 = 无会话级 system prompt"
          class="w-full rounded-input border border-line bg-bg px-2.5 py-2 text-sm text-ink placeholder:text-ink-3"
        />
        <div class="mb-3 mt-1 text-[10px] text-ink-3">
          与预设/角色定义组装为系统提示词,留空即无。
        </div>
      </template>

      <template v-if="hasBackdrop">
        <div class="flex items-center justify-between">
          <div class="text-xs font-bold text-ink-2">
            卡图背景
          </div>
          <ToggleSwitch v-model="draftBg.enabled" />
        </div>
        <div
          class="mt-2 space-y-2"
          :class="draftBg.enabled ? '' : 'pointer-events-none opacity-40'"
        >
          <label class="flex items-center gap-2">
            <span class="w-8 flex-shrink-0 text-xs text-ink-2">模糊</span>
            <input
              v-model.number="draftBg.blur"
              type="range"
              min="0"
              max="40"
              step="2"
              class="min-w-0 flex-1 accent-primary"
            >
            <span class="w-10 flex-shrink-0 text-right font-mono text-[10px] text-ink-3">{{ draftBg.blur }}px</span>
          </label>
          <label class="flex items-center gap-2">
            <span class="w-8 flex-shrink-0 text-xs text-ink-2">压暗</span>
            <input
              v-model.number="draftBg.dim"
              type="range"
              min="0"
              max="80"
              step="5"
              class="min-w-0 flex-1 accent-primary"
            >
            <span class="w-10 flex-shrink-0 text-right font-mono text-[10px] text-ink-3">{{ draftBg.dim }}%</span>
          </label>
        </div>
        <div class="mb-3 mt-1 text-[10px] text-ink-3">
          只影响本卡,调整时背后实时预览。
        </div>
        <button
          v-if="cardTuned"
          type="button"
          class="mb-3 w-full rounded-input border border-line px-3 py-2 text-xs text-ink-2 active:bg-bg"
          @click="resetBackdrop"
        >
          恢复跟随全局默认
        </button>
      </template>

      <div class="mb-1 text-xs font-bold text-ink-2">
        会话模型覆盖
      </div>
      <div class="flex gap-2">
        <input
          v-model="draftModel"
          list="session-model-options"
          placeholder="留空 = 跟随全局档案"
          class="min-w-0 flex-1 rounded-input border border-line bg-bg px-2.5 py-2 text-sm text-ink placeholder:text-ink-3"
        >
        <button
          type="button"
          class="flex-shrink-0 rounded-input border border-line px-2 text-xs text-ink-2"
          :disabled="fetching"
          @click="pullModels"
        >
          {{ fetching ? '拉取中…' : '拉取模型' }}
        </button>
      </div>
      <datalist id="session-model-options">
        <option
          v-for="option in modelOptions"
          :key="option"
          :value="option"
        />
      </datalist>
      <div class="mt-1 text-[10px] text-ink-3">
        {{ fetchNote || '只覆盖模型名;端点与密钥仍走激活档案。留空 = 跟随全局。' }}
      </div>

      <button
        type="button"
        class="mt-4 w-full rounded-input bg-chat-accent px-3 py-2.5 text-sm font-bold text-chat-on-bubble-ai"
        @click="save"
      >
        保存
      </button>
    </div>
  </div>
</template>
