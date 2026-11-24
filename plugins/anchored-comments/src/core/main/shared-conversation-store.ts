import { createHash } from 'node:crypto'
import { z } from 'zod'
import { codeConversationCommandSchema, codeConversationSchema, projectIdSchema, userIdSchema,
  codeConversationCommandByteLength, MAX_CODE_CONVERSATION_COMMAND_BYTES } from '@sciforge/collaboration-contracts'
import { sharedConversationRejectionSchema, sharedConversationOutcomeReceiptSchema } from '../contract.js'
import { atomicWriteSafeStore, readSafeStoreText, MAX_SAFE_STORE_READ_BYTES } from './safe-store.js'
import { applySharedConversationPage } from './shared-conversation-sync.js'

export const sharedConversationBindingSchema = z.object({
  baseUrl: z.url().max(2_048), userId: userIdSchema, projectId: projectIdSchema
}).strict()
export type SharedConversationBinding = z.infer<typeof sharedConversationBindingSchema>
const mutationSchema = codeConversationCommandSchema.refine(command => command.type !== 'project.code_conversation.pull')
const stateSchema = z.object({
  version: z.literal(1), binding: sharedConversationBindingSchema,
  afterSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  conversations: z.array(codeConversationSchema), outbox: z.array(mutationSchema).max(100),
  rejectedCommands: z.array(sharedConversationRejectionSchema).max(100).default([]),
  outcomeReceipts: z.array(sharedConversationOutcomeReceiptSchema).max(100).default([])
}).strict()
export type SharedConversationState = z.infer<typeof stateSchema>

/** Persist pending commands and authoritative projection/cursor in one atomic document. */
export class SharedConversationStore {
  private readonly pending = new Map<string, Promise<unknown>>()
  constructor(private readonly root: string) {}

  private path(binding: SharedConversationBinding): string[] {
    return ['anchored-comments', 'shared', `${createHash('sha256').update(JSON.stringify(binding)).digest('hex')}.json`]
  }

  async read(rawBinding: SharedConversationBinding): Promise<SharedConversationState> {
    const binding = sharedConversationBindingSchema.parse(rawBinding)
    try {
      const state = stateSchema.parse(JSON.parse(await readSafeStoreText(this.root, this.path(binding))))
      if (JSON.stringify(state.binding) !== JSON.stringify(binding)) throw new Error('Shared identity binding mismatch.')
      return state
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return { version: 1, binding, afterSequence: 0, conversations: [], outbox: [], rejectedCommands: [], outcomeReceipts: [] }
    }
  }

  private update(binding: SharedConversationBinding, work: (state: SharedConversationState) => void, recoverProjection = false): Promise<SharedConversationState> {
    const parsed = sharedConversationBindingSchema.parse(binding)
    const key = JSON.stringify(parsed)
    const next = (this.pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const state = await this.read(parsed)
      work(state)
      const checked = stateSchema.parse(state)
      let serialized = JSON.stringify(checked)
      // Projection is rebuildable; durable command identities must remain recoverable
      // even when the cache has consumed all available document capacity.
      if (Buffer.byteLength(serialized, 'utf8') > MAX_SAFE_STORE_READ_BYTES && recoverProjection) {
        checked.conversations = []; checked.afterSequence = 0
        serialized = JSON.stringify(checked)
      }
      if (Buffer.byteLength(serialized, 'utf8') > MAX_SAFE_STORE_READ_BYTES) {
        throw new Error(`Shared conversation state exceeds ${MAX_SAFE_STORE_READ_BYTES} bytes; previous readable state preserved.`)
      }
      await atomicWriteSafeStore(this.root, this.path(parsed), serialized)
      return checked
    })
    this.pending.set(key, next)
    void next.finally(() => { if (this.pending.get(key) === next) this.pending.delete(key) }).catch(() => undefined)
    return next
  }

  enqueue(binding: SharedConversationBinding, raw: unknown): Promise<SharedConversationState> {
    const command = mutationSchema.parse(raw)
    if (command.projectId !== binding.projectId) throw new Error('Shared command Project mismatch.')
    return this.update(binding, state => {
      const existing = state.outbox.find(item => 'idempotencyKey' in item && item.idempotencyKey === command.idempotencyKey)
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(command)) throw new Error('Pending command identity already addresses different content.')
      } else {
        if (codeConversationCommandByteLength(command) > MAX_CODE_CONVERSATION_COMMAND_BYTES) {
          throw new Error(`Shared conversation command exceeds ${MAX_CODE_CONVERSATION_COMMAND_BYTES} UTF-8 bytes. Select fewer messages or shorten content before submitting.`)
        }
        state.outbox.push(command)
      }
    }, true)
  }

  reject(binding: SharedConversationBinding, rejection: z.infer<typeof sharedConversationRejectionSchema>): Promise<SharedConversationState> {
    const checked = sharedConversationRejectionSchema.parse(rejection)
    return this.update(binding, state => {
      if (!state.outbox.some(command => command.idempotencyKey === checked.idempotencyKey && command.conversationId === checked.conversationId)) {
        throw new Error('Rejected command is not pending.')
      }
      if (!state.rejectedCommands.some(item => item.idempotencyKey === checked.idempotencyKey)) state.rejectedCommands.push(checked)
      state.outcomeReceipts = [...state.outcomeReceipts.filter(item => item.idempotencyKey !== checked.idempotencyKey),
        { idempotencyKey: checked.idempotencyKey, outcome: 'rejected' }].slice(-100) as SharedConversationState['outcomeReceipts']
    }, true)
  }

  discard(binding: SharedConversationBinding, idempotencyKey: string): Promise<SharedConversationState> {
    return this.update(binding, state => {
      if (!state.rejectedCommands.some(item => item.idempotencyKey === idempotencyKey)) throw new Error('Only definitively rejected commands may be discarded.')
      state.outbox = state.outbox.filter(command => command.idempotencyKey !== idempotencyKey)
      state.rejectedCommands = state.rejectedCommands.filter(item => item.idempotencyKey !== idempotencyKey)
    })
  }

  acknowledge(binding: SharedConversationBinding, idempotencyKey: string): Promise<SharedConversationState> {
    return this.update(binding, state => {
      if (!state.outbox.some(command => command.idempotencyKey === idempotencyKey)) throw new Error('Acknowledged command is not pending.')
      state.outbox = state.outbox.filter(command => !('idempotencyKey' in command) || command.idempotencyKey !== idempotencyKey)
      state.outcomeReceipts = [...state.outcomeReceipts.filter(item => item.idempotencyKey !== idempotencyKey),
        { idempotencyKey, outcome: 'acknowledged' }].slice(-100) as SharedConversationState['outcomeReceipts']
    }, true)
  }

  applyPage(binding: SharedConversationBinding, raw: unknown): Promise<SharedConversationState> {
    return this.update(binding, state => {
      const next = applySharedConversationPage({
        projectId: state.binding.projectId,
        afterSequence: state.afterSequence,
        conversations: state.conversations
      }, raw)
      state.afterSequence = next.afterSequence
      state.conversations = [...next.conversations]
    })
  }

  clearProjection(binding: SharedConversationBinding): Promise<SharedConversationState> {
    return this.update(binding, state => { state.afterSequence = 0; state.conversations = [] })
  }
}
