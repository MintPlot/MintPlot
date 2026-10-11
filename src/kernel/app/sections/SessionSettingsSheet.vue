<script setup lang="ts">
// 会话设置面板(M4-g3 parity):chatbox 域 = 会话级 system prompt 编辑 + 模型
// 覆盖;卡域 = 模型覆盖(卡定义/世界书/预设组装本就是卡域的 system 面)。模型
// 覆盖只换模型名,端点与密钥仍走激活档案;空 = 跟随全局。模型列表经「拉取」
// 按钮从激活档案端点实时获取(M4-b fetchModelList)。
import { computed, ref, watch } from 'vue'
import { fetchModelList } from '@/kernel/llm/api-profiles'
import { resolveApiConfig } from '@/kernel/llm/api-profiles'
import type { SettingsState } from '@/kernel/settings/settings-state'
import type { ChatboxConversation } from '@/kernel/sessions/chatbox-store'
import type { CardSession } from '@/kernel/sessions/card-session-store'

const props = defineProps<{
  domain: 'chatbox' | 'card'
  conversation: ChatboxConversation | null
  cardSession: CardSession | null
  settingsState: SettingsState | null
}>()

const emit = defineEmits<{ close: []; saved: [{ title: string; systemPrompt: string; model: string }] }>()

const draftTitle = ref('')
const draftPrompt = ref('')
const draftModel = ref('')
const modelOptions = ref<string[]>([])
const fetching = ref(false)
const fetchNote = ref('')

const isChatbox = computed(() => props.domain === 'chatbox')

watch(
  () => [props.conversation, props.cardSession] as const,
  () => {
    draftTitle.value = props.conversation?.title ?? ''
    draftPrompt.value = props.conversation?.systemPrompt ?? ''
    draftModel.value = props.conversation?.model || props.cardSession?.model || ''
    modelOptions.value = []
    fetchNote.value = ''
  },
  { immediate: true },
)

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
  // no override) and keep the current title (rename is opt-in).
  emit('saved', { title: draftTitle.value.trim(), systemPrompt: draftPrompt.value, model: draftModel.value.trim() })
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
