import { describe, expect, it, vi } from 'vitest'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

import {
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  openContentBindInputSchema,
  openContentConnectionResultSchema,
  openContentConnectionTargetInputSchema,
  openContentUnbindOutputSchema
} from '../contract.js'
import { createOpenContentConnectionRendererClient } from './client.js'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'test-opencontent-provider'

describe('OpenContent connection renderer client', () => {
  it('targets the selected Provider Instance for status, bind, and unbind', async () => {
    const invoke = vi.fn(async (contract: Readonly<{ actionId: string }>) =>
      contract.actionId === OPENCONTENT_CONNECTION_CAPABILITY_IDS.unbind
        ? {
            outcome: 'success' as const,
            state: 'disconnected' as const,
            remoteRevocation: 'unsupported' as const
          }
        : {
            outcome: 'success' as const,
            status: { state: 'disconnected' as const }
          })
    const client = createOpenContentConnectionRendererClient({
      invoke,
      observe: vi.fn()
    } as unknown as DomainRendererCapabilityInvoker)

    const controller = new AbortController()
    await client.status(OPENCONTENT_PROVIDER_INSTANCE_REF, {
      signal: controller.signal
    })
    await client.bind(OPENCONTENT_PROVIDER_INSTANCE_REF)
    await client.unbind(OPENCONTENT_PROVIDER_INSTANCE_REF)

    expect(invoke).toHaveBeenNthCalledWith(1, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.status,
      effect: 'read',
      inputSchema: openContentConnectionTargetInputSchema,
      outputSchema: openContentConnectionResultSchema
    }, { providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF }, {
      signal: controller.signal
    })
    expect(invoke).toHaveBeenNthCalledWith(2, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      effect: 'external-write',
      inputSchema: openContentBindInputSchema,
      outputSchema: openContentConnectionResultSchema
    }, { providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF })
    expect(invoke).toHaveBeenNthCalledWith(3, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.unbind,
      effect: 'external-write',
      inputSchema: openContentConnectionTargetInputSchema,
      outputSchema: openContentUnbindOutputSchema
    }, { providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF })
  })

  it('returns typed business failures without converting them to thrown errors', async () => {
    const failure = Object.freeze({
      outcome: 'error' as const,
      error: Object.freeze({
        code: 'invalid_credentials' as const,
        action: 'check_credentials' as const
      })
    })
    const client = createOpenContentConnectionRendererClient({
      invoke: vi.fn(async () => failure),
      observe: vi.fn()
    } as unknown as DomainRendererCapabilityInvoker)

    await expect(client.bind(OPENCONTENT_PROVIDER_INSTANCE_REF)).resolves.toBe(failure)
  })

  it('rejects secret-shaped public bind inputs at the Renderer boundary', () => {
    expect(openContentBindInputSchema.safeParse({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'must-not-cross',
      password: 'must-not-cross'
    }).success).toBe(false)
  })
})
