import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type {
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeThread,
  AgentRuntimeThreadStartInput,
  AgentRuntimeThreadStatus,
  AgentRuntimeThreadStatusInput,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput,
  AgentRuntimeTurnTargetInput
} from '../../shared/agent-runtime-contract'
import type {
  AgentRuntimeEventSubscribeInput,
  AgentRuntimeThreadDeleteInput
} from '../runtime/agent-runtime/adapter'
import type { LiveWorkflowRuntime } from './live-executor'

type BridgeEnvelope<T> =
  | { ok: true; payload: T }
  | { ok: false; message?: string }

type BridgeMessage = {
  channel: string
  payload: unknown
}

type BridgeEventPayload = {
  streamId?: unknown
  event?: unknown
  message?: unknown
}

type FetchLike = typeof fetch

type QueueWaiter<T> = {
  resolve: (result: IteratorResult<T>) => void
  reject: (error: Error) => void
}

type AsyncQueueState<T> = {
  values: T[]
  waiters: QueueWaiter<T>[]
  closed: boolean
  error?: Error
}

export type DevBrowserBridgeRuntimeOptions = Readonly<{
  bridgeUrl?: string
  instanceId?: string
  clientId?: string
  projectRoot?: string
  fetch?: FetchLike
}>

export type DevBrowserBridgeRuntime = LiveWorkflowRuntime & Readonly<{
  close: () => Promise<void>
  bridgeUrl: string
}>

/**
 * Adapts the existing localhost development bridge to the live workflow
 * executor. The bridge dispatches into the already-running main-process
 * AgentRuntimeHost, so this adapter never creates a second Agent runtime.
 */
export async function createDevBrowserBridgeRuntime(
  options: DevBrowserBridgeRuntimeOptions = {}
): Promise<DevBrowserBridgeRuntime> {
  const bridgeUrl = (options.bridgeUrl ?? process.env.SCIFORGE_DEV_BRIDGE_URL ?? 'http://127.0.0.1:5174')
    .trim()
    .replace(/\/$/u, '')
  if (!bridgeUrl) throw new Error('A development bridge URL is required.')
  const instanceId = (options.instanceId ?? process.env.SCIFORGE_DEV_INSTANCE_ID ??
    await readDevelopmentInstanceId(options.projectRoot ?? process.cwd())).trim()
  if (!instanceId) {
    throw new Error(
      'Could not resolve the SciForge development instance ID. Start `npm run dev` or provide --dev-instance-id.'
    )
  }
  const runtime = new DevBrowserBridgeRuntimeImpl(
    bridgeUrl,
    instanceId,
    options.clientId?.trim() || randomUUID(),
    options.fetch ?? fetch
  )
  await runtime.assertReachable()
  return runtime
}

class DevBrowserBridgeRuntimeImpl implements DevBrowserBridgeRuntime {
  readonly bridgeUrl: string
  private readonly instanceId: string
  private readonly clientId: string
  private readonly fetchImpl: FetchLike
  private readonly streams = new Map<string, AsyncQueueState<AgentRuntimeEvent>>()
  private readonly eventsController = new AbortController()
  private eventsTask: Promise<void> | undefined
  private eventsReady: Promise<void> | undefined
  private resolveEventsReady: (() => void) | undefined
  private rejectEventsReady: ((error: Error) => void) | undefined
  private closed = false

  constructor(bridgeUrl: string, instanceId: string, clientId: string, fetchImpl: FetchLike) {
    this.bridgeUrl = bridgeUrl
    this.instanceId = instanceId
    this.clientId = clientId
    this.fetchImpl = fetchImpl
  }

  async assertReachable(): Promise<void> {
    const response = await this.fetchImpl(`${this.bridgeUrl}/health`, {
      headers: { 'X-SciForge-Dev-Instance': this.instanceId }
    }).catch((error) => {
      throw new Error(`SciForge development bridge is not reachable at ${this.bridgeUrl}: ${errorMessage(error)}`)
    })
    if (!response.ok) throw new Error(`SciForge development bridge health check failed with HTTP ${response.status}.`)
  }

  startThread(input: AgentRuntimeThreadStartInput): Promise<AgentRuntimeThread> {
    return this.invoke('agentRuntime:startThread', input)
  }

  readThreadStatus(input: AgentRuntimeThreadStatusInput): Promise<AgentRuntimeThreadStatus> {
    return this.invoke('agentRuntime:readThreadStatus', input)
  }

  startTurn(input: AgentRuntimeTurnStartInput): Promise<AgentRuntimeTurnHandle> {
    return this.invoke('agentRuntime:startTurn', input)
  }

  async *subscribeEvents(input: AgentRuntimeEventSubscribeInput): AsyncIterable<AgentRuntimeEvent> {
    await this.ensureEventStream()
    const streamId = input.streamId?.trim() || randomUUID()
    const queue = createQueue<AgentRuntimeEvent>()
    this.streams.set(streamId, queue)
    const onAbort = (): void => closeQueue(queue)
    input.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const payload = { ...input, streamId }
      delete payload.signal
      const response = await this.invoke<{ streamId?: unknown } | undefined>(
        'agentRuntime:subscribeEvents',
        { ...payload },
        input.signal
      )
      const returnedStreamId = response && stringValue(response.streamId)
      if (returnedStreamId && returnedStreamId !== streamId) {
        throw new Error(`Development bridge returned an unexpected event stream ID for ${streamId}.`)
      }
      for await (const event of queueIterator(queue)) yield event
    } finally {
      input.signal?.removeEventListener('abort', onAbort)
      this.streams.delete(streamId)
      await this.invoke('agentRuntime:stopEvents', streamId).catch(() => undefined)
      closeQueue(queue)
    }
  }

  interruptTurn(input: AgentRuntimeTurnTargetInput): Promise<void> {
    return this.invoke('agentRuntime:interruptTurn', input)
  }

  deleteThread(input: AgentRuntimeThreadDeleteInput): Promise<void> {
    return this.invoke('agentRuntime:deleteThread', input)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.eventsController.abort()
    for (const queue of this.streams.values()) closeQueue(queue)
    await this.eventsTask?.catch(() => undefined)
  }

  private async ensureEventStream(): Promise<void> {
    if (this.closed) throw new Error('Development bridge runtime is closed.')
    if (!this.eventsTask) {
      this.eventsReady = new Promise<void>((resolve, reject) => {
        this.resolveEventsReady = resolve
        this.rejectEventsReady = reject
      })
      this.eventsTask = this.consumeEvents()
    }
    await this.eventsReady
  }

  private async consumeEvents(): Promise<void> {
    try {
      const url = new URL(`${this.bridgeUrl}/events`)
      url.searchParams.set('clientId', this.clientId)
      url.searchParams.set('devInstanceId', this.instanceId)
      const response = await this.fetchImpl(url, {
        headers: { 'X-SciForge-Dev-Instance': this.instanceId },
        signal: this.eventsController.signal
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (!response.body) throw new Error('empty event stream')
      this.resolveEventsReady?.()
      this.resolveEventsReady = undefined
      this.rejectEventsReady = undefined
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (!this.eventsController.signal.aborted) {
          const chunk = await reader.read()
          if (chunk.done) break
          buffer += decoder.decode(chunk.value, { stream: true })
          let boundary = buffer.indexOf('\n\n')
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            this.dispatchFrame(frame)
            boundary = buffer.indexOf('\n\n')
          }
        }
      } finally {
        reader.releaseLock()
      }
      if (!this.eventsController.signal.aborted) throw new Error('stream closed unexpectedly')
    } catch (error) {
      if (this.eventsController.signal.aborted) return
      const failure = new Error(`SciForge development bridge event stream failed: ${errorMessage(error)}`)
      this.rejectEventsReady?.(failure)
      this.resolveEventsReady = undefined
      this.rejectEventsReady = undefined
      for (const queue of this.streams.values()) failQueue(queue, failure)
    }
  }

  private dispatchFrame(frame: string): void {
    let eventName = 'message'
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim()
      if (line.startsWith('data:')) data.push(line.slice('data:'.length).trimStart())
    }
    if (eventName !== 'bridge-message' || data.length === 0) return
    let message: BridgeMessage
    try {
      message = JSON.parse(data.join('\n')) as BridgeMessage
    } catch {
      return
    }
    if (message.channel !== 'agentRuntime:event' &&
        message.channel !== 'agentRuntime:end' &&
        message.channel !== 'agentRuntime:error') return
    const payload = recordValue(message.payload) as BridgeEventPayload
    const streamId = stringValue(payload.streamId)
    const queue = this.streams.get(streamId)
    if (!queue) return
    if (message.channel === 'agentRuntime:event' && isAgentRuntimeEvent(payload.event)) {
      pushQueue(queue, payload.event)
    } else if (message.channel === 'agentRuntime:end') {
      closeQueue(queue)
    } else if (message.channel === 'agentRuntime:error') {
      failQueue(queue, new Error(stringValue(payload.message) || `Agent runtime event stream ${streamId} failed.`))
    }
  }

  private async invoke<T>(channel: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    if (this.closed) throw new Error('Development bridge runtime is closed.')
    const response = await this.fetchImpl(`${this.bridgeUrl}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SciForge-Client': this.clientId,
        'X-SciForge-Dev-Instance': this.instanceId
      },
      ...(signal ? { signal } : {}),
      body: JSON.stringify({ channel, payload })
    }).catch((error) => {
      throw new Error(`SciForge development bridge invocation failed for ${channel}: ${errorMessage(error)}`)
    })
    const envelope = await response.json().catch(() => null) as BridgeEnvelope<T> | null
    if (!response.ok || !envelope?.ok) {
      throw new Error(envelope && !envelope.ok
        ? envelope.message ?? `Development bridge request failed for ${channel}.`
        : `Development bridge returned HTTP ${response.status} for ${channel}.`)
    }
    return envelope.payload
  }
}

function createQueue<T>(): AsyncQueueState<T> {
  return { values: [], waiters: [], closed: false }
}

function pushQueue<T>(queue: AsyncQueueState<T>, value: T): void {
  if (queue.closed) return
  const waiter = queue.waiters.shift()
  if (waiter) waiter.resolve({ done: false, value })
  else queue.values.push(value)
}

function closeQueue<T>(queue: AsyncQueueState<T>): void {
  if (queue.closed) return
  queue.closed = true
  for (const waiter of queue.waiters.splice(0)) waiter.resolve({ done: true, value: undefined as never })
}

function failQueue<T>(queue: AsyncQueueState<T>, error: Error): void {
  if (queue.closed) return
  queue.closed = true
  queue.error = error
  for (const waiter of queue.waiters.splice(0)) waiter.reject(error)
}

async function* queueIterator<T>(queue: AsyncQueueState<T>): AsyncIterable<T> {
  while (queue.values.length > 0) yield queue.values.shift() as T
  while (!queue.closed) {
    const result = await new Promise<IteratorResult<T>>((resolve, reject) => {
      queue.waiters.push({ resolve, reject })
    })
    if (result.done) return
    yield result.value
  }
  if (queue.error) throw queue.error
  while (queue.values.length > 0) yield queue.values.shift() as T
}

async function readDevelopmentInstanceId(projectRoot: string): Promise<string> {
  const workspaceId = createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0, 16)
  try {
    const owner = JSON.parse(await readFile(join(tmpdir(), 'sciforge-dev-instances', `${workspaceId}.json`), 'utf8')) as { instanceId?: unknown }
    return stringValue(owner.instanceId)
  } catch {
    return ''
  }
}

function isAgentRuntimeEvent(value: unknown): value is AgentRuntimeEvent {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    typeof (value as { threadId?: unknown }).threadId === 'string'
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
