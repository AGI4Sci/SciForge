import { describe, expect, it, vi } from 'vitest'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

import {
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  openContentBindInputSchema,
  openContentConnectionResultSchema,
  openContentConnectionTargetInputSchema,
  openContentUnbindOutputSchema,
  type OpenContentConnectionResult
} from '../contract.js'
import { createOpenContentConnectionRendererClient } from './client.js'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'test-opencontent-provider'

describe('OpenContent connection renderer client', () => {
  it('clears one-use bind credentials and invocation input as soon as invocation is accepted', async () => {
    const pendingResult = deferred<OpenContentConnectionResult>()
    let invocationInput: Record<string, string> | undefined
    let invocationSnapshot: Record<string, string> | undefined
    const invoke = vi.fn((_contract: unknown, input: unknown, _options?: unknown) => {
      invocationInput = input as Record<string, string>
      invocationSnapshot = { ...invocationInput }
      return pendingResult.promise
    })
    const client = createOpenContentConnectionRendererClient({
      invoke,
      observe: vi.fn()
    } as unknown as DomainRendererCapabilityInvoker)
    const credentials = {
      account: 'scientist@example.org',
      password: 'one-use-secret'
    }
    const controller = new AbortController()

    const binding = client.bind(OPENCONTENT_PROVIDER_INSTANCE_REF, credentials, {
      signal: controller.signal
    })

    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke.mock.calls[0]?.[0]).toEqual({
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      effect: 'external-write',
      inputSchema: openContentBindInputSchema,
      outputSchema: openContentConnectionResultSchema
    })
    expect(invocationSnapshot).toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      account: 'scientist@example.org',
      password: 'one-use-secret'
    })
    expect(invoke.mock.calls[0]?.[2]).toEqual({
      signal: controller.signal
    })
    expect(credentials).toEqual({ account: '', password: '' })
    expect(invocationInput).toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      account: '',
      password: ''
    })

    pendingResult.resolve({
      outcome: 'success',
      status: { state: 'disconnected' }
    })
    await binding

    expect(credentials).toEqual({ account: '', password: '' })
  })

  it('targets the selected Provider Instance for status and unbind', async () => {
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
    const credentials = {
      account: 'scientist@example.org',
      password: 'one-use-secret'
    }

    await expect(client.bind(OPENCONTENT_PROVIDER_INSTANCE_REF, credentials))
      .resolves.toBe(failure)
    expect(credentials).toEqual({ account: '', password: '' })
  })

  it('keeps the public bind schema strict', () => {
    expect(openContentBindInputSchema.safeParse({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      account: 'scientist@example.org',
      password: 'one-use-secret'
    }).success).toBe(true)
    expect(openContentBindInputSchema.safeParse({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'must-not-cross',
      password: 'must-not-cross'
    }).success).toBe(false)
  })

  it('clears one-use bind objects when capability invocation throws', async () => {
    let invocationInput: Record<string, string> | undefined
    const client = createOpenContentConnectionRendererClient({
      invoke: vi.fn(async (_contract: unknown, input: unknown) => {
        invocationInput = input as Record<string, string>
        throw new Error('transport unavailable')
      }),
      observe: vi.fn()
    } as unknown as DomainRendererCapabilityInvoker)
    const credentials = {
      account: 'scientist@example.org',
      password: 'one-use-secret'
    }

    await expect(client.bind(OPENCONTENT_PROVIDER_INSTANCE_REF, credentials))
      .rejects.toThrow('transport unavailable')

    expect(credentials).toEqual({ account: '', password: '' })
    expect(invocationInput).toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      account: '',
      password: ''
    })
  })
})

function deferred<Value>(): Readonly<{
  promise: Promise<Value>
  resolve: (value: Value) => void
}> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
