import { describe, expect, it, vi } from 'vitest'
import { identityAvailableStateSchema } from '../contract.js'
import { IdentityRendererProjection, type IdentityProjectionSnapshot } from './projection.js'
import type { IdentityRendererClient } from './client.js'

const available = identityAvailableStateSchema.parse({
  status: 'available',
  identityVersion: 0,
  currentAccount: null,
  accountCount: 0,
  firstPromptDismissed: false
})

function clientFixture(): IdentityRendererClient {
  return {
    inspect: vi.fn(async () => available),
    listAccounts: vi.fn(async () => ({ state: available, accounts: [] })),
    createAccount: vi.fn(async () => available),
    selectAccount: vi.fn(async () => available),
    renameAccount: vi.fn(async () => available),
    exitAccount: vi.fn(async () => available),
    dismissFirstPrompt: vi.fn(async () => available),
    backupAndReset: vi.fn(async () => ({ state: available, backupPath: '/tmp/backup' }))
  }
}

describe('local identity renderer projection', () => {
  it('loads and publishes the local account state', async () => {
    const projection = new IdentityRendererProjection(clientFixture())
    const snapshots: IdentityProjectionSnapshot[] = []
    projection.subscribe(() => snapshots.push(projection.getSnapshot()))
    await projection.load()
    expect(projection.getSnapshot()).toMatchObject({
      loading: false,
      state: available,
      accounts: [],
      error: null
    })
    expect(snapshots.length).toBeGreaterThan(0)
    projection.dispose()
  })
})
