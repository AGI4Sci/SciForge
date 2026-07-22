import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import type { CapabilityJsonValue, CapabilityReadiness } from '@shared/capability-broker'
import type { SciForgeApi } from '@shared/sciforge-api'
import { RendererCapabilityClient, type RendererCapabilityContract } from './capability-client'

const READY: CapabilityReadiness = {
  contractVersion: 1,
  status: 'ready' as const,
  registryFingerprint: '0'.repeat(64),
  availableCapabilityIds: ['example.read', 'example.compute'],
  missingCapabilityIds: [],
  message: 'ready'
}

function result(actionId: string, output: CapabilityJsonValue, invocationId?: string) {
  return {
    actionId,
    ...(invocationId ? { invocationId } : {}),
    output,
    changed: false,
    replayed: false,
    completedAt: '2026-07-22T00:00:00.000Z'
  }
}

function transport(output: CapabilityJsonValue) {
  const readiness = vi.fn(async (): Promise<CapabilityReadiness> => READY)
  const invoke = vi.fn(async ({ request }: Parameters<SciForgeApi['capabilities']['invoke']>[0]) =>
    result(request.actionId, output, request.invocationId)
  )
  return { readiness, invoke }
}

describe('RendererCapabilityClient', () => {
  it('validates readiness, input and output around one generic invocation', async () => {
    const bridge = transport({ value: 2 })
    const client = new RendererCapabilityClient({ getTransport: () => bridge })
    const contract: RendererCapabilityContract<{ value: number }, { value: number }> = {
      actionId: 'example.read',
      effect: 'read',
      inputSchema: z.object({ value: z.number() }).strict(),
      outputSchema: z.object({ value: z.number() }).strict()
    }

    await expect(client.invoke(contract, { value: 1 })).resolves.toEqual({ value: 2 })
    expect(bridge.readiness).toHaveBeenCalledWith({
      expectedContractVersion: 1,
      requiredCapabilityIds: ['example.read']
    })
    expect(bridge.invoke.mock.calls[0]?.[0].request).toEqual({
      actionId: 'example.read',
      input: { value: 1 }
    })
  })

  it('adds an invocation ID to every non-read action', async () => {
    const bridge = transport({ ok: true })
    const client = new RendererCapabilityClient({
      getTransport: () => bridge,
      createInvocationId: () => 'invocation-1'
    })
    const contract = {
      actionId: 'example.compute',
      effect: 'compute' as const,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict()
    }

    await client.invoke(contract, {})
    expect(bridge.invoke.mock.calls[0]?.[0].request.invocationId).toBe('invocation-1')
  })

  it('rejects values outside the JSON transport boundary before invoking', async () => {
    const bridge = transport(null)
    const client = new RendererCapabilityClient({ getTransport: () => bridge })
    const contract = {
      actionId: 'example.read',
      effect: 'read' as const,
      inputSchema: z.unknown(),
      outputSchema: z.null()
    }

    await expect(client.invoke(contract, Number.NaN)).rejects.toThrow()
    expect(bridge.readiness).not.toHaveBeenCalled()
    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it('fails closed when the required action is not ready', async () => {
    const bridge = transport(null)
    bridge.readiness.mockResolvedValue({
      ...READY,
      status: 'incomplete',
      availableCapabilityIds: [],
      missingCapabilityIds: ['example.read'],
      message: 'missing example.read'
    })
    const client = new RendererCapabilityClient({ getTransport: () => bridge })

    await expect(client.invoke({
      actionId: 'example.read',
      effect: 'read',
      inputSchema: z.object({}).strict(),
      outputSchema: z.null()
    }, {})).rejects.toThrow('missing example.read')
    expect(bridge.invoke).not.toHaveBeenCalled()
  })
})
