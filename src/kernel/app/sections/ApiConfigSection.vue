<script setup lang="ts">
// API 连接与服务分区(M3 三键 → M4-b 多供应商档案,D1-D4 拍板):档案列表
// (名称/URL/Key/模型)点选即全局生效,预设五家 chips 预填(RP 目录照搬),
// 「拉取模型」GET /models 进可搜索下拉(拉不到保留手填),状态灯 = 进页自动
// 测一次 + 手动「测试连接」(不随应用启动后台探测)。apiKey 仍走设置仓秘密
// 通道 —— 档案按 id 键控对象存储,秘密路径跨删除稳定;旧单配置三键在挂载时
// 自动迁移为「默认」档案。
import { computed, inject, onMounted, ref } from 'vue'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'
import {
  API_PROVIDER_PRESETS,
  checkProfileConnectivity,
  fetchModelList,
  migrateLegacyApiConfig,
  newProfileId,
  resolveApiConfig,
} from '@/kernel/llm/api-profiles'
import type { ApiProfileConfig, ApiProfileMap } from '@/kernel/llm/api-profiles'
import { uiService } from '@/kernel/ui/toasts'

const settingsState = inject(SETTINGS_STATE_KEY, null)

const profiles = ref<ApiProfileMap>({})
const activeId = ref('')
const editingId = ref('')
// 识图模型槽(M4-d D1):描述式识图的独立模型,作用于激活档案的端点+密钥。
const visionModel = ref('')
const modelOptions = ref<Record<string, string[]>>({})
const fetchingModelsId = ref('')
const status = ref<'unknown' | 'checking' | 'connected' | 'error'>('unknown')
const statusLatency = ref(0)
const statusError = ref('')

const profileOrder = computed(() => Object.keys(profiles.value))

const statusText = computed(() => {
  if (status.value === 'checking') return '正在测试连接…'
  if (status.value === 'connected') return `连接正常 · ${statusLatency.value}ms`
  if (status.value === 'error') return `连接失败${statusError.value ? ` · ${statusError.value}` : ''}`
  return profiles.value && Object.keys(profiles.value).length > 0 ? '未测试' : '未配置端点'
})

const urlSummary = (profile: ApiProfileConfig): string =>
  String(profile.baseUrl || '').replace(/^https?:\/\//, '').replace(/\/+$/, '') || '未填 URL'

const persist = (): void => {
  if (!settingsState) return
  const scope = settingsState.scope(['apiProfiles', 'apiActiveProfileId', 'apiBaseUrl', 'apiKey', 'apiModel', 'visionModel'])
  scope.apiProfiles = JSON.parse(JSON.stringify(profiles.value))
  scope.apiActiveProfileId = activeId.value
  scope.visionModel = visionModel.value.trim()
}

const persistProbe = (): void => {
  persist()
  void probe()
}

const probe = async (): Promise<void> => {
  const config = resolveApiConfig({
    apiProfiles: profiles.value,
    apiActiveProfileId: activeId.value,
  })
  if (!config.baseUrl) {
    status.value = 'unknown'
    statusLatency.value = 0
    statusError.value = ''
    return
  }
  status.value = 'checking'
  const result = await checkProfileConnectivity({ baseUrl: config.baseUrl, apiKey: config.apiKey })
  status.value = result.ok ? 'connected' : 'error'
  statusLatency.value = result.latencyMs
  statusError.value = result.error ?? ''
}

const hydrate = async (): Promise<void> => {
  if (!settingsState) return
  const snapshot = settingsState.snapshot()
  const migrated = migrateLegacyApiConfig(snapshot)
  if (migrated) {
    profiles.value = migrated.profiles
    activeId.value = migrated.activeId
    persist()
    // Legacy trio replaced by the default profile — clear it so the flat
    // keys can never shadow a later "no profiles" state.
    const scope = settingsState.scope(['apiBaseUrl', 'apiKey', 'apiModel'])
    scope.apiBaseUrl = ''
    scope.apiKey = ''
    scope.apiModel = ''
  } else {
    profiles.value = (snapshot.apiProfiles && typeof snapshot.apiProfiles === 'object'
      ? (JSON.parse(JSON.stringify(snapshot.apiProfiles)) as ApiProfileMap)
      : {})
    activeId.value = String(snapshot.apiActiveProfileId ?? '') || Object.keys(profiles.value)[0] || ''
  }
  visionModel.value = String(snapshot.visionModel ?? '')
}

onMounted(async () => {
  if (!settingsState) return
  await hydrate()
  await probe()
})

const selectProfile = (id: string): void => {
  if (activeId.value === id) return
  activeId.value = id
  persistProbe()
}

const toggleEdit = (id: string): void => {
  editingId.value = editingId.value === id ? '' : id
}

const addProfile = (presetId: string): void => {
  const preset = API_PROVIDER_PRESETS.find((entry) => entry.id === presetId) ?? null
  const id = newProfileId()
  profiles.value[id] = {
    name: preset ? preset.name : '自定义',
    baseUrl: preset ? preset.apiUrl : '',
    model: '',
    apiKey: '',
  }
  activeId.value = id
  editingId.value = id
  persist()
}

const removeProfile = async (id: string): Promise<void> => {
  const target = profiles.value[id]
  if (!target) return
  const confirmed = await uiService.confirm('shell', {
    title: '删除供应商档案',
    message: `删除「${target.name || '未命名'}」?该档案的密钥一并删除。`,
    confirmLabel: '删除',
  })
  if (!confirmed) return
  const rest = profileOrder.value.filter((entry) => entry !== id)
  const next: ApiProfileMap = {}
  for (const entry of rest) next[entry] = profiles.value[entry]
  profiles.value = next
  if (activeId.value === id) activeId.value = rest[0] ?? ''
  if (editingId.value === id) editingId.value = ''
  persistProbe()
}

const fetchModels = async (id: string): Promise<void> => {
  const profile = profiles.value[id]
  if (!profile || fetchingModelsId.value) return
  if (!profile.baseUrl) {
    uiService.toast('shell', '请先填写 Base URL', { tone: 'error' })
    return
  }
  fetchingModelsId.value = id
  try {
    const models = await fetchModelList({ baseUrl: profile.baseUrl, apiKey: profile.apiKey })
    modelOptions.value = { ...modelOptions.value, [id]: models }
    uiService.toast('shell', `成功获取 ${models.length} 个模型`, { tone: 'success' })
  } catch (error) {
    uiService.toast('shell', `获取模型失败: ${error instanceof Error ? error.message : String(error)}`, { tone: 'error' })
  } finally {
    fetchingModelsId.value = ''
  }
}
</script>

<template>
  <div
    v-if="settingsState"
    class="flex flex-col gap-3 px-4 py-4"
  >
    <div class="flex items-center gap-2">
      <span
        class="h-2 w-2 flex-shrink-0 rounded-full"
        :class="{
          'bg-ink-3 animate-pulse': status === 'checking',
          'bg-primary': status === 'connected',
          'bg-danger': status === 'error',
        }"
      />
      <span class="min-w-0 flex-1 truncate text-xs text-ink-2">{{ statusText }}</span>
      <button
        type="button"
        class="flex-shrink-0 rounded-input border border-line px-2 py-1 text-xs text-ink-2 disabled:opacity-40"
        :disabled="status === 'checking'"
        @click="probe"
      >
        测试连接
      </button>
    </div>

    <ul class="flex flex-col gap-2">
      <li
        v-for="id in profileOrder"
        :key="id"
        class="rounded-input border border-line bg-bg px-3 py-2"
      >
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border"
            :class="activeId === id ? 'border-primary' : 'border-line'"
            :aria-label="`选用档案「${profiles[id].name || '未命名'}」`"
            :aria-pressed="activeId === id"
            @click="selectProfile(id)"
          >
            <span
              v-if="activeId === id"
              class="h-2 w-2 rounded-full bg-primary"
            />
          </button>
          <button
            type="button"
            class="min-w-0 flex-1 text-left"
            @click="selectProfile(id)"
          >
            <span
              class="block truncate text-sm"
              :class="activeId === id ? 'font-bold text-ink' : 'text-ink-2'"
            >{{ profiles[id].name || '未命名' }}</span>
            <span class="block truncate text-[10px] text-ink-3">{{ urlSummary(profiles[id]!) }}</span>
          </button>
          <button
            type="button"
            class="flex-shrink-0 px-1 text-xs text-ink-3"
            :aria-label="`编辑档案「${profiles[id].name || '未命名'}」`"
            @click="toggleEdit(id)"
          >
            {{ editingId === id ? '▲' : '编辑 ▾' }}
          </button>
        </div>

        <div
          v-if="editingId === id"
          class="mt-2 flex flex-col gap-2 border-t border-line pt-2"
          @change="persist"
        >
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-3">名称</label>
            <input
              v-model.trim="profiles[id].name"
              type="text"
              placeholder="供应商名称"
              class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-sm text-ink"
            >
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-3">API Base URL</label>
            <input
              v-model.trim="profiles[id].baseUrl"
              type="text"
              placeholder="https://api.example.com/v1"
              class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-sm text-ink"
            >
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-3">API Key</label>
            <input
              v-model="profiles[id].apiKey"
              type="password"
              autocomplete="off"
              placeholder="sk-...（留空表示无密钥端点）"
              class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-sm text-ink"
            >
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-3">模型</label>
            <div class="flex gap-2">
              <input
                v-model.trim="profiles[id].model"
                type="text"
                :list="`models-${id}`"
                placeholder="gpt-4o / deepseek-chat / …"
                class="min-w-0 flex-1 rounded-input border border-line bg-card px-2 py-1.5 text-sm text-ink"
              >
              <datalist :id="`models-${id}`">
                <option
                  v-for="model in modelOptions[id] ?? []"
                  :key="model"
                  :value="model"
                />
              </datalist>
              <button
                type="button"
                class="flex-shrink-0 rounded-input border border-primary px-2 py-1 text-xs text-primary disabled:opacity-40"
                :disabled="fetchingModelsId === id"
                @click="fetchModels(id)"
              >
                {{ fetchingModelsId === id ? '拉取中…' : '拉取模型' }}
              </button>
            </div>
          </div>
          <label class="flex items-center gap-2 text-xs text-ink-2">
            <input
              v-model="profiles[id].visionCapable"
              type="checkbox"
              class="h-4 w-4 accent-primary"
            >
            该模型支持看图(发图直连,不经识图模型)
          </label>
          <button
            type="button"
            class="self-start text-xs text-danger"
            :aria-label="`删除档案「${profiles[id].name || '未命名'}」`"
            @click="removeProfile(id)"
          >
            删除此档案
          </button>
        </div>
      </li>
    </ul>

    <p
      v-if="profileOrder.length === 0"
      class="text-center text-xs text-ink-3"
    >
      暂无供应商档案 —— 从下方预设新建,或点「自定义」手填
    </p>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="preset in API_PROVIDER_PRESETS"
        :key="preset.id"
        type="button"
        class="rounded-full border border-line bg-bg px-3 py-1 text-xs text-ink-2 active:border-primary active:text-primary"
        @click="addProfile(preset.id)"
      >
        + {{ preset.name }}
      </button>
      <button
        type="button"
        class="rounded-full border border-line bg-bg px-3 py-1 text-xs text-ink-2 active:border-primary active:text-primary"
        @click="addProfile('custom')"
      >
        + 自定义
      </button>
    </div>

    <div>
      <label class="mb-1 block text-xs font-medium text-ink-3">识图模型(可选)</label>
      <input
        v-model.trim="visionModel"
        type="text"
        placeholder="glm-4v / gpt-4o / …(发图且模型不支持看图时用)"
        class="w-full rounded-input border border-line bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-primary"
        @change="persist"
      >
      <p class="mt-0.5 text-[10px] text-ink-3">
        用当前档案的端点与密钥调用;激活档案声明「支持看图」时此槽不参与。
      </p>
    </div>

    <p class="text-[10px] leading-relaxed text-ink-3">
      OpenAI 兼容接口(chat/completions,流式);点选档案即全局生效,对已有对话立即生效。密钥经秘密通道加密落盘,不入普通备份。
    </p>
  </div>
  <p
    v-else
    class="px-4 py-6 text-center text-xs text-ink-3"
  >
    设置仓未接入
  </p>
</template>
