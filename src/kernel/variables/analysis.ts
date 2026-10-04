/**
 * Secondary-model template analysis (M3-t, native) — the RP analysis pipeline
 * internalized (behavior source: decoupled repo useUiTemplatePipeline.mjs;
 * not a code port). Main-model mode parses the reply's protocol block; when
 * the block is missing/unroutable the pipeline FALLS BACK to a dedicated
 * analysis request, and in sub-model mode every reply is analyzed that way.
 *
 * Request shape mirrors RP: recent 4–10 floors + current state + the card's
 * own variableSchema, temperature 0.2, a token budget decoupled from chat
 * (default 4096), optional structured-JSON output, batch ≤5 templates per
 * request (else per-template, concurrency 3), 2 attempts on retryable errors.
 */

import type { LlmChatMessage, LlmRequestConfig, LlmUsage } from '@/kernel/llm/chat-completions'
import { completeChatCompletion } from '@/kernel/llm/chat-completions'
import type { SettingsState } from '@/kernel/settings/settings-state'

export interface TemplateAnalysisSettings {
  /** true = main-model protocol blocks (default); false = always analyze. */
  mainModelAnalysis: boolean
  analysisModel: string
  analysisDepth: number
  injectContext: boolean
  batchMode: boolean
  jsonMode: boolean
  maxOutputTokens: number
}

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

export function readTemplateAnalysisSettings(settings: SettingsState | null): TemplateAnalysisSettings {
  if (!settings) {
    return {
      mainModelAnalysis: true,
      analysisModel: '',
      analysisDepth: 4,
      injectContext: false,
      batchMode: true,
      jsonMode: true,
      maxOutputTokens: 4096,
    }
  }
  const scope = settings.scope([
    'uiTemplateMainModelAnalysis',
    'uiTemplateModel',
    'uiTemplateAnalysisDepth',
    'uiTemplateInjectContext',
    'uiTemplateBatchMode',
    'uiTemplateJsonMode',
    'uiTemplateMaxOutputTokens',
  ])
  return {
    mainModelAnalysis: scope.uiTemplateMainModelAnalysis !== false,
    analysisModel: String(scope.uiTemplateModel ?? '').trim(),
    analysisDepth: clamp(Number(scope.uiTemplateAnalysisDepth), 4, 10, 4),
    injectContext: scope.uiTemplateInjectContext === true,
    batchMode: scope.uiTemplateBatchMode !== false,
    jsonMode: scope.uiTemplateJsonMode !== false,
    maxOutputTokens: clamp(Number(scope.uiTemplateMaxOutputTokens), 1024, 16384, 4096),
  }
}

export interface AnalysisTemplatePayload {
  id: string
  name: string
  currentVariables: Record<string, unknown>
  variableSchema: string
}

export interface AnalysisFloor {
  role: 'user' | 'assistant'
  name: string
  content: string
}

const BATCH_MAX_TEMPLATES = 5
export const ANALYSIS_CONCURRENCY = 3
export const ANALYSIS_MAX_ATTEMPTS = 2
const RETRY_BACKOFF_MS = 800

const buildBatchMessages = (
  templates: AnalysisTemplatePayload[],
  recentFloors: AnalysisFloor[],
  userInfo: string,
  force: boolean,
): LlmChatMessage[] => [
  {
    role: 'system',
    content: [
      '你是变量更新器。当前请求同时分析多个变量模板。',
      '只根据用户消息里提供的最近对话，更新下方每个模板已定义的变量。',
      '严格返回JSON，不要解释，不要输出Markdown围栏，不要输出任何额外字段。',
      '返回格式固定为 {"updates":[{"id":"模板id","variables":{"变量路径":"新值"},"reason":"简短原因"}]}。',
      '每个模板最多返回一条更新；没有变化的模板不要出现在updates里。',
      ...(force ? ['本次请求为手动刷新：每个建议必须按最新情境重新生成，不要沿用上一轮。'] : []),
      '变量值可以是文字、数字、对象或JSON数组；数组字段可返回完整数组。',
      '只更新每个模板已定义的变量；不要修改HTML；不要编造无关字段。',
      '',
      '用户信息如下（用于判断称呼、人称；不要在JSON外复述）：',
      userInfo,
    ].join('\n'),
  },
  {
    role: 'user',
    content: JSON.stringify({ templates, recentMessages: recentFloors }),
  },
]

const buildSingleMessages = (
  template: AnalysisTemplatePayload,
  recentFloors: AnalysisFloor[],
  userInfo: string,
  force: boolean,
): LlmChatMessage[] => [
  {
    role: 'system',
    content: [
      '你是变量更新器。当前请求只分析一个变量模板。',
      '只根据用户消息里提供的最近对话，更新下方模板已定义的变量。',
      '严格返回JSON，不要解释，不要输出Markdown围栏，不要输出任何额外字段。',
      '返回格式固定为 {"variables":{"变量路径":"新值"},"reason":"简短原因"}。',
      '变量值可以是文字、数字、对象或JSON数组；数组字段可直接返回完整数组。',
      '没有变化则返回 {"variables":{},"reason":"无变化"}。不要返回模板id，不要套updates数组，不要修改HTML。',
      ...(force ? ['本次请求为手动刷新：建议必须按最新情境重新生成，不要沿用上一轮。'] : []),
      '',
      '用户信息如下（用于判断称呼、人称；不要在JSON外复述）：',
      userInfo,
      '',
      '当前变量JSON如下：',
      JSON.stringify(template.currentVariables, null, 2),
      ...(template.variableSchema.trim()
        ? ['', '变量说明如下（给AI参考，必须按这里理解字段含义和生成规则）：', template.variableSchema]
        : []),
    ].join('\n'),
  },
  {
    role: 'user',
    content: JSON.stringify({ recentMessages: recentFloors }, null, 2),
  },
]

/** Batch when enabled, ≤5 templates, else per-template requests. */
export const useBatchAnalysis = (settings: TemplateAnalysisSettings, templateCount: number): boolean =>
  settings.batchMode && templateCount > 1 && templateCount <= BATCH_MAX_TEMPLATES

export interface AnalysisCallResult {
  content: string
  usage: LlmUsage | null
  model: string
}

type CompleteFn = (
  config: LlmRequestConfig,
  messages: readonly LlmChatMessage[],
  options: { signal?: AbortSignal },
) => Promise<AnalysisCallResult>

const isRetryable = (error: unknown): boolean => {
  const status = (error as { status?: number })?.status
  if (status === 429 || (typeof status === 'number' && status >= 500 && status <= 599)) return true
  const message = String((error as Error)?.message ?? '')
  return message.includes('请求失败') // network-layer TypeError wrapper
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** One retryable analysis request (2 attempts, 800ms×n backoff). */
const requestWithRetry = async (
  complete: CompleteFn,
  config: LlmRequestConfig,
  messages: LlmChatMessage[],
  signal: AbortSignal | undefined,
  onRetry?: (attempt: number) => void,
): Promise<AnalysisCallResult> => {
  let lastError: unknown
  for (let attempt = 0; attempt < ANALYSIS_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await complete(config, messages, { signal })
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw error
      if (!isRetryable(error) || attempt >= ANALYSIS_MAX_ATTEMPTS - 1) break
      onRetry?.(attempt + 1)
      await sleep(RETRY_BACKOFF_MS * (attempt + 1))
    }
  }
  throw lastError
}

export interface TemplateAnalysisOutcome {
  /** Raw parsed JSON of every successful reply, in request order. */
  replies: Array<{ templateId: string | null; content: string }>
  failedTemplates: number
  firstError: string
}

/** Runs the analysis requests (batch or per-template, concurrency 3) and
 *  returns raw contents — parsing/routing/application stay with the caller
 *  (the same parse+match+apply chain the main-model block path uses). */
export async function runTemplateAnalysis(options: {
  config: LlmRequestConfig
  templates: AnalysisTemplatePayload[]
  recentFloors: AnalysisFloor[]
  userInfo: string
  batch: boolean
  /** Manual refresh: ask for regenerated suggestions. */
  force?: boolean
  signal?: AbortSignal
  complete?: CompleteFn
  onUsage?: (usage: LlmUsage | null, meta: { type: 'ui_template' | 'ui_template_batch'; model: string; detail: string }) => void
  onRetry?: (attempt: number) => void
}): Promise<TemplateAnalysisOutcome> {
  const { config, templates, recentFloors, userInfo, batch, signal } = options
  const complete = options.complete ?? completeChatCompletion
  const replies: TemplateAnalysisOutcome['replies'] = []
  let failedTemplates = 0
  let firstError = ''

  const runOne = async (template: AnalysisTemplatePayload | null): Promise<void> => {
    const messages = template
      ? buildSingleMessages(template, recentFloors, userInfo, options.force === true)
      : buildBatchMessages(templates, recentFloors, userInfo, options.force === true)
    try {
      const result = await requestWithRetry(complete, config, messages, signal, options.onRetry)
      options.onUsage?.(result.usage, {
        type: template ? 'ui_template' : 'ui_template_batch',
        model: result.model,
        detail: template ? template.name : `${templates.length} 个模板合并`,
      })
      replies.push({ templateId: template?.id ?? null, content: result.content })
    } catch (error) {
      if (signal?.aborted) return
      failedTemplates += 1
      if (!firstError) firstError = String((error as Error)?.message ?? error ?? '未知错误')
    }
  }

  if (batch && templates.length > 1) {
    await runOne(null)
  } else {
    for (let index = 0; index < templates.length; index += ANALYSIS_CONCURRENCY) {
      await Promise.all(templates.slice(index, index + ANALYSIS_CONCURRENCY).map((template) => runOne(template)))
    }
  }
  return { replies, failedTemplates, firstError }
}

/** Sub-model mode context injection (RP `<ui_template_state_context>` shape,
 *  MP wording): a read-only snapshot so the model understands the state —
 *  never a rewrite instruction. */
export const renderTemplateStateContext = (
  templates: Array<{ name: string; state: Record<string, unknown> }>,
): string => {
  if (templates.length === 0) return ''
  const sections = templates.map((entry) =>
    [
      `  <template_state name="${entry.name}">`,
      ...JSON.stringify(entry.state, null, 2)
        .split('\n')
        .map((line) => `    ${line}`),
      '  </template_state>',
    ].join('\n'))
  return [
    '<ui_template_state_context>',
    '  <description>以下内容是供你参考的当前剧情状态快照，不是正文，不要复述、改写或输出这些变量。请只用它理解角色状态、关系、地点。</description>',
    ...sections,
    '</ui_template_state_context>',
  ].join('\n')
}
