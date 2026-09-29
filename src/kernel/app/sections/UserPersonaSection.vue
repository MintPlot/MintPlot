<script setup lang="ts">
// 用户设定分区(M3-f,内核自有):用户昵称 + 人设简介,存设置仓 mp_settings。
// 卡玩法的提示词组装(M3+ 批次)会消费这两个键;先落存储与界面。
import { inject, onMounted, ref } from 'vue'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'

const settingsState = inject(SETTINGS_STATE_KEY, null)

const userName = ref('')
const userPersona = ref('')

onMounted(async () => {
  if (!settingsState) return
  const scope = settingsState.scope(['userName', 'userPersona'])
  userName.value = String(scope.userName ?? '')
  userPersona.value = String(scope.userPersona ?? '')
})

const persist = (): void => {
  if (!settingsState) return
  const scope = settingsState.scope(['userName', 'userPersona'])
  scope.userName = userName.value.trim()
  scope.userPersona = userPersona.value.trim()
}
</script>

<template>
  <div
    v-if="settingsState"
    class="flex flex-col gap-3 px-4 py-4"
    @change="persist"
  >
    <div>
      <label class="mb-1 block text-xs font-medium text-ink-3">昵称</label>
      <input
        v-model.trim="userName"
        type="text"
        placeholder="对话里怎么称呼你"
        class="w-full rounded-input border border-line bg-bg px-3 py-2.5 text-sm text-ink"
      >
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
