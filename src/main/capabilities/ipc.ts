import { createHash, randomUUID } from 'node:crypto'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  workspaceLocatorSchema,
  type WorkspaceLocator
} from '@sciforge/domain-sdk/workspace-host'
import {
  CAPABILITY_BROKER_CONTRACT_VERSION,
  capabilityDiscoveryQuerySchema,
  capabilityEventQuerySchema,
  capabilityInvocationRequestSchema,
  capabilityObserveRequestSchema,
  capabilityReadinessRequestSchema,
  capabilityReadinessSchema,
  capabilityResourceBindRequestSchema,
  capabilityResourceHandleSchema,
  capabilityTransportRequestIdSchema,
  type CapabilityApprovalGrant,
  type CapabilityCallerContextInput,
  type CapabilityResourceChangeEvent
} from '../../shared/capability-broker'
import {
  capabilityTransportFailure,
  capabilityTransportSuccess
} from '../../shared/capability-transport-error'
import type { CapabilityBroker } from './broker'

export const CAPABILITY_IPC_CHANNELS = Object.freeze({
  readiness: 'capability:readiness',
  discover: 'capability:discover',
  observe: 'capability:observe',
  bind: 'capability:bind',
  invoke: 'capability:invoke',
  cancel: 'capability:cancel',
  events: 'capability:events',
  subscribe: 'capability:subscribe',
  unsubscribe: 'capability:unsubscribe',
  event: 'capability:event'
} as const)

const workspaceIdSchema = z.string().trim().min(1).max(4_096)
const capabilityDiscoverIpcSchema = z.object({
  workspaceId: workspaceIdSchema.optional(),
  query: capabilityDiscoveryQuerySchema.optional()
}).strict()
const capabilityObserveIpcSchema = z.object({
  transportRequestId: capabilityTransportRequestIdSchema,
  workspaceId: workspaceIdSchema.optional(),
  request: capabilityObserveRequestSchema
}).strict()
const capabilityBindIpcSchema = z.object({
  workspaceId: workspaceIdSchema.optional(),
  request: capabilityResourceBindRequestSchema
}).strict()
const capabilityInvokeIpcSchema = z.object({
  transportRequestId: capabilityTransportRequestIdSchema,
  workspaceId: workspaceIdSchema.optional(),
  workspaceLocator: workspaceLocatorSchema.optional(),
  request: capabilityInvocationRequestSchema,
  approval: z.object({ mode: z.enum(['confirmation']) }).strict().optional()
}).strict()
const capabilityCancelIpcSchema = z.object({
  transportRequestId: capabilityTransportRequestIdSchema
}).strict()
const capabilityEventsIpcSchema = z.object({
  workspaceId: workspaceIdSchema.optional(),
  query: capabilityEventQuerySchema.optional()
}).strict()
const capabilitySubscribeIpcSchema = z.object({ workspaceId: workspaceIdSchema.optional() }).strict()
const capabilityUnsubscribeIpcSchema = z.object({ subscriptionId: z.string().uuid() }).strict()
const capabilityResourceContentPayloadSchema = z.object({
  workspaceId: workspaceIdSchema.optional(),
  resource: capabilityResourceHandleSchema
}).strict()
const capabilityResourceContentRangePayloadSchema = capabilityResourceContentPayloadSchema.extend({
  range: z.object({
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive()
  }).strict()
}).strict()

type CapabilityIpcSender = {
  id: number
  send: (channel: string, ...args: unknown[]) => void
  once: (event: 'destroyed', listener: () => void) => unknown
  removeListener: (event: 'destroyed', listener: () => void) => unknown
  isDestroyed: () => boolean
}
type CapabilityIpcEvent = { sender: CapabilityIpcSender }
type CapabilityIpcHandler = (event: CapabilityIpcEvent, payload: unknown) => unknown
type CapabilityIpcMain = Pick<typeof ipcMain, 'handle' | 'removeHandler'>
type CapabilityIpcHandlerOptions = Readonly<{ typedErrors?: boolean }>

class CapabilityIpcTransportError extends Error {
  readonly code: string
  readonly category = 'rejected'
  readonly retryable = false

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CapabilityIpcTransportError'
    this.code = code
  }
}

export type RegisterCapabilityIpcOptions = {
  broker: CapabilityBroker
  ipc?: CapabilityIpcMain
  isTrustedIpcSender: (event: IpcMainInvokeEvent) => boolean
  onCallerDestroyed?: (callerId: string) => void
}

export type CapabilityIpcRegistration = {
  dispose: () => void
  handles: (channel: string) => boolean
  invoke: (channel: string, payload: unknown, sender: CapabilityIpcSender) => Promise<unknown>
  resourceContent: {
    describe: (payload: unknown, sender: CapabilityIpcSender) => Promise<unknown>
    readRange: (payload: unknown, sender: CapabilityIpcSender) => Promise<unknown>
  }
}

type Subscription = {
  sender: CapabilityIpcSender
  dispose: () => void
}

type ActiveInvocation = {
  senderId: number
  controller: AbortController
}

type WatchedCaller = {
  sender: CapabilityIpcSender
  listener: () => void
  destroyed: boolean
}

const MAX_PENDING_CANCELLATIONS = 1_024

function transportInvocationKey(senderId: number, transportRequestId: string): string {
  return `${senderId}:${transportRequestId}`
}

/** Canonical UI caller identity shared by capability and Host-owned picker IPC. */
export function capabilityUiCallerId(senderId: number): string {
  if (!Number.isSafeInteger(senderId)) {
    throw new TypeError('Capability UI sender ID must be a safe integer.')
  }
  return `window:${senderId}`
}

function uiCaller(
  sender: CapabilityIpcSender,
  workspaceId?: string,
  approvals: CapabilityApprovalGrant[] = [],
  workspaceLocator?: WorkspaceLocator
): CapabilityCallerContextInput {
  return {
    audience: 'ui',
    callerId: capabilityUiCallerId(sender.id),
    ...(workspaceId ? { workspaceId } : {}),
    ...(workspaceLocator ? { workspaceLocator } : {}),
    approvals
  }
}

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  return schema.parse(payload ?? {})
}

export function registerCapabilityIpc(options: RegisterCapabilityIpcOptions): CapabilityIpcRegistration {
  const ipc = options.ipc ?? ipcMain
  const subscriptions = new Map<string, Subscription>()
  const watchedCallers = new Map<number, WatchedCaller>()
  const destroyedCallerIds = new Set<number>()
  const activeInvocations = new Map<string, ActiveInvocation>()
  const pendingCancellations = new Map<string, number>()
  const invokeHandlers = new Map<string, CapabilityIpcHandler>()
  const channels = Object.values(CAPABILITY_IPC_CHANNELS).filter((channel) => channel !== CAPABILITY_IPC_CHANNELS.event)

  const handle = (
    channel: string,
    handler: CapabilityIpcHandler,
    handlerOptions: CapabilityIpcHandlerOptions = {}
  ): void => {
    const transportedHandler: CapabilityIpcHandler = handlerOptions.typedErrors
      ? async (event, payload) => {
          try {
            return capabilityTransportSuccess(await handler(event, payload))
          } catch (error) {
            return capabilityTransportFailure(error)
          }
        }
      : handler
    invokeHandlers.set(channel, transportedHandler)
    ipc.removeHandler(channel)
    ipc.handle(channel, (event, payload) => {
      if (!options.isTrustedIpcSender(event)) {
        throw new Error('Rejected capability IPC invocation from an untrusted renderer frame.')
      }
      watchCaller(event.sender)
      return transportedHandler(event, payload)
    })
  }

  const watchCaller = (sender: CapabilityIpcSender): WatchedCaller => {
    if (destroyedCallerIds.has(sender.id)) {
      throw new Error('Rejected capability IPC invocation from a destroyed renderer.')
    }
    const existing = watchedCallers.get(sender.id)
    if (existing) return existing
    const watched: WatchedCaller = {
      sender,
      destroyed: false,
      listener: () => undefined
    }
    const listener = () => {
      if (watched.destroyed) return
      watched.destroyed = true
      destroyedCallerIds.add(sender.id)
      if (watchedCallers.get(sender.id) === watched) watchedCallers.delete(sender.id)
      for (const [key, active] of activeInvocations) {
        if (active.senderId !== sender.id) continue
        active.controller.abort()
        activeInvocations.delete(key)
      }
      for (const [key, senderId] of pendingCancellations) {
        if (senderId === sender.id) pendingCancellations.delete(key)
      }
      for (const [subscriptionId, subscription] of subscriptions) {
        if (subscription.sender.id !== sender.id) continue
        subscription.dispose()
        subscriptions.delete(subscriptionId)
      }
      options.onCallerDestroyed?.(capabilityUiCallerId(sender.id))
    }
    watched.listener = listener
    watchedCallers.set(sender.id, watched)
    sender.once('destroyed', listener)
    // Electron may destroy a WebContents before or during listener
    // registration. Re-check after publishing the watched state so a
    // capability can never dispatch through that gap.
    if (sender.isDestroyed()) listener()
    if (watched.destroyed || watchedCallers.get(sender.id) !== watched) {
      throw new Error('Rejected capability IPC invocation from a destroyed renderer.')
    }
    return watched
  }

  handle(CAPABILITY_IPC_CHANNELS.discover, (event, payload) => {
    const input = parse(capabilityDiscoverIpcSchema, payload)
    return options.broker.discover(uiCaller(event.sender, input.workspaceId), input.query)
  })
  handle(CAPABILITY_IPC_CHANNELS.readiness, (event, payload) => {
    const input = parse(capabilityReadinessRequestSchema, payload)
    const descriptors = options.broker.discover(uiCaller(event.sender, input.workspaceId))
    const availableCapabilityIds = descriptors.map((descriptor) => descriptor.id).sort()
    const available = new Set(availableCapabilityIds)
    const missingCapabilityIds = input.requiredCapabilityIds
      .filter((id) => !available.has(id))
      .sort()
    const status = input.expectedContractVersion !== CAPABILITY_BROKER_CONTRACT_VERSION
      ? 'incompatible'
      : missingCapabilityIds.length > 0
        ? 'incomplete'
        : 'ready'
    const registryFingerprint = createHash('sha256')
      .update(JSON.stringify(descriptors.map((descriptor) => ({
        contractVersion: descriptor.contractVersion,
        id: descriptor.id,
        version: descriptor.version
      }))))
      .digest('hex')
    const message = status === 'incompatible'
      ? `Capability broker contract mismatch: renderer expects ${input.expectedContractVersion}, main provides ${CAPABILITY_BROKER_CONTRACT_VERSION}.`
      : status === 'incomplete'
        ? `Capability registry is missing required operations: ${missingCapabilityIds.join(', ')}.`
        : `Capability broker is ready with ${availableCapabilityIds.length} UI operation${availableCapabilityIds.length === 1 ? '' : 's'}.`

    return capabilityReadinessSchema.parse({
      contractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
      status,
      registryFingerprint,
      availableCapabilityIds,
      missingCapabilityIds,
      message
    })
  })
  handle(CAPABILITY_IPC_CHANNELS.observe, async (event, payload) => {
    const watched = watchCaller(event.sender)
    const input = parse(capabilityObserveIpcSchema, payload)
    const invocationKey = transportInvocationKey(event.sender.id, input.transportRequestId)
    if (activeInvocations.has(invocationKey)) {
      throw new CapabilityIpcTransportError(
        'transport_request_conflict',
        'A capability transport request with this ID is already active.'
      )
    }
    if (pendingCancellations.delete(invocationKey)) {
      throw new CapabilityIpcTransportError(
        'invocation_cancelled',
        'Capability observation was cancelled before dispatch.'
      )
    }
    const controller = new AbortController()
    activeInvocations.set(invocationKey, { senderId: event.sender.id, controller })
    if (watched.destroyed || watchedCallers.get(event.sender.id) !== watched || event.sender.isDestroyed()) {
      controller.abort()
      activeInvocations.delete(invocationKey)
      throw new CapabilityIpcTransportError(
        'invocation_cancelled',
        'Capability observation sender was destroyed before dispatch.'
      )
    }
    try {
      return await options.broker.observe(
        uiCaller(event.sender, input.workspaceId),
        input.request,
        { signal: controller.signal }
      )
    } finally {
      if (activeInvocations.get(invocationKey)?.controller === controller) {
        activeInvocations.delete(invocationKey)
      }
    }
  }, { typedErrors: true })
  handle(CAPABILITY_IPC_CHANNELS.bind, (event, payload) => {
    const input = parse(capabilityBindIpcSchema, payload)
    return options.broker.bindResourceRef(
      uiCaller(event.sender, input.workspaceId),
      input.request.resourceRef
    )
  })
  handle(CAPABILITY_IPC_CHANNELS.invoke, async (event, payload) => {
    const watched = watchCaller(event.sender)
    const input = parse(capabilityInvokeIpcSchema, payload)
    const invocationKey = transportInvocationKey(event.sender.id, input.transportRequestId)
    if (activeInvocations.has(invocationKey)) {
      throw new CapabilityIpcTransportError(
        'transport_request_conflict',
        'A capability transport request with this ID is already active.'
      )
    }
    if (pendingCancellations.delete(invocationKey)) {
      throw new CapabilityIpcTransportError(
        'invocation_cancelled',
        'Capability invocation was cancelled before dispatch.'
      )
    }
    const approvals: CapabilityApprovalGrant[] = input.approval && input.request.invocationId
      ? [{
          actionId: input.request.actionId,
          invocationId: input.request.invocationId,
          mode: input.approval.mode
        }]
      : []
    const controller = new AbortController()
    activeInvocations.set(invocationKey, { senderId: event.sender.id, controller })
    if (watched.destroyed || watchedCallers.get(event.sender.id) !== watched || event.sender.isDestroyed()) {
      controller.abort()
      activeInvocations.delete(invocationKey)
      throw new CapabilityIpcTransportError(
        'invocation_cancelled',
        'Capability invocation sender was destroyed before dispatch.'
      )
    }
    try {
      return await options.broker.invoke(
        uiCaller(event.sender, input.workspaceId, approvals, input.workspaceLocator),
        input.request,
        { signal: controller.signal }
      )
    } finally {
      if (activeInvocations.get(invocationKey)?.controller === controller) {
        activeInvocations.delete(invocationKey)
      }
    }
  }, { typedErrors: true })
  handle(CAPABILITY_IPC_CHANNELS.cancel, (event, payload) => {
    const input = parse(capabilityCancelIpcSchema, payload)
    const invocationKey = transportInvocationKey(event.sender.id, input.transportRequestId)
    const active = activeInvocations.get(invocationKey)
    if (active) {
      active.controller.abort()
      return true
    }
    // The browser dev bridge uses concurrent HTTP requests. Remember a bounded
    // early cancellation so request reordering cannot start a cancelled write.
    pendingCancellations.set(invocationKey, event.sender.id)
    while (pendingCancellations.size > MAX_PENDING_CANCELLATIONS) {
      const oldest = pendingCancellations.keys().next().value
      if (oldest === undefined) break
      pendingCancellations.delete(oldest)
    }
    return true
  })
  handle(CAPABILITY_IPC_CHANNELS.events, (event, payload) => {
    const input = parse(capabilityEventsIpcSchema, payload)
    return options.broker.listEvents(uiCaller(event.sender, input.workspaceId), input.query)
  })
  handle(CAPABILITY_IPC_CHANNELS.subscribe, (event, payload) => {
    const input = parse(capabilitySubscribeIpcSchema, payload)
    const subscriptionId = randomUUID()
    const sender = event.sender
    const dispose = options.broker.subscribe(uiCaller(sender, input.workspaceId), (change) => {
      if (sender.isDestroyed()) return
      sender.send(CAPABILITY_IPC_CHANNELS.event, {
        subscriptionId,
        event: change satisfies CapabilityResourceChangeEvent
      })
    })
    subscriptions.set(subscriptionId, { sender, dispose })
    return { subscriptionId }
  })
  handle(CAPABILITY_IPC_CHANNELS.unsubscribe, (event, payload) => {
    const { subscriptionId } = parse(capabilityUnsubscribeIpcSchema, payload)
    const subscription = subscriptions.get(subscriptionId)
    if (!subscription || subscription.sender.id !== event.sender.id) return false
    subscription.dispose()
    subscriptions.delete(subscriptionId)
    return true
  })

  return {
    handles: (channel) => invokeHandlers.has(channel),
    invoke: async (channel, payload, sender) => {
      const handler = invokeHandlers.get(channel)
      if (!handler) throw new Error(`Unknown capability bridge channel: ${channel}`)
      watchCaller(sender)
      return await handler({ sender }, payload)
    },
    resourceContent: {
      describe: async (payload, sender) => {
        const input = parse(capabilityResourceContentPayloadSchema, payload)
        return await options.broker.describeResourceContent(
          uiCaller(sender, input.workspaceId),
          input.resource
        )
      },
      readRange: async (payload, sender) => {
        const input = parse(capabilityResourceContentRangePayloadSchema, payload)
        return await options.broker.readResourceContentRange(
          uiCaller(sender, input.workspaceId),
          input.resource,
          input.range
        )
      }
    },
    dispose: () => {
      for (const channel of channels) ipc.removeHandler(channel)
      for (const active of activeInvocations.values()) active.controller.abort()
      activeInvocations.clear()
      pendingCancellations.clear()
      for (const subscription of subscriptions.values()) subscription.dispose()
      subscriptions.clear()
      for (const watched of watchedCallers.values()) {
        watched.sender.removeListener('destroyed', watched.listener)
      }
      watchedCallers.clear()
      destroyedCallerIds.clear()
      invokeHandlers.clear()
    }
  }
}
