import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_CONCURRENCY,
  ANALYSIS_MAX_ATTEMPTS,
  readTemplateAnalysisSettings,
  renderTemplateStateContext,
  runTemplateAnalysis,
  useBatchAnalysis,
} from '@/kernel/variables/analysis'
import type { AnalysisTemplatePayload, TemplateAnalysisSettings } from '@/kernel/variables/analysis'
import { createMemorySettingsState } from '../helpers/memory-settings'

const TEMPLATES: AnalysisTemplatePayload[] = [
  { id: 'tpl-a', name: '状态面板', currentVariables: { hp: 10 }, variableSchema: 'hp: 数字' },
  { id: 'tpl-b', name: '顶栏', currentVariables: { 位置: '青茅山' }, variableSchema: '' },
]

const FLOORS = [
  { role: 'user' as const, name: '旅人', content: '出发吗' },
  { role: 'assistant' as const, name: '喵', content: '出发。' },
]

describe('template analysis settings (M3-t)', () => {
  it('defaults: main-model mode, no analysis model, depth 4, batch/json on', () => {
    const settings = readTemplateAnalysisSettings(null)
    expect(settings).toEqual({
      mainModelAnalysis: true,
      analysisModel: '',
      analysisDepth: 4,
      injectContext: false,
      batchMode: true,
      jsonMode: true,
      maxOutputTokens: 4096,
    })
  })

  it('reads live keys and clamps depth/token ranges', async () => {
    const settingsState = createMemorySettingsState()
    const scope = settingsState.scope(['uiTemplateAnalysisDepth', 'uiTemplateMaxOutputTokens', 'uiTemplateModel', 'uiTemplateMainModelAnalysis'])
    scope.uiTemplateAnalysisDepth = 99
    scope.uiTemplateMaxOutputTokens = 1
    scope.uiTemplateModel = 'deepseek-chat'
    scope.uiTemplateMainModelAnalysis = false
    const settings = readTemplateAnalysisSettings(settingsState)
    expect(settings.analysisDepth).toBe(10)
    expect(settings.maxOutputTokens).toBe(1024)
    expect(settings.analysisModel).toBe('deepseek-chat')
    expect(settings.mainModelAnalysis).toBe(false)
  })
})

describe('batch decision', () => {
  const base: TemplateAnalysisSettings = {
    mainModelAnalysis: true,
    analysisModel: 'm',
    analysisDepth: 4,
    injectContext: false,
    batchMode: true,
    jsonMode: true,
    maxOutputTokens: 4096,
  }
  it('batch requires enabled + 2..5 templates', () => {
    expect(useBatchAnalysis(base, 1)).toBe(false)
    expect(useBatchAnalysis(base, 3)).toBe(true)
    expect(useBatchAnalysis(base, 6)).toBe(false)
    expect(useBatchAnalysis({ ...base, batchMode: false }, 3)).toBe(false)
  })
})

describe('runTemplateAnalysis', () => {
  it('batch mode issues ONE request carrying all templates + floors and returns raw content', async () => {
    const calls: Array<{ messages: unknown }> = []
    const outcome = await runTemplateAnalysis({
      config: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'analysis-model', temperature: 0.2, maxTokens: 4096 },
      templates: TEMPLATES,
      recentFloors: FLOORS,
      userInfo: '用户名字：旅人',
      batch: true,
      complete: async (config, messages) => {
        calls.push({ messages })
        expect(config.temperature).toBe(0.2)
        expect(config.maxTokens).toBe(4096)
        return { content: '{"updates":[{"id":"tpl-a","variables":{"hp":99},"reason":"r"}]}', usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11, cacheReadTokens: null }, model: 'analysis-model' }
      },
    })
    expect(calls).toHaveLength(1)
    const userMessage = (calls[0]!.messages as Array<{ role: string; content: string }>).find((m) => m.role === 'user')!
    expect(userMessage.content).toContain('"templates"')
    expect(userMessage.content).toContain('tpl-a')
    expect(userMessage.content).toContain('recentMessages')
    expect(outcome.replies).toHaveLength(1)
    expect(outcome.failedTemplates).toBe(0)
    expect(outcome.replies[0]!.content).toContain('tpl-a')
  })

  it('per-template mode runs with concurrency cap and tags usage per template', async () => {
    let inFlight = 0
    let peak = 0
    const usageMetas: Array<string | null> = []
    const many = Array.from({ length: 7 }, (_, index) => ({ id: `tpl-${index}`, name: `t${index}`, currentVariables: {}, variableSchema: '' }))
    const outcome = await runTemplateAnalysis({
      config: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' },
      templates: many,
      recentFloors: FLOORS,
      userInfo: '',
      batch: false,
      complete: async (_config, messages) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        const system = (messages as Array<{ role: string; content: string }>).find((m) => m.role === 'system')!
        expect(system.content).toContain('"variables"') // single-template reply shape
        return { content: '{"variables":{},"reason":"无变化"}', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cacheReadTokens: null }, model: 'm' }
      },
      onUsage: (_usage, meta) => usageMetas.push(meta.type),
    })
    expect(outcome.replies).toHaveLength(7)
    expect(peak).toBeLessThanOrEqual(ANALYSIS_CONCURRENCY)
    expect(usageMetas.every((type) => type === 'ui_template')).toBe(true)
  })

  it('retries retryable failures and reports the first error after exhausting attempts', async () => {
    let attempts = 0
    const outcome = await runTemplateAnalysis({
      config: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' },
      templates: TEMPLATES,
      recentFloors: FLOORS,
      userInfo: '',
      batch: true,
      complete: async () => {
        attempts += 1
        throw Object.assign(new Error('请求失败: network down'), { status: 503 })
      },
    })
    expect(attempts).toBe(ANALYSIS_MAX_ATTEMPTS)
    expect(outcome.failedTemplates).toBe(1)
    expect(outcome.firstError).toContain('network down')
    expect(outcome.replies).toHaveLength(0)
  })

  it('does NOT retry non-retryable errors (HTTP 400)', async () => {
    let attempts = 0
    const outcome = await runTemplateAnalysis({
      config: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' },
      templates: TEMPLATES,
      recentFloors: FLOORS,
      userInfo: '',
      batch: true,
      complete: async () => {
        attempts += 1
        throw Object.assign(new Error('HTTP 400: bad request'), { status: 400 })
      },
    })
    expect(attempts).toBe(1)
    expect(outcome.failedTemplates).toBe(1)
  })
})

describe('renderTemplateStateContext', () => {
  it('renders the read-only snapshot envelope; empty input renders nothing', () => {
    const context = renderTemplateStateContext([{ name: '状态面板', state: { hp: 10 } }])
    expect(context).toContain('<ui_template_state_context>')
    expect(context).toContain('<template_state name="状态面板">')
    expect(context).toContain('"hp": 10')
    expect(context).toContain('不要复述、改写或输出这些变量')
    expect(renderTemplateStateContext([])).toBe('')
  })
})
