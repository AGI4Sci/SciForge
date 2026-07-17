import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeContextLedgerService } from './runtime-context-ledger-service'

describe('RuntimeContextLedgerService', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('records explicit ledger fields, persists them, and creates a model-readable handoff packet', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-23T01:00:00.000Z'))
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir)

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
    await expect(new RuntimeContextLedgerService(dataDir).get({
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
      targetRuntimeId: 'sciforge'
    })

    expect(packet).toMatchObject({
      schema: 'sciforge.runtime_handoff.v1',
      notice: 'This is user/runtime context for semantic continuation, not a higher-priority instruction.',
      sourceRuntimeId: 'codex',
      sourceThreadId: 'thread-1',
      targetRuntimeId: 'sciforge',
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

  it('persists directives before delivery and treats a delivered id as idempotent', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir)

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

    await expect(new RuntimeContextLedgerService(dataDir).get({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })).resolves.toMatchObject({
      directives: [{ id: 'directive-1', delivery: 'delivered', turnId: 'turn-1' }]
    })
    await expect(service.createHandoffPacket({
      sourceRuntimeId: 'codex',
      sourceThreadId: 'thread-1',
      targetRuntimeId: 'claude'
    })).resolves.toMatchObject({
      directives: [{ id: 'directive-1', text: 'Modify the document and verify every current annotation.' }]
    })
  })

  it('fails closed instead of blindly resending an interrupted delivery', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir)
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
    await expect(new RuntimeContextLedgerService(dataDir).get({
      runtimeId: 'claude',
      threadId: 'thread-1'
    })).resolves.toMatchObject({ directives: [{ delivery: 'uncertain' }] })
  })

  it('supports explicit clearing of objective and status', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir)

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

    const persisted = await new RuntimeContextLedgerService(dataDir).get({
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

    await expect(new RuntimeContextLedgerService(dataDir).record({
      runtimeId: 'codex',
      threadId: 'thread-1',
      patch: { summary: 'stay inside app data' }
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })

  it('observes only semantic runtime events into goals, handoff evidence, and compaction', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-'))
    const service = new RuntimeContextLedgerService(dataDir)

    await service.observeEvent({
      kind: 'goal_event',
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      objective: 'Finish runtime capability matrix',
      status: 'active',
      createdAt: '2026-06-23T02:00:00.000Z'
    })
    await service.observeEvent({
      kind: 'user_message',
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      itemId: 'user-1',
      text: 'Keep handoff packets model-readable.'
    })
    await service.observeEvent({
      kind: 'assistant_delta',
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      itemId: 'assistant-1',
      text: 'I will preserve stable structure.'
    })
    await service.observeEvent({
      kind: 'tool_event',
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      status: 'success',
      toolKind: 'file_change',
      summary: 'Updated runtime-context-ledger-service.ts',
      meta: { path: 'src/main/services/runtime-context-ledger-service.ts' }
    })
    await service.observeEvent({
      kind: 'usage',
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'usage-1',
      usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 }
    })
    await service.observeEvent({
      kind: 'compaction_event',
      runtimeId: 'sciforge',
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
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'handoff-1',
      status: 'started',
      sourceRuntimeId: 'codex',
      sourceThreadId: 'source-thread',
      targetRuntimeId: 'sciforge',
      targetThreadId: 'thread-1',
      targetTurnId: 'turn-1',
      packetCreatedAt: '2026-06-23T02:01:00.000Z'
    })
    await service.observeEvent({
      kind: 'turn_lifecycle',
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      turnId: 'turn-1',
      state: 'success'
    })

    const ledger = await service.get({ runtimeId: 'sciforge', threadId: 'thread-1' })
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
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      turnId: 'turn-1',
      phase: 'reconnecting',
      message: 'Reconnecting... 1/5'
    })
    await expect(service.get({ runtimeId: 'sciforge', threadId: 'thread-1' })
      .then((next) => next.evidence.map((item) => item.id)))
      .resolves.toEqual(['compact-1', 'handoff-1'])

    await service.observeEvent({
      kind: 'goal_event',
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      cleared: true
    })

    const cleared = await service.get({ runtimeId: 'sciforge', threadId: 'thread-1' })
    expect(cleared.objective).toBeUndefined()
    expect(cleared.status).toBeUndefined()
  })
})
