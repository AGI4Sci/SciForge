import { describe, expect, it } from 'vitest'

import {
  createNativeIdentityPrivateVault,
  IdentityPrivateVaultError
} from './private-vault.js'
import type { NativeIdentityPrivateVaultBinding } from './private-vault/native-binding.js'

const INSTALLATION_ID = 'ins_000000000000000000000000'
const AGENT_ID = 'agt_000000000000000000000000'

describe('Identity private vault', () => {
  it('derives isolated fixed-size native keys and never exposes a generic string slot', async () => {
    const values = new Map<string, string>()
    const seen: string[] = []
    const binding = memoryBinding(values, seen)
    const vault = createNativeIdentityPrivateVault({ installationId: INSTALLATION_ID, binding })

    await vault.write({ kind: 'oidc-session' }, 'session-secret-material')
    await vault.write({ kind: 'device-key' }, 'device-private-key-material')
    await vault.write({ kind: 'agent-credential', agentId: AGENT_ID }, 'agent-machine-credential')

    expect(new Set(seen).size).toBe(3)
    expect(seen).toSatisfy((keys: string[]) => keys.every((key) => /^[a-f0-9]{64}$/u.test(key)))
    expect([...values.values()]).toEqual([
      'session-secret-material',
      'device-private-key-material',
      'agent-machine-credential'
    ])
    expect(await vault.has({ kind: 'agent-credential', agentId: AGENT_ID })).toBe(true)
    expect(await vault.read({ kind: 'agent-credential', agentId: AGENT_ID }))
      .toBe('agent-machine-credential')
    await vault.remove({ kind: 'agent-credential', agentId: AGENT_ID })
    expect(await vault.has({ kind: 'agent-credential', agentId: AGENT_ID })).toBe(false)
  })

  it('fails closed on invalid refs and unbounded values', async () => {
    const vault = createNativeIdentityPrivateVault({
      installationId: INSTALLATION_ID,
      binding: memoryBinding(new Map(), [])
    })
    await expect(vault.write(
      { kind: 'agent-credential', agentId: 'wrong' },
      'agent-machine-credential'
    )).rejects.toThrow()
    await expect(vault.write({ kind: 'oidc-session' }, '')).rejects.toMatchObject({
      code: 'secure_storage_unavailable'
    })
  })

  it('does not load an unavailable native addon through a fallback', async () => {
    if (process.platform === 'darwin') return
    const vault = createNativeIdentityPrivateVault({ installationId: INSTALLATION_ID })
    await expect(vault.has({ kind: 'oidc-session' })).rejects.toBeInstanceOf(
      IdentityPrivateVaultError
    )
  })
})

function memoryBinding(
  values: Map<string, string>,
  seen: string[]
): NativeIdentityPrivateVaultBinding {
  return {
    isAvailable: () => true,
    storeSecret: (key, value) => {
      seen.push(key)
      values.set(key, value)
    },
    hasSecret: (key) => values.has(key),
    readSecret: (key) => values.get(key) ?? null,
    deleteSecret: (key) => { values.delete(key) }
  }
}

