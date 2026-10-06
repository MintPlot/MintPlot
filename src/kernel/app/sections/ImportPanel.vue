<script setup lang="ts">
// 导入面板(M4-g2):统一入口吃三类来源 —— RP 备份 zip(SQLite 库)、酒馆备份
// zip(资产目录树)、散装 JSON/PNG(社区单文件)。流程 = 选文件 → 识别来源 →
// 清单勾选(RP: 卡多选+全局物/预设开关;ST: 资产清单+世界书/正则的目标卡)
// → 落库 → 结果 toast。桥不可用(纯 Web)给出说明而非报错。
import { computed, ref } from 'vue'
import { ImportBridgeUnavailableError, resolveImportBridge } from '@/kernel/import/import-bridge'
import { createImportService, stAssetKindLabel, type ArchiveInspection, type ImportService, type LandResult, type StImportPlan } from '@/kernel/import/import-service'
import type { RpImportPlan, RpImportPlanCard } from '@/kernel/import/rp-import'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createDefaultEngine } from '@/kernel/store/idb-engine'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createPresetStore } from '@/kernel/presets/preset-store'
import { uiService } from '@/kernel/ui/toasts'

type Phase = 'idle' | 'inspecting' | 'rp-pick' | 'st-pick' | 'landing' | 'done'

const phase = ref<Phase>('idle')
const statusText = ref('')
const resultText = ref('')
const inspection = ref<ArchiveInspection | null>(null)
const rpPlan = ref<RpImportPlan | null>(null)
const selectedUuids = ref<string[]>([])
const includeGlobals = ref(true)
const includePresets = ref(true)
const stPlan = ref<StImportPlan | null>(null)
const selectedAssets = ref<string[]>([])
const cards = ref<Array<{ id: string; name: string }>>([])
const targetCardId = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const service = ref<ImportService | null>(null)
const cardStore = createCharacterStore(createStorageRepository(createDefaultEngine()))
const presetStore = createPresetStore(createStorageRepository(createDefaultEngine()))

const ensureService = (): ImportService | null => {
  if (service.value) return service.value
  const bridge = resolveImportBridge()
  if (!bridge) return null
  service.value = createImportService({ bridge, repository: createStorageRepository(createDefaultEngine()), characters: cardStore, presets: presetStore })
  return service.value
}

const reset = (): void => {
  phase.value = 'idle'
  statusText.value = ''
  resultText.value = ''
  inspection.value = null
  rpPlan.value = null
  selectedUuids.value = []
  stPlan.value = null
  selectedAssets.value = []
}

const picking = ref(false)

const beginImport = (): void => {
  resultText.value = ''
  // Double-fire guard: a second click while the SAF picker is up would open
  // another picker session and orphan the first call's promise forever.
  if (picking.value || isBusy.value) return
  const active = ensureService()
  if (!active) {
    uiService.toast('shell', '当前环境不支持备份导入(需要应用内运行)', { tone: 'error' })
    return
  }
  // Zip backups (a real RP backup is ~100 MB) ride the bridge's own streaming
  // SAF picker — the renderer never holds the bytes (the first real-backup
  // test crashed the renderer on a JS-side base64 round-trip).
  void inspectArchive(active)
}

const beginLooseImport = (): void => {
  resultText.value = ''
  if (picking.value || isBusy.value) return
  if (!ensureService()) {
    uiService.toast('shell', '当前环境不支持备份导入(需要应用内运行)', { tone: 'error' })
    return
  }
  picking.value = true
  fileInput.value?.click()
}

const onFilesChosen = async (event: Event): Promise<void> => {
  picking.value = false
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  const active = service.value
  if (!active || files.length === 0) return
  await inspectLoose(active, files)
}

const inspectArchive = async (active: ImportService): Promise<void> => {
  phase.value = 'inspecting'
  statusText.value = '正在识别备份文件…'
  try {
    const found = await active.inspectArchive()
    inspection.value = found
    if (found.source === 'rp') {
      if (!found.databaseEntryName) throw new Error('备份缺少数据库文件')
      statusText.value = `RP-Hub 备份 · ${new Date(found.rpInfo?.createdAt ?? 0).toLocaleString()}`
      phase.value = 'rp-pick'
      await loadRpPlan(active, found.sessionId, found.databaseEntryName, [], true)
      selectedUuids.value = rpPlan.value?.cards.map((card) => card.rpUuid) ?? []
    } else {
      statusText.value = '酒馆备份'
      const plan = await active.inspectStArchive(found.sessionId, found.entries)
      stPlan.value = plan
      selectedAssets.value = plan.assets.map((asset) => asset.entryName)
      await loadTargetCards()
      phase.value = 'st-pick'
    }
  } catch (error) {
    reset()
    picking.value = false
    if ((error as { cancelled?: boolean })?.cancelled) return
    if (!(error instanceof ImportBridgeUnavailableError)) {
      uiService.toast('shell', (error as Error)?.message || '识别失败', { tone: 'error', durationMs: 5000 })
    }
  }
}

const loadRpPlan = async (active: ImportService, sessionId: string, databaseEntryName: string, uuids: string[], listAll = false): Promise<void> => {
  const { plan } = await active.buildRpPlan(sessionId, databaseEntryName, uuids, { includeGlobals: includeGlobals.value, includePresets: includePresets.value, listAll })
  rpPlan.value = plan
}

const loadTargetCards = async (): Promise<void> => {
  cards.value = (await cardStore.list()).map((entry) => ({ id: entry.id, name: entry.name }))
  targetCardId.value = cards.value[0]?.id ?? ''
}

const inspectLoose = async (active: ImportService, files: File[]): Promise<void> => {
  phase.value = 'inspecting'
  statusText.value = '正在识别文件…'
  try {
    const payloads = await Promise.all(
      files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
    )
    const plan = await active.inspectLooseFiles(payloads)
    stPlan.value = plan
    selectedAssets.value = plan.assets.map((asset) => asset.entryName)
    await loadTargetCards()
    phase.value = 'st-pick'
  } catch (error) {
    reset()
    uiService.toast('shell', (error as Error)?.message || '识别失败', { tone: 'error', durationMs: 5000 })
  }
}

const toggleCard = (rpUuid: string): void => {
  const active = service.value
  const found = inspection.value
  if (!active || !found?.databaseEntryName) return
  const next = selectedUuids.value.includes(rpUuid)
    ? selectedUuids.value.filter((id) => id !== rpUuid)
    : [...selectedUuids.value, rpUuid]
  selectedUuids.value = next
  void (async () => {
    try {
      const { plan } = await active.buildRpPlan(found.sessionId, found.databaseEntryName!, next, { includeGlobals: includeGlobals.value, includePresets: includePresets.value })
      rpPlan.value = plan
    } catch {
      // keep the previous plan on rebuild failure
    }
  })()
}

const rpCardSummary = (card: RpImportPlanCard): string => {
  const parts = [`${card.floors.length} 楼`]
  if (card.memory && (card.memory.long || card.memory.short)) parts.push('记忆')
  if (card.avatarEntryName) parts.push('头像')
  return parts.join(' · ')
}

const confirmImport = async (): Promise<void> => {
  const active = service.value
  const found = inspection.value
  if (!active || !found) return
  phase.value = 'landing'
  statusText.value = '正在导入…'
  try {
    let result: LandResult
    if (found.source === 'rp' && rpPlan.value) {
      const { plan, avatarBytes } = await active.buildRpPlan(found.sessionId, found.databaseEntryName!, selectedUuids.value, { includeGlobals: includeGlobals.value, includePresets: includePresets.value })
      result = await active.landRp(plan, avatarBytes)
    } else if (stPlan.value) {
      const chosen = stPlan.value.assets.filter((asset) => selectedAssets.value.includes(asset.entryName))
      result = await active.landSt({ assets: chosen, warnings: stPlan.value.warnings }, targetCardId.value || null)
      if (found.sessionId) await active.closeArchive(found.sessionId)
    } else {
      throw new Error('没有可导入的内容')
    }
    finish(result)
  } catch (error) {
    reset()
    uiService.toast('shell', `导入失败:${(error as Error)?.message || '未知错误'}`, { tone: 'error', durationMs: 6000 })
  }
}

const finish = (result: LandResult): void => {
  phase.value = 'done'
  const parts: string[] = []
  if (result.importedCardIds.length) parts.push(`${result.importedCardIds.length} 张卡`)
  if (result.presetCount) parts.push(`${result.presetCount} 条预设`)
  resultText.value = parts.length ? `已导入:${parts.join('、')}` : '没有导入任何内容'
  if (result.warnings.length) resultText.value += ` · ${result.warnings.length} 条警告`
  statusText.value = ''
}

const cancel = async (): Promise<void> => {
  const active = service.value
  const found = inspection.value
  if (active && found?.sessionId) await active.closeArchive(found.sessionId)
  reset()
}

const isBusy = computed(() => phase.value === 'inspecting' || phase.value === 'landing')
</script>

<template>
  <div class="space-y-2">
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      multiple
      accept=".zip,.backup,.json,.png"
      @change="onFilesChosen"
    >

    <button
      type="button"
      class="flex w-full items-center justify-between rounded-input border border-line bg-card px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-bg active:bg-bg"
      :disabled="isBusy"
      @click="beginImport"
    >
      <span>导入备份文件</span>
      <span class="text-xs text-ink-3">{{ isBusy ? '处理中…' : 'RP-Hub / 酒馆 zip' }}</span>
    </button>
    <button
      type="button"
      class="flex w-full items-center justify-between rounded-input border border-line bg-card px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-bg active:bg-bg"
      :disabled="isBusy"
      @click="beginLooseImport"
    >
      <span>导入散装文件</span>
      <span class="text-xs text-ink-3">世界书 / 正则 / 预设 / 角色卡</span>
    </button>

    <div
      v-if="phase !== 'idle' && phase !== 'done'"
      class="rounded-input border border-line bg-bg px-3 py-2.5"
    >
      <div class="mb-1 text-xs font-bold text-ink-2">
        {{ statusText }}
      </div>

      <!-- RP: card multi-select + global/preset switches -->
      <template v-if="phase === 'rp-pick' && rpPlan">
        <div
          v-if="rpPlan.cards.length === 0"
          class="py-2 text-xs text-ink-3"
        >
          备份中没有可导入的角色卡
        </div>
        <label
          v-for="card in rpPlan.cards"
          :key="card.rpUuid"
          class="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-ink"
        >
          <input
            type="checkbox"
            :checked="selectedUuids.includes(card.rpUuid)"
            @change="toggleCard(card.rpUuid)"
          >
          <span class="min-w-0 flex-1 truncate">{{ card.name }}</span>
          <span class="text-[10px] text-ink-3">{{ rpCardSummary(card) }}</span>
        </label>
        <div class="mt-2 space-y-1 border-t border-line pt-2">
          <label class="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
            <input
              v-model="includeGlobals"
              type="checkbox"
            >
            <span>全局世界书/正则/UI模板(挂到选中的卡上)</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
            <input
              v-model="includePresets"
              type="checkbox"
            >
            <span>预设({{ rpPlan.presets.length }} 条,导入为停用)</span>
          </label>
        </div>
      </template>

      <!-- ST: asset checklist + target card -->
      <template v-if="phase === 'st-pick' && stPlan">
        <div
          v-if="stPlan.assets.length === 0"
          class="py-2 text-xs text-ink-3"
        >
          没有可识别的资产
        </div>
        <label
          v-for="asset in stPlan.assets"
          :key="asset.entryName"
          class="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-ink"
        >
          <input
            v-model="selectedAssets"
            type="checkbox"
            :value="asset.entryName"
          >
          <span class="min-w-0 flex-1 truncate">{{ asset.name }}</span>
          <span class="text-[10px] text-ink-3">{{ stAssetKindLabel(asset.kind) }}<template v-if="asset.notes"> · 有损</template></span>
        </label>
        <div
          v-for="asset in stPlan.assets.filter((entry) => entry.notes)"
          :key="`note-${asset.entryName}`"
          class="mt-1 text-[10px] leading-relaxed text-ink-3"
        >
          {{ asset.name }}:{{ asset.notes!.join(';') }}
        </div>
        <div
          v-if="stPlan.assets.some((asset) => asset.kind === 'worldbook' || asset.kind === 'regex')"
          class="mt-2 border-t border-line pt-2"
        >
          <div class="mb-1 text-xs text-ink-2">
            世界书/正则挂载到卡:
          </div>
          <select
            v-model="targetCardId"
            class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-sm text-ink"
          >
            <option value="">
              不挂载(仅导卡和预设)
            </option>
            <option
              v-for="card in cards"
              :key="card.id"
              :value="card.id"
            >
              {{ card.name }}
            </option>
          </select>
        </div>
      </template>

      <div class="mt-3 flex gap-2">
        <button
          type="button"
          class="flex-1 rounded-input border border-line bg-card px-2 py-1.5 text-xs text-ink-2"
          @click="cancel"
        >
          取消
        </button>
        <button
          type="button"
          class="flex-1 rounded-input bg-chat-accent px-2 py-1.5 text-xs font-bold text-chat-on-bubble-ai"
          :disabled="isBusy"
          @click="confirmImport"
        >
          {{ phase === 'landing' ? '导入中…' : '开始导入' }}
        </button>
      </div>
    </div>

    <div
      v-if="resultText"
      class="rounded-input border border-line bg-bg px-3 py-2 text-xs text-ink-2"
    >
      {{ resultText }}
    </div>
  </div>
</template>
