import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import type { FloorThinkingItem } from './FloorThinkingCard.vue'

/** Derived values are evaluated in the owning floor component. */
export interface FloorView {
  message: ChatboxMessage
  index: number
  html: string
  thinking: FloorThinkingItem[]
  thinkingOpen: boolean
  thinkingLive: boolean
  panels: { top: Array<{ id: string; html: string }>; bottom: Array<{ id: string; html: string }> }
  capsule: { flat: Array<{ name: string; value: string }>; templateLines: string[]; total: number }
  capsuleOpen: boolean
  isHtmlFrame: boolean
  wide: boolean
  isStreaming: boolean
  isLastAssistant: boolean
}
