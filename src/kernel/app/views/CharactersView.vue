<script setup lang="ts">
// 角色 tab(M3-f 导卡 + M3-i 进卡开玩 + M3-m 封面网格):PNG(chara/ccv3 tEXt
// 文本块)或 JSON 文件 → 解析归一 → character store 落库;PNG 卡文件本身就是
// 封面画,随导入存成 data URL(`character:cover:<id>`,JSON 卡无图走占位猫)。
// 列表 = 双列封面网格,点卡直接进入该卡的对话(D2,RP 式:无详情页无会话
// 列表,进卡即接续);删除连带清掉该卡会话与封面。
import { inject, onActivated, onMounted, ref } from 'vue'
import MintCat from '@/kernel/design/assets/MintCat.vue'
import { CARD_SESSION_STORE_KEY, CHARACTER_STORE_KEY } from '@/kernel/app/chat-keys'
import { openConversation } from '@/kernel/app/chat-router'
import { CharacterCardError, isPngBytes, parseCharacterCardFile } from '@/kernel/characters/character-card'
import type { CharacterCardSummary } from '@/kernel/characters/character-store'
import { uiService } from '@/kernel/ui/toasts'

const store = inject(CHARACTER_STORE_KEY, null)
const cardSessions = inject(CARD_SESSION_STORE_KEY, null)

const cards = ref<CharacterCardSummary[]>([])
const covers = ref<Record<string, string>>({})
const loading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const loadCovers = async (list: CharacterCardSummary[]): Promise<void> => {
  if (!store) return
  await Promise.all(list.map(async (card) => {
    if (covers.value[card.id] !== undefined) return
    const url = await store.getCover(card.id)
    if (url) covers.value[card.id] = url
  }))
}

const refresh = async (): Promise<void> => {
  if (!store) return
  cards.value = await store.list()
  await loadCovers(cards.value)
  loading.value = false
}

onMounted(() => {
  if (!store) return
  loading.value = true
  void refresh()
})

// KeepAlive revisit (App.vue caches tab pages): refresh like a remount did.
onActivated(() => {
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
    // A PNG card file is its own cover artwork; JSON files carry no image.
    const stored = await store.import(parsed, isPngBytes(bytes) ? bytes : undefined)
    uiService.toast('shell', `已导入「${stored.name}」`, { tone: 'success' })
    await refresh()
  } catch (error) {
    uiService.toast('shell', error instanceof CharacterCardError ? error.message : '导入失败:文件无法解析', { tone: 'error' })
  }
}

const openCard = (card: CharacterCardSummary): void => {
  openConversation(card.id, 'card')
}

const removeCard = async (card: CharacterCardSummary): Promise<void> => {
  if (!store) return
  const confirmed = await uiService.confirm('shell', {
    title: '删除角色卡',
    message: `确定删除「${card.name}」吗?它的会话记录将一并删除。`,
    confirmLabel: '删除',
  })
  if (!confirmed) return
  await store.remove(card.id)
  // Cascade: the card's session dies with it (no orphan card sessions).
  await cardSessions?.remove(card.id)
  delete covers.value[card.id]
  await refresh()
}
</script>

<template>
  <section class="relative h-full">
    <header class="mp-glass absolute inset-x-3 top-3 z-10 flex items-center justify-between rounded-panel px-4 py-2.5">
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
      class="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 pb-28 pt-20 text-center"
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
      class="absolute inset-0 overflow-y-auto pt-[98px] pb-[calc(104px+env(safe-area-inset-bottom))]"
    >
      <TransitionGroup
        tag="div"
        name="mp-mo-cell"
        class="mx-auto grid max-w-xl grid-cols-2 gap-3 px-4 py-4"
      >
        <div
          v-for="card in cards"
          :key="card.id"
          class="relative aspect-[2/3] overflow-hidden rounded-xl border border-line bg-card shadow-sm"
        >
          <button
            type="button"
            class="absolute inset-0 h-full w-full text-left"
            :aria-label="`进入「${card.name}」的对话`"
            @click="openCard(card)"
          >
            <img
              v-if="covers[card.id]"
              :src="covers[card.id]"
              :alt="card.name"
              class="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            >
            <span
              v-else
              class="absolute inset-0 flex items-center justify-center bg-bg/40"
            >
              <MintCat class="h-12 w-12 text-ink-3" />
            </span>
            <span class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2.5 pb-2 pt-8">
              <span class="block truncate text-sm text-white">{{ card.name }}</span>
            </span>
          </button>
          <button
            type="button"
            class="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-xs leading-none text-white backdrop-blur-sm active:text-danger"
            :aria-label="`删除角色卡「${card.name}」`"
            @click.stop="removeCard(card)"
          >
            ✕
          </button>
        </div>
      </TransitionGroup>
    </div>
  </section>
</template>
