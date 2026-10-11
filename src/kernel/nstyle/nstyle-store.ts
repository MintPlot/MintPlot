/**
 * 叙事风格存储（M4-nstyle）— 自定义风格 CRUD、全局配置、故事级覆盖与会话
 * 临时配置。
 *
 * 复用既有 StorageRepository（ADR-003 域键纪律）：
 *   - `nstyle:customs`        自定义风格档案数组（builtin=false）
 *   - `nstyle:global`         全局默认配置
 *   - `nstyle:card:<cardId>`  单个故事（卡域）的独立配置
 * 会话临时配置不落盘 —— 内存 ref（app 会话期间有效）。
 *
 * 同步镜像：请求组装是同步路径（request-assembly 的 deps 全为同步 getter），
 * 所以内存里持有一份镜像，写操作先更新镜像再异步落盘；工厂创建时异步水合
 * 一次（与 settings-state 的 hydrate 时序纪律一致）。同步 getter 永远命中
 * 镜像，请求路径零 await。
 *
 * 优先级（视图层解析）：会话临时 > 故事级 > 全局 > 内置默认。
 */

import type { StorageRepository } from '@/kernel/store/storage-repository'
import type { NstyleConfig, NstyleProfile } from './types'
import { NSTYLE_VERSION } from './types'
import { parseNstyleConfig, parseProfile } from './validate'

const CUSTOMS_KEY = 'nstyle:customs'
const GLOBAL_KEY = 'nstyle:global'
const cardKey = (cardId: string): string => `nstyle:card:${cardId}`

export interface NstyleStore {
  /** 水合 Promise：启动时从持久层回填镜像；请求路径依赖的镜像在它之后有效。 */
  readonly hydrated: Promise<void>
  /** 自定义风格列表（镜像同步读；不含内置预设）。 */
  listCustomsSync(): NstyleProfile[]
  /** 创建（id 缺省时生成）或按 id 更新；镜像同步更新 + 异步落盘。 */
  saveCustom(profile: NstyleProfile): Promise<NstyleProfile>
  deleteCustom(id: string): Promise<void>
  getGlobalSync(): NstyleConfig | null
  setGlobal(config: NstyleConfig): Promise<void>
  /** 故事级覆盖；null = 清除覆盖（回落全局）。 */
  getCardOverrideSync(cardId: string): NstyleConfig | null
  setCardOverride(cardId: string, config: NstyleConfig | null): Promise<void>
  /** 异步读取（落盘后的权威值；一般用同步镜像即可）。 */
  getGlobal(): Promise<NstyleConfig | null>
  getCardOverride(cardId: string): Promise<NstyleConfig | null>
}

const newId = (): string => `nstyle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function createNstyleStore(repository: StorageRepository): NstyleStore {
  // ── 同步镜像（请求路径的数据源）──
  let globalConfig: NstyleConfig | null = null
  let customsCache: NstyleProfile[] = []
  const cardConfigs = new Map<string, NstyleConfig>()

  const hydrated: Promise<void> = (async () => {
    const [customsRaw, globalRaw] = await Promise.all([
      repository.get<unknown>(CUSTOMS_KEY),
      repository.get<unknown>(GLOBAL_KEY),
    ])
    if (Array.isArray(customsRaw)) {
      const profiles: NstyleProfile[] = []
      for (const entry of customsRaw) {
        const parsed = parseProfile(entry)
        if (parsed.ok && parsed.profile) profiles.push(parsed.profile)
      }
      customsCache = profiles
    }
    if (globalRaw !== undefined && globalRaw !== null) globalConfig = parseNstyleConfig(globalRaw)
  })().catch((error) => {
    console.error('[nstyle-store] hydrate failed; starting from empty mirror:', error)
  })

  const persistCustoms = async (): Promise<void> => {
    // 镜像即权威（写路径已同步更新），落盘只是持久化镜像。
    await repository.set(CUSTOMS_KEY, customsCache)
  }

  const store: NstyleStore = {
    hydrated,

    listCustomsSync() {
      return customsCache
    },

    async saveCustom(profile) {
      const now = Date.now()
      const normalized: NstyleProfile = {
        ...profile,
        id: profile.id || newId(),
        builtin: false,
        version: NSTYLE_VERSION,
        createdAt: profile.createdAt || now,
        updatedAt: now,
      }
      const index = customsCache.findIndex((entry) => entry.id === normalized.id)
      if (index >= 0) customsCache[index] = normalized
      else customsCache.push(normalized)
      await persistCustoms()
      return normalized
    },

    async deleteCustom(id) {
      customsCache = customsCache.filter((entry) => entry.id !== id)
      await persistCustoms()
    },

    getGlobalSync() {
      return globalConfig
    },

    async setGlobal(config) {
      globalConfig = config
      await repository.set(GLOBAL_KEY, config)
    },

    getCardOverrideSync(cardId) {
      return cardConfigs.get(cardId) ?? null
    },

    async setCardOverride(cardId, config) {
      if (config === null) {
        cardConfigs.delete(cardId)
        await repository.remove(cardKey(cardId))
        return
      }
      cardConfigs.set(cardId, config)
      await repository.set(cardKey(cardId), config)
    },

    async getGlobal() {
      await hydrated
      return globalConfig
    },

    async getCardOverride(cardId) {
      await hydrated
      return cardConfigs.get(cardId) ?? null
    },
  }
  void hydrated
  return store
}

/** 会话临时配置（内存，不落盘）— 请求侧最高优先级。模块级单例。 */
let tempOverride: NstyleConfig | null = null
const tempListeners = new Set<() => void>()

export function getTempOverride(): NstyleConfig | null {
  return tempOverride
}

export function setTempOverride(config: NstyleConfig | null): void {
  tempOverride = config
  for (const listener of tempListeners) listener()
}

export function onTempOverrideChange(listener: () => void): () => void {
  tempListeners.add(listener)
  return () => tempListeners.delete(listener)
}

export { parseNstyleConfig, parseProfile }
