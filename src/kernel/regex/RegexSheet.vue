<script setup lang="ts">
// 正则面板(M3-v 轻管理,D8):条目列表(名/类型标签 美化·提示词/模式预览/启停
// 开关 KV 覆盖)+ HTML 楼层提示词省略开关(D7 开场白债)。启停 = 设备库覆盖
// 层(regex-store),永不回写卡记录。
import { computed, inject, onMounted, ref } from 'vue'
import type { RegexScript } from '@/kernel/regex/regex-engine'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'
import type { SettingsState } from '@/kernel/settings/settings-state'

const props = defineProps<{
  scripts: RegexScript[]
  disabledUids: ReadonlySet<number>
}>()
const emit = defineEmits<{ toggle: [uid: number]; close: [] }>()

const settingsState = inject<SettingsState | null>(SETTINGS_STATE_KEY, null)
const omitHtmlFloors = ref(true)

onMounted(() => {
  if (!settingsState) return
  const scope = settingsState.scope(['promptOmitHtmlFloors'])
  omitHtmlFloors.value = scope.promptOmitHtmlFloors !== false
})

const persist = (): void => {
  if (!settingsState) return
  const scope = settingsState.scope(['promptOmitHtmlFloors'])
  scope.promptOmitHtmlFloors = omitHtmlFloors.value
}

const search = ref('')
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return props.scripts
  return props.scripts.filter(
    (script) => script.name.toLowerCase().includes(query) || script.pattern.toLowerCase().includes(query),
  )
})

const typeLabel = (script: RegexScript): string => (script.promptOnly ? '提示词' : '美化')

const shortPattern = (script: RegexScript): string => {
  const text = `${script.pattern} → ${script.replacement}`
  return text.length > 70 ? `${text.slice(0, 70)}…` : text
}

const toggle = (script: RegexScript): void => emit('toggle', script.uid)
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
    @click.self="emit('close')"
  >
    <div class="max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-line bg-card px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-bold">
          正则
        </h2>
        <button
          type="button"
          class="rounded-input px-2 py-1 text-xs text-ink-2"
          @click="emit('close')"
        >
          完成
        </button>
      </div>

      <!-- HTML 楼层提示词省略(D7 开场白债):前端文档楼层在请求里替换为省略标记 -->
      <label
        v-if="settingsState"
        class="mb-2 flex items-center justify-between gap-2 rounded-input border border-line bg-bg px-3 py-2 text-xs text-ink-2"
        @change="persist"
      >
        <span class="min-w-0 flex-1">
          HTML 楼层提示词省略
          <span class="block text-[10px] text-ink-3">前端文档楼层不再全量进请求（显示不受影响）</span>
        </span>
        <input
          v-model="omitHtmlFloors"
          type="checkbox"
          class="accent-primary"
        >
      </label>

      <input
        v-model="search"
        placeholder="搜索名称或模式…"
        class="mb-2 w-full rounded-input border border-line bg-bg px-3 py-1.5 text-sm text-ink outline-none focus:border-primary"
      >

      <p
        v-if="filtered.length === 0"
        class="py-6 text-center text-xs text-ink-3"
      >
        {{ props.scripts.length === 0 ? '这张卡没有自带正则' : '没有匹配的条目' }}
      </p>

      <ul class="flex flex-col gap-2">
        <li
          v-for="script in filtered"
          :key="script.uid"
          class="rounded-input border border-line bg-bg px-3 py-2"
        >
          <div class="flex items-center gap-2">
            <span
              class="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
              :class="script.promptOnly ? 'border border-primary/40 bg-primary/10 text-primary' : 'border border-line bg-card text-ink-3'"
            >
              {{ typeLabel(script) }}
            </span>
            <span class="min-w-0 flex-1 truncate text-sm text-ink">
              {{ script.name || `条目 ${script.uid + 1}` }}
            </span>
            <button
              type="button"
              class="relative h-5 w-9 flex-shrink-0 rounded-full transition-colors"
              :class="!disabledUids.has(script.uid) ? 'bg-primary' : 'bg-line'"
              :aria-label="`切换正则「${script.name || script.uid + 1}」`"
              @click="toggle(script)"
            >
              <span
                class="absolute top-0.5 h-4 w-4 rounded-full bg-card transition-all"
                :class="!disabledUids.has(script.uid) ? 'left-[18px]' : 'left-0.5'"
              />
            </button>
          </div>
          <p class="mt-1 break-all font-mono text-[10px] leading-relaxed text-ink-3">
            /{{ shortPattern(script) }}/
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>
