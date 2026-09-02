import { describe, expect, it, vi } from 'vitest'
import { IDENTITY_CAPABILITY_IDS } from '../contract.js'
import { createIdentityRendererClient } from './client.js'

describe('local identity renderer client', () => {
  it('exposes only local account operations', async () => {
    const invoke = vi.fn(async (_contract: unknown, input: unknown) => input as never)
    const client = createIdentityRendererClient({ invoke } as never)
    await client.inspect()
    await client.listAccounts()
    await client.createAccount('Ada')
    await client.selectAccount('00000000-0000-4000-8000-000000000000')
    await client.renameAccount('00000000-0000-4000-8000-000000000000', 'Grace')
    await client.exitAccount()
    await client.dismissFirstPrompt()
    await client.backupAndReset('RESET LOCAL IDENTITY')
    expect(invoke.mock.calls.map(([contract]) => (contract as { actionId: string }).actionId)).toEqual(
      Object.values(IDENTITY_CAPABILITY_IDS)
    )
  })
})
