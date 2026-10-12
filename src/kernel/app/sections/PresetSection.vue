<script setup lang="ts">
// 提示词预设分区(M3-w,D6):预设是应用级配置,与「变量分析」同址设置页。
// 组切换器(互斥)+条目列表(名/角色标签/维度徽标/启停/上下移/编辑)+新建+导入
// 导出(RP 组包 JSON 同构——用户的 RP 预设文件可直接搬进 MP)。
// S4(风格维度):编辑器增维度下拉——打维度的条目进「风格」面板的维度块
// (system 通道强制,选维度即锁系统角色);无维度 = 普通条目。
import { computed, inject, onMounted, ref } from 'vue'
import { PRESET_STORE_KEY } from '@/kernel/app/chat-keys'
import type { PresetEntry, PresetRole, PresetSnapshot } from '@/kernel/presets/preset-store'
import { STYLE_DIMENSIONS, type StyleDimension } from '@/kernel/presets/style-dimensions'

const store = inject(PRESET_STORE_KEY, null)

const snapshot = ref<PresetSnapshot | null>(null)
const editing = ref<PresetEntry | null>(null)
const creating = ref(false)
const draftName = ref('')
const draftRole = ref<PresetRole>('system')
const draftContent = ref('')
const draftDimension = ref('')
const importMessage = ref('')

const activeGroupId = computed(() => snapshot.value?.groups.find((group) => group.enabled)?.id ?? 'default')
const activeGroupName = computed(() => snapshot.value?.groups.find((group) => group.enabled)?.name ?? '默认预设')
const activeEntries = computed(() =>
  (snapshot.value?.entries ?? []).filter((entry) => entry.group === activeGroupId.value))
const otherGroups = computed(() => (snapshot.value?.groups ?? []).filter((group) => !group.enabled))

const roleLabel: Record<PresetRole, string> = { system: '系统', user: '用户', assistant: 'AI' }
const dimensionLabel = (dimension: string): string =>
  STYLE_DIMENSIONS.find((meta) => meta.id === dimension)?.label ?? dimension

const load = async (): Promise<void> => {
  snapshot.value = (await store?.ensure()) ?? null
}
onMounted(load)

const toggleGroup = async (groupId: string): Promise<void> => {
  snapshot.value = (await store?.setActiveGroup(groupId)) ?? null
}

const toggleEntry = async (entry: PresetEntry): Promise<void> => {
  snapshot.value = (await store?.setEntryEnabled(entry.id, !entry.enabled)) ?? null
}

const move = async (entry: PresetEntry, direction: -1 | 1): Promise<void> => {
  snapshot.value = (await store?.moveEntry(entry.id, direction)) ?? null
}

const openCreate = (): void => {
  creating.value = true
  editing.value = null
  draftName.value = ''
  draftRole.value = 'system'
  draftContent.value = ''
  draftDimension.value = ''
}

const openEdit = (entry: PresetEntry): void => {
  creating.value = false
  editing.value = entry
  draftName.value = entry.name
  draftRole.value = entry.role
  draftContent.value = entry.content
  draftDimension.value = entry.dimension ?? ''
}

const saveDraft = async (): Promise<void> => {
  if (!draftName.value.trim() || !draftContent.value.trim()) return
  const dimension: StyleDimension | null = draftDimension.value === ''
    ? null
    : (draftDimension.value as StyleDimension)
  if (editing.value) {
    snapshot.value = (await store?.updateEntry(editing.value.id, {
      name: draftName.value.trim(),
      content: draftContent.value,
      role: draftRole.value,
      dimension,
    })) ?? null
  } else {
    snapshot.value = (await store?.addEntry({
      name: draftName.value.trim(),
      content: draftContent.value,
      role: draftRole.value,
      ...(dimension ? { dimension } : {}),
    })) ?? null
  }
  editing.value = null
  creating.value = false
}

/** S2 semantics: a dimension tag forces the system channel — picking a
 *  dimension locks the role select to 系统. */
const onDimensionChange = (): void => {
  if (draftDimension.value !== '') draftRole.value = 'system'
}

const removeEntry = async (entry: PresetEntry): Promise<void> => {
  snapshot.value = (await store?.removeEntry(entry.id)) ?? null
}

const exportGroups = async (): Promise<void> => {
  const json = (await store?.exportGroups()) ?? ''
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'preset_groups.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

const importGroups = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !store) return
  try {
    snapshot.value = await store.importGroups(await file.text())
    importMessage.value = '导入成功'
  } catch (error) {
    importMessage.value = `导入失败：${error instanceof Error ? error.message : '文件无法解析'}`
  }
  input.value = ''
}
</script>

<template>
  <div
    v-if="store"
    class="flex flex-col gap-3 px-4 py-4"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-medium text-ink-3">当前组:{{ activeGroupName }}</span>
      <div class="flex items-center gap-2">
        <select
          class="rounded-input border border-line bg-card px-2 py-1 text-xs text-ink outline-none focus:border-primary"
          :value="activeGroupId"
          @change="toggleGroup(($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="group in snapshot?.groups ?? []"
            :key="group.id"
            :value="group.id"
          >
            {{ group.name }}
          </option>
        </select>
        <button
          type="button"
          class="rounded-input border border-line px-2 py-1 text-xs text-ink-2"
          @click="exportGroups"
        >
          导出
        </button>
        <label class="cursor-pointer rounded-input border border-line px-2 py-1 text-xs text-ink-2">
          导入
          <input
            type="file"
            accept=".json"
            class="hidden"
            @change="importGroups"
          >
        </label>
      </div>
    </div>
    <p
      v-if="importMessage"
      class="text-[10px] text-ink-3"
    >
      {{ importMessage }}
    </p>
    <p
      v-if="otherGroups.length > 0"
      class="text-[10px] leading-relaxed text-ink-3"
    >
      其他组({{ otherGroups.map((group) => group.name).join('、') }})处于停用状态——组间互斥,切换即整套换装。
    </p>

    <p
      v-if="activeEntries.length === 0"
      class="py-4 text-center text-xs text-ink-3"
    >
      当前组暂无条目
    </p>

    <ul class="flex flex-col gap-2">
      <li
        v-for="(entry, index) in activeEntries"
        :key="entry.id"
        class="rounded-input border border-line bg-bg px-3 py-2"
      >
        <div class="flex items-center gap-2">
          <span
            class="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
            :class="entry.role === 'system' ? 'border border-primary/40 bg-primary/10 text-primary' : 'border border-line bg-card text-ink-3'"
          >
            {{ roleLabel[entry.role] }}
          </span>
          <span
            v-if="entry.dimension"
            class="flex-shrink-0 rounded-full border border-line bg-card px-1.5 py-0.5 text-[10px] text-ink-2"
          >
            {{ dimensionLabel(entry.dimension) }}
          </span>
          <span class="min-w-0 flex-1 truncate text-sm text-ink">{{ entry.name }}</span>
          <button
            type="button"
            class="relative h-5 w-9 flex-shrink-0 rounded-full transition-colors"
            :class="entry.enabled ? 'bg-primary' : 'bg-line'"
            :aria-label="`切换条目「${entry.name}」`"
            @click="toggleEntry(entry)"
          >
            <span
              class="absolute top-0.5 h-4 w-4 rounded-full bg-card transition-all"
              :class="entry.enabled ? 'left-[18px]' : 'left-0.5'"
            />
          </button>
        </div>
        <div class="mt-1 flex items-center gap-2 text-[10px] text-ink-3">
          <button
            type="button"
            class="rounded-input border border-line px-1.5"
            aria-label="上移"
            :disabled="index === 0"
            @click="move(entry, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            class="rounded-input border border-line px-1.5"
            aria-label="下移"
            :disabled="index === activeEntries.length - 1"
            @click="move(entry, 1)"
          >
            ↓
          </button>
          <button
            type="button"
            class="rounded-input border border-line px-2"
            @click="openEdit(entry)"
          >
            编辑
          </button>
          <button
            type="button"
            class="rounded-input border border-line px-2 active:text-danger"
            @click="removeEntry(entry)"
          >
            删除
          </button>
        </div>
      </li>
    </ul>

    <button
      type="button"
      class="rounded-input bg-primary px-3 py-1.5 text-xs font-bold text-on-primary"
      @click="openCreate"
    >
      新建条目
    </button>

    <div
      v-if="creating || editing"
      class="flex flex-col gap-2 rounded-input border border-line bg-bg px-3 py-2"
    >
      <input
        v-model="draftName"
        placeholder="条目名称"
        class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-primary"
      >
      <select
        v-model="draftDimension"
        class="rounded-input border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-primary"
        @change="onDimensionChange"
      >
        <option value="">
          无维度(普通预设条目)
        </option>
        <option
          v-for="meta in STYLE_DIMENSIONS"
          :key="meta.id"
          :value="meta.id"
        >
          {{ meta.label }}({{ meta.multi ? '可多选' : '单选' }})
        </option>
      </select>
      <select
        v-model="draftRole"
        class="rounded-input border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-primary disabled:opacity-50"
        :disabled="draftDimension !== ''"
      >
        <option value="system">
          系统(进系统提示词区)
        </option>
        <option
          v-if="draftDimension === ''"
          value="user"
        >
          用户(历史前预注入消息)
        </option>
        <option
          v-if="draftDimension === ''"
          value="assistant"
        >
          AI(历史前预注入消息)
        </option>
      </select>
      <p
        v-if="draftDimension !== ''"
        class="text-[10px] text-ink-3"
      >
        打维度的条目走「风格」面板的维度块(系统通道),在卡域顶栏「风格」中选择生效
      </p>
      <textarea
        v-model="draftContent"
        rows="8"
        placeholder="内容(支持 {{char}}/{{user}} 宏)"
        class="w-full resize-y rounded-input border border-line bg-card px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ink outline-none focus:border-primary"
      />
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-input bg-primary px-3 py-1.5 text-xs font-bold text-on-primary"
          @click="saveDraft"
        >
          保存
        </button>
        <button
          type="button"
          class="rounded-input border border-line px-3 py-1.5 text-xs text-ink-2"
          @click="editing = null; creating = false"
        >
          取消
        </button>
      </div>
    </div>
  </div>
</template>
