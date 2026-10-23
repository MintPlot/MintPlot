import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useChatTurn, type ChatTurnOptions } from '@/kernel/app/chat/use-chat-turn'
import { createSessionLocalWork } from '@/kernel/app/chat/session-local-work'
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'

describe('turn preflight generation', () => {
  it.each(['persist','scroll','presets'] as const)('does not start an old send after a reset during %s', async blocked => {
    const work = createSessionLocalWork()
    const messages: ChatboxMessage[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const stream = vi.fn(async () => ({ content:'reply',usage:null }))
    const options: ChatTurnOptions = {
      sessionSignal:work.signal,trackLocalWrite:work.track,resolveProvider:()=>({providerId:'openai-compatible',configured:()=>true,stream}),
      streaming:ref(false),sendError:ref(''),draft:ref('old request'),oneShotInstruction:ref(''),pendingImages:ref([]),pendingImagesNotReady:ref(false),
      sessionLoaded:()=>true,isCardDomain:()=>false,cardSession:()=>null,conversation:()=>null,card:()=>null,messages:()=>messages,
      variablesActive:()=>false,settingsState:null,recordUsage:null,variableStore:null,activeTemplates:()=>[],absorbVariableSnapshot:()=>{},
      applyMatchedTemplateUpdates:async()=>0,runTemplateAnalysisPipeline:async()=>{},buildRequestMessages:()=>[],
      syncCotPresetsIfActive:()=>blocked==='presets'?gate:Promise.resolve(),persistSession:()=>blocked==='persist'?gate:Promise.resolve(),
      scrollToBottom:()=>blocked==='scroll'?gate:Promise.resolve(),maybeRunMemoryPipeline:async()=>{},domain:()=> 'chatbox',
    }
    const turn = useChatTurn(options)
    const pending = turn.send()
    // Reach each selected preflight without releasing its local gate.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    work.cancel(); turn.stopStreaming()
    messages.splice(0,messages.length,{id:'fresh',role:'assistant',content:'fresh greeting',ts:0})
    release(); await pending
    expect(stream).not.toHaveBeenCalled()
    expect(messages.map(m=>m.content)).toEqual(['fresh greeting'])
  })
})
