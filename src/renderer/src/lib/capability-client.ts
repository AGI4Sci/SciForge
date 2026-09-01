import type { z } from 'zod'
import {
  CAPABILITY_BROKER_CONTRACT_VERSION,
  capabilityEffectSchema,
  capabilityIdSchema,
  capabilityInvocationRequestSchema,
  capabilityInvocationResultSchema,
  capabilityJsonValueSchema,
  capabilityObservationSchema,
  capabilityObserveRequestSchema,
  capabilityResourceChangeEventSchema,
  capabilityResourceBindRequestSchema,
  capabilityResourceHandleSchema,
  capabilityReadinessRequestSchema,
  capabilityReadinessSchema,
  type CapabilityEffect,
  type CapabilityReadiness
} from '@shared/capability-broker'
import type {
  DomainRendererCapabilityChange,
  DomainRendererCapabilityChangeDisposer,
  DomainCapabilityResourceHandle,
  DomainRendererCapabilityObservation,
  DomainRendererCapabilityObservationContract
} from '@sciforge/domain-sdk/host'
import type { SciForgeApi } from '@shared/sciforge-api'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import { activeWorkspaceLocator } from '../remote-workspace/placement'

export type RendererCapabilityContract<TInput, TOutput> = Readonly<{
  actionId: string
  effect: CapabilityEffect
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
}>

export type RendererCapabilityInvokeOptions = Readonly<{
  workspaceId?: string
  workspaceLocator?: WorkspaceLocator
  resource?: DomainCapabilityResourceHandle
  expectedRevision?: string
  approval?: { mode: 'confirmation' }
  signal?: AbortSignal
}>

export type RendererCapabilityObserveOptions = Readonly<{
  workspaceId?: string
  signal?: AbortSignal
}>

type CapabilityTransport = Pick<
  SciForgeApi['capabilities'],
  'readiness' | 'observe' | 'bind' | 'invoke' | 'cancel' | 'subscribe' | 'unsubscribe' | 'onEvent'
>

export type RendererCapabilityClientOptions = Readonly<{
  getTransport?: () => CapabilityTransport
  createInvocationId?: () => string
  createTransportRequestId?: () => string
}>

export class RendererCapabilityClient {
  private readonly getTransport: () => CapabilityTransport
  private readonly createInvocationId: () => string
  private readonly createTransportRequestId: () => string

  constructor(options: RendererCapabilityClientOptions = {}) {
    this.getTransport = options.getTransport ?? defaultTransport
    this.createInvocationId = options.createInvocationId ?? defaultInvocationId
    this.createTransportRequestId = options.createTransportRequestId ?? defaultTransportRequestId
  }

  async readiness(
    requiredCapabilityIds: readonly string[],
    workspaceId?: string
  ): Promise<CapabilityReadiness> {
    const request = capabilityReadinessRequestSchema.parse({
      ...(workspaceId ? { workspaceId } : {}),
      expectedContractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
      requiredCapabilityIds: [...new Set(requiredCapabilityIds.map((id) => capabilityIdSchema.parse(id)))].sort()
    })
    return capabilityReadinessSchema.parse(await this.getTransport().readiness(request))
  }

  async observe<TState>(
    contract: DomainRendererCapabilityObservationContract<TState>,
    resource: DomainCapabilityResourceHandle,
    options: RendererCapabilityObserveOptions = {}
  ): Promise<DomainRendererCapabilityObservation<TState>> {
    throwIfAborted(options.signal)
    const request = capabilityObserveRequestSchema.parse({ resource })
    const transport = this.getTransport()
    const transportRequestId = this.createTransportRequestId()
    let cancellationSent = false
    const cancel = (): void => {
      if (cancellationSent) return
      cancellationSent = true
      void transport.cancel(transportRequestId).catch(() => undefined)
    }
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()
    let rawObservation: Awaited<ReturnType<CapabilityTransport['observe']>>
    try {
      rawObservation = await transport.observe({
        transportRequestId,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        request
      })
    } finally {
      options.signal?.removeEventListener('abort', cancel)
    }
    throwIfAborted(options.signal)
    const observation = capabilityObservationSchema.parse(rawObservation)
    if (observation.resourceKind !== contract.resourceKind) {
      throw new Error(
        `Capability observation resource kind mismatch: expected "${contract.resourceKind}", received "${observation.resourceKind}".`
      )
    }
    return {
      resource: observation.resource,
      resourceRef: observation.resourceRef,
      resourceKind: observation.resourceKind,
      semanticRevision: observation.semanticRevision,
      ...(observation.layoutRevision ? { layoutRevision: observation.layoutRevision } : {}),
      observedAt: observation.observedAt,
      state: contract.stateSchema.parse(observation.state)
    }
  }

  async bind(
    resourceRef: string,
    options: RendererCapabilityObserveOptions = {}
  ): Promise<DomainCapabilityResourceHandle> {
    throwIfAborted(options.signal)
    const request = capabilityResourceBindRequestSchema.parse({ resourceRef })
    const rawHandle = await this.getTransport().bind({
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      request
    })
    throwIfAborted(options.signal)
    return capabilityResourceHandleSchema.parse(rawHandle)
  }

  async invoke<TInput, TOutput>(
    contract: RendererCapabilityContract<TInput, TOutput>,
    input: TInput,
    options: RendererCapabilityInvokeOptions = {}
  ): Promise<TOutput> {
    const actionId = capabilityIdSchema.parse(contract.actionId)
    const effect = capabilityEffectSchema.parse(contract.effect)
    const parsedInput = contract.inputSchema.parse(input)
    const jsonInput = capabilityJsonValueSchema.parse(parsedInput)
    throwIfAborted(options.signal)
    const readiness = await waitForAbortableResult(
      this.readiness([actionId], options.workspaceId),
      options.signal
    )
    throwIfAborted(options.signal)
    if (readiness.status !== 'ready') throw new Error(readiness.message)
    const workspaceLocator = options.workspaceLocator ??
      activeWorkspaceLocator(options.workspaceId)

    const request = capabilityInvocationRequestSchema.parse({
      actionId,
      input: jsonInput,
      ...(options.resource ? { resource: options.resource } : {}),
      ...(options.expectedRevision === undefined
        ? {}
        : { expectedRevision: options.expectedRevision }),
      ...(effect === 'read' ? {} : { invocationId: this.createInvocationId() })
    })
    const transport = this.getTransport()
    const transportRequestId = this.createTransportRequestId()
    let cancellationSent = false
    const cancel = (): void => {
      if (cancellationSent) return
      cancellationSent = true
      void transport.cancel(transportRequestId).catch(() => undefined)
    }
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()

    let rawResult: Awaited<ReturnType<CapabilityTransport['invoke']>>
    try {
      rawResult = await transport.invoke({
        transportRequestId,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        ...(workspaceLocator ? { workspaceLocator } : {}),
        request,
        ...(options.approval ? { approval: options.approval } : {})
      })
    } finally {
      options.signal?.removeEventListener('abort', cancel)
    }
    const result = capabilityInvocationResultSchema.parse(rawResult)
    if (result.actionId !== actionId) {
      throw new Error(`Capability result action mismatch: expected "${actionId}", received "${result.actionId}".`)
    }
    if (request.invocationId && result.invocationId !== request.invocationId) {
      throw new Error(`Capability result invocation mismatch for "${actionId}".`)
    }
    return contract.outputSchema.parse(result.output)
  }

  async subscribe(
    resourceRef: string,
    listener: (change: DomainRendererCapabilityChange) => void,
    options: RendererCapabilityObserveOptions = {}
  ): Promise<DomainRendererCapabilityChangeDisposer> {
    const normalizedResourceRef = resourceRef.trim()
    if (!/^res_[A-Za-z0-9_-]{20,}$/.test(normalizedResourceRef)) {
      throw new Error('Capability subscription requires a valid resource reference.')
    }
    if (typeof listener !== 'function') {
      throw new TypeError('Capability subscription listener must be a function.')
    }

    const transport = this.getTransport()
    let disposed = false
    let subscriptionId: string | null = null
    const pending: Parameters<Parameters<CapabilityTransport['onEvent']>[0]>[0][] = []

    const deliver = (payload: Parameters<Parameters<CapabilityTransport['onEvent']>[0]>[0]): void => {
      if (disposed || payload.subscriptionId !== subscriptionId) return
      const event = capabilityResourceChangeEventSchema.parse(payload.event)
      if (event.resourceRef !== normalizedResourceRef) return
      const common = {
        resourceRef: event.resourceRef,
        resourceKind: event.resourceKind,
        beforeRevision: event.beforeRevision,
        afterRevision: event.afterRevision,
        changedAt: event.occurredAt
      }
      listener(event.origin === 'capability'
        ? { ...common, origin: 'capability', actionId: event.actionId }
        : { ...common, origin: 'provider' })
    }
    const removeEventListener = transport.onEvent((payload) => {
      if (subscriptionId === null) {
        if (pending.length < 100) pending.push(payload)
        return
      }
      deliver(payload)
    })

    try {
      const subscription = await transport.subscribe(options.workspaceId)
      subscriptionId = subscription.subscriptionId
      for (const payload of pending.splice(0)) deliver(payload)
    } catch (error) {
      disposed = true
      pending.length = 0
      removeEventListener()
      throw error
    }

    return () => {
      if (disposed) return
      disposed = true
      pending.length = 0
      removeEventListener()
      if (subscriptionId) {
        void transport.unsubscribe(subscriptionId).catch(() => undefined)
      }
    }
  }
}

export const rendererCapabilityClient = new RendererCapabilityClient()

function defaultTransport(): CapabilityTransport {
  const transport = window.sciforge?.capabilities
  if (!transport) throw new Error('Capability transport is unavailable.')
  return transport
}

function defaultInvocationId(): string {
  return `ui_${globalThis.crypto.randomUUID()}`
}

function defaultTransportRequestId(): string {
  return globalThis.crypto.randomUUID()
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw capabilityInvocationAbortError()
}

function capabilityInvocationAbortError(): Error {
  const error = new Error('Capability invocation was cancelled.')
  error.name = 'AbortError'
  return error
}

async function waitForAbortableResult<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (!signal) return operation
  throwIfAborted(signal)
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      settle()
    }
    const onAbort = (): void => {
      finish(() => reject(capabilityInvocationAbortError()))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    )
    if (signal.aborted) onAbort()
  })
}
