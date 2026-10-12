<script setup lang="ts">
// 用户设定分区(M3-f,内核自有):用户头像 + 昵称 + 人称 + 人设简介,存设置仓
// mp_settings(userAvatar = 压缩到长边 256 的 data URL,复用 vision 的压缩
// 管线,免得 mp_settings 被大图撑爆)。卡玩法的提示词组装(M3+ 批次)会消费
// 昵称/人设;头像目前只在设定面展示。点头像换图,角标清空回默认猫。
// 人称(1.0.x → 风格维度 v3):与提示词预设的 person 维度条目同源联动 ——
// 这里的选择就是预设仓里的条目开关(单选维度互斥,再点取消),预设面板改动
// 回到本页即见(挂载重读)。全部删掉则整行隐藏。
import { inject, onMounted, ref } from 'vue'
import { SETTINGS_STATE_KEY, PRESET_STORE_KEY } from '@/kernel/app/chat-keys'
import type { PresetEntry, PresetSnapshot } from '@/kernel/presets/preset-store'
import { compressImageFile } from '@/kernel/llm/vision'
import MintCat from '@/kernel/design/assets/MintCat.vue'

const settingsState = inject(SETTINGS_STATE_KEY, null)
const presetStore = inject(PRESET_STORE_KEY, null)

const userName = ref('')
const userPersona = ref('')
const userAvatar = ref('')
const avatarInputEl = ref<HTMLInputElement | null>(null)

// Person chips: every person-dimension entry of the ACTIVE group (that is
// what the global scheme actually injects). The three seeds sort in natural
// order, custom entries follow in library order. Row hides when none exist.
const personEntries = ref<PresetEntry[]>([])
const PERSON_SEED_ORDER = ['第一人称', '第二人称', '第三人称']

const loadPersonEntries = (snapshot: PresetSnapshot): void => {
  const activeGroup = snapshot.groups.find((group) => group.enabled)?.id ?? 'default'
  personEntries.value = snapshot.entries
    .filter((entry) => entry.dimension === 'person' && entry.group === activeGroup)
    .sort((a, b) => {
      const ai = PERSON_SEED_ORDER.indexOf(a.name)
      const bi = PERSON_SEED_ORDER.indexOf(b.name)
      return (ai === -1 ? PERSON_SEED_ORDER.length : ai) - (bi === -1 ? PERSON_SEED_ORDER.length : bi)
    })
}

const togglePerson = async (entry: PresetEntry): Promise<void> => {
  if (!presetStore) return
  // The store enforces the single-select dimension mutex (presets panel
  // included) — one call.
  const snapshot = await presetStore.setEntryEnabled(entry.id, !entry.enabled)
  loadPersonEntries(snapshot)
}

onMounted(async () => {
  if (!settingsState) return
  const scope = settingsState.scope(['userName', 'userPersona', 'userAvatar'])
  userName.value = String(scope.userName ?? '')
  userPersona.value = String(scope.userPersona ?? '')
  userAvatar.value = String(scope.userAvatar ?? '')
  if (presetStore) loadPersonEntries(await presetStore.get())
})

const persist = (): void => {
  if (!settingsState) return
  const scope = settingsState.scope(['userName', 'userPersona', 'userAvatar'])
  scope.userName = userName.value.trim()
  scope.userPersona = userPersona.value.trim()
  scope.userAvatar = userAvatar.value
}

const onAvatarSelected = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // M4-d gotcha: Android WebView invalidates photo-picker File handles the
  // moment input.value is reset — clear only after every read is dispatched.
  if (file) {
    userAvatar.value = await compressImageFile(file, 256)
    persist()
  }
  input.value = ''
}

const clearAvatar = (): void => {
  userAvatar.value = ''
  persist()
}
</script>

<template>
  <div
    v-if="settingsState"
    class="flex flex-col gap-3 px-4 py-4"
    @change="persist"
  >
    <div class="flex items-center gap-3">
      <div class="relative flex-shrink-0">
        <button
          type="button"
          class="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-line bg-bg"
          aria-label="更换头像"
          @click="avatarInputEl?.click()"
        >
          <img
            v-if="userAvatar"
            :src="userAvatar"
            alt="用户头像"
            class="h-full w-full object-cover"
          >
          <MintCat
            v-else
            class="h-8 w-8 text-ink-3"
          />
        </button>
        <button
          v-if="userAvatar"
          type="button"
          class="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-bg text-ink-2 shadow"
          aria-label="移除头像"
          @click="clearAvatar"
        >
          <svg
            class="h-2.5 w-2.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        <input
          ref="avatarInputEl"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onAvatarSelected"
        >
      </div>
      <div class="min-w-0 flex-1">
        <label class="mb-1 block text-xs font-medium text-ink-3">昵称</label>
        <input
          v-model.trim="userName"
          type="text"
          placeholder="对话里怎么称呼你"
          class="w-full rounded-input border border-line bg-bg px-3 py-2.5 text-sm text-ink"
        >
      </div>
    </div>
    <div v-if="personEntries.length > 0">
      <label class="mb-1 block text-xs font-medium text-ink-3">人称</label>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="entry in personEntries"
          :key="entry.id"
          type="button"
          class="rounded-full border px-3 py-1.5 text-xs transition-colors"
          :class="entry.enabled ? 'border-primary bg-primary-wash font-medium text-primary' : 'border-line text-ink-2'"
          :aria-pressed="entry.enabled"
          :aria-label="`选择人称「${entry.name}」`"
          @click="togglePerson(entry)"
        >
          {{ entry.name }}
        </button>
      </div>
      <p class="mt-1 text-[10px] text-ink-3">
        与「提示词预设」中的同条目联动,单选可不选(全灭 = 不约束)。
      </p>
    </div>
    <div>
      <label class="mb-1 block text-xs font-medium text-ink-3">人设简介</label>
      <textarea
        v-model="userPersona"
        rows="3"
        placeholder="你的身份、性格、偏好……(供对话与角色扮演引用)"
        class="w-full resize-none rounded-input border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none focus:border-primary"
      />
    </div>
    <p class="text-[10px] leading-relaxed text-ink-3">
      修改后自动保存。
    </p>
  </div>
  <p
    v-else
    class="px-4 py-6 text-center text-xs text-ink-3"
  >
    设置仓未接入
  </p>
</template>
