<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { closeConversation, useChatRoute, type ChatRoute } from '@/kernel/app/chat-router'
import ChatSessionView from '@/kernel/app/views/ChatSessionView.vue'
import SessionBackdrop from './SessionBackdrop.vue'
import type { SessionPageBackground } from './session-shell-prototype'
import { pendingSessionFeedbackTrialEnabled } from './session-shell-prototype'
import { cardBackdropDefault } from '@/kernel/app/card-backdrop-default'

type SessionRoute = Extract<ChatRoute, { view: 'chat' }>
type Phase = 'idle' | 'preparing' | 'entering' | 'settled' | 'leaving'
interface HeldPage {
  route: SessionRoute
  token: number
  ready: (key: string) => void
  backdrop: (value: SessionPageBackground) => void
}

const route = useChatRoute()
const emit = defineEmits<{ covered: [boolean] }>()
const suppressFeedback = pendingSessionFeedbackTrialEnabled()
const held = shallowRef<HeldPage | null>(null)
const phase = ref<Phase>('idle')
// The host owns transition completion; the source navigation only consumes
// whether this page fully covers it, without another animation lifecycle.
watch(phase, value => emit('covered', value === 'settled'), { immediate: true, flush: 'sync' })
const shown = ref(false)
const emptyBackground = (): SessionPageBackground => ({ cover: '', backdrop: { enabled: true, ...cardBackdropDefault.value } })
const background = shallowRef<SessionPageBackground>(emptyBackground())
let generation = 0
const isCurrent = (page: HeldPage): boolean => route.value === page.route
const pending = computed(() => route.value.view === 'chat' && (!held.value || !isCurrent(held.value) || phase.value === 'preparing'))
const contentPresented = computed(() => phase.value === 'entering' || phase.value === 'settled' || phase.value === 'leaving')
const clearPage = (): void => {
  held.value = null
  background.value = emptyBackground()
  phase.value = 'idle'
}
const begin = (target: SessionRoute): void => {
  const token = ++generation
  phase.value = 'preparing'
  held.value = {
    route: target, token,
    ready: async (key) => {
      const page = held.value
      if (!page || page.token !== token || !isCurrent(page) || phase.value !== 'preparing') return
      if (key !== `${page.route.kind}:${page.route.conversationId}`) return
      // Commit the accepted backdrop before revealing this viewport. Executable
      // content is mounted only when presented, never in the hidden shell.
      await nextTick()
      if (held.value !== page || !isCurrent(page) || phase.value !== 'preparing') return
      phase.value = 'entering'
      shown.value = true
    },
    backdrop: (value) => {
      const page = held.value
      if (page?.token === token && isCurrent(page) && phase.value !== 'leaving') {
        background.value = { cover: value.cover, backdrop: { ...value.backdrop } }
      }
    },
  }
}
const afterLeave = (): void => {
  if (shown.value || phase.value !== 'leaving') return
  clearPage()
  if (route.value.view === 'chat') begin(route.value)
}
const afterEnter = (): void => {
  if (shown.value && phase.value === 'entering') phase.value = 'settled'
}
watch(route, (target) => {
  if (phase.value === 'leaving') return // The route itself holds the latest request.
  if (held.value && shown.value) {
    phase.value = 'leaving'
    shown.value = false
  } else if (target.view === 'chat') begin(target)
  else clearPage()
}, { immediate: true, flush: 'sync' })
</script>

<template>
  <div
    v-if="!suppressFeedback && pending"
    class="fixed inset-0 z-50 flex items-end justify-center pb-[max(env(safe-area-inset-bottom),1rem)]"
    aria-busy="true"
  >
    <div class="mp-glass flex items-center gap-4 rounded-panel px-4 py-2 text-sm">
      <span role="status">正在打开…</span>
      <button
        type="button"
        class="min-h-11 px-3 text-primary"
        @click="closeConversation()"
      >
        取消
      </button>
    </div>
  </div>
  <Transition
    name="mp-mo-push"
    @after-leave="afterLeave"
    @after-enter="afterEnter"
  >
    <div
      v-show="shown"
      data-session-viewport
      class="fixed inset-0 z-40"
      :inert="phase === 'leaving' ? true : undefined"
      :aria-hidden="!shown ? true : undefined"
    >
      <SessionBackdrop
        :cover="background.cover"
        :backdrop="background.backdrop"
      />
      <ChatSessionView
        v-if="held"
        :key="held.token"
        :domain="held.route.kind"
        :conversation-id="held.route.conversationId"
        hosted
        :presented="contentPresented"
        @ready="held.ready"
        @backdrop="held.backdrop"
      />
    </div>
  </Transition>
</template>
