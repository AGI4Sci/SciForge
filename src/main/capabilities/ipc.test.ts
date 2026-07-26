import { EventEmitter } from 'node:events'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { CapabilityBroker } from './broker'
import { CAPABILITY_BROKER_CONTRACT_VERSION } from '../../shared/capability-broker'
import { CAPABILITY_IPC_CHANNELS, registerCapabilityIpc } from './ipc'
import { CapabilityRegistry, defineCapability } from './registry'

describe('capability IPC adapter', () => {
  it('keeps transport generic and routes discovery/invocation/events through one broker', async () => {
    const handler = vi.fn(async (input: { value: string }, context) => ({
      output: { value: input.value },
      changed: true,
      semanticRevision: `${Number(context.resource?.semanticRevision ?? '0') + 1}`
    }))
    const registry = new CapabilityRegistry([defineCapability({
      id: 'test-resource.update',
      version: '1',
      title: 'Update test resource',
      description: 'Updates a test resource through the capability IPC adapter.',
      audiences: ['ui'],
      scope: 'resource',
      resourceKinds: ['test-resource'],
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      inputSchema: z.object({ value: z.string() }).strict(),
      outputSchema: z.object({ value: z.string() }).strict(),
      handler
    })])
    const broker = new CapabilityBroker(registry)
    const ipcHandlers = new Map<string, (event: never, payload: unknown) => unknown>()
    const ipc = {
      removeHandler: vi.fn((channel: string) => ipcHandlers.delete(channel)),
      handle: vi.fn((channel: string, callback: (event: never, payload: unknown) => unknown) => {
        ipcHandlers.set(channel, callback)
      })
    }
    const registration = registerCapabilityIpc({ broker, ipc: ipc as never })

    const senderEvents = new EventEmitter()
    const sender = {
      id: 7,
      send: vi.fn(),
      isDestroyed: () => false,
      once: senderEvents.once.bind(senderEvents)
    }
    const event = { sender } as never
    const caller = { audience: 'ui' as const, callerId: 'window:7', workspaceId: '/workspace' }
    const resource = broker.issueResourceHandle(caller, {
      resourceId: 'resource-1',
      resourceKind: 'test-resource',
      workspaceId: '/workspace',
      semanticRevision: '1',
      observe: async () => ({
        state: { value: 'before' },
        semanticRevision: '1',
        operationIds: ['test-resource.update']
      })
    })

    const discovered = await ipcHandlers.get(CAPABILITY_IPC_CHANNELS.discover)?.(event, {
      workspaceId: '/workspace'
    }) as Array<{ id: string }>
    expect(discovered.map((descriptor) => descriptor.id)).toEqual(['test-resource.update'])

    const ready = await ipcHandlers.get(CAPABILITY_IPC_CHANNELS.readiness)?.(event, {
      workspaceId: '/workspace',
      expectedContractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
      requiredCapabilityIds: ['test-resource.update']
    }) as {
      status: string
      registryFingerprint: string
      availableCapabilityIds: string[]
      missingCapabilityIds: string[]
    }
    expect(ready).toMatchObject({
      status: 'ready',
      availableCapabilityIds: ['test-resource.update'],
      missingCapabilityIds: []
    })
    expect(ready.registryFingerprint).toMatch(/^[a-f0-9]{64}$/)

    const observed = await ipcHandlers.get(CAPABILITY_IPC_CHANNELS.observe)?.(event, {
      workspaceId: '/workspace',
      request: { resource }
    }) as { resourceRef: string }
    const rebound = await ipcHandlers.get(CAPABILITY_IPC_CHANNELS.bind)?.(event, {
      workspaceId: '/workspace',
      request: { resourceRef: observed.resourceRef }
    }) as { semanticRevision: string }
    expect(rebound.semanticRevision).toBe('1')

    await expect(registration.invoke(CAPABILITY_IPC_CHANNELS.readiness, {
      expectedContractVersion: CAPABILITY_BROKER_CONTRACT_VERSION + 1,
      requiredCapabilityIds: ['test-resource.missing']
    }, sender)).resolves.toMatchObject({
      status: 'incompatible',
      missingCapabilityIds: ['test-resource.missing']
    })

    await expect(registration.invoke(CAPABILITY_IPC_CHANNELS.readiness, {
      expectedContractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
      requiredCapabilityIds: ['test-resource.missing']
    }, sender)).resolves.toMatchObject({
      status: 'incomplete',
      missingCapabilityIds: ['test-resource.missing']
    })

    const subscription = await ipcHandlers.get(CAPABILITY_IPC_CHANNELS.subscribe)?.(event, {
      workspaceId: '/workspace'
    }) as { subscriptionId: string }
    const result = await ipcHandlers.get(CAPABILITY_IPC_CHANNELS.invoke)?.(event, {
      workspaceId: '/workspace',
      request: {
        actionId: 'test-resource.update',
        invocationId: 'ipc-update-1',
        resource,
        expectedRevision: '1',
        input: { value: 'after' }
      }
    }) as { changed: boolean }

    expect(result.changed).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(sender.send).toHaveBeenCalledWith(CAPABILITY_IPC_CHANNELS.event, expect.objectContaining({
      subscriptionId: subscription.subscriptionId,
      event: expect.objectContaining({ actionId: 'test-resource.update' })
    }))

    expect(registration.handles(CAPABILITY_IPC_CHANNELS.discover)).toBe(true)
    expect(registration.handles(CAPABILITY_IPC_CHANNELS.bind)).toBe(true)
    expect(registration.handles('workspacePreview:open')).toBe(false)
    await expect(registration.invoke(CAPABILITY_IPC_CHANNELS.discover, {
      workspaceId: '/workspace'
    }, sender)).resolves.toEqual(discovered)
    await expect(registration.invoke('workspacePreview:open', {}, sender))
      .rejects.toThrow('Unknown capability bridge channel')
  })
})
