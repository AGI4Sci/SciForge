import { createHash, randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  CAPABILITY_BROKER_CONTRACT_VERSION,
  capabilityDiscoveryQuerySchema,
  capabilityEventQuerySchema,
  capabilityInvocationRequestSchema,
  capabilityObserveRequestSchema,
  capabilityReadinessRequestSchema,
  capabilityReadinessSchema,
  capabilityResourceHandleSchema,
  type CapabilityApprovalGrant,
  type CapabilityCallerContextInput,
  type CapabilityResourceChangeEvent
} from '../../shared/capability-broker'
import type { CapabilityBroker } from './broker'

export const CAPABILITY_IPC_CHANNELS = Object.freeze({
  readiness: 'capability:readiness',
  discover: 'capability:discover',
  observe: 'capability:observe',
  invoke: 'capability:invoke',
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
  workspaceId: workspaceIdSchema.optional(),
  request: capabilityObserveRequestSchema
}).strict()
const capabilityInvokeIpcSchema = z.object({
  workspaceId: workspaceIdSchema.optional(),
  request: capabilityInvocationRequestSchema,
  approval: z.object({ mode: z.enum(['confirmation']) }).strict().optional()
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
  isDestroyed: () => boolean
}
type CapabilityIpcEvent = { sender: CapabilityIpcSender }
type CapabilityIpcHandler = (event: CapabilityIpcEvent, payload: unknown) => unknown
type CapabilityIpcMain = Pick<typeof ipcMain, 'handle' | 'removeHandler'>

export type RegisterCapabilityIpcOptions = {
  broker: CapabilityBroker
  ipc?: CapabilityIpcMain
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

function uiCaller(sender: CapabilityIpcSender, workspaceId?: string, approvals: CapabilityApprovalGrant[] = []): CapabilityCallerContextInput {
  return {
    audience: 'ui',
    callerId: `window:${sender.id}`,
    ...(workspaceId ? { workspaceId } : {}),
    approvals
  }
}

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  return schema.parse(payload ?? {})
}

export function registerCapabilityIpc(options: RegisterCapabilityIpcOptions): CapabilityIpcRegistration {
  const ipc = options.ipc ?? ipcMain
  const subscriptions = new Map<string, Subscription>()
  const invokeHandlers = new Map<string, CapabilityIpcHandler>()
  const channels = Object.values(CAPABILITY_IPC_CHANNELS).filter((channel) => channel !== CAPABILITY_IPC_CHANNELS.event)

  const handle = (channel: string, handler: CapabilityIpcHandler): void => {
    invokeHandlers.set(channel, handler)
    ipc.removeHandler(channel)
    ipc.handle(channel, (event, payload) => handler(event, payload))
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
  handle(CAPABILITY_IPC_CHANNELS.observe, (event, payload) => {
    const input = parse(capabilityObserveIpcSchema, payload)
    return options.broker.observe(uiCaller(event.sender, input.workspaceId), input.request)
  })
  handle(CAPABILITY_IPC_CHANNELS.invoke, (event, payload) => {
    const input = parse(capabilityInvokeIpcSchema, payload)
    const approvals: CapabilityApprovalGrant[] = input.approval && input.request.invocationId
      ? [{
          actionId: input.request.actionId,
          invocationId: input.request.invocationId,
          mode: input.approval.mode
        }]
      : []
    return options.broker.invoke(uiCaller(event.sender, input.workspaceId, approvals), input.request)
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
    sender.once('destroyed', () => {
      const subscription = subscriptions.get(subscriptionId)
      if (!subscription) return
      subscription.dispose()
      subscriptions.delete(subscriptionId)
    })
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
      for (const subscription of subscriptions.values()) subscription.dispose()
      subscriptions.clear()
      invokeHandlers.clear()
    }
  }
}
