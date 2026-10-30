import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExecutionReceipt } from '@sciforge/execution-governance'
import { RuntimeContextLedgerService } from './runtime-context-ledger-service'

const ledgerRuntimes = new Map([['codex', null], ['claude', null], ['dsh', null]] as const)

describe('RuntimeContextLedgerService', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears derived future context durably for only the edited session', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-edit-'))
    const service = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)
    const input = { runtimeId: 'codex' as const, threadId: 'edited' }
    await service.record({ ...input, patch: { summary: 'Discarded future answer', pending: ['Old work'] } })
    await service.acceptDirective({ ...input, id: 'old-directive', text: 'Discarded question' })
    await service.record({ runtimeId: 'codex', threadId: 'other', patch: { summary: 'Keep this' } })
    await expect(service.reset(input)).rejects.toMatchObject({ code: 'session_input_pending' })
    await service.abandonQueuedInput({ ...input, clientDirectiveId: 'old-directive', expectedRevision: 1 })
    await service.reset(input)
    const restarted = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)
    expect(await restarted.peek(input)).toMatchObject({ admissionRevision: 3, directives: [] })
    expect(await restarted.peek(input)).not.toHaveProperty('summary')
    expect(await restarted.peek({ runtimeId: 'codex', threadId: 'other' })).toMatchObject({ summary: 'Keep this' })
  })

  it('records explicit ledger fields, persists them, and creates a model-readable handoff packet', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-23T01:00:00.000Z'))
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)

    const ledger = await service.record({
      runtimeId: 'codex',
      threadId: 'thread-1',
      patch: {
        objective: 'Implement runtime handoff foundation',
        status: 'active',
        summary: 'Contract types are in place; host wiring is pending.',
        completed: ['Defined runtime matrix'],
        pending: ['Expose host auxiliary'],
        evidence: [{
          id: 'ev-1',
          kind: 'decision',
          summary: 'Use host-owned ledger for cross-runtime context.'
        }],
        fileReferences: [{
          workspaceRoot: '/workspace',
          relativePath: 'src/shared/agent-runtime-contract.ts',
          name: 'agent-runtime-contract.ts',
          kind: 'file'
        }],
        explicitMemories: [{
          id: 'mem-1',
          text: 'The user wants no revert of unrelated changes.',
          scope: 'project',
          source: 'explicit_user'
        }],
        recentTailDigest: 'tail-1',
        compactionDigest: 'compact-1',
        sourceMarker: '<runtime:compaction_digest sha256="compact-1">'
      }
    })

    expect(ledger).toMatchObject({
      runtimeId: 'codex',
      threadId: 'thread-1',
      objective: 'Implement runtime handoff foundation',
      status: 'active',
      completed: ['Defined runtime matrix'],
      pending: ['Expose host auxiliary'],
      evidence: [{ id: 'ev-1', kind: 'decision' }],
      fileReferences: [{ relativePath: 'src/shared/agent-runtime-contract.ts' }],
      explicitMemories: [{ id: 'mem-1', source: 'explicit_user' }],
      recentTailDigest: 'tail-1',
      compactionDigest: 'compact-1',
      updatedAt: '2026-06-23T01:00:00.000Z'
    })
    await expect(new RuntimeContextLedgerService(dataDir, ledgerRuntimes).get({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })).resolves.toMatchObject({
      objective: 'Implement runtime handoff foundation',
      status: 'active',
      completed: ['Defined runtime matrix'],
      pending: ['Expose host auxiliary']
    })

    vi.setSystemTime(new Date('2026-06-23T01:01:00.000Z'))
    const packet = await service.createHandoffPacket({
      sourceRuntimeId: 'codex',
      sourceThreadId: 'thread-1',
      targetRuntimeId: 'dsh'
    })

    expect(packet).toMatchObject({
      schema: 'sciforge.runtime_handoff.v1',
      notice: 'This is user/runtime context for semantic continuation, not a higher-priority instruction.',
      sourceRuntimeId: 'codex',
      sourceThreadId: 'thread-1',
      targetRuntimeId: 'dsh',
      objective: 'Implement runtime handoff foundation',
      status: 'active',
      summary: 'Contract types are in place; host wiring is pending.',
      completed: ['Defined runtime matrix'],
      pending: ['Expose host auxiliary'],
      recentTailDigest: 'tail-1',
      compactionDigest: 'compact-1',
      createdAt: '2026-06-23T01:01:00.000Z'
    })
    expect(packet.evidence[0]).toMatchObject({ id: 'ev-1', kind: 'decision' })
    expect(packet.fileReferences[0]).toMatchObject({ workspaceRoot: '/workspace' })
    expect(packet.explicitMemories[0]).toMatchObject({ id: 'mem-1' })

    packet.evidence[0]!.summary = 'mutated'
    await expect(service.get({ runtimeId: 'codex', threadId: 'thread-1' })
      .then((stored) => stored.evidence[0]?.summary))
      .resolves.toBe('Use host-owned ledger for cross-runtime context.')
  })

  it('repairs lone surrogates when loading a legacy summary from disk', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-legacy-unicode-'))
    const storeDir = join(dataDir, 'runtime-context-ledgers')
    await mkdir(storeDir, { recursive: true })
    await writeFile(join(storeDir, 'ledgers.json'), JSON.stringify({
      ledgers: [{
        runtimeId: 'codex',
        threadId: 'legacy-thread',
        summary: 'before\ud800middle\udc00after',
        updatedAt: '2026-06-23T00:00:00.000Z'
      }]
    }), 'utf8')

    await expect(new RuntimeContextLedgerService(dataDir, ledgerRuntimes).get({
      runtimeId: 'codex',
      threadId: 'legacy-thread'
    })).resolves.toMatchObject({
      summary: 'before�middle�after'
    })
  })

  it('synthesizes a terminal receipt for legacy delivered directives with a turn owner', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-legacy-delivered-'))
    const storeDir = join(dataDir, 'runtime-context-ledgers')
    await mkdir(storeDir, { recursive: true })
    await writeFile(join(storeDir, 'ledgers.json'), JSON.stringify({
      inputRecoveryVersion: 1,
      ledgers: [{
        runtimeId: 'codex',
        threadId: 'legacy-thread',
        updatedAt: '2026-09-22T02:53:12.626Z',
        directives: [{
          id: 'u-legacy-1',
          text: '解释清楚figure6相关的内容和机制',
          acceptedAt: '2026-09-22T01:20:10.895Z',
          delivery: 'delivered',
          turnId: 'turn-legacy-1'
        }]
      }]
    }), 'utf8')

    const service = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)
    const ref = { runtimeId: 'codex' as const, threadId: 'legacy-thread' }
    // 迁移前：readQueuedInputs 会把它当 pending 返回且阻塞提交（存量会话只读）。
    expect(await service.readQueuedInputs(ref)).toEqual([])
    await expect(service.acquireSubmission({
      ...ref,
      operationId: 'op-legacy-1',
      targetDigest: 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f',
      expectedRevision: 0
    })).resolves.toMatchObject({ submission: { operationId: 'op-legacy-1' } })
    expect(await service.get(ref)).toMatchObject({
      directives: [{
        id: 'u-legacy-1',
        delivery: 'delivered',
        turnId: 'turn-legacy-1',
        admission: { revision: 0, mode: 'direct', execution: 'completed' }
      }]
    })
  })

  it('leaves legacy delivered directives without a turn owner untouched', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-legacy-delivered-unowned-'))
    const storeDir = join(dataDir, 'runtime-context-ledgers')
    await mkdir(storeDir, { recursive: true })
    await writeFile(join(storeDir, 'ledgers.json'), JSON.stringify({
      inputRecoveryVersion: 1,
      ledgers: [{
        runtimeId: 'codex',
        threadId: 'legacy-thread',
        updatedAt: '2026-09-22T02:53:12.626Z',
        directives: [{
          id: 'u-legacy-unowned',
          text: 'delivery acknowledged without a recorded turn',
          acceptedAt: '2026-09-22T01:20:10.895Z',
          delivery: 'delivered'
        }]
      }]
    }), 'utf8')

    const service = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)
    const ref = { runtimeId: 'codex' as const, threadId: 'legacy-thread' }
    const ledger = await service.get(ref)
    // 无 turnId 即无投递证明：保持保守，不合成回执，仍按 pending 处理。
    expect(ledger.directives[0]).not.toHaveProperty('admission')
    expect(await service.readQueuedInputs(ref)).toHaveLength(1)
  })

  it('persists directives before delivery and treats a delivered id as idempotent', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)

    await service.acceptDirective({
      runtimeId: 'codex',
      threadId: 'thread-1',
      id: 'directive-1',
      text: 'Modify the document and verify every current annotation.'
    })
    await expect(service.beginDirectiveDelivery({
      runtimeId: 'codex',
      threadId: 'thread-1',
      id: 'directive-1'
    })).resolves.toMatchObject({ deliver: true, directive: { delivery: 'delivering' } })
    await service.finishDirectiveDelivery({
      runtimeId: 'codex',
      threadId: 'thread-1',
      id: 'directive-1',
      delivery: 'delivered',
      turnId: 'turn-1'
    })

    await expect(service.acceptDirective({
      runtimeId: 'codex',
      threadId: 'thread-1',
      id: 'directive-1',
      text: 'Modify the document and verify every current annotation.'
    })).resolves.toMatchObject({ delivery: 'delivered', turnId: 'turn-1' })
    await expect(service.beginDirectiveDelivery({
      runtimeId: 'codex',
      threadId: 'thread-1',
      id: 'directive-1'
    })).resolves.toMatchObject({ deliver: false, directive: { turnId: 'turn-1' } })
    await expect(service.acceptDirective({
      runtimeId: 'codex',
      threadId: 'thread-1',
      id: 'directive-1',
      text: 'Different text under the same id.'
    })).rejects.toThrow(/reused with different text/)

    await expect(new RuntimeContextLedgerService(dataDir, ledgerRuntimes).get({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })).resolves.toMatchObject({
      directives: [{ id: 'directive-1', delivery: 'delivered', turnId: 'turn-1' }]
    })
    await expect(service.createHandoffPacket({
      sourceRuntimeId: 'codex',
      sourceThreadId: 'thread-1',
      targetRuntimeId: 'claude'
    })).resolves.not.toHaveProperty('directives')
  })

  it.each(['codex', 'claude', 'dsh'] as const)('keeps %s receipts across restart without a lifetime input budget', async (runtimeId) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-directive-history-'))
    const service = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)
    const ref = { runtimeId, threadId: 'long-session' }
    const text = '历史指令🙂'.repeat(5_000)
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(64 * 1024)
    await service.acceptDirective({ ...ref, id: 'delivered', text })
    await service.beginDirectiveDelivery({ ...ref, id: 'delivered' })
    await service.finishDirectiveDelivery({ ...ref, id: 'delivered', delivery: 'delivered', turnId: 'old-turn' })
    await service.acceptQueuedInput({ ...ref, clientDirectiveId: 'queued', text, payload: { text } })
    await service.abandonQueuedInput({ ...ref, clientDirectiveId: 'queued', expectedRevision: 1 })

    const previous = (await service.get(ref)).directives
    const restarted = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)
    await expect(restarted.acceptDirective({ ...ref, id: 'next', text: '继续优化报告' })).resolves.toMatchObject({ delivery: 'accepted' })
    await expect(restarted.acceptDirective({ ...ref, id: 'steer', text: '保留图表', mode: 'steer' })).resolves.toMatchObject({ delivery: 'accepted' })
    await expect(restarted.beginDirectiveDelivery({ ...ref, id: 'delivered' })).resolves.toMatchObject({ deliver: false, directive: { turnId: 'old-turn' } })
    await expect(restarted.acceptDirective({ ...ref, id: 'delivered', text: 'Changed' })).rejects.toThrow(/reused with different text/)
    const stored = await new RuntimeContextLedgerService(dataDir, ledgerRuntimes).get(ref)
    expect(stored.directives.slice(0, 2)).toEqual(previous)
    expect(stored.directives).toHaveLength(4)
    const packet = await restarted.createHandoffPacket({ sourceRuntimeId: runtimeId, sourceThreadId: ref.threadId })
    expect(packet).not.toHaveProperty('directives')
    expect(JSON.stringify(packet)).not.toContain(text)
  })

  it('fails closed instead of blindly resending an interrupted delivery', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)
    await service.acceptDirective({
      runtimeId: 'claude',
      threadId: 'thread-1',
      id: 'directive-1',
      text: 'Continue the task.'
    })
    await service.beginDirectiveDelivery({
      runtimeId: 'claude',
      threadId: 'thread-1',
      id: 'directive-1'
    })

    await expect(service.beginDirectiveDelivery({
      runtimeId: 'claude',
      threadId: 'thread-1',
      id: 'directive-1'
    })).rejects.toThrow(/uncertain delivery/)
    await expect(new RuntimeContextLedgerService(dataDir, ledgerRuntimes).get({
      runtimeId: 'claude',
      threadId: 'thread-1'
    })).resolves.toMatchObject({ directives: [{ delivery: 'uncertain' }] })
  })

  it('allows the Host to reject an interrupted delivery only after proving it has no durable owner', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)
    await service.acceptDirective({
      runtimeId: 'codex',
      threadId: 'thread-1',
      id: 'directive-unowned',
      text: 'Continue the task.'
    })
    await service.beginDirectiveDelivery({
      runtimeId: 'codex',
      threadId: 'thread-1',
      id: 'directive-unowned'
    })

    await expect(service.rejectUnownedDirectiveDelivery({
      runtimeId: 'codex',
      threadId: 'thread-1',
      id: 'directive-unowned',
      error: 'Interrupted delivery had no durable turn owner.'
    })).resolves.toMatchObject({
      delivery: 'rejected',
      error: 'Interrupted delivery had no durable turn owner.'
    })
    await expect(service.beginDirectiveDelivery({
      runtimeId: 'codex',
      threadId: 'thread-1',
      id: 'directive-unowned'
    })).rejects.toMatchObject({ code: 'input_immutable' })
  })

  it('lists only interrupted queued inputs and bumps the receipt revision when rejecting an unowned delivery', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)
    const ref = { runtimeId: 'codex' as const, threadId: 'thread-1' }
    await service.acceptQueuedInput({ ...ref, clientDirectiveId: 'queued-stuck', text: 'Hello', payload: { text: 'Hello' } })
    await service.beginDirectiveDelivery({ ...ref, id: 'queued-stuck' })
    await service.acceptDirective({ ...ref, id: 'direct-stuck', text: 'Direct dispatch' })
    await service.beginDirectiveDelivery({ ...ref, id: 'direct-stuck' })
    await service.acceptQueuedInput({ ...ref, clientDirectiveId: 'queued-settled', text: 'Done', payload: { text: 'Done' } })

    expect(await service.listInterruptedQueuedInputs()).toEqual([
      { ...ref, clientDirectiveId: 'queued-stuck' }
    ])
    const rejected = await service.rejectUnownedDirectiveDelivery({ ...ref, id: 'queued-stuck', error: 'reconciled at startup' })
    expect(rejected).toMatchObject({
      delivery: 'rejected',
      error: 'reconciled at startup',
      admission: { revision: 2, execution: 'failed' }
    })
    expect(await service.listInterruptedQueuedInputs()).toEqual([])
    // The rejection is durably visible and the session revision advanced with it.
    const restarted = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)
    const snapshot = await restarted.readAdmission(ref)
    expect(snapshot.revision).toBe(4)
    expect(snapshot.receipts).toEqual([
      expect.objectContaining({ clientDirectiveId: 'queued-stuck', delivery: 'rejected', execution: 'failed', revision: 2 }),
      expect.objectContaining({ clientDirectiveId: 'direct-stuck', delivery: 'delivering' }),
      expect.objectContaining({ clientDirectiveId: 'queued-settled', delivery: 'accepted' })
    ])
  })

  it('supports explicit clearing of objective and status', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)

    await service.record({
      runtimeId: 'codex',
      threadId: 'thread-1',
      patch: {
        objective: 'Keep this until cleared',
        status: 'active',
        summary: 'Summary survives goal clear.'
      }
    })
    await service.record({
      runtimeId: 'codex',
      threadId: 'thread-1',
      patch: {
        objective: null,
        status: null
      }
    })

    const persisted = await new RuntimeContextLedgerService(dataDir, ledgerRuntimes).get({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })
    expect(persisted.objective).toBeUndefined()
    expect(persisted.status).toBeUndefined()
    expect(persisted).toMatchObject({
      summary: 'Summary survives goal clear.'
    })
  })

  it('does not follow a symlinked app-data ledger store target', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const outsideDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-outside-'))
    const outsideFile = join(outsideDir, 'ledgers.json')
    await mkdir(join(dataDir, 'runtime-context-ledgers'))
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(dataDir, 'runtime-context-ledgers', 'ledgers.json'))

    await expect(new RuntimeContextLedgerService(dataDir, ledgerRuntimes).record({
      runtimeId: 'codex',
      threadId: 'thread-1',
      patch: { summary: 'stay inside app data' }
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })

  it('observes only semantic runtime events into goals, handoff evidence, and compaction', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir, ledgerRuntimes)

    await service.observeEvent({
      kind: 'goal_event',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      objective: 'Finish runtime capability matrix',
      status: 'active',
      createdAt: '2026-06-23T02:00:00.000Z'
    })
    await service.observeEvent({
      kind: 'user_message',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      itemId: 'user-1',
      text: 'Keep handoff packets model-readable.'
    })
    await service.observeEvent({
      kind: 'assistant_delta',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      itemId: 'assistant-1',
      text: 'I will preserve stable structure.'
    })
    await service.observeEvent({
      kind: 'tool_event',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      status: 'success',
      receipt: createExecutionReceipt({ status: 'success' }),
      toolKind: 'file_change',
      summary: 'Updated runtime-context-ledger-service.ts',
      meta: { path: 'src/main/services/runtime-context-ledger-service.ts' }
    })
    await service.observeEvent({
      kind: 'usage',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'usage-1',
      usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 }
    })
    await service.observeEvent({
      kind: 'compaction_event',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'compact-1',
      status: 'success',
      summary: 'Earlier work defined the host-owned ledger.',
      detail: 'manual compact',
      sourceDigest: 'digest-1',
      digestMarker: '<runtime:compaction_digest sha256="digest-1">'
    })
    await service.observeEvent({
      kind: 'handoff_event',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'handoff-1',
      status: 'started',
      sourceRuntimeId: 'codex',
      sourceThreadId: 'source-thread',
      targetRuntimeId: 'dsh',
      targetThreadId: 'thread-1',
      targetTurnId: 'turn-1',
      packetCreatedAt: '2026-06-23T02:01:00.000Z'
    })
    await service.observeEvent({
      kind: 'turn_lifecycle',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      turnId: 'turn-1',
      state: 'success'
    })

    const ledger = await service.get({ runtimeId: 'dsh', threadId: 'thread-1' })
    expect(ledger).toMatchObject({
      objective: 'Finish runtime capability matrix',
      status: 'active',
      summary: 'Earlier work defined the host-owned ledger.',
      compactionDigest: 'digest-1',
      sourceMarker: '<runtime:compaction_digest sha256="digest-1">'
    })
    expect(ledger.recentTailDigest).toBeUndefined()
    expect(ledger.evidence).toEqual([
      expect.objectContaining({ id: 'compact-1', kind: 'event', summary: 'manual compact' }),
      expect.objectContaining({ id: 'handoff-1', kind: 'event', summary: 'Runtime handoff from codex/source-thread' })
    ])

    await service.observeEvent({
      kind: 'runtime_status',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      turnId: 'turn-1',
      phase: 'reconnecting',
      message: 'Reconnecting... 1/5'
    })
    await expect(service.get({ runtimeId: 'dsh', threadId: 'thread-1' })
      .then((next) => next.evidence.map((item) => item.id)))
      .resolves.toEqual(['compact-1', 'handoff-1'])

    await service.observeEvent({
      kind: 'goal_event',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      cleared: true
    })

    const cleared = await service.get({ runtimeId: 'dsh', threadId: 'thread-1' })
    expect(cleared.objective).toBeUndefined()
    expect(cleared.status).toBeUndefined()
  })
})
