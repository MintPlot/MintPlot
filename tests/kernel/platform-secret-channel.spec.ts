import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPlatformSecretChannel } from '@/kernel/secrets/platform-secret-channel'

interface MpVaultBridgeStub {
  secretSet(options: { key: string; value: string }): Promise<void>
  secretGet(options: { key: string }): Promise<{ value?: string | null } | undefined>
  secretRemove(options: { key: string }): Promise<void>
}

const bridgeStub = (): { calls: Array<{ method: string; options: unknown }>; bridge: MpVaultBridgeStub } => {
  const calls: Array<{ method: string; options: unknown }> = []
  const bridge: MpVaultBridgeStub = {
    async secretSet(options) {
      calls.push({ method: 'secretSet', options })
    },
    async secretGet(options) {
      calls.push({ method: 'secretGet', options })
      return { value: 'restored' }
    },
    async secretRemove(options) {
      calls.push({ method: 'secretRemove', options })
    },
  }
  return { calls, bridge }
}

describe('M4-b2 · 平台秘密通道(ADR-005)', () => {
  beforeEach(() => {
    delete (globalThis as { Capacitor?: unknown }).Capacitor
  })

  afterEach(() => {
    delete (globalThis as { Capacitor?: unknown }).Capacitor
  })

  it('无壳桥件 → 会话级内存回退,读写删回环成立', async () => {
    const channel = createPlatformSecretChannel()
    await channel.setSecret('config:mp_settings', '{"paths":1}')
    await expect(channel.getSecret('config:mp_settings')).resolves.toBe('{"paths":1}')
    await channel.removeSecret('config:mp_settings')
    await expect(channel.getSecret('config:mp_settings')).resolves.toBeNull()
  })

  it('有壳桥件 → 委托原生,白名单仍在内核侧强制', async () => {
    const { calls, bridge } = bridgeStub()
    ;(globalThis as { Capacitor?: unknown }).Capacitor = { Plugins: { MpVault: bridge } }
    const channel = createPlatformSecretChannel()

    await channel.setSecret('config:mp_settings', '{"paths":1}')
    await expect(channel.getSecret('config:mp_settings')).resolves.toBe('restored')
    await channel.removeSecret('config:mp_settings')

    expect(calls.map((entry) => entry.method)).toEqual(['secretSet', 'secretGet', 'secretRemove'])
    expect(calls[0]?.options).toEqual({ key: 'config:mp_settings', value: '{"paths":1}' })
    // Whitelist enforcement stays kernel-side even with the bridge present.
    await expect(channel.setSecret('chat:chatbox:x', '{}')).rejects.toThrow(/secret access denied/)
  })

  it('桥件形状不完整(缺方法)按无壳处理,回内存', async () => {
    ;(globalThis as { Capacitor?: unknown }).Capacitor = {
      Plugins: { MpVault: { secretGet: async () => ({ value: null }) } },
    }
    const channel = createPlatformSecretChannel()
    await channel.setSecret('config:mp_settings', 'v')
    await expect(channel.getSecret('config:mp_settings')).resolves.toBe('v')
  })

  it('桥件中途可用(惰性探测):写入落在当下后端', async () => {
    const { bridge } = bridgeStub()
    const channel = createPlatformSecretChannel()
    await channel.setSecret('config:mp_settings', 'session-only')

    ;(globalThis as { Capacitor?: unknown }).Capacitor = { Plugins: { MpVault: bridge } }
    await channel.setSecret('config:mp_settings', 'persisted')
    await expect(channel.getSecret('config:mp_settings')).resolves.toBe('restored')
  })
})
