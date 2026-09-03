import { describe, expect, it, vi } from 'vitest'
import {
  IDENTITY_CAPABILITY_IDS,
  identityAvailableStateSchema,
  type IdentityAvailableState
} from '../contract.js'
import {
  createDomainMainEntry,
  createIdentityCapabilityFactory
} from './index.js'

const state: IdentityAvailableState = identityAvailableStateSchema.parse({
  status: 'available',
  identityVersion: 0,
  currentAccount: null,
  accountCount: 0,
  firstPromptDismissed: false
})

function serviceFixture(): Record<string, unknown> {
  return {
    inspect: vi.fn(() => state),
    listAccounts: vi.fn(() => ({ state, accounts: [] })),
    createAccount: vi.fn(() => state),
    selectAccount: vi.fn(() => state),
    renameAccount: vi.fn(() => state),
    exitAccount: vi.fn(() => state),
    dismissFirstPrompt: vi.fn(() => state),
    backupAndReset: vi.fn(() => ({ state, backupPath: '/tmp/identity.sqlite.backup' }))
  }
}

describe('local identity main entry', () => {
  it('publishes only local capabilities', () => {
    const service = serviceFixture()
    const definitions = createIdentityCapabilityFactory({
      defineCapability: (input) => input,
      getService: () => service as never
    }).createDefinitions() as unknown as Array<{ id: string }>
    expect(definitions.map((definition) => definition.id)).toEqual(
      Object.values(IDENTITY_CAPABILITY_IDS)
    )
    expect(definitions.every(({ id }) => id.startsWith('identity.local.'))).toBe(true)
  })

  it('creates a main entry without internal service or lifecycle contributions', () => {
    const host = {
      getUserDataDir: () => '/tmp/sciforge-identity-test',
      getDeviceId: () => 'device-installation-1',
      defineCapability: vi.fn((input: unknown) => input)
    }
    const entry = createDomainMainEntry(host as never)
    expect(entry.contributions).toHaveLength(2)
    expect(entry.contributions.map((contribution) => contribution.kind)).toEqual([
      'main.capability-factory',
      'main.principal-provider'
    ])
  })
})
