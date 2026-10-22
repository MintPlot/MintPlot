import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import { contentUsesHtmlFrame, renderMessageHtml } from '@/kernel/render/message-render'
import type { MessageRenderContext } from '@/kernel/render/message-render'
import { applyRegexPipeline } from '@/kernel/regex/regex-engine'
import type { RegexScript } from '@/kernel/regex/regex-engine'
import { stripVariableBlocks } from '@/kernel/variables/variable-engine'
import { parseCot } from '@/kernel/cot/cot-parser'
import type { FloorView } from './floor-view'

interface FloorProjectionOptions {
  isStreamingFloor: (message: ChatboxMessage) => boolean
  cotActive: () => boolean
  isCardDomain: () => boolean
  variablesActive: () => boolean
  regexActive: () => boolean
  cardRegexScripts: () => RegexScript[]
  regexDisabledUids: () => ReadonlySet<number>
  macroContext: () => MessageRenderContext
  persistSession: () => Promise<void>
  floorPanels: (message: ChatboxMessage) => FloorView['panels']
  floorVariableSummary: (message: ChatboxMessage) => FloorView['capsule']
  capsuleOpenId: () => string | null
  isLastAssistantFloor: (message: ChatboxMessage) => boolean
}

interface FloorThinkingSection {
  id: string
  title: string
  text: string
  chars: number
  live: boolean
}

/** Each floor calls this projection from its own computed scope. Getters keep
 * the original reactive dependencies without building a parent-wide array. */
export function createFloorProjection(options: FloorProjectionOptions) {
  const { isStreamingFloor } = options
  const renderFloor = (message: ChatboxMessage): string => {
    let content = message.content
    // Strip only the display projection. HTML documents keep their original
    // structure and user floors never receive assistant beautification rules.
    if (options.cotActive() && !contentUsesHtmlFrame(content)) {
      content = parseCot(content, !isStreamingFloor(message)).main
    }
    if (options.isCardDomain() && options.variablesActive()) content = stripVariableBlocks(content)
    if (options.isCardDomain() && options.regexActive() && message.role === 'assistant' && options.cardRegexScripts().length > 0) {
      content = applyRegexPipeline(content, {
        scripts: options.cardRegexScripts(), surface: 'display', role: 'assistant', depth: 0,
        disabledUids: options.regexDisabledUids(),
      })
    }
    return renderMessageHtml(content, options.macroContext(), !isStreamingFloor(message))
  }

  const floorThinkingSections = (message: ChatboxMessage): FloorThinkingSection[] => {
    if (message.role !== 'assistant' || !options.cotActive() || contentUsesHtmlFrame(message.content)) return []
    const streamingFloor = isStreamingFloor(message)
    const sections: FloorThinkingSection[] = []
    const reasoning = String(message.reasoning ?? '').trim()
    if (reasoning) {
      sections.push({ id: 'native', title: '原生思考', text: reasoning, chars: reasoning.length, live: streamingFloor && !message.content })
    }
    const info = parseCot(message.content, !streamingFloor)
    if (info.cot) {
      sections.push({ id: 'cot', title: '分析过程', text: info.cot, chars: info.cot.length, live: streamingFloor && !info.isFinished })
    }
    return sections
  }

  const isCotCardOpen = (message: ChatboxMessage, sections = floorThinkingSections(message)): boolean =>
    message.cotOpen !== undefined ? message.cotOpen : isStreamingFloor(message) && sections.length > 0
  const toggleCotCard = (message: ChatboxMessage): void => {
    message.cotOpen = !isCotCardOpen(message)
    void options.persistSession()
  }
  const projectFloor = (message: ChatboxMessage, index: number): FloorView => {
    const thinking = floorThinkingSections(message).map((section) => ({
      ...section, html: renderMessageHtml(section.text, options.macroContext(), true),
    }))
    const panels = options.floorPanels(message)
    const isHtmlFrame = contentUsesHtmlFrame(message.content)
    return {
      message, index, html: renderFloor(message), thinking,
      thinkingOpen: isCotCardOpen(message, thinking),
      thinkingLive: thinking.some((section) => section.live),
      panels, capsule: options.floorVariableSummary(message),
      capsuleOpen: options.capsuleOpenId() === message.id,
      isHtmlFrame, wide: isHtmlFrame || panels.top.length > 0 || panels.bottom.length > 0,
      isStreaming: isStreamingFloor(message), isLastAssistant: options.isLastAssistantFloor(message),
    }
  }
  return { projectFloor, toggleCotCard }
}
