import { nextTick, ref } from 'vue'
import { CHAT_READER_DRAG_THRESHOLD, CHAT_SCROLL_END_THRESHOLD } from '@/kernel/runtime/runtime-policy'

interface FloorScroller {
  scrollToEnd(): Promise<boolean>
  cancelScroll(): void
}

/** Following is interrupted by an actual reading gesture, never a floor tap. */
export function useChatScroll(element: () => HTMLElement | null, list: () => FloorScroller | null) {
  const followingOutput = ref(true)
  let interrupted = false
  let leftEnd = false
  let pointer: { id: number; x: number; y: number } | undefined
  const interruptFollow = (): void => {
    interrupted = true
    if (followingOutput.value) leftEnd = false
    followingOutput.value = false
    list()?.cancelScroll()
  }
  const onReaderPointerDown = (event: PointerEvent): void => {
    if (event.isPrimary === false || event.button > 0) return
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }
  const onReaderPointerMove = (event: PointerEvent): void => {
    if (!pointer || pointer.id !== event.pointerId) return
    const dy = Math.abs(event.clientY - pointer.y)
    if (dy > CHAT_READER_DRAG_THRESHOLD && dy > Math.abs(event.clientX - pointer.x)) {
      pointer = undefined
      interruptFollow()
    }
  }
  const clearReaderPointer = (): void => { pointer = undefined }
  const onMessageScroll = (): void => {
    const target = element()
    if (!target) return
    const atEnd = target.scrollHeight - target.clientHeight - target.scrollTop <= CHAT_SCROLL_END_THRESHOLD
    if (!atEnd) leftEnd = true
    if (!atEnd) followingOutput.value = false
    else if (!interrupted || leftEnd) {
      followingOutput.value = true
      interrupted = false
    }
    if (!followingOutput.value) list()?.cancelScroll()
  }
  const scrollToBottom = async (): Promise<void> => {
    interrupted = false
    leftEnd = false
    followingOutput.value = true
    await nextTick()
    if (!followingOutput.value) return
    const handled = await list()?.scrollToEnd()
    if (!handled && followingOutput.value) element()?.scrollTo?.({ top: element()!.scrollHeight })
  }
  const followOutput = async (): Promise<void> => {
    await nextTick()
    if (!followingOutput.value) return
    const handled = await list()?.scrollToEnd()
    if (!handled && followingOutput.value) element()?.scrollTo?.({ top: element()!.scrollHeight })
  }
  return { followingOutput, interruptFollow, onReaderPointerDown, onReaderPointerMove, clearReaderPointer, onMessageScroll, scrollToBottom, followOutput }
}
