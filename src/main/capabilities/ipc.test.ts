import { EventEmitter } from 'node:events'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { CapabilityBroker, CapabilityBrokerError } from './broker'
import { CAPABILITY_BROKER_CONTRACT_VERSION } from '../../shared/capability-broker'
import { unwrapCapabilityTransportEnvelope } from '../../shared/capability-transport-error'
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
    const onCallerDestroyed = vi.fn()
    const registration = registerCapabilityIpc({
      broker,
      ipc: ipc as never,
      isTrustedIpcSender: () => true,
      onCallerDestroyed
    })

    const senderEvents = new EventEmitter()
    const sender = {
      id: 7,
      send: vi.fn(),
      isDestroyed: () => false,
      once: senderEvents.once.bind(senderEvents),
      removeListener: senderEvents.removeListener.bind(senderEvents)
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

    const observed = unwrapCapabilityTransportEnvelope<{ resourceRef: string }>(
      await ipcHandlers.get(CAPABILITY_IPC_CHANNELS.observe)?.(event, {
      transportRequestId: '123e4567-e89b-42d3-a456-426614174001',
      workspaceId: '/workspace',
      request: { resource }
      })
    )
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
    const secondSubscription = await ipcHandlers.get(CAPABILITY_IPC_CHANNELS.subscribe)?.(event, {
      workspaceId: '/workspace'
    }) as { subscriptionId: string }
    expect(secondSubscription.subscriptionId).not.toBe(subscription.subscriptionId)
    expect(senderEvents.listenerCount('destroyed')).toBe(1)
    const result = unwrapCapabilityTransportEnvelope<{ changed: boolean }>(
      await ipcHandlers.get(CAPABILITY_IPC_CHANNELS.invoke)?.(event, {
      transportRequestId: '123e4567-e89b-42d3-a456-426614174000',
      workspaceId: '/workspace',
      request: {
        actionId: 'test-resource.update',
        invocationId: 'ipc-update-1',
        resource,
        expectedRevision: '1',
        input: { value: 'after' }
      }
      })
    )

    expect(result.changed).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ invocationId: 'ipc-update-1' })
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
    senderEvents.emit('destroyed')
    expect(onCallerDestroyed).toHaveBeenCalledOnce()
    expect(onCallerDestroyed).toHaveBeenCalledWith('window:7')
  })

  it('serializes typed Broker errors without exposing causes or path-bearing details', async () => {
    const brokerError = new CapabilityBrokerError(
      'outcome_unknown',
      'The mutation outcome is unknown.',
      {
        category: 'failed',
        cause: new Error('provider stack and secret'),
        details: {
          expected: 'revision-2',
          path: '/private/provider/cache',
          localPath: '/private/provider/local',
          accessToken: 'access-token-secret',
          endpointUrl: 'https://provider.invalid/private',
          connectionId: 'connection-secret',
          brokerHandle: 'broker-handle-secret',
          authorizationHeader: 'Bearer credential-secret',
          providerUri: 'provider://private',
          sourceFile: '/private/provider/source',
          cacheDirectory: '/private/provider/directory',
          nested: {
            cause: 'provider rejected token',
            reason: 'delivery principal changed'
          }
        }
      }
    )
    Object.assign(brokerError, { retryable: true })
    const invokeBroker = vi.fn(async () => Promise.reject(brokerError))
    const observeBroker = vi.fn(async () => Promise.reject(brokerError))
    const ipcHandlers = new Map<string, (event: never, payload: unknown) => unknown>()
    registerCapabilityIpc({
      broker: { invoke: invokeBroker, observe: observeBroker } as never,
      ipc: {
        removeHandler: vi.fn((channel: string) => ipcHandlers.delete(channel)),
        handle: vi.fn((channel: string, callback: (event: never, payload: unknown) => unknown) => {
          ipcHandlers.set(channel, callback)
        })
      } as never,
      isTrustedIpcSender: () => true
    })
    const senderEvents = new EventEmitter()
    const sender = {
      id: 71,
      send: vi.fn(),
      isDestroyed: () => false,
      once: senderEvents.once.bind(senderEvents),
      removeListener: senderEvents.removeListener.bind(senderEvents)
    }

    const invokeEnvelope = await ipcHandlers.get(CAPABILITY_IPC_CHANNELS.invoke)?.(
      { sender } as never,
      {
        transportRequestId: '123e4567-e89b-42d3-a456-426614174071',
        request: {
          actionId: 'test-resource.update',
          invocationId: 'write-71',
          input: {}
        }
      }
    )
    const observeEnvelope = await ipcHandlers.get(CAPABILITY_IPC_CHANNELS.observe)?.(
      { sender } as never,
      {
        transportRequestId: '123e4567-e89b-42d3-a456-426614174072',
        request: {
          resource: {
            token: 'cap_abcdefghijklmnopqrst',
            semanticRevision: '1',
            expiresAt: '2026-08-17T00:00:00.000Z'
          }
        }
      }
    )

    const expectedError = {
      code: 'outcome_unknown',
      message: 'The mutation outcome is unknown.',
      category: 'failed',
      retryable: false,
      details: {
        expected: 'revision-2',
        nested: { reason: 'delivery principal changed' }
      }
    }
    expect(invokeEnvelope).toEqual({ contractVersion: 1, ok: false, error: expectedError })
    expect(observeEnvelope).toEqual({ contractVersion: 1, ok: false, error: expectedError })
    expect(JSON.stringify(invokeEnvelope)).not.toContain('/private/provider/cache')
    expect(JSON.stringify(invokeEnvelope)).not.toContain('provider stack and secret')
    expect(JSON.stringify(invokeEnvelope)).not.toContain('provider rejected token')
    expect(JSON.stringify(invokeEnvelope)).not.toContain('access-token-secret')
    expect(JSON.stringify(invokeEnvelope)).not.toContain('provider.invalid')
    expect(JSON.stringify(invokeEnvelope)).not.toContain('connection-secret')
    expect(JSON.stringify(invokeEnvelope)).not.toContain('broker-handle-secret')
    expect(JSON.stringify(invokeEnvelope)).not.toContain('credential-secret')
    expect(JSON.stringify(invokeEnvelope)).not.toContain('provider://private')
  })

  it('rejects every Electron capability channel before parsing an untrusted frame', () => {
    const broker = new CapabilityBroker(new CapabilityRegistry())
    const ipcHandlers = new Map<string, (event: never, payload: unknown) => unknown>()
    const ipc = {
      removeHandler: vi.fn((channel: string) => ipcHandlers.delete(channel)),
      handle: vi.fn((channel: string, callback: (event: never, payload: unknown) => unknown) => {
        ipcHandlers.set(channel, callback)
      })
    }
    const isTrustedIpcSender = vi.fn(() => false)
    registerCapabilityIpc({
      broker,
      ipc: ipc as never,
      isTrustedIpcSender
    })
    const sender = {
      id: 99,
      send: vi.fn(),
      isDestroyed: () => false,
      once: vi.fn(),
      removeListener: vi.fn()
    }

    for (const [channel, callback] of ipcHandlers) {
      expect(() => callback({ sender } as never, {}), channel)
        .toThrow('Rejected capability IPC invocation from an untrusted renderer frame.')
    }
    expect(isTrustedIpcSender).toHaveBeenCalledTimes(ipcHandlers.size)
    expect(sender.once).not.toHaveBeenCalled()
  })

  it('uses sender-bound transport IDs to cancel active, reordered, and destroyed invocations', async () => {
    const signals: AbortSignal[] = []
    const handler = vi.fn(async (_input: Record<string, never>, context) => {
      const signal = context.signal
      if (!signal) throw new Error('missing signal')
      signals.push(signal)
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      })
      return { output: { ok: true } }
    })
    const registry = new CapabilityRegistry([defineCapability({
      id: 'test-operation.wait',
      version: '1',
      title: 'Wait for cancellation',
      description: 'Waits so generic capability cancellation can be exercised.',
      audiences: ['ui'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
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
    const registration = registerCapabilityIpc({
      broker,
      ipc: ipc as never,
      isTrustedIpcSender: () => true
    })
    const senderEvents = new EventEmitter()
    const sender = {
      id: 17,
      send: vi.fn(),
      isDestroyed: () => false,
      once: senderEvents.once.bind(senderEvents),
      removeListener: senderEvents.removeListener.bind(senderEvents)
    }
    const otherSenderEvents = new EventEmitter()
    const otherSender = {
      id: 18,
      send: vi.fn(),
      isDestroyed: () => false,
      once: otherSenderEvents.once.bind(otherSenderEvents),
      removeListener: otherSenderEvents.removeListener.bind(otherSenderEvents)
    }
    const invoke = ipcHandlers.get(CAPABILITY_IPC_CHANNELS.invoke)!
    const cancel = ipcHandlers.get(CAPABILITY_IPC_CHANNELS.cancel)!
    const transportRequestId = '123e4567-e89b-42d3-a456-426614174001'
    const invocation = Promise.resolve(invoke({ sender } as never, {
      transportRequestId,
      workspaceId: '/workspace',
      request: {
        actionId: 'test-operation.wait',
        invocationId: 'wait-1',
        input: {}
      }
    })).then(unwrapCapabilityTransportEnvelope)
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))

    await expect(Promise.resolve(cancel({ sender: otherSender } as never, { transportRequestId })))
      .resolves.toBe(true)
    expect(signals[0]?.aborted).toBe(false)
    await expect(Promise.resolve(cancel({ sender } as never, { transportRequestId })))
      .resolves.toBe(true)
    expect(signals[0]?.aborted).toBe(true)
    await expect(invocation).rejects.toMatchObject({ code: 'handler_failed' })

    const reorderedId = '123e4567-e89b-42d3-a456-426614174002'
    await expect(Promise.resolve(cancel({ sender } as never, {
      transportRequestId: reorderedId
    }))).resolves.toBe(true)
    await expect(Promise.resolve(invoke({ sender } as never, {
      transportRequestId: reorderedId,
      workspaceId: '/workspace',
      request: {
        actionId: 'test-operation.wait',
        invocationId: 'wait-2',
        input: {}
      }
    })).then(unwrapCapabilityTransportEnvelope)).rejects.toThrow('cancelled before dispatch')
    expect(handler).toHaveBeenCalledTimes(1)

    const destroyedId = '123e4567-e89b-42d3-a456-426614174003'
    const destroyedInvocation = Promise.resolve(invoke({ sender } as never, {
      transportRequestId: destroyedId,
      workspaceId: '/workspace',
      request: {
        actionId: 'test-operation.wait',
        invocationId: 'wait-3',
        input: {}
      }
    })).then(unwrapCapabilityTransportEnvelope)
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2))
    senderEvents.emit('destroyed')
    expect(signals[1]?.aborted).toBe(true)
    await expect(destroyedInvocation).rejects.toMatchObject({ code: 'handler_failed' })
    registration.dispose()
  })

  it('never dispatches invoke or observe across renderer destruction races', async () => {
    const invokeBroker = vi.fn(async () => ({ ok: true }))
    const observeBroker = vi.fn(async () => ({ ok: true }))
    const ipcHandlers = new Map<string, (event: never, payload: unknown) => unknown>()
    const ipc = {
      removeHandler: vi.fn((channel: string) => ipcHandlers.delete(channel)),
      handle: vi.fn((channel: string, callback: (event: never, payload: unknown) => unknown) => {
        ipcHandlers.set(channel, callback)
      })
    }
    const onCallerDestroyed = vi.fn()
    const registration = registerCapabilityIpc({
      broker: {
        invoke: invokeBroker,
        observe: observeBroker
      } as never,
      ipc: ipc as never,
      isTrustedIpcSender: () => true,
      onCallerDestroyed
    })
    const invocationPayload = {
      transportRequestId: '123e4567-e89b-42d3-a456-426614174020',
      request: { actionId: 'test-operation.read', input: {} }
    }
    const observationPayload = {
      transportRequestId: '123e4567-e89b-42d3-a456-426614174021',
      request: {
        resource: {
          token: 'cap_abcdefghijklmnopqrst',
          semanticRevision: '1',
          expiresAt: '2026-08-17T00:00:00.000Z'
        }
      }
    }

    const alreadyDestroyed = {
      id: 29,
      send: vi.fn(),
      isDestroyed: () => true,
      once: vi.fn(),
      removeListener: vi.fn()
    }
    await expect(Promise.resolve().then(() => ipcHandlers.get(CAPABILITY_IPC_CHANNELS.invoke)?.(
      { sender: alreadyDestroyed } as never,
      invocationPayload
    ))).rejects.toThrow('destroyed renderer')

    const raceSender = (id: number) => {
      const events = new EventEmitter()
      let checks = 0
      let destroyed = false
      return {
        id,
        send: vi.fn(),
        once: events.once.bind(events),
        removeListener: events.removeListener.bind(events),
        isDestroyed: () => {
          checks += 1
          if (checks === 2) {
            destroyed = true
            events.emit('destroyed')
          }
          return destroyed
        }
      }
    }
    const invokeRaceSender = raceSender(30)
    await expect(Promise.resolve().then(() => ipcHandlers.get(CAPABILITY_IPC_CHANNELS.invoke)?.(
      { sender: invokeRaceSender } as never,
      invocationPayload
    )).then(unwrapCapabilityTransportEnvelope)).rejects.toThrow('destroyed before dispatch')

    const observeRaceSender = raceSender(31)
    await expect(Promise.resolve().then(() => ipcHandlers.get(CAPABILITY_IPC_CHANNELS.observe)?.(
      { sender: observeRaceSender } as never,
      observationPayload
    )).then(unwrapCapabilityTransportEnvelope)).rejects.toThrow('destroyed before dispatch')

    expect(invokeBroker).not.toHaveBeenCalled()
    expect(observeBroker).not.toHaveBeenCalled()
    expect(onCallerDestroyed.mock.calls).toEqual([
      ['window:29'],
      ['window:30'],
      ['window:31']
    ])
    registration.dispose()
  })
})
