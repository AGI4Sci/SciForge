import { describe, expect, it, vi } from 'vitest'
import type { IdentityAvailableState } from '../contract.js'
import type { IdentityRendererClient } from './client.js'
import { IdentityRendererProjection } from './projection.js'

const signedOut = {
  status: 'available' as const,
  identityVersion: 0,
  currentAccount: null,
  accountCount: 0,
  firstPromptDismissed: false
}

describe('IdentityRendererProjection', () => {
  it('keeps a non-authoritative capability-backed projection without local persistence', async () => {
    const client: IdentityRendererClient = {
      inspect: vi.fn(async () => signedOut),
      listAccounts: vi.fn(async () => ({ state: signedOut, accounts: [] })),
      createAccount: vi.fn(),
      selectAccount: vi.fn(),
      renameAccount: vi.fn(),
      exitAccount: vi.fn(),
      dismissFirstPrompt: vi.fn(),
      backupAndReset: vi.fn()
    }
    const projection = new IdentityRendererProjection(client)
    const listener = vi.fn()
    const dispose = projection.subscribe(listener)
    await projection.load()
    expect(projection.getSnapshot()).toEqual({
      loading: false,
      state: signedOut,
      accounts: [],
      error: null
    })
    expect(client.listAccounts).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalled()
    dispose()
    projection.dispose()
  })

  it('refreshes restored/switch/exit state from main and surfaces rename conflicts', async () => {
    const alice = {
      userId: 'c07f29ee-801d-4cf3-90ef-96c56c65de21',
      username: 'Alice',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z'
    }
    let state: IdentityAvailableState = {
      ...signedOut,
      identityVersion: 1,
      accountCount: 1,
      currentAccount: alice
    }
    const client: IdentityRendererClient = {
      inspect: vi.fn(async () => state),
      listAccounts: vi.fn(async () => ({ state, accounts: [alice] })),
      createAccount: vi.fn(),
      selectAccount: vi.fn(async () => state),
      renameAccount: vi.fn(async () => { throw new Error('username conflict') }),
      exitAccount: vi.fn(async () => {
        state = { ...state, identityVersion: 2, currentAccount: null }
        return state
      }),
      dismissFirstPrompt: vi.fn(async () => state),
      backupAndReset: vi.fn()
    }
    const projection = new IdentityRendererProjection(client)
    await projection.load()
    expect(projection.getSnapshot().state).toMatchObject({ currentAccount: { username: 'Alice' } })
    await expect(projection.renameAccount(alice.userId, 'ALICE')).rejects.toThrow('username conflict')
    expect(projection.getSnapshot().error).toContain('username conflict')
    await projection.exitAccount()
    expect(projection.getSnapshot().state).toMatchObject({ currentAccount: null, identityVersion: 2 })
  })

  it('recovers unavailable state only through backup-and-reset and retains the backup path', async () => {
    const unavailable = {
      status: 'unavailable' as const,
      reason: 'integrity-failed' as const,
      recoveryAvailable: true
    }
    const recovered = { ...signedOut, identityVersion: 1, firstPromptDismissed: false }
    const client: IdentityRendererClient = {
      inspect: vi.fn(async () => unavailable),
      listAccounts: vi.fn(async () => ({ state: unavailable, accounts: [] })),
      createAccount: vi.fn(),
      selectAccount: vi.fn(),
      renameAccount: vi.fn(),
      exitAccount: vi.fn(),
      dismissFirstPrompt: vi.fn(),
      backupAndReset: vi.fn(async () => ({ state: recovered, backupPath: '/backup/identity.sqlite' }))
    }
    const projection = new IdentityRendererProjection(client)
    await projection.load()
    await expect(projection.backupAndReset('RESET LOCAL IDENTITY'))
      .resolves.toBe('/backup/identity.sqlite')
    expect(projection.getSnapshot()).toMatchObject({ state: recovered, accounts: [], error: null })
  })
})
