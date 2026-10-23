import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCardLedger } from '@/kernel/app/chat/use-card-ledger'
import { useChatMemory } from '@/kernel/app/chat/use-chat-memory'
import { createSessionLocalWork } from '@/kernel/app/chat/session-local-work'
import { createVariableStore } from '@/kernel/variables/variable-store'
import { createMemoryStore } from '@/kernel/memory/memory-store'
import { createEmptyMemoryState } from '@/kernel/memory/memory-engine'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { createMemorySettingsState } from '../helpers/memory-settings'
import type { CharacterCard } from '@/kernel/characters/character-card'
import type { TemplateAnalysisOutcome } from '@/kernel/variables/analysis'
import type { RollingSummaryResult } from '@/kernel/memory/summary-pipeline'

const requests = vi.hoisted(() => ({ analysis: vi.fn(), summary: vi.fn() }))
vi.mock('@/kernel/variables/analysis', async original => ({ ...await original<typeof import('@/kernel/variables/analysis')>(), runTemplateAnalysis: requests.analysis }))
vi.mock('@/kernel/memory/summary-pipeline', async original => ({ ...await original<typeof import('@/kernel/memory/summary-pipeline')>(), runRollingSummary: requests.summary }))
afterEach(() => { vi.restoreAllMocks(); requests.analysis.mockReset(); requests.summary.mockReset() })

async function fixture() {
  const repository = createStorageRepository(createMemoryEngine())
  const variables = createVariableStore(repository), memory = createMemoryStore(repository)
  const settings = createMemorySettingsState()
  Object.assign(settings.scope(['uiTemplateModel','apiBaseUrl','apiModel']), { uiTemplateModel:'synthetic',apiBaseUrl:'http://synthetic.invalid/v1',apiModel:'synthetic' })
  await settings.flush()
  const card: CharacterCard = {
    id:'background',name:'Synthetic',description:'',personality:'',scenario:'',firstMes:'',mesExample:'',systemPrompt:'',postHistoryInstructions:'',
    alternateGreetings:[],tags:[],creator:'',characterVersion:'',creatorNotes:'',spec:'v1',importedAt:0,
    uiTemplates:[{id:'panel',name:'Panel',enabled:true,scope:'character',order:0,placement:'top',htmlTemplate:'',initialVariableState:{n:0},variableSchema:''}],
  }
  await variables.ensure(card.id,[{name:'panel',value:{n:0}}])
  const work = createSessionLocalWork()
  const ledger = useCardLedger({sessionSignal:work.signal,trackLocalWrite:work.track,settingsState:settings,variableStore:variables,worldbookStore:null,regexStore:null,recordUsage:null,isCardDomain:()=>true,card:()=>card,messages:()=>[],isStreamingFloor:()=>false,toProse:x=>x,userName:()=>'',userInfoLine:()=>''})
  const patrol = useChatMemory({sessionSignal:work.signal,trackLocalWrite:work.track,settingsState:settings,memoryStore:memory,recordUsage:null,isCardDomain:()=>true,card:()=>card,messages:()=>[],toProse:x=>x,userName:()=>''})
  return { variables, memory, card, work, ledger, patrol }
}

describe('session background task lifetime', () => {
  it.each(['retire','cancel'] as const)('rejects analysis results after %s even when the request ignores abort', async action => {
    const f = await fixture()
    let finish!: (result:TemplateAnalysisOutcome)=>void
    requests.analysis.mockImplementationOnce(() => new Promise(resolve => {finish=resolve}))
    const task = f.ledger.runTemplateAnalysisPipeline({id:'floor',role:'assistant',content:'Synthetic',ts:0})
    const signal = requests.analysis.mock.calls[0]![0].signal as AbortSignal
    f.work[action]()
    await f.work.drain()
    await f.variables.reset(f.card.id,[{name:'panel',value:{n:0}}])
    finish({replies:[{templateId:'panel',content:JSON.stringify({updates:[{id:'panel',variables:{n:99}}]})}],failedTemplates:0,firstError:''})
    await task
    expect(signal.aborted).toBe(true)
    expect((await f.variables.get(f.card.id))!.events).toEqual([])
  })
  it('persists analysis and memory results while their session generation is current', async () => {
    const f = await fixture()
    requests.analysis.mockResolvedValueOnce({replies:[{templateId:'panel',content:JSON.stringify({updates:[{id:'panel',variables:{n:99}}]})}],failedTemplates:0,firstError:''})
    await f.ledger.runTemplateAnalysisPipeline({id:'floor',role:'assistant',content:'Synthetic',ts:0})
    expect((await f.variables.get(f.card.id))!.state.panel!.value).toEqual({n:99})
    requests.summary.mockResolvedValueOnce({state:{...createEmptyMemoryState(),short:'current summary',anchor:4},batches:1,error:''})
    await f.patrol.maybeRunMemoryPipeline(true)
    expect((await f.memory.get({kind:'card',id:f.card.id}))!.short).toBe('current summary')
  })
  it.each([false,true])('keeps a new memory patrol independent from a cancelled request: reject=%s', async reject => {
    const f = await fixture()
    let oldFinish!: (result:RollingSummaryResult)=>void, oldFail!: (error:Error)=>void, newFinish!: (result:RollingSummaryResult)=>void
    requests.summary.mockImplementationOnce(()=>new Promise((resolve,no)=>{oldFinish=resolve;oldFail=no}))
    const oldTask = f.patrol.maybeRunMemoryPipeline(true)
    f.work.cancel()
    expect(f.patrol.memoryBusy.value).toBe(false)
    requests.summary.mockImplementationOnce(()=>new Promise(resolve=>{newFinish=resolve}))
    const newTask = f.patrol.maybeRunMemoryPipeline(true)
    expect(f.patrol.memoryBusy.value).toBe(true)
    if (reject) oldFail(new Error('late old failure'))
    else oldFinish({state:{...createEmptyMemoryState(),short:'old'},batches:1,error:''})
    await oldTask
    expect(f.patrol.memoryBusy.value).toBe(true)
    expect(f.patrol.memoryStatus.value).toBe('整理中…')
    newFinish({state:{...createEmptyMemoryState(),short:'new'},batches:1,error:''}); await newTask
    expect(f.patrol.memoryBusy.value).toBe(false)
    expect((await f.memory.get({kind:'card',id:f.card.id}))!.short).toBe('new')
  })
  it.each(['retire','cancel'] as const)('rejects memory results after %s even when the request ignores abort', async action => {
    const f = await fixture()
    let finish!: (result:RollingSummaryResult)=>void
    requests.summary.mockImplementationOnce(() => new Promise(resolve => {finish=resolve}))
    const task = f.patrol.maybeRunMemoryPipeline(true)
    const signal = requests.summary.mock.calls[0]![0].signal as AbortSignal
    f.work[action]()
    await f.work.drain()
    await f.memory.reset({kind:'card',id:f.card.id})
    finish({state:{...createEmptyMemoryState(),short:'stale summary',anchor:40},batches:1,error:''})
    await task
    expect(signal.aborted).toBe(true)
    expect(await f.memory.get({kind:'card',id:f.card.id})).toBeNull()
  })
})
