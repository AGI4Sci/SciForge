import { describe, expect, it, vi } from 'vitest'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

import { OPENCONTENT_CONNECTION_CAPABILITY_IDS } from '../contract.js'
import { createOpenContentConnectionRendererClient } from './client.js'

describe('OpenContent connection renderer client', () => {
  it('uses only the generic capability invoker for enrollment', async () => {
    const invoke = vi.fn(async () => ({ state: 'disconnected' }))
    const client = createOpenContentConnectionRendererClient({
      invoke,
      observe: vi.fn()
    } as unknown as DomainRendererCapabilityInvoker)

    await client.bind('scientist', 'fixture-password')

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      effect: 'external-write'
    }), {
      username: 'scientist',
      password: 'fixture-password'
    })
  })
})
