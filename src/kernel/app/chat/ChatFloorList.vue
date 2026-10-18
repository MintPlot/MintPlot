<script setup lang="ts">
// Window coordinates are separate from complete session history. Stable keys
// preserve DOM identity, while a small retained range protects recent frames.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/vue-virtual'
import { CHAT_SCROLL_END_THRESHOLD, limits } from '@/kernel/runtime/runtime-policy'
import ChatFloor from './ChatFloor.vue'
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import type { FloorView } from './floor-view'

const props = defineProps<{
  messages: ChatboxMessage[]
  scrollElement: HTMLElement | null
  followingOutput: boolean
  project: (message: ChatboxMessage, index: number) => FloorView
  editingFloorId: string
  editDraft: string
  streaming: boolean
  ttsActive: boolean
}>()
const emit = defineEmits<{
  'update:editDraft': [string]
  'cancel-edit': []
  'save-edit': []
  'view-image': [string]
  'toggle-cot': [message: ChatboxMessage]
  'toggle-capsule': [messageId: string]
  'switch': [message: ChatboxMessage, direction: -1 | 1]
  'regenerate': [message: ChatboxMessage]
  'edit': [message: ChatboxMessage]
  'copy': [message: ChatboxMessage]
  'speak': [message: ChatboxMessage]
  'remove': [message: ChatboxMessage]
  'viewport-resize': []
}>()
const host = ref<HTMLElement | null>(null)
const retainedFrames = shallowRef<string[]>([])
const selectionIds = shallowRef<string[]>([])
const focusId = ref('')
const scrollMargin = ref(0)
const viewportHeight = ref(0)
let viewportWidth = 0
const indices = computed(() => new Map(props.messages.map((message, index) => [message.id, index])))
const retainFrame = (id: string): void => {
  if (retainedFrames.value.includes(id)) return
  retainedFrames.value = [...retainedFrames.value.filter((key) => indices.value.has(key)), id].slice(-limits.activeIframes)
}
const virtualizer = useVirtualizer(computed(() => {
  const pinned = [...retainedFrames.value, ...selectionIds.value, focusId.value, props.editingFloorId]
    .map((id) => indices.value.get(id)).filter((index): index is number => index !== undefined)
  return {
    count: props.messages.length,
    getScrollElement: () => props.scrollElement,
    getItemKey: (index: number) => props.messages[index]!.id,
    estimateSize: () => 160,
    overscan: 5,
    gap: 12,
    scrollMargin: scrollMargin.value,
    scrollPaddingStart: scrollMargin.value,
    anchorTo: props.followingOutput ? 'end' as const : 'start' as const,
    // Append and measured growth share one owner. Per-delta imperative
    // scrollToEnd commands would compete with resize compensation.
    followOnAppend: props.followingOutput,
    scrollEndThreshold: CHAT_SCROLL_END_THRESHOLD,
    rangeExtractor: (range: Parameters<typeof defaultRangeExtractor>[0]) => [...new Set([...defaultRangeExtractor(range), ...pinned])].sort((a, b) => a - b),
    useAnimationFrameWithResizeObserver: true,
  }
}))
// The floating header occludes the top of the scroll viewport. Size changes
// wholly behind it should preserve the first readable row, not an obscured
// row at scrollTop. Changes below that anchor must remain in normal flow.
virtualizer.value.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
  item.end <= (instance.scrollOffset ?? 0) + scrollMargin.value
const rows = computed(() => {
  const measured = virtualizer.value.getVirtualItems()
  if (measured.length && viewportHeight.value > 0) return measured
  // Before a measurable viewport (including non-layout renderers), render a
  // bounded tail. Never mount the complete history as an initial fallback.
  const start = Math.max(0, props.messages.length - limits.chatInitial)
  return props.messages.slice(start).map((message, offset) => ({
    index: start + offset, key: message.id, start: (start + offset) * 172 + scrollMargin.value,
  }))
})
const totalSize = computed(() => virtualizer.value.getTotalSize())
let cleanupQueued = false
const measure = (element: Element | ComponentPublicInstance | null): void => {
  if (element === null && !cleanupQueued) {
    // Vue clears refs before removing DOM. Coalesce cleanup after the patch,
    // when TanStack can actually see disconnected nodes and unobserve them.
    cleanupQueued = true
    void nextTick(() => {
      cleanupQueued = false
      virtualizer.value.measureElement(null)
    })
  }
  if (element instanceof HTMLElement && viewportHeight.value > 0) virtualizer.value.measureElement(element)
}
const updateViewport = (): void => {
  const element = props.scrollElement
  if (!element) return
  const changed = viewportHeight.value > 0 && (viewportHeight.value !== element.clientHeight || viewportWidth !== element.clientWidth)
  viewportHeight.value = element.clientHeight
  viewportWidth = element.clientWidth
  // The stream is padded below the floating header; coordinates are local
  // to the content host, not the scroll container's padded origin.
  scrollMargin.value = parseFloat(getComputedStyle(element).paddingTop) || 0
  if (changed) emit('viewport-resize')
}
let resize: ResizeObserver | undefined
watch(() => props.scrollElement, (element) => {
  resize?.disconnect()
  updateViewport()
  if (element && typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(updateViewport)
    resize.observe(element)
  }
}, { flush: 'post' })
const messageIdAt = (node: Node | null): string => {
  const element = node instanceof Element ? node : node?.parentElement
  const row = element?.closest<HTMLElement>('[data-message-id]')
  return row && host.value?.contains(row) ? row.dataset.messageId ?? '' : ''
}
const updateSelection = (): void => {
  const selection = document.getSelection()
  const ids = selection && !selection.isCollapsed
    ? [...new Set([messageIdAt(selection.anchorNode), messageIdAt(selection.focusNode)].filter(Boolean))] : []
  if (ids.join('|') !== selectionIds.value.join('|')) selectionIds.value = ids
}
const updateFocus = (): void => { focusId.value = messageIdAt(document.activeElement) }
onMounted(() => {
  updateViewport()
  document.addEventListener('selectionchange', updateSelection)
})
onBeforeUnmount(() => {
  resize?.disconnect()
  document.removeEventListener('selectionchange', updateSelection)
})
const scrollToEnd = async (): Promise<boolean> => {
  await nextTick()
  if (!props.followingOutput) return true
  updateViewport()
  if (viewportHeight.value <= 0) return false
  virtualizer.value.scrollToEnd()
  return true
}
const cancelScroll = (): void => { virtualizer.value.cancelScroll() }
defineExpose({ scrollToEnd, cancelScroll })
</script>

<template>
  <p
    v-if="messages.length === 0"
    class="py-12 text-center text-xs text-chat-accent"
  >
    发送第一条消息开始对话
  </p>
  <!-- Virtual mounts are not new messages and must not play landing/move
       animations. Each measured row keeps a stable message identity. -->
  <div
    ref="host"
    class="relative w-full"
    :style="{ height: `${totalSize}px`, overflowAnchor: 'none' }"
    @focusin="updateFocus"
    @focusout="nextTick(updateFocus)"
  >
    <div
      v-for="row in rows"
      :key="String(row.key)"
      :ref="measure"
      :data-index="row.index"
      :data-message-id="messages[row.index]!.id"
      class="absolute left-0 top-0 w-full"
      :style="{ transform: `translateY(${row.start - scrollMargin}px)` }"
    >
      <ChatFloor
        :message="messages[row.index]!"
        :index="row.index"
        :project="project"
        :editing-floor-id="editingFloorId"
        :edit-draft="editDraft"
        :streaming="streaming"
        :tts-active="ttsActive"
        @update:edit-draft="emit('update:editDraft', $event)"
        @cancel-edit="emit('cancel-edit')"
        @save-edit="emit('save-edit')"
        @view-image="emit('view-image', $event)"
        @toggle-cot="emit('toggle-cot', $event)"
        @toggle-capsule="emit('toggle-capsule', $event)"
        @switch="(floor, direction) => emit('switch', floor, direction)"
        @regenerate="emit('regenerate', $event)"
        @edit="emit('edit', $event)"
        @copy="emit('copy', $event)"
        @speak="emit('speak', $event)"
        @remove="emit('remove', $event)"
        @frame-row="retainFrame"
      />
    </div>
  </div>
</template>
