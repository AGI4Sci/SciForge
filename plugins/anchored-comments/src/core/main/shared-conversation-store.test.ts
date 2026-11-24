import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { atomicWriteSafeStore, MAX_SAFE_STORE_READ_BYTES } from './safe-store.js'
import { describe, expect, it } from 'vitest'
import { SharedConversationStore } from './shared-conversation-store.js'
import { MAX_CODE_CONVERSATION_COMMAND_BYTES } from '@sciforge/collaboration-contracts'

const binding = { baseUrl: 'https://cloud.example.test', userId: 'usr_CodeOwner000001', projectId: 'prj_CodeConversation01' }
const command = { protocolVersion: '1.0', type: 'project.code_conversation.append', requestId: 'req_CodeStore000001',
  idempotencyKey: 'idem_code_store_0001', projectId: binding.projectId, conversationId: 'root',
  message: { messageId: 'm1', kind: 'user', body: 'Hello' } }

describe('durable shared conversation state', () => {
  it('admits exactly the serialized-byte budget and refuses one byte more without replacing durable state', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'shared-code-budget-')))
    try {
      const store = new SharedConversationStore(root)
      const publication = { protocolVersion: '1.0', type: 'project.code_conversation.publish', requestId: command.requestId,
        idempotencyKey: command.idempotencyKey, projectId: binding.projectId, conversationId: 'root',
        anchor: { filePath: 'a.ts', side: 'new', line: 1, hunkHeader: '', code: 'x'.repeat(40_000), baseRevision: 'abc', contentDigest: 'a'.repeat(64) },
        messages: [{ messageId: 'm1', kind: 'user', body: 'x'.repeat(20_000) }, { messageId: 'm2', kind: 'user', body: 'x' }] }
      publication.messages[1].body += 'x'.repeat(MAX_CODE_CONVERSATION_COMMAND_BYTES - Buffer.byteLength(JSON.stringify(publication)))
      expect(Buffer.byteLength(JSON.stringify(publication))).toBe(MAX_CODE_CONVERSATION_COMMAND_BYTES)
      const before = await store.enqueue(binding, publication)
      const oversized = { ...publication, idempotencyKey: publication.idempotencyKey + 'x' }
      await expect(store.enqueue(binding, oversized)).rejects.toThrow(/UTF-8 bytes/)
      expect(await new SharedConversationStore(root).read(binding)).toEqual(before)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('persists bounded exact command outcome receipts across restart', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'shared-code-receipts-')))
    try {
      const store = new SharedConversationStore(root)
      for (let index = 0; index < 102; index++) {
        const next = { ...command, idempotencyKey: `idem_receipt_command_${index}` }
        await store.enqueue(binding, next)
        await store.acknowledge(binding, next.idempotencyKey)
      }
      const state = await new SharedConversationStore(root).read(binding)
      expect(state.outbox).toEqual([])
      expect(state.outcomeReceipts).toHaveLength(100)
      expect(state.outcomeReceipts[0]).toEqual({ idempotencyKey: 'idem_receipt_command_2', outcome: 'acknowledged' })
      expect(state.outcomeReceipts.at(-1)).toEqual({ idempotencyKey: 'idem_receipt_command_101', outcome: 'acknowledged' })
      await expect(store.acknowledge(binding, 'idem_not_pending_command')).rejects.toThrow(/not pending/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('checks serialized UTF-8 capacity before replacing readable projection and recovers command capacity', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'shared-code-capacity-')))
    try {
      const store = new SharedConversationStore(root), at = '2026-11-12T00:00:00.000Z'
      const message = { messageId: 'm1', kind: 'user', body: '界'.repeat(20_000), publishedByUserId: binding.userId, publishedAt: at }
      const conversation = { projectId: binding.projectId, conversationId: 'root', revision: 1, status: 'open',
        createdByUserId: binding.userId, createdAt: at,
        anchor: { filePath: 'a.ts', side: 'new', line: 1, hunkHeader: '', code: 'x', baseRevision: 'abc', contentDigest: 'a'.repeat(64) },
        messages: Array.from({ length: 500 }, (_, index) => ({ ...message, messageId: `m${index}` })) }
      const conversations = [conversation, { ...conversation, anchor: { ...conversation.anchor }, conversationId: 'second', messages: conversation.messages.slice(0, 57) }]
      const initial = { version: 1, binding, afterSequence: 2, conversations, outbox: [], rejectedCommands: [] }
      const padding = MAX_SAFE_STORE_READ_BYTES - Buffer.byteLength(JSON.stringify(initial)) - 1_000
      expect(padding).toBeGreaterThan(0)
      expect(padding).toBeLessThan(79_998)
      conversations[0].anchor.code += 'x'.repeat(Math.min(39_999, padding))
      conversations[1].anchor.code += 'x'.repeat(Math.max(0, padding - 39_999))
      const serialized = JSON.stringify(initial)
      expect(Buffer.byteLength(serialized)).toBeLessThan(MAX_SAFE_STORE_READ_BYTES)
      const path = ['anchored-comments', 'shared', `${createHash('sha256').update(JSON.stringify(binding)).digest('hex')}.json`]
      await atomicWriteSafeStore(root, path, serialized)
      const created = { ...conversation, conversationId: 'third', messages: conversation.messages.slice(0, 32) }
      await expect(store.applyPage(binding, { protocolVersion: '1.0', type: 'rest.code_conversation.page', requestId: command.requestId,
        projectId: binding.projectId, events: [{ projectId: binding.projectId, conversationId: 'third', sequence: 3, revision: 1,
          actorUserId: binding.userId, occurredAt: at, change: { kind: 'created', conversation: created } }], nextSequence: 3, hasMore: false
      })).rejects.toThrow(/exceeds.*previous readable state/)
      expect((await new SharedConversationStore(root).read(binding)).afterSequence).toBe(2)
      const large = { ...command, message: { ...command.message, body: '界'.repeat(20_000) } }
      const recovered = await store.enqueue(binding, large)
      expect(recovered).toMatchObject({ afterSequence: 0, conversations: [], outbox: [large] })
      expect((await new SharedConversationStore(root).read(binding)).outbox).toEqual([large])
      await store.acknowledge(binding, command.idempotencyKey)
      expect((await store.read(binding)).outbox).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('does not persist projection or cursor from an invalid page', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'shared-code-store-')))
    try {
      const store = new SharedConversationStore(root)
      await store.enqueue(binding, command)
      const before = await store.read(binding)
      await expect(store.applyPage(binding, { protocolVersion: '1.0', type: 'rest.code_conversation.page',
        requestId: command.requestId, projectId: binding.projectId, events: [], nextSequence: 5, hasMore: false })).rejects.toThrow(/cursor/iu)
      expect(await new SharedConversationStore(root).read(binding)).toEqual(before)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('retains retry identity across restart and isolates cloud, user and project', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'shared-code-store-')))
    try {
      await new SharedConversationStore(root).enqueue(binding, command)
      const restarted = new SharedConversationStore(root)
      expect((await restarted.read(binding)).outbox).toEqual([command])
      for (const other of [{ ...binding, userId: 'usr_CodeOther000001' },
        { ...binding, baseUrl: 'https://other.example.test' }, { ...binding, projectId: 'prj_CodeDifferent01' }]) {
        expect((await restarted.read(other)).outbox).toEqual([])
      }
      await expect(restarted.enqueue(binding, { ...command, message: { ...command.message, body: 'Changed' } })).rejects.toThrow(/identity/iu)
      await restarted.acknowledge(binding, command.idempotencyKey)
      expect((await new SharedConversationStore(root).read(binding)).outbox).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('serializes concurrent enqueues and refuses cross-project commands', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'shared-code-store-')))
    try {
      const store = new SharedConversationStore(root)
      await Promise.all(Array.from({ length: 8 }, (_, index) => store.enqueue(binding, {
        ...command, idempotencyKey: `idem_code_store_${index}`, message: { ...command.message, messageId: `m${index}` }
      })))
      expect((await store.read(binding)).outbox).toHaveLength(8)
      expect(() => store.enqueue(binding, { ...command, projectId: 'prj_CodeDifferent01' })).toThrow(/project/iu)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
