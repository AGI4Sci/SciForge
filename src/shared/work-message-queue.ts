/**
 * Provider-neutral FIFO queue for messages that belong to one logical work.
 *
 * A provider turn can finish while the work is still being continued or
 * verified.  Callers keep the same `workId` and enqueue new user messages
 * here; claiming a message is the only operation that makes it runnable.
 * The state is plain JSON so it can be persisted and restored after a
 * renderer or Host restart.
 */

export type WorkMessageKind = 'continuation' | 'verification' | 'user'

export type WorkQueuedMessage<TPayload = unknown> = {
  id: string
  workId: string
  kind: WorkMessageKind
  sequence: number
  enqueuedAt: number
  idempotencyKey?: string
  payload: TPayload
}

export type WorkMessageQueueState<TPayload = unknown> = {
  nextSequence: number
  messages: WorkQueuedMessage<TPayload>[]
  /** At most one provider turn may run for a work at a time. */
  activeByWork: Record<string, string>
  /** Durable idempotency tombstones for messages that were delivered. */
  settledMessageIds: Record<string, true>
  settledIdempotencyKeys: Record<string, true>
}

export type EnqueueWorkMessageInput<TPayload = unknown> = {
  id: string
  workId: string
  kind: WorkMessageKind
  payload: TPayload
  enqueuedAt?: number
  idempotencyKey?: string
}

export type EnqueueWorkMessageResult<TPayload = unknown> = {
  state: WorkMessageQueueState<TPayload>
  message: WorkQueuedMessage<TPayload>
  accepted: boolean
}

const KIND_PRIORITY: Record<WorkMessageKind, number> = {
  continuation: 0,
  verification: 1,
  user: 2
}

function normalizeKey(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} must not be empty.`)
  return normalized
}

export function createWorkMessageQueue<TPayload = unknown>(): WorkMessageQueueState<TPayload> {
  return {
    nextSequence: 1,
    messages: [],
    activeByWork: {},
    settledMessageIds: {},
    settledIdempotencyKeys: {}
  }
}

/** Hydrates records written before the queue added durable idempotency fields. */
export function normalizeWorkMessageQueueState<TPayload = unknown>(
  value: Partial<WorkMessageQueueState<TPayload>> | null | undefined
): WorkMessageQueueState<TPayload> {
  return {
    nextSequence: Number.isInteger(value?.nextSequence) && (value?.nextSequence ?? 0) > 0
      ? value!.nextSequence!
      : (value?.messages?.reduce((max, message) => Math.max(max, message.sequence), 0) ?? 0) + 1,
    messages: Array.isArray(value?.messages) ? value.messages : [],
    activeByWork: value?.activeByWork && typeof value.activeByWork === 'object'
      ? value.activeByWork
      : {},
    settledMessageIds: value?.settledMessageIds && typeof value.settledMessageIds === 'object'
      ? value.settledMessageIds
      : {},
    settledIdempotencyKeys: value?.settledIdempotencyKeys && typeof value.settledIdempotencyKeys === 'object'
      ? value.settledIdempotencyKeys
      : {}
  }
}

/**
 * Enqueues once by message id or idempotency key. Duplicate delivery attempts
 * return the original message and leave queue ordering unchanged.
 */
export function enqueueWorkMessage<TPayload>(
  state: WorkMessageQueueState<TPayload>,
  input: EnqueueWorkMessageInput<TPayload>
): EnqueueWorkMessageResult<TPayload> {
  const id = normalizeKey(input.id, 'Work message id')
  const workId = normalizeKey(input.workId, 'Work id')
  const idempotencyKey = input.idempotencyKey?.trim() || undefined
  const existing = state.messages.find((message) =>
    message.id === id || (idempotencyKey != null && message.idempotencyKey === idempotencyKey)
  )
  if (existing) return { state, message: existing, accepted: false }
  if (state.settledMessageIds?.[id] || (idempotencyKey != null && state.settledIdempotencyKeys?.[idempotencyKey])) {
    const settled = state.messages.find((message) => message.id === id) ?? {
      id,
      workId,
      kind: input.kind,
      sequence: 0,
      enqueuedAt: input.enqueuedAt ?? Date.now(),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      payload: input.payload
    }
    return { state, message: settled, accepted: false }
  }

  const message: WorkQueuedMessage<TPayload> = {
    id,
    workId,
    kind: input.kind,
    sequence: state.nextSequence,
    enqueuedAt: input.enqueuedAt ?? Date.now(),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    payload: input.payload
  }
  return {
    state: {
      ...state,
      nextSequence: state.nextSequence + 1,
      messages: [...state.messages, message]
    },
    message,
    accepted: true
  }
}

function nextMessage<TPayload>(
  state: WorkMessageQueueState<TPayload>,
  workId: string
): WorkQueuedMessage<TPayload> | undefined {
  if (state.activeByWork[workId]) return undefined
  return state.messages
    .filter((message) => message.workId === workId)
    .sort((left, right) => {
      const priority = KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind]
      return priority || left.sequence - right.sequence
    })[0]
}

export function peekNextWorkMessage<TPayload>(
  state: WorkMessageQueueState<TPayload>,
  workId: string
): WorkQueuedMessage<TPayload> | undefined {
  return nextMessage(state, normalizeKey(workId, 'Work id'))
}

/** Claims the next message and marks the work busy until complete/release. */
export function claimNextWorkMessage<TPayload>(
  state: WorkMessageQueueState<TPayload>,
  workId: string
): { state: WorkMessageQueueState<TPayload>; message?: WorkQueuedMessage<TPayload> } {
  const normalizedWorkId = normalizeKey(workId, 'Work id')
  const message = nextMessage(state, normalizedWorkId)
  if (!message) return { state }
  return {
    state: {
      ...state,
      activeByWork: { ...state.activeByWork, [normalizedWorkId]: message.id }
    },
    message
  }
}

/** Removes a successfully delivered message and releases the work lock. */
export function completeWorkMessage<TPayload>(
  state: WorkMessageQueueState<TPayload>,
  workId: string,
  messageId: string
): WorkMessageQueueState<TPayload> {
  const normalizedWorkId = normalizeKey(workId, 'Work id')
  const normalizedMessageId = normalizeKey(messageId, 'Work message id')
  if (state.activeByWork[normalizedWorkId] !== normalizedMessageId) return state
  const completed = state.messages.find((message) => message.id === normalizedMessageId)
  const activeByWork = { ...state.activeByWork }
  delete activeByWork[normalizedWorkId]
  return {
    ...state,
    messages: state.messages.filter((message) => message.id !== normalizedMessageId),
    activeByWork,
    settledMessageIds: { ...state.settledMessageIds, [normalizedMessageId]: true },
    settledIdempotencyKeys: {
      ...state.settledIdempotencyKeys,
      ...(completed?.idempotencyKey ? { [completed.idempotencyKey]: true } : {})
    }
  }
}

/** Releases a message without deleting it so it can be retried after restart. */
export function releaseWorkMessage<TPayload>(
  state: WorkMessageQueueState<TPayload>,
  workId: string,
  messageId: string
): WorkMessageQueueState<TPayload> {
  const normalizedWorkId = normalizeKey(workId, 'Work id')
  const normalizedMessageId = normalizeKey(messageId, 'Work message id')
  if (state.activeByWork[normalizedWorkId] !== normalizedMessageId) return state
  const activeByWork = { ...state.activeByWork }
  delete activeByWork[normalizedWorkId]
  return { ...state, activeByWork }
}

export function workMessageQueueSize<TPayload>(
  state: WorkMessageQueueState<TPayload>,
  workId?: string
): number {
  if (workId == null) return state.messages.length
  const normalizedWorkId = normalizeKey(workId, 'Work id')
  return state.messages.filter((message) => message.workId === normalizedWorkId).length
}
