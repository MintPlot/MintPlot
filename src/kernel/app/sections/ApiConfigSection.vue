<script setup lang="ts">
// 模型与 API 配置分区(M3,内核自有):OpenAI 兼容 provider 三键 —— Base URL /
// API Key / 模型。apiKey 走设置仓秘密通道(落盘抽取,回读回填);这是
// ctx.settings.scope 的宿主侧同款投影(内核分区直接用设置仓)。
import { inject, onMounted, ref } from 'vue'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'

const settingsState = inject(SETTINGS_STATE_KEY, null)

const baseUrl = ref('')
const apiKey = ref('')
const model = ref('')

onMounted(async () => {
  if (!settingsState) return
  const scope = settingsState.scope(['apiBaseUrl', 'apiKey', 'apiModel'])
  baseUrl.value = String(scope.apiBaseUrl ?? '')
  apiKey.value = String(scope.apiKey ?? '')
  model.value = String(scope.apiModel ?? '')
})

const persist = (): void => {
  if (!settingsState) return
  const scope = settingsState.scope(['apiBaseUrl', 'apiKey', 'apiModel'])
  scope.apiBaseUrl = baseUrl.value.trim()
  scope.apiKey = apiKey.value
  scope.apiModel = model.value.trim()
}
</script>

<template>
  <div
    v-if="settingsState"
    class="flex flex-col gap-3 px-4 py-4"
    @change="persist"
  >
    <div>
      <label class="mb-1 block text-xs font-medium text-ink-3">API Base URL</label>
      <input
        v-model.trim="baseUrl"
        type="text"
        placeholder="https://api.example.com/v1"
        class="w-full rounded-input border border-line bg-bg px-3 py-2.5 text-sm text-ink"
      >
    </div>
    <div>
      <label class="mb-1 block text-xs font-medium text-ink-3">API Key</label>
      <input
        v-model="apiKey"
        type="password"
        autocomplete="off"
        placeholder="sk-...（留空表示无密钥端点）"
        class="w-full rounded-input border border-line bg-bg px-3 py-2.5 text-sm text-ink"
      >
      <p class="mt-0.5 text-[10px] text-ink-3">
        密钥经秘密通道加密落盘，不入普通备份。
      </p>
    </div>
    <div>
      <label class="mb-1 block text-xs font-medium text-ink-3">模型</label>
      <input
        v-model.trim="model"
        type="text"
        placeholder="gpt-4o / deepseek-chat / …"
        class="w-full rounded-input border border-line bg-bg px-3 py-2.5 text-sm text-ink"
      >
    </div>
    <p class="text-[10px] leading-relaxed text-ink-3">
      OpenAI 兼容接口（chat/completions，流式）。修改后自动保存。
    </p>
  </div>
  <p
    v-else
    class="px-4 py-6 text-center text-xs text-ink-3"
  >
    设置仓未接入
  </p>
</template>
