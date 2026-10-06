<script setup lang="ts">
// 故事设置(M4-e) — 故事引擎的用户面:叙事原则、关系阶段表、阶段记账。
// 设置走 mp_settings 普通键;面板由 HOST 以 placement 'plugin' 注册在
// story 插件的工具区折叠条目下(同变量分析面板的宿主注册模式)。
import { inject, onMounted, ref } from 'vue'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'
import type { SettingsState } from '@/kernel/settings/settings-state'
import {
  DEFAULT_STORY_PRINCIPLES,
  DEFAULT_STORY_STAGES,
  parseStoryStages,
} from '@/kernel/app/story-prompt'
import type { StoryStage } from '@/kernel/app/story-prompt'

const settingsState = inject<SettingsState | null>(SETTINGS_STATE_KEY, null)

const principles = ref(DEFAULT_STORY_PRINCIPLES)
const stages = ref<StoryStage[]>([...DEFAULT_STORY_STAGES])
const bookkeeping = ref(true)

const STORY_KEYS = ['storyPrinciples', 'storyStages', 'storyBookkeeping'] as const

onMounted(() => {
  if (!settingsState) return
  const scope = settingsState.scope([...STORY_KEYS])
  principles.value = scope.storyPrinciples === undefined ? DEFAULT_STORY_PRINCIPLES : String(scope.storyPrinciples)
  // 只在键从未设置时回落默认表;用户删空(持久化为 '[]')必须保持空表,
  // 否则删除会被静默还原,且阶段系统无法关闭。
  const parsed = parseStoryStages(scope.storyStages)
  stages.value = scope.storyStages === undefined ? [...DEFAULT_STORY_STAGES] : parsed
  bookkeeping.value = scope.storyBookkeeping !== false
})

const persist = (): void => {
  if (!settingsState) return
  const scope = settingsState.scope([...STORY_KEYS])
  scope.storyPrinciples = principles.value
  scope.storyStages = JSON.stringify(stages.value.filter((stage) => stage.name.trim()))
  scope.storyBookkeeping = bookkeeping.value
}

const addStage = (): void => {
  stages.value = [...stages.value, { name: '', guide: '' }]
}

const removeStage = (index: number): void => {
  stages.value = stages.value.filter((_, position) => position !== index)
  persist()
}

const updateStageName = (index: number, name: string): void => {
  stages.value = stages.value.map((stage, position) => (position === index ? { ...stage, name } : stage))
  persist()
}

const updateStageGuide = (index: number, guide: string): void => {
  stages.value = stages.value.map((stage, position) => (position === index ? { ...stage, guide } : stage))
  persist()
}
</script>

<template>
  <div
    v-if="settingsState"
    class="flex flex-col gap-4 px-4 py-4"
    @change="persist"
  >
    <div>
      <div class="mb-1 text-xs font-medium text-ink-3">
        叙事原则（注入每轮请求，压住「有求必应」的助手本性）
      </div>
      <textarea
        v-model="principles"
        rows="6"
        class="w-full resize-y rounded-input border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-primary"
        @blur="persist"
      />
    </div>

    <div>
      <div class="mb-1 text-xs font-medium text-ink-3">
        关系阶段表（按顺序执行；当前阶段由变量 <code>{{ 'stage' }}</code> 决定，仅卡域生效）
      </div>
      <div class="flex flex-col gap-2">
        <div
          v-for="(stage, index) in stages"
          :key="index"
          class="flex flex-col gap-1 rounded-card border border-line bg-bg p-2"
        >
          <div class="flex items-center gap-2">
            <span class="text-xs text-ink-3">{{ index + 1 }}.</span>
            <input
              :value="stage.name"
              placeholder="阶段名（如 初识）"
              class="min-h-[36px] flex-1 rounded-input border border-line bg-card px-2 text-sm text-ink outline-none focus:border-primary"
              @input="updateStageName(index, ($event.target as HTMLInputElement).value)"
            >
            <button
              type="button"
              class="min-h-[36px] rounded-input border border-line px-2 text-xs text-danger"
              :aria-label="`删除阶段 ${stage.name || index + 1}`"
              @click="removeStage(index)"
            >
              删除
            </button>
          </div>
          <textarea
            :value="stage.guide"
            rows="2"
            placeholder="该阶段的语气、称呼、配合度描述"
            class="w-full resize-y rounded-input border border-line bg-card px-2 py-1.5 text-xs text-ink outline-none focus:border-primary"
            @input="updateStageGuide(index, ($event.target as HTMLTextAreaElement).value)"
          />
        </div>
      </div>
      <button
        type="button"
        class="mt-2 min-h-[36px] w-full rounded-input border border-dashed border-line-strong text-xs text-ink-3"
        @click="addStage"
      >
        + 添加阶段
      </button>
    </div>

    <div>
      <div class="mb-1 text-xs font-medium text-ink-3">
        阶段记账（指示 AI 在关系质变时自行更新阶段变量）
      </div>
      <div class="flex overflow-hidden rounded-input border border-line">
        <button
          type="button"
          class="flex-1 py-1.5 text-xs"
          :class="bookkeeping ? 'bg-primary font-bold text-on-primary' : 'bg-card text-ink-2'"
          @click="bookkeeping = true; persist()"
        >
          开启
        </button>
        <button
          type="button"
          class="flex-1 py-1.5 text-xs"
          :class="!bookkeeping ? 'bg-primary font-bold text-on-primary' : 'bg-card text-ink-2'"
          @click="bookkeeping = false; persist()"
        >
          关闭
        </button>
      </div>
    </div>

    <p class="text-xs text-ink-3">
      阶段联动需要「变量系统」插件开启；纯对话（非角色卡）只注入叙事原则。
    </p>
  </div>
</template>
