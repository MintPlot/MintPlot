import { onMounted, onScopeDispose, ref, watch } from 'vue'
import type { CharacterCard } from '@/kernel/characters/character-card'
import type { CharacterStore } from '@/kernel/characters/character-store'
import type { CardSession, CardSessionStore } from '@/kernel/sessions/card-session-store'
import type { ChatboxConversation, ChatboxStore } from '@/kernel/sessions/chatbox-store'
import type { VariableSnapshot, VariableStore } from '@/kernel/variables/variable-store'
import type { MemoryState } from '@/kernel/memory/memory-engine'
import type { MemoryStore } from '@/kernel/memory/memory-store'
import type { PresetSnapshot, PresetStore } from '@/kernel/presets/preset-store'
import type { WorldbookStore } from '@/kernel/worldinfo/worldbook-store'
import type { RegexStore } from '@/kernel/regex/regex-store'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import { buildCardVariableDefaults } from './card-variable-defaults'
import { waitForSessionWriteHandoff } from './session-write-handoff'

type Feature = 'variables' | 'worldinfo' | 'regex' | 'memory' | 'presets' | 'cot'
export interface SessionEntrySnapshot {
  conversation: ChatboxConversation | null
  card: CharacterCard | null
  session: CardSession | null
  cover: string
  gates: Record<Feature, boolean>
  worldbookDisabled: ReadonlySet<number>
  regexDisabled: ReadonlySet<number>
  variables: VariableSnapshot | null
  memory: MemoryState | null
  presets: PresetSnapshot | null
}

interface EntryOptions {
  id: () => string
  isCard: () => boolean
  active: () => boolean
  store: ChatboxStore | null
  cardSessions: CardSessionStore | null
  characters: CharacterStore | null
  variables: VariableStore | null
  worldbook: WorldbookStore | null
  regex: RegexStore | null
  memory: MemoryStore | null
  presets: PresetStore | null
  featureActive: (feature: Feature) => boolean
  publish: (snapshot: SessionEntrySnapshot) => void
  failed: (message: string) => void
  presented: () => void | Promise<void>
  ready: () => void
}

/** No page state is published while independent local reads are still pending.
 * Cancellation invalidates results; it does not roll back store operations that
 * have already started, nor interfere with a streaming turn's final save. */
export function useSessionEntry(options: EntryOptions) {
  const ready = ref(false)
  const lifetime = new AbortController()
  let coverImage: HTMLImageElement | null = null
  onScopeDispose(() => {
    lifetime.abort()
    coverImage?.removeAttribute('src')
    coverImage = null
  })
  const current = () => !lifetime.signal.aborted
  watch(options.active, (active) => { if (!active) lifetime.abort() }, { flush: 'sync' })
  const prepareCover = (source: string): Promise<boolean> => new Promise((resolve) => {
    const image = new Image()
    coverImage = image
    let settled = false
    const finish = (loaded: boolean) => {
      if (settled) return
      settled = true
      image.onload = null
      image.onerror = null
      lifetime.signal.removeEventListener('abort', cancelled)
      resolve(loaded && current())
    }
    const cancelled = () => finish(false)
    lifetime.signal.addEventListener('abort', cancelled, { once: true })
    image.onload = () => { if (!image.decode) finish(true) }
    image.onerror = () => finish(false)
    image.src = source
    if (image.decode) void image.decode().then(() => finish(true), () => finish(false))
  })

  onMounted(async () => {
    if (!options.active()) return
    try {
      const gates = Object.fromEntries(
        (['variables', 'worldinfo', 'regex', 'memory', 'presets', 'cot'] as const)
          .map((feature) => [feature, options.isCard() ? options.featureActive(feature) : true]),
      ) as Record<Feature, boolean>
      const snapshot: SessionEntrySnapshot = {
        conversation: null, card: null, session: null, cover: '', gates,
        worldbookDisabled: new Set(), regexDisabled: new Set(), variables: null, memory: null, presets: null,
      }
      const id = options.id()
      const sessionStore = options.isCard() ? options.cardSessions : options.store
      if (sessionStore) await waitForSessionWriteHandoff(sessionStore, id)
      if (!current()) return
      if (options.isCard()) {
        if (!options.characters || !options.cardSessions) throw new Error('missing_store')
        const card = await options.characters.get(id)
        if (!current()) return
        if (!card) throw new Error('missing_card')
        const readSession = async () => {
          const stored = await options.cardSessions!.get(id)
          if (!current()) return null
          return stored ?? options.cardSessions!.create(card)
        }
        const [cover, session, worldbook, regex, memory, presets, variables] = await Promise.all([
          options.characters.getCover(id),
          readSession(),
          gates.worldinfo ? options.worldbook?.getDisabled(id) : undefined,
          gates.regex ? options.regex?.getDisabled(id) : undefined,
          gates.memory ? options.memory?.ensure({ kind: 'card', id }) : undefined,
          gates.presets ? options.presets?.ensure() : undefined,
          gates.variables ? options.variables?.ensure(id, buildCardVariableDefaults(card)) : undefined,
        ])
        if (!current() || !session) return
        snapshot.card = card
        snapshot.session = session
        snapshot.worldbookDisabled = worldbook ?? new Set()
        snapshot.regexDisabled = regex ?? new Set()
        snapshot.memory = memory ?? null
        snapshot.presets = presets ?? null
        snapshot.variables = variables ?? null
        // Check the authoritative session override before showing any artwork.
        // One retained image per mounted page keeps the decoded cover available
        // to its first render; there is no cross-session image cache.
        if (cover && session.bg?.enabled !== false) {
          if (await prepareCover(cover)) snapshot.cover = cover
          else if (current()) uiCoverWarning()
        } else snapshot.cover = cover ?? ''
        if (!current()) return
      } else {
        if (!options.store) throw new Error('missing_store')
        snapshot.conversation = await options.store.get(id)
        if (!current()) return
        if (!snapshot.conversation) throw new Error('missing_conversation')
      }
      options.publish(snapshot)
      ready.value = true
      options.ready()
      await options.presented()
    } catch {
      if (!current()) return
      options.failed('会话加载失败，请返回后重试')
      errorHub.record({ category: 'chat', action: 'entry_failed', code: 'MP-CHAT-004', message: 'Session entry preparation failed' })
      ready.value = true
      options.ready()
    }
  })
  return { entryReady: ready }
}

function uiCoverWarning(): void {
  errorHub.record({ category: 'chat', action: 'cover_decode_failed', message: 'Session cover could not be decoded' })
}
