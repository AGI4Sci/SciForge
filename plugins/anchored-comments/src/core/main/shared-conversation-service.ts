import { randomUUID } from 'node:crypto'
import { codeConversationCommandSchema, codeConversationMutationResponseSchema, codeConversationPageResponseSchema, projectIdSchema, restProjectPageResponseSchema, restResponseSchema,
  codeConversationCommandByteLength, MAX_CODE_CONVERSATION_COMMAND_BYTES } from '@sciforge/collaboration-contracts'
import { SharedConversationStore, type SharedConversationBinding, type SharedConversationState } from './shared-conversation-store.js'
import { cloudIdentityBindingSchema, type CloudIdentityBinding } from '../../ports/cloud.js'

class DefinitiveRejection extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}
type InvocationBinding = Readonly<{ persistent: SharedConversationBinding; expectedBinding: CloudIdentityBinding }>

/** Public Host client only; Identity owns credentials and authenticated dispatch. */
export type SharedConversationTransport = Readonly<{
  status(): Promise<Readonly<{ state: string; baseUrl?: string; userId?: string; deviceId?: string; deviceRevision?: number; sessionGeneration?: string }>>
  execute(input: Readonly<{ contractVersion: 1; operationId: 'sciforge.cloud.command'; payload: unknown; expectedBinding: CloudIdentityBinding }>): Promise<Readonly<{ status: number; body: unknown }>>
}>

export class SharedConversationService {
  private readonly pending = new Map<string, Promise<SharedConversationState>>()
  private disposed = false
  constructor(private readonly store: SharedConversationStore, private readonly transport: SharedConversationTransport) {}

  dispose(): void { this.disposed = true }

  async projects(cursor?: string) {
    const identity = await this.identity()
    const requestId = `req_${randomUUID().replaceAll('-', '')}`
    const response = await this.transport.execute({ contractVersion: 1, operationId: 'sciforge.cloud.command',
      expectedBinding: identity,
      payload: { protocolVersion: '1.0', type: 'project.list', requestId, limit: 100, ...(cursor ? { cursor } : {}) } })
    if (JSON.stringify(await this.identity()) !== JSON.stringify(identity)) throw new Error('Shared conversation identity changed.')
    if (response.status < 200 || response.status >= 300) throw new Error('Project discovery failed. Check sign-in and membership.')
    const page = restProjectPageResponseSchema.parse(response.body)
    if (page.requestId !== requestId || page.cursor !== cursor || page.limit !== 100) throw new Error('Project discovery response identity mismatch.')
    return page
  }

  private async identity() {
    if (this.disposed) throw new Error('Shared conversation lifecycle ended.')
    const status = await this.transport.status()
    if (this.disposed) throw new Error('Shared conversation lifecycle ended.')
    if (status.state !== 'ready' || !status.baseUrl || !status.userId) throw new Error('Sign in and register this device to share conversations.')
    const { state: _state, ...binding } = status
    return cloudIdentityBindingSchema.parse(binding)
  }

  private async binding(projectId: string): Promise<InvocationBinding> {
    const expectedBinding = await this.identity()
    return { persistent: { baseUrl: expectedBinding.baseUrl, userId: expectedBinding.userId, projectId: projectIdSchema.parse(projectId) }, expectedBinding }
  }

  private async assertBinding(binding: InvocationBinding): Promise<void> {
    if (JSON.stringify(await this.identity()) !== JSON.stringify(binding.expectedBinding)) throw new Error('Shared conversation identity changed. Refresh before continuing.')
  }

  async submit(projectId: string, raw: unknown): Promise<SharedConversationState> {
    const binding = await this.binding(projectId)
    const command = codeConversationCommandSchema.parse(raw)
    if (command.type === 'project.code_conversation.pull') throw new Error('Shared writes require a mutation.')
    await this.store.enqueue(binding.persistent, command)
    await this.assertBinding(binding)
    // A joined flush may already be pulling after it drained its queue. Wait for
    // our own command, not merely for whichever worker happened to be running.
    for (;;) {
      await this.sync(projectId, true)
      await this.assertBinding(binding)
      const state = await this.store.read(binding.persistent)
      if (!state.outbox.some(item => item.idempotencyKey === command.idempotencyKey) ||
          state.rejectedCommands.some(item => item.idempotencyKey === command.idempotencyKey)) return state
      await this.assertBinding(binding)
    }
  }

  async discard(projectId: string, idempotencyKey: string): Promise<SharedConversationState> {
    const binding = await this.binding(projectId)
    await this.assertBinding(binding)
    return this.store.discard(binding.persistent, idempotencyKey)
  }

  async sync(projectId: string, flushPending = false): Promise<SharedConversationState> {
    const binding = await this.binding(projectId)
    const key = `${JSON.stringify(binding)}:${flushPending}`
    const running = this.pending.get(key)
    if (running) return running
    const work = this.synchronize(binding, flushPending)
    this.pending.set(key, work)
    try { return await work } finally { if (this.pending.get(key) === work) this.pending.delete(key) }
  }

  private async synchronize(binding: InvocationBinding, flushPending: boolean): Promise<SharedConversationState> {
    const execute = async (payload: ReturnType<typeof codeConversationCommandSchema.parse>) => {
      await this.assertBinding(binding)
      const response = await this.transport.execute({ contractVersion: 1, operationId: 'sciforge.cloud.command', payload, expectedBinding: binding.expectedBinding })
      await this.assertBinding(binding)
      const body = response.body as { type?: string; requestId?: string; error?: { code?: string; message?: string } }
      if (response.status < 200 || response.status >= 300 || body.type === 'rest.error') {
        if (response.status === 401 || response.status === 403 || body.error?.code === 'permission_denied') await this.store.clearProjection(binding.persistent)
        const parsed = restResponseSchema.safeParse(response.body)
        if (parsed.success && parsed.data.type === 'rest.error' && parsed.data.requestId === payload.requestId &&
            (!parsed.data.error.requestId || parsed.data.error.requestId === payload.requestId) &&
            parsed.data.error.httpStatus === response.status &&
            (!parsed.data.error.retryable || parsed.data.error.code === 'revision_conflict') &&
            !(parsed.data.error.code === 'payload_too_large' && codeConversationCommandByteLength(payload) > MAX_CODE_CONVERSATION_COMMAND_BYTES)) {
          throw new DefinitiveRejection(response.status, parsed.data.error.code, 'Cloud rejected the shared conversation operation. Refresh and check your access before retrying.')
        }
        throw new Error('Cloud shared conversation outcome could not be confirmed. Retry only the original operation after checking access.')
      }
      if (body.requestId !== payload.requestId) throw new Error('Shared response request identity mismatch.')
      return body
    }
    for (; flushPending;) {
      const state = await this.store.read(binding.persistent)
      const command = state.outbox.find(item => !state.rejectedCommands.some(rejected => rejected.idempotencyKey === item.idempotencyKey))
      if (!command) break
      let response
      try { response = codeConversationMutationResponseSchema.parse(await execute(command)) }
      catch (error) {
        if (!(error instanceof DefinitiveRejection)) throw error
        await this.store.reject(binding.persistent, { idempotencyKey: command.idempotencyKey, conversationId: command.conversationId,
          status: error.status, code: error.code.slice(0, 256), message: error.message.slice(0, 2_000) })
        continue
      }
      if (response.event.projectId !== binding.persistent.projectId || response.event.conversationId !== command.conversationId) throw new Error('Shared mutation response target mismatch.')
      await this.assertBinding(binding)
      await this.store.acknowledge(binding.persistent, command.idempotencyKey)
    }
    for (let count = 0; count < 100; count++) {
      const state = await this.store.read(binding.persistent)
      const page = codeConversationPageResponseSchema.parse(await execute({ protocolVersion: '1.0',
        type: 'project.code_conversation.pull', requestId: `req_${randomUUID().replaceAll('-', '')}`,
        projectId: binding.persistent.projectId, afterSequence: state.afterSequence, limit: 100 }))
      await this.assertBinding(binding)
      const next = await this.store.applyPage(binding.persistent, page)
      if (!page.hasMore) return next
      if (next.afterSequence <= state.afterSequence) throw new Error('Shared synchronization made no progress.')
    }
    throw new Error('Shared conversation synchronization page limit reached; retry to continue.')
  }
}
