<script setup lang="ts">
// 角色 tab(M3-f):角色卡工坊第一块真实拼图 —— 导卡。PNG(chara/ccv3 tEXt
// 文本块)或 JSON 文件 → 解析归一 → character store 落库;列表 = 库投影。
// 进卡开剧情(chat:card:<id> 会话)随卡玩法批次接入。
import { inject, onMounted, ref } from 'vue'
import MintCat from '@/kernel/design/assets/MintCat.vue'
import { CHARACTER_STORE_KEY } from '@/kernel/app/chat-keys'
import { CharacterCardError, parseCharacterCardFile } from '@/kernel/characters/character-card'
import type { CharacterCardSummary } from '@/kernel/characters/character-store'
import { uiService } from '@/kernel/ui/toasts'

const store = inject(CHARACTER_STORE_KEY, null)

const cards = ref<CharacterCardSummary[]>([])
const loading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const refresh = async (): Promise<void> => {
  if (!store) return
  cards.value = await store.list()
  loading.value = false
}

onMounted(() => {
  if (!store) return
  loading.value = true
  void refresh()
})

const pickFile = (): void => {
  fileInput.value?.click()
}

const importFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !store) return
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const parsed = parseCharacterCardFile(bytes)
    const stored = await store.import(parsed)
    uiService.toast('shell', `已导入「${stored.name}」`, { tone: 'success' })
    await refresh()
  } catch (error) {
    uiService.toast('shell', error instanceof CharacterCardError ? error.message : '导入失败:文件无法解析', { tone: 'error' })
  }
}

const removeCard = async (card: CharacterCardSummary): Promise<void> => {
  if (!store) return
  const confirmed = await uiService.confirm('shell', {
    title: '删除角色卡',
    message: `确定删除「${card.name}」吗?`,
    confirmLabel: '删除',
  })
  if (!confirmed) return
  await store.remove(card.id)
  await refresh()
}

const snippetOf = (card: CharacterCardSummary): string =>
  (card.description || card.spec).slice(0, 80)
</script>

<template>
  <section class="flex h-full flex-col">
    <header class="flex shrink-0 items-center justify-between border-b border-line bg-card px-4">
      <h1 class="py-3 text-lg">
        角色
      </h1>
      <button
        type="button"
        class="flex h-11 items-center gap-1 rounded-input px-3 text-sm text-primary"
        aria-label="导入角色卡"
        @click="pickFile"
      >
        导入角色卡
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".png,.json,image/png,application/json"
        class="hidden"
        @change="importFile"
      >
    </header>

    <div
      v-if="!loading && cards.length === 0"
      class="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-16 text-center"
    >
      <MintCat class="h-24 w-24 text-ink" />
      <p class="text-sm text-ink-2">
        导入第一张角色卡
      </p>
      <p class="text-xs text-ink-3">
        支持 PNG 角色卡(V2/V3)或 JSON 文件
      </p>
    </div>

    <div
      v-else
      class="min-h-0 flex-1 overflow-y-auto"
    >
      <ul class="mx-auto max-w-xl">
        <li
          v-for="card in cards"
          :key="card.id"
          class="flex items-start gap-3 border-b border-line px-4 py-3"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm text-ink">{{ card.name }}</span>
            <span class="mt-0.5 block truncate text-xs text-ink-3">{{ snippetOf(card) }}</span>
          </span>
          <span class="flex-shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
            {{ card.spec === 'v1' ? 'V1' : card.spec === 'chara_card_v3' ? 'V3' : 'V2' }}
          </span>
          <button
            type="button"
            class="flex-shrink-0 text-xs text-ink-3 active:text-danger"
            @click="removeCard(card)"
          >
            删除
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
