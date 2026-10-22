/**
 * 叙事风格校验（M4-nstyle）— 参数钳制、配置解析与导入校验。
 *
 * 规范七/十：导入时验证数据结构与取值范围，拒绝或安全处理不合法数据；
 * 缺失字段回落默认值；旧版本配置做兼容；绝不抛出未处理的脏数据。
 */

import type { NstyleConfig, NstyleNarration, NstyleParamKey, NstyleProfile } from './types'
import {
  DEFAULT_STORY_CONFIG,
  DEFAULT_STORY_NARRATION,
  DEFAULT_STORY_PARAMS,
  NSTYLE_PARAM_KEYS,
  NSTYLE_VERSION,
} from './types'

const clamp100 = (value: unknown, fallback: number): number => {
  const num = Math.round(Number(value))
  if (!Number.isFinite(num)) return fallback
  return Math.min(100, Math.max(0, num))
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

/** 钳制 12 个参数到 0–100；未知键忽略，缺失键回落默认。 */
export function clampParams(raw: unknown): Record<NstyleParamKey, number> {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const result = {} as Record<NstyleParamKey, number>
  for (const key of NSTYLE_PARAM_KEYS) {
    result[key] = clamp100(source[key], DEFAULT_STORY_PARAMS[key])
  }
  return result
}

const VIEWPOINTS = ['first', 'third', 'thirdLimited', 'omniscient', 'auto'] as const
const TENSES = ['past', 'present', 'auto'] as const
const MONOLOGUES = ['off', 'some', 'rich'] as const
const MODES = ['dialogueLed', 'balanced', 'narrationLed', 'auto'] as const
const LENGTHS = ['concise', 'standard', 'detailed', 'adaptive'] as const
const PORTRAYALS = ['behavior', 'dialogue', 'inner', 'mixed'] as const
const TRANSITIONS = ['cut', 'smooth', 'lingering'] as const
const LANGUAGES = ['plain', 'natural', 'rich', 'literary'] as const

/** 解析叙述方式设置；非法值逐项回落默认。 */
export function parseNarration(raw: unknown): NstyleNarration {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    viewpoint: oneOf(source.viewpoint, VIEWPOINTS, DEFAULT_STORY_NARRATION.viewpoint),
    tense: oneOf(source.tense, TENSES, DEFAULT_STORY_NARRATION.tense),
    monologue: oneOf(source.monologue, MONOLOGUES, DEFAULT_STORY_NARRATION.monologue),
    mode: oneOf(source.mode, MODES, DEFAULT_STORY_NARRATION.mode),
    length: oneOf(source.length, LENGTHS, DEFAULT_STORY_NARRATION.length),
    portrayal: oneOf(source.portrayal, PORTRAYALS, DEFAULT_STORY_NARRATION.portrayal),
    transition: oneOf(source.transition, TRANSITIONS, DEFAULT_STORY_NARRATION.transition),
    language: oneOf(source.language, LANGUAGES, DEFAULT_STORY_NARRATION.language),
  }
}

/** 解析标签：字符串数组，去重、去空白、限量（防导入膨胀）。 */
export function parseTags(raw: unknown, max = 12): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const tag = entry.trim().slice(0, 16)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= max) break
  }
  return tags
}

/** 解析一份完整配置（缺失/非法字段回落默认，绝不抛出）。 */
export function parseNstyleConfig(raw: unknown): NstyleConfig {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    params: clampParams(source.params),
    narration: parseNarration(source.narration),
    tags: parseTags(source.tags),
  }
}

export interface ParsedProfile {
  ok: boolean
  profile?: NstyleProfile
  reason?: string
}

/**
 * 解析一份导入/持久化的风格档案。返回 ok=false 时携带原因（面板展示），
 * 绝不把结构不明的数据直接塞进存储。
 */
export function parseProfile(raw: unknown): ParsedProfile {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: '不是有效的风格对象' }
  const source = raw as Record<string, unknown>
  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim().slice(0, 64) : ''
  const name = typeof source.name === 'string' ? source.name.trim().slice(0, 40) : ''
  if (!id) return { ok: false, reason: '缺少风格 ID' }
  if (!name) return { ok: false, reason: '缺少风格名称' }
  // 内置预设不允许通过导入通道重建（id 前缀保留）。
  if (id.startsWith('preset-')) return { ok: false, reason: '内置预设 ID 保留，不能导入' }
  const version = Number(source.version) === NSTYLE_VERSION ? NSTYLE_VERSION : NSTYLE_VERSION
  const description = typeof source.description === 'string' ? source.description.trim().slice(0, 200) : ''
  const config = parseNstyleConfig(source.config)
  const now = Date.now()
  const createdAt = Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : now
  return {
    ok: true,
    profile: {
      id,
      name,
      description,
      config,
      builtin: false,
      version,
      createdAt,
      updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : now,
    },
  }
}

export { DEFAULT_STORY_CONFIG }
