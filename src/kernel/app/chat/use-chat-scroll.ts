import { getCurrentScope, nextTick, onScopeDispose, ref, watch } from 'vue'
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
  let observed: { top: number; height: number; viewport: number } | undefined
  let command = 0
  let disposed = false
  watch(element, (target) => {
    observed = target ? { top: target.scrollTop, height: target.scrollHeight, viewport: target.clientHeight } : undefined
  }, { immediate: true, flush: 'post' })
  const disposeScroll = (): void => {
    disposed = true
    pointer = undefined
    command++
    list()?.cancelScroll()
  }
  if (getCurrentScope()) onScopeDispose(disposeScroll)
  const interruptFollow = (): void => {
    interrupted = true
    if (followingOutput.value) leftEnd = false
    followingOutput.value = false
    command++
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
  const onReaderWheel = (event: WheelEvent): void => {
    if (event.deltaY !== 0 && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) interruptFollow()
  }
  const onReaderKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="textbox"]')) return
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interruptFollow()
  }
  const onMessageScroll = (): void => {
    const target = element()
    if (!target) return
    const atEnd = target.scrollHeight - target.clientHeight - target.scrollTop <= CHAT_SCROLL_END_THRESHOLD
    // Scrollbars and assistive scrolling need no pointer/wheel event. An
    // upward offset with an unchanged extent is reading; height/IME changes
    // alone are geometry observations, not evidence of reader intent.
    if (followingOutput.value && observed && !atEnd &&
      target.scrollHeight === observed.height && target.clientHeight === observed.viewport &&
      target.scrollTop < observed.top) interruptFollow()
    observed = { top: target.scrollTop, height: target.scrollHeight, viewport: target.clientHeight }
    if (!atEnd) leftEnd = true
    if (atEnd && (!interrupted || leftEnd)) {
      followingOutput.value = true
      interrupted = false
    }
  }
  const scrollToBottom = async (): Promise<void> => {
    if (disposed) return
    interrupted = false
    leftEnd = false
    followingOutput.value = true
    const token = ++command
    await nextTick()
    if (disposed || !followingOutput.value || token !== command) return
    const handled = await list()?.scrollToEnd()
    if (!handled && followingOutput.value && token === command) element()?.scrollTo?.({ top: element()!.scrollHeight })
  }
  const followOutput = async (): Promise<void> => {
    const token = command
    await nextTick()
    if (disposed || !followingOutput.value || token !== command) return
    const handled = await list()?.scrollToEnd()
    if (!handled && !disposed && followingOutput.value && token === command) element()?.scrollTo?.({ top: element()!.scrollHeight })
  }
  return { followingOutput, interruptFollow, disposeScroll, onReaderPointerDown, onReaderPointerMove, clearReaderPointer, onReaderWheel, onReaderKeyDown, onMessageScroll, scrollToBottom, followOutput }
}
