import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { atomicWriteSafeStore } from './safe-store.js'
import { describe, expect, it } from 'vitest'
import { createCollaborationError, codeConversationCommandSchema, MAX_CODE_CONVERSATION_COMMAND_BYTES } from '@sciforge/collaboration-contracts'
import { SharedConversationStore } from './shared-conversation-store.js'
import { SharedConversationService, type SharedConversationTransport } from './shared-conversation-service.js'

const projectId = 'prj_CodeConversation01'
const ready = { state: 'ready', baseUrl: 'https://cloud.example.test', userId: 'usr_CodeOwner000001', deviceId: 'dev_CodeDevice00001', deviceRevision: 1, sessionGeneration: 'runtime:1' }
const binding = { baseUrl: ready.baseUrl, userId: ready.userId, projectId }
const command = { protocolVersion: '1.0', type: 'project.code_conversation.append', requestId: 'req_CodeSync000001',
  idempotencyKey: 'idem_code_sync_0001', projectId, conversationId: 'root', message: { messageId: 'm1', kind: 'user', body: 'Hello' } }
const at = '2026-11-12T00:00:00.000Z'
const event = { projectId, conversationId: 'root', sequence: 1, revision: 2, actorUserId: ready.userId, occurredAt: at,
  change: { kind: 'message', message: { ...command.message, publishedByUserId: ready.userId, publishedAt: at } } }

async function fixture(work: (store: SharedConversationStore) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'shared-code-service-')))
  try { await work(new SharedConversationStore(root)) } finally { await rm(root, { recursive: true, force: true }) }
}

describe('shared conversation Host transport synchronization', () => {
  it('never exposes or persists arbitrary server error prose as a client diagnostic', async () => fixture(async store => {
    const sentinel = 'SERVER_PRIVATE_SENTINEL token=fixture-sensitive https://user:secret@example.invalid/'
    const error = createCollaborationError('revision_conflict', sentinel, { requestId: command.requestId })
    const service = new SharedConversationService(store, { status: async () => ready, execute: async request => {
      if ((request.payload as { type: string }).type === 'project.code_conversation.pull') return { status: 200, body: {
        protocolVersion: '1.0', type: 'rest.code_conversation.page', requestId: (request.payload as { requestId: string }).requestId,
        projectId, events: [], nextSequence: 0, hasMore: false
      } }
      return { status: error.httpStatus, body: { protocolVersion: '1.0', type: 'rest.error', requestId: command.requestId, error } }
    } })
    const state = await service.submit(projectId, command)
    expect(state.rejectedCommands[0]).toMatchObject({ code: 'revision_conflict', status: error.httpStatus })
    expect(state.outbox).toEqual([command])
    expect(JSON.stringify(state)).not.toContain('SERVER_PRIVATE_SENTINEL')
    expect(JSON.stringify(await store.read(binding))).not.toContain('fixture-sensitive')
  }))
  it.each(['x', '界', '\\'])('refuses oversized serialized %s publication before enqueue or dispatch', async text => fixture(async store => {
    const publication = { protocolVersion: '1.0', type: 'project.code_conversation.publish', requestId: command.requestId,
      idempotencyKey: command.idempotencyKey, projectId, conversationId: 'root',
      anchor: { filePath: 'a.ts', side: 'new', line: 1, hunkHeader: '', code: 'x'.repeat(40_000), baseRevision: 'abc', contentDigest: 'a'.repeat(64) },
      messages: Array.from({ length: 32 }, (_, index) => ({ messageId: `m${index}`, kind: 'user', body: text.repeat(20_000) })) }
    expect(codeConversationCommandSchema.safeParse(publication).success).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(publication))).toBeGreaterThan(MAX_CODE_CONVERSATION_COMMAND_BYTES)
    let calls = 0
    const service = new SharedConversationService(store, { status: async () => ready, execute: async () => { calls++; throw new Error('Unexpected dispatch') } })
    await expect(service.submit(projectId, publication)).rejects.toThrow(/65536 UTF-8 bytes/)
    expect(calls).toBe(0)
    expect(await store.read(binding)).toMatchObject({ outbox: [], rejectedCommands: [], outcomeReceipts: [] })
  }))

  it('retries a committed unacknowledged legacy 70KiB command under its original identity without fabricating rejection', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'shared-code-legacy-')))
    try {
      const store = new SharedConversationStore(root)
      const oversized = { protocolVersion: '1.0', type: 'project.code_conversation.publish', requestId: 'req_LegacyLarge00001',
        idempotencyKey: 'idem_legacy_large_001', projectId, conversationId: 'legacy',
        anchor: { filePath: 'a.ts', side: 'new', line: 1, hunkHeader: '', code: 'x', baseRevision: 'abc', contentDigest: 'a'.repeat(64) },
        messages: Array.from({ length: 4 }, (_, index) => ({ messageId: `m${index}`, kind: 'user', body: 'x'.repeat(18_000) })) }
      const initial = { ...await store.read(binding), afterSequence: 7, outbox: [oversized] }
      await atomicWriteSafeStore(root, ['anchored-comments', 'shared', `${createHash('sha256').update(JSON.stringify(binding)).digest('hex')}.json`], JSON.stringify(initial))
      const calls: unknown[] = []
      let unavailable = true
      const service = new SharedConversationService(store, { status: async () => ready, execute: async request => {
        const payload = request.payload as typeof command
        calls.push(payload)
        if (payload.idempotencyKey === oversized.idempotencyKey) {
          if (unavailable) return { status: 413, body: { type: 'rest.error', error: { code: 'payload_too_large', message: 'Ingress too small' } } }
          // Replay of original committed receipt from larger ingress.
          return { status: 200, body: { protocolVersion: '1.0', type: 'rest.code_conversation.changed', requestId: oversized.requestId,
            event: { ...event, conversationId: 'legacy' } } }
        }
        if (payload.type === 'project.code_conversation.append') return { status: 200, body: { protocolVersion: '1.0',
          type: 'rest.code_conversation.changed', requestId: payload.requestId, event } }
        expect(await store.read(binding)).toMatchObject({ afterSequence: 7, conversations: [] })
        return { status: 200, body: { protocolVersion: '1.0', type: 'rest.code_conversation.page', requestId: payload.requestId,
          projectId, events: [], nextSequence: 7, hasMore: false } }
      } })
      await expect(service.sync(projectId, true)).rejects.toThrow('Cloud shared conversation outcome could not be confirmed.')
      expect(await store.read(binding)).toMatchObject({ outbox: [oversized], rejectedCommands: [], outcomeReceipts: [] })
      await expect(service.discard(projectId, oversized.idempotencyKey)).rejects.toThrow(/Only definitively/)
      unavailable = false
      const state = await service.submit(projectId, oversized)
      expect(calls[0]).toEqual(oversized)
      expect(calls[1]).toEqual(oversized)
      expect(state).toMatchObject({ outbox: [], rejectedCommands: [], conversations: [], afterSequence: 7 })
      expect(state.outcomeReceipts).toEqual([{ idempotencyKey: oversized.idempotencyKey, outcome: 'acknowledged' }])
      expect((await service.submit(projectId, command)).outbox).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it.each(['account', 'same-account session'])('passes preflight fence through the final %s switch without dispatching a write', async kind => fixture(async store => {
    let current = { ...ready }
    let dispatched = 0
    const transport: SharedConversationTransport = {
      status: async () => ({ ...current }),
      execute: async request => {
        // Simulate a new Host invocation capturing B after the plugin preflight.
        current = kind === 'account' ? { ...ready, userId: 'usr_CodeOther000001' }
          : { ...ready, sessionGeneration: 'runtime:2' }
        const { state: _state, ...actual } = current
        expect(request.expectedBinding).toEqual((({ state: _ready, ...binding }) => binding)(ready))
        if (JSON.stringify(request.expectedBinding) !== JSON.stringify(actual)) throw new Error('Cloud Host expected identity binding changed.')
        dispatched++
        throw new Error('Unexpected dispatch')
      }
    }
    await expect(new SharedConversationService(store, transport).submit(projectId, command)).rejects.toThrow(/binding changed/)
    expect(dispatched).toBe(0)
    const pending = await store.read(binding)
    expect(pending.outbox).toHaveLength(1)
    expect(pending.binding).toEqual(binding)
    expect(pending.binding).not.toHaveProperty('expectedBinding')
    expect(pending.binding).not.toHaveProperty('sessionGeneration')
  }))
  it('flushes a submit arriving after a joined worker has started its pull', async () => fixture(async store => {
    let finishPull!: () => void, enteredPull!: () => void
    const pulling = new Promise<void>(resolve => { enteredPull = resolve })
    const heldPull = new Promise<void>(resolve => { finishPull = resolve })
    const mutations: unknown[] = []
    let pulls = 0
    const transport: SharedConversationTransport = { status: async () => ready, execute: async request => {
      const payload = request.payload as typeof command
      if (payload.type === 'project.code_conversation.append') {
        mutations.push(payload)
        return { status: 200, body: { protocolVersion: '1.0', type: 'rest.code_conversation.changed', requestId: payload.requestId, event } }
      }
      if (++pulls === 1) { enteredPull(); await heldPull }
      return { status: 200, body: { protocolVersion: '1.0', type: 'rest.code_conversation.page', requestId: payload.requestId,
        projectId, events: [], nextSequence: 0, hasMore: false } }
    } }
    const service = new SharedConversationService(store, transport)
    const first = service.sync(projectId, true)
    await pulling
    const second = service.submit(projectId, command)
    // Wait until submit's enqueue has completed before releasing the older pull.
    while (!(await store.read(binding)).outbox.length) await new Promise(resolve => setImmediate(resolve))
    finishPull()
    await first
    expect((await second).outbox).toEqual([])
    expect(mutations).toEqual([command])
  }))

  it.each(['revision_conflict', 'payload_too_large', 'expired', 'version_incompatible'] as const)('persists canonical %s rejection, permits later writes, and discards only explicitly rejected commands', async code => fixture(async store => {
    const next = { ...command, requestId: 'req_CodeSync000002', idempotencyKey: 'idem_code_sync_0002' }
    const mutations: unknown[] = []
    const transport: SharedConversationTransport = { status: async () => ready, execute: async request => {
      const payload = request.payload as typeof command
      if (payload.type === 'project.code_conversation.append') {
        mutations.push(payload)
        if (payload.idempotencyKey === command.idempotencyKey) {
          const error = createCollaborationError(code, 'Command rejected', { requestId: payload.requestId })
          return { status: error.httpStatus, body: { protocolVersion: '1.0', type: 'rest.error', requestId: payload.requestId, error } }
        }
        return { status: 200, body: { protocolVersion: '1.0', type: 'rest.code_conversation.changed', requestId: payload.requestId, event } }
      }
      return { status: 200, body: { protocolVersion: '1.0', type: 'rest.code_conversation.page', requestId: payload.requestId,
        projectId, events: [], nextSequence: 0, hasMore: false } }
    } }
    const service = new SharedConversationService(store, transport)
    const rejected = await service.submit(projectId, command)
    expect(rejected.rejectedCommands).toEqual([{ idempotencyKey: command.idempotencyKey, conversationId: 'root',
      status: createCollaborationError(code, 'Command rejected').httpStatus, code, message: 'Cloud rejected the shared conversation operation. Refresh and check your access before retrying.' }])
    expect(rejected.outcomeReceipts).toEqual([{ idempotencyKey: command.idempotencyKey, outcome: 'rejected' }])
    expect((await service.submit(projectId, next)).outbox).toEqual([command])
    expect(mutations).toEqual([command, next])
    const discarded = await service.discard(projectId, command.idempotencyKey)
    expect(discarded.outbox).toEqual([])
    expect(discarded.outcomeReceipts).toContainEqual({ idempotencyKey: next.idempotencyKey, outcome: 'acknowledged' })
    await store.enqueue(binding, command)
    await expect(service.discard(projectId, command.idempotencyKey)).rejects.toThrow(/Only definitively/)
  }))

  it.each([408, 429, 500])('keeps status %s retry identity uncertain and refuses discard', async status => fixture(async store => {
    const transport: SharedConversationTransport = { status: async () => ready, execute: async () => ({ status,
      body: { type: 'rest.error', requestId: command.requestId, error: { code: 'unavailable', message: 'Try later' } } }) }
    const service = new SharedConversationService(store, transport)
    await expect(service.submit(projectId, command)).rejects.toThrow('Cloud shared conversation outcome could not be confirmed.')
    expect(await store.read(binding)).toMatchObject({ outbox: [command], rejectedCommands: [] })
    await expect(service.discard(projectId, command.idempotencyKey)).rejects.toThrow(/Only definitively/)
  }))

  it('does not classify an uncorrelated conflict as a discardable rejection', async () => fixture(async store => {
    const transport: SharedConversationTransport = { status: async () => ready, execute: async () => ({ status: 409,
      body: { type: 'rest.error', requestId: 'req_CodeWrong000001', error: { code: 'conflict', message: 'Uncorrelated conflict' } } }) }
    const service = new SharedConversationService(store, transport)
    await expect(service.submit(projectId, command)).rejects.toThrow('Cloud shared conversation outcome could not be confirmed.')
    expect(await store.read(binding)).toMatchObject({ outbox: [command], rejectedCommands: [] })
    await expect(service.discard(projectId, command.idempotencyKey)).rejects.toThrow(/Only definitively/)
  }))

  it('does not allow malformed canonical errors or mismatched HTTP status to discard a command', async () => fixture(async store => {
    const error = createCollaborationError('payload_too_large', 'Too large', { requestId: command.requestId })
    for (const response of [
      { status: 413, body: { protocolVersion: '1.0', type: 'rest.error', requestId: command.requestId, error: { ...error, retryable: true } } },
      { status: 409, body: { protocolVersion: '1.0', type: 'rest.error', requestId: command.requestId, error } }
    ]) {
      const service = new SharedConversationService(store, { status: async () => ready, execute: async () => response })
      await expect(service.submit(projectId, command)).rejects.toThrow('Cloud shared conversation outcome could not be confirmed.')
      expect(await store.read(binding)).toMatchObject({ outbox: [command], rejectedCommands: [], outcomeReceipts: [] })
    }
  }))

  it.each(['rate_limited', 'provider_unavailable', 'internal_error'] as const)('preserves immutable retry identity for canonical %s', async code => fixture(async store => {
    const calls: unknown[] = []
    const error = createCollaborationError(code, 'Try later', { requestId: command.requestId })
    const service = new SharedConversationService(store, { status: async () => ready, execute: async request => {
      calls.push(request.payload)
      return { status: error.httpStatus, body: { protocolVersion: '1.0', type: 'rest.error', requestId: command.requestId, error } }
    } })
    await expect(service.submit(projectId, command)).rejects.toThrow('Cloud shared conversation outcome could not be confirmed.')
    await expect(service.sync(projectId, true)).rejects.toThrow('Cloud shared conversation outcome could not be confirmed.')
    expect(calls).toEqual([command, command])
    expect(await store.read(binding)).toMatchObject({ outbox: [command], rejectedCommands: [], outcomeReceipts: [] })
  }))

  it.each(['request', 'project', 'conversation'])('retains commands for mismatched %s response', async mismatch => fixture(async store => {
    const transport: SharedConversationTransport = { status: async () => ready, execute: async () => ({ status: 200,
      body: { protocolVersion: '1.0', type: 'rest.code_conversation.changed', requestId: mismatch === 'request' ? 'req_CodeWrong000001' : command.requestId,
        event: { ...event, projectId: mismatch === 'project' ? 'prj_CodeWrong000001' : projectId,
          conversationId: mismatch === 'conversation' ? 'other' : 'root' } } }) }
    await expect(new SharedConversationService(store, transport).submit(projectId, command)).rejects.toThrow(/mismatch/iu)
    expect((await store.read(binding)).outbox).toEqual([command])
  }))

  it('retries unchanged mutation after lost acknowledgment', async () => fixture(async store => {
    const calls: unknown[] = []
    const transport: SharedConversationTransport = { status: async () => ready, execute: async request => {
      calls.push(request.payload)
      throw new Error('offline')
    } }
    await expect(new SharedConversationService(store, transport).submit(projectId, command)).rejects.toThrow('offline')
    await expect(new SharedConversationService(store, transport).sync(projectId, true)).rejects.toThrow('offline')
    expect(calls).toEqual([command, command])
    expect((await store.read(binding)).outbox).toEqual([command])
  }))

  it('rejects account switches before persisting late pages', async () => fixture(async store => {
    let status = ready
    const transport: SharedConversationTransport = { status: async () => status, execute: async request => {
      status = { ...ready, userId: 'usr_CodeOther000001' }
      return { status: 200, body: { protocolVersion: '1.0', type: 'rest.code_conversation.page',
        requestId: (request.payload as { requestId: string }).requestId, projectId, events: [], nextSequence: 0, hasMore: false } }
    } }
    await expect(new SharedConversationService(store, transport).sync(projectId)).rejects.toThrow(/identity/iu)
    expect((await store.read(binding)).afterSequence).toBe(0)
  }))

  it('rejects cross-project mutations before dispatch', async () => fixture(async store => {
    let calls = 0
    const transport: SharedConversationTransport = { status: async () => ready, execute: async () => { calls++; throw new Error('unexpected') } }
    await expect(new SharedConversationService(store, transport).submit(projectId, { ...command, projectId: 'prj_CodeWrong000001' })).rejects.toThrow(/Project/iu)
    expect(calls).toBe(0)
    expect((await store.read(binding)).outbox).toEqual([])
  }))

  it('read refresh never flushes the durable mutation queue', async () => fixture(async store => {
    await store.enqueue(binding, command)
    const calls: unknown[] = []
    const transport: SharedConversationTransport = { status: async () => ready, execute: async request => {
      const payload = request.payload as { type: string; requestId: string }
      calls.push(payload.type)
      return { status: 200, body: { protocolVersion: '1.0', type: 'rest.code_conversation.page', requestId: payload.requestId,
        projectId, events: [], nextSequence: 0, hasMore: false } }
    } }
    const state = await new SharedConversationService(store, transport).sync(projectId)
    expect(calls).toEqual(['project.code_conversation.pull'])
    expect(state.outbox).toEqual([command])
  }))

  it('pulls an authoritative publication and clears projection on membership denial', async () => fixture(async store => {
    const conversation = { projectId, conversationId: 'root', revision: 1, status: 'open', createdByUserId: ready.userId,
      createdAt: at, anchor: { filePath: 'a.ts', side: 'new', line: 1, hunkHeader: '', code: 'x', baseRevision: 'abc', contentDigest: 'a'.repeat(64) },
      messages: [{ ...command.message, publishedByUserId: ready.userId, publishedAt: at }] }
    let denied = false
    const transport: SharedConversationTransport = { status: async () => ready, execute: async request => {
      if (denied) return { status: 403, body: { type: 'rest.error', error: { code: 'permission_denied', message: 'Membership removed' } } }
      return { status: 200, body: { protocolVersion: '1.0', type: 'rest.code_conversation.page',
        requestId: (request.payload as { requestId: string }).requestId, projectId, nextSequence: 1, hasMore: false,
        events: [{ ...event, revision: 1, change: { kind: 'created', conversation } }] } }
    } }
    const service = new SharedConversationService(store, transport)
    expect((await service.sync(projectId)).conversations).toEqual([conversation])
    denied = true
    await expect(service.sync(projectId)).rejects.toThrow('Cloud shared conversation outcome could not be confirmed.')
    expect(await store.read(binding)).toMatchObject({ conversations: [], afterSequence: 0 })
  }))

  it('keeps revoked project projection and uncertain retry identities isolated across a cold store reopen', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'shared-project-revocation-')))
    try {
      let store = new SharedConversationStore(root)
      const otherProject = 'prj_CodeOther000001'
      const otherBinding = { ...binding, projectId: otherProject }
      const otherCommand = { ...command, projectId: otherProject }
      // Identical request/idempotency identities in different projects must never share a queue.
      await store.enqueue(binding, command)
      await store.enqueue(otherBinding, otherCommand)
      for (const target of [binding, otherBinding]) {
        const conversation = { projectId: target.projectId, conversationId: 'root', revision: 1, status: 'open', createdByUserId: ready.userId,
          createdAt: at, anchor: { filePath: 'a.ts', side: 'new', line: 1, hunkHeader: '', code: 'x', baseRevision: 'abc', contentDigest: 'a'.repeat(64) },
          messages: [{ ...command.message, publishedByUserId: ready.userId, publishedAt: at }] }
        await store.applyPage(target, { protocolVersion: '1.0', type: 'rest.code_conversation.page', requestId: command.requestId,
          projectId: target.projectId, nextSequence: 1, hasMore: false,
          events: [{ ...event, projectId: target.projectId, revision: 1, change: { kind: 'created', conversation } }] })
      }
      const beforeOther = await store.read(otherBinding)
      const calls: unknown[] = []
      const transport: SharedConversationTransport = { status: async () => ready, execute: async request => {
        calls.push(request.payload)
        return { status: 403, body: { type: 'rest.error', error: { code: 'permission_denied', message: 'Membership removed' } } }
      } }
      await expect(new SharedConversationService(store, transport).sync(projectId, true)).rejects.toThrow('Cloud shared conversation outcome could not be confirmed.')
      store = new SharedConversationStore(root)
      expect(await store.read(otherBinding)).toEqual(beforeOther)
      expect(await store.read(binding)).toMatchObject({ conversations: [], afterSequence: 0, outbox: [command], rejectedCommands: [] })
      await expect(new SharedConversationService(store, transport).sync(projectId, true)).rejects.toThrow('Cloud shared conversation outcome could not be confirmed.')
      expect(calls).toEqual([command, command])
      expect(await store.read(otherBinding)).toEqual(beforeOther)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('fences disposed services after awaiting Host status', async () => fixture(async store => {
    let service: SharedConversationService
    const transport: SharedConversationTransport = { status: async () => { service.dispose(); return ready }, execute: async () => { throw new Error('unexpected') } }
    service = new SharedConversationService(store, transport)
    await expect(service.sync(projectId)).rejects.toThrow(/lifecycle/iu)
  }))
})
