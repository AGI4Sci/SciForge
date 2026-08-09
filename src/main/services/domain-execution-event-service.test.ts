import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import type { TraceEvent, TraceEventInput } from '@sciforge/full-trace'
import type { DomainExecutionEventV1 } from '@sciforge/domain-sdk/reproducibility'

import { DomainExecutionEventOutbox } from './domain-execution-event-outbox'
import { DomainExecutionEventService } from './domain-execution-event-service'

describe('DomainExecutionEventService', () => {
  it('persists before broadcasting a completed execution', async () => {
    const order: string[] = []
    const traceInputs: TraceEventInput<'execution_event'>[] = []
    const service = new DomainExecutionEventService({
      trace: {
        append: async (input) => {
          order.push('trace')
          traceInputs.push(input)
          return {} as TraceEvent
        }
      },
      consumers: [{
        consume: async (event) => {
          order.push('consumer')
          assert.equal(event.kind, 'execution-completed')
          assert.equal(Object.isFrozen(event), true)
          assert.equal(Object.isFrozen(event.artifacts), true)
          assert.equal(Object.isFrozen(event.artifacts[0]), true)
          assert.equal(Object.isFrozen((event.artifacts[0] as { producer: unknown }).producer), true)
          assert.deepEqual(event.hostBinding, {
            contractVersion: 1,
            acceptanceSequence: 1,
            workspaceBinding: 'unbound'
          })
          assert.equal(
            event.targetWatermark,
            '1:event-fixed'
          )
        }
      }],
      now: () => new Date('2026-08-05T00:00:00.000Z')
    })

    const event = await service.publish({ moduleId: 'domain.create-loop', moduleVersion: '1.0.0' }, {
      eventId: 'event-fixed',
      phase: 'run_completed',
      executionId: 'execution-1',
      runId: 'run-1',
      artifacts: [{ manifest: 'run-1' }]
    })

    assert.deepEqual(order, ['trace', 'consumer'])
    assert.match(event.traceId ?? '', /^trace_[a-f0-9]{32}$/)
    assert.equal(traceInputs[0]?.payload.event, event)
  })

  it('does not fan out non-terminal execution events', async () => {
    let consumed = false
    const service = new DomainExecutionEventService({
      trace: { append: async () => ({} as TraceEvent) },
      consumers: [{ consume: () => { consumed = true } }]
    })
    await service.publish({ moduleId: 'domain.create-loop', moduleVersion: '1.0.0' }, {
      phase: 'activity_started',
      executionId: 'execution-2',
      runId: 'run-2'
    })
    assert.equal(consumed, false)
  })

  it('uses monotonic execution watermarks when a stable Evidence scope is reused', async () => {
    const watermarks: string[] = []
    const service = new DomainExecutionEventService({
      trace: { append: async () => ({} as TraceEvent) },
      consumers: [{ consume: async (event) => { watermarks.push(event.targetWatermark) } }]
    })
    const owner = { moduleId: 'domain.create-loop', moduleVersion: '1.0.0' }
    await service.publish(owner, {
      eventId: 'run-a',
      phase: 'run_completed',
      executionId: 'execution-a',
      runId: 'run-a',
      occurredAt: '2099-08-05T00:00:00.000Z',
      scope: { runtimeId: 'domain.create-loop', threadId: 'workflow:stable' }
    })
    await service.publish(owner, {
      eventId: 'run-b',
      phase: 'run_completed',
      executionId: 'execution-b',
      runId: 'run-b',
      // Producer time moves backwards, but the Host acceptance order cannot.
      occurredAt: '2000-08-05T00:00:01.000Z',
      scope: { runtimeId: 'domain.create-loop', threadId: 'workflow:stable' }
    })

    assert.deepEqual(watermarks, [
      '1:run-a',
      '2:run-b'
    ])
    assert.ok(Number(watermarks[1]!.split(':', 1)[0]) > Number(watermarks[0]!.split(':', 1)[0]))
  })

  it('rejects mutually exclusive terminal events for the same producer execution and run', async () => {
    const service = new DomainExecutionEventService({
      trace: { append: async () => ({} as TraceEvent) },
      consumers: []
    })
    const owner = { moduleId: 'domain.create-loop', moduleVersion: '1.0.0' }
    await service.publish(owner, {
      eventId: 'terminal-success',
      phase: 'run_completed',
      executionId: 'execution-terminal',
      runId: 'run-terminal'
    })
    await assert.rejects(service.publish(owner, {
      eventId: 'terminal-failure',
      phase: 'run_failed',
      executionId: 'execution-terminal',
      runId: 'run-terminal'
    }), /terminal collision/)
  })

  it('binds workspace only to the active capability caller and rejects a forged claim', async () => {
    const delivered: Array<{
      workspaceRoot?: string
      hostBinding?: { workspaceBinding: string; workspaceRoot?: string }
      artifacts: readonly unknown[]
    }> = []
    const service = new DomainExecutionEventService({
      trace: { append: async () => ({} as TraceEvent) },
      consumers: [{ consume: async (event) => { delivered.push(event) } }],
      resolveCallerWorkspace: () => '/workspace/trusted'
    })
    const owner = { moduleId: 'domain.create-loop', moduleVersion: '1.0.0' }
    await service.publish(owner, {
      eventId: 'workspace-bound',
      phase: 'run_completed',
      executionId: 'execution-workspace-bound',
      runId: 'run-workspace-bound',
      workspaceRoot: '/workspace/trusted'
    })
    assert.equal(delivered[0]?.workspaceRoot, '/workspace/trusted')
    assert.deepEqual(delivered[0]?.hostBinding, {
      contractVersion: 1,
      acceptanceSequence: 1,
      workspaceBinding: 'capability-caller',
      workspaceRoot: '/workspace/trusted'
    })
    assert.equal(
      (delivered[0]?.artifacts[0] as { workspaceRoot?: string }).workspaceRoot,
      '/workspace/trusted'
    )

    await assert.rejects(service.publish(owner, {
      eventId: 'workspace-forged',
      phase: 'run_failed',
      executionId: 'execution-workspace-forged',
      runId: 'run-workspace-forged',
      workspaceRoot: '/workspace/victim'
    }), /does not match the capability caller workspace/)
    assert.equal(delivered.length, 1)
  })

  it('strips an unbound workspace from consumer artifacts', async () => {
    let delivered: unknown
    const service = new DomainExecutionEventService({
      trace: { append: async () => ({} as TraceEvent) },
      consumers: [{ consume: async (event) => { delivered = event } }]
    })
    await service.publish({ moduleId: 'domain.background', moduleVersion: '1.0.0' }, {
      eventId: 'workspace-unbound',
      phase: 'run_completed',
      executionId: 'execution-workspace-unbound',
      runId: 'run-workspace-unbound',
      workspaceRoot: '/workspace/untrusted'
    })
    const event = delivered as {
      workspaceRoot?: string
      hostBinding: { workspaceBinding: string }
      artifacts: Array<{ workspaceRoot?: string }>
    }
    assert.equal(event.workspaceRoot, undefined)
    assert.equal(event.hostBinding.workspaceBinding, 'unbound')
    assert.equal(event.artifacts[0]?.workspaceRoot, undefined)
  })

  it('persists terminal uniqueness and acceptance sequence across restart', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'domain-execution-outbox-'))
    try {
      const owner = { moduleId: 'domain.create-loop', moduleVersion: '1.0.0' }
      const firstOutbox = new DomainExecutionEventOutbox(userDataDir)
      const first = new DomainExecutionEventService({
        trace: { append: async () => ({} as TraceEvent) },
        consumers: [],
        outbox: firstOutbox,
        setTimeout: inertSetTimeout,
        clearTimeout: inertClearTimeout
      })
      await first.publish(owner, {
        eventId: 'terminal-first',
        phase: 'run_completed',
        executionId: 'execution-first',
        runId: 'run-first'
      })
      await first.replayPending()
      await first.close()

      const watermarks: string[] = []
      const restartedOutbox = new DomainExecutionEventOutbox(userDataDir)
      const restarted = new DomainExecutionEventService({
        trace: { append: async () => ({} as TraceEvent) },
        consumers: [{ consume: async (event) => { watermarks.push(event.targetWatermark) } }],
        outbox: restartedOutbox,
        setTimeout: inertSetTimeout,
        clearTimeout: inertClearTimeout
      })
      await assert.rejects(restarted.publish(owner, {
        eventId: 'terminal-conflict',
        phase: 'run_failed',
        executionId: 'execution-first',
        runId: 'run-first'
      }), /terminal collision/)
      await restarted.publish(owner, {
        eventId: 'terminal-second',
        phase: 'run_completed',
        executionId: 'execution-second',
        runId: 'run-second',
        occurredAt: '1900-01-01T00:00:00.000Z'
      })
      await restarted.replayPending()
      assert.deepEqual(watermarks, ['2:terminal-second'])
      await restarted.close()
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('retains terminal identity after receipt pruning and fails closed at identity capacity', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'domain-execution-outbox-'))
    const options = { maxDeliveredReceipts: 1, maxTerminalIdentities: 2 }
    try {
      const first = terminalEvent({
        eventId: 'terminal-pruned-first',
        executionId: 'execution-pruned-first',
        runId: 'run-pruned-first'
      })
      const second = terminalEvent({
        eventId: 'terminal-pruned-second',
        executionId: 'execution-pruned-second',
        runId: 'run-pruned-second'
      })
      const outbox = new DomainExecutionEventOutbox(userDataDir, options)
      await outbox.enqueue(first)
      await outbox.markDelivered(first.eventId)
      await outbox.enqueue(second)
      await outbox.markDelivered(second.eventId)

      assert.equal(outbox.wasDelivered(first.eventId), false)
      assert.equal(outbox.wasDelivered(second.eventId), true)
      const persisted = JSON.parse(await readFile(outbox.path, 'utf8')) as {
        terminalIdentities: unknown[]
        receipts: unknown[]
      }
      assert.equal(persisted.receipts.length, 1)
      assert.equal(persisted.terminalIdentities.length, 2)

      const restarted = new DomainExecutionEventOutbox(userDataDir, options)
      await restarted.load()
      await assert.rejects(restarted.enqueue(terminalEvent({
        eventId: 'terminal-pruned-conflict',
        executionId: first.executionId,
        runId: first.runId,
        phase: 'run_failed'
      })), /terminal collision/)
      await assert.rejects(restarted.enqueue({
        ...first,
        phase: 'run_failed'
      }), /eventId collision/)

      const repeated = await restarted.enqueue({
        ...first,
        producer: { ...first.producer, moduleVersion: '2.0.0' }
      })
      assert.equal(repeated.producer.moduleVersion, '1.0.0')
      assert.equal(restarted.all().length, 0)

      const beforeCapacityFailure = await readFile(restarted.path, 'utf8')
      await assert.rejects(restarted.enqueue(terminalEvent({
        eventId: 'terminal-capacity-third',
        executionId: 'execution-capacity-third',
        runId: 'run-capacity-third'
      })), /terminal identity index is full/)
      assert.equal(restarted.all().length, 0)
      assert.equal(await readFile(restarted.path, 'utf8'), beforeCapacityFailure)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('atomically migrates v2 pending terminals into the permanent identity index', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'domain-execution-outbox-'))
    try {
      const outbox = new DomainExecutionEventOutbox(userDataDir)
      const accepted = terminalEvent({
        eventId: 'terminal-v2-pending',
        executionId: 'execution-v2-pending',
        runId: 'run-v2-pending'
      })
      await mkdir(join(userDataDir, 'domain-executions'), { recursive: true })
      await writeFile(outbox.path, `${JSON.stringify({
        version: 2,
        records: [{
          event: accepted,
          traceRecorded: false,
          attempts: 0,
          createdAt: '2026-08-05T00:00:00.000Z',
          updatedAt: '2026-08-05T00:00:00.000Z'
        }],
        receipts: []
      }, null, 2)}\n`, 'utf8')

      await outbox.load()
      const migrated = JSON.parse(await readFile(outbox.path, 'utf8')) as {
        version: number
        nextSequence: number
        terminalIdentities: Array<{ eventId: string; sequence: number }>
      }
      assert.equal(migrated.version, 3)
      assert.equal(migrated.nextSequence, 2)
      assert.equal(migrated.terminalIdentities.length, 1)
      assert.equal(migrated.terminalIdentities[0]?.eventId, accepted.eventId)
      assert.equal(migrated.terminalIdentities[0]?.sequence, 1)
      await assert.rejects(outbox.enqueue(terminalEvent({
        eventId: 'terminal-v2-conflict',
        executionId: accepted.executionId,
        runId: accepted.runId,
        phase: 'run_failed'
      })), /terminal collision/)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('reconstructs opaque v2 receipt identities only from an exact Host Full Trace event', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'domain-execution-outbox-'))
    try {
      const accepted = terminalEvent({
        eventId: 'terminal-v2-traced-receipt',
        executionId: 'execution-v2-traced-receipt',
        runId: 'run-v2-traced-receipt'
      })
      const seed = new DomainExecutionEventOutbox(userDataDir)
      await seed.enqueue(accepted)
      await seed.markDelivered(accepted.eventId)
      const seeded = JSON.parse(await readFile(seed.path, 'utf8')) as {
        receipts: Array<Record<string, unknown>>
      }
      const legacyReceipt = { ...seeded.receipts[0] }
      delete legacyReceipt.terminalKey
      delete legacyReceipt.sequence
      await writeFile(seed.path, `${JSON.stringify({
        version: 2,
        records: [],
        receipts: [legacyReceipt]
      }, null, 2)}\n`, 'utf8')

      const requested: string[][] = []
      const migrated = new DomainExecutionEventOutbox(userDataDir, {
        resolveLegacyTerminalEvents: async (eventIds) => {
          requested.push([...eventIds])
          return [accepted]
        }
      })
      await migrated.load()
      assert.deepEqual(requested, [[accepted.eventId]])
      const persisted = JSON.parse(await readFile(migrated.path, 'utf8')) as {
        version: number
        nextSequence: number
        receipts: Array<{ eventId: string; terminalKey?: string; sequence?: number }>
        terminalIdentities: Array<{ eventId: string; terminalKey: string; sequence: number }>
        ambiguousLegacyProducers: string[]
      }
      assert.equal(persisted.version, 3)
      assert.equal(persisted.nextSequence, 2)
      assert.deepEqual(persisted.ambiguousLegacyProducers, [])
      assert.equal(persisted.receipts[0]?.eventId, accepted.eventId)
      assert.match(persisted.receipts[0]?.terminalKey ?? '', /^sha256:[0-9a-f]{64}$/)
      assert.equal(persisted.receipts[0]?.sequence, 1)
      assert.equal(persisted.terminalIdentities[0]?.eventId, accepted.eventId)
      assert.equal(
        persisted.terminalIdentities[0]?.terminalKey,
        persisted.receipts[0]?.terminalKey
      )
      assert.equal(persisted.terminalIdentities[0]?.sequence, 1)

      await assert.rejects(migrated.enqueue(terminalEvent({
        eventId: 'terminal-v2-traced-conflict',
        executionId: accepted.executionId,
        runId: accepted.runId,
        phase: 'run_failed'
      })), /terminal collision/)
      const next = await migrated.enqueue(terminalEvent({
        eventId: 'terminal-v2-traced-next',
        executionId: 'execution-v2-traced-next',
        runId: 'run-v2-traced-next'
      }))
      assert.equal(next.eventId, 'terminal-v2-traced-next')
      const afterNext = JSON.parse(await readFile(migrated.path, 'utf8')) as {
        records: Array<{ event: { eventId: string }; sequence: number }>
      }
      assert.deepEqual(
        afterNext.records.map((record) => [record.event.eventId, record.sequence]),
        [['terminal-v2-traced-next', 2]]
      )
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('fails closed per producer when a v2 receipt cannot reconstruct its terminal tuple', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'domain-execution-outbox-'))
    try {
      const accepted = terminalEvent({
        eventId: 'terminal-v2-opaque-receipt',
        executionId: 'execution-v2-opaque-receipt',
        runId: 'run-v2-opaque-receipt'
      })
      const seed = new DomainExecutionEventOutbox(userDataDir, { maxDeliveredReceipts: 1 })
      await seed.enqueue(accepted)
      await seed.markDelivered(accepted.eventId)
      const seeded = JSON.parse(await readFile(seed.path, 'utf8')) as {
        receipts: Array<Record<string, unknown>>
      }
      const legacyReceipt = { ...seeded.receipts[0] }
      delete legacyReceipt.terminalKey
      delete legacyReceipt.sequence
      await writeFile(seed.path, `${JSON.stringify({
        version: 2,
        records: [],
        receipts: [legacyReceipt]
      }, null, 2)}\n`, 'utf8')

      const migrated = new DomainExecutionEventOutbox(userDataDir, {
        maxDeliveredReceipts: 1,
        // A trace record with the same eventId but a different signed intent
        // is untrusted input and must not remove the producer tombstone.
        resolveLegacyTerminalEvents: async () => [{ ...accepted, phase: 'run_failed' }]
      })
      await migrated.load()
      const persisted = JSON.parse(await readFile(migrated.path, 'utf8')) as {
        version: number
        receipts: Array<{ eventId: string }>
        ambiguousLegacyProducers: string[]
      }
      assert.equal(persisted.version, 3)
      assert.deepEqual(persisted.ambiguousLegacyProducers, ['domain.create-loop'])

      // Exact retries remain idempotent, but neither a changed event with the
      // old id nor an uncheckable new terminal from that producer is accepted.
      assert.equal((await migrated.enqueue(accepted)).eventId, accepted.eventId)
      await assert.rejects(migrated.enqueue({
        ...accepted,
        phase: 'run_failed'
      }), /eventId collision/)
      await assert.rejects(migrated.enqueue(terminalEvent({
        eventId: 'terminal-v2-ambiguous-new',
        executionId: 'execution-v2-ambiguous-new',
        runId: 'run-v2-ambiguous-new'
      })), /ambiguous after v2 migration/)

      // Other producers can progress. Their prunable receipt must never evict
      // the opaque exact receipt that backs the fail-closed migration.
      const otherProducer = {
        ...terminalEvent({
          eventId: 'terminal-other-producer',
          executionId: 'execution-other-producer',
          runId: 'run-other-producer'
        }),
        producer: { moduleId: 'domain.other', moduleVersion: '1.0.0' }
      }
      await migrated.enqueue(otherProducer)
      await migrated.markDelivered(otherProducer.eventId)
      const afterDelivery = JSON.parse(await readFile(migrated.path, 'utf8')) as {
        receipts: Array<{ eventId: string }>
      }
      assert.deepEqual(
        afterDelivery.receipts.map((receipt) => receipt.eventId),
        [accepted.eventId]
      )

      const restarted = new DomainExecutionEventOutbox(userDataDir, { maxDeliveredReceipts: 1 })
      await assert.rejects(restarted.enqueue(terminalEvent({
        eventId: 'terminal-v2-ambiguous-after-restart',
        executionId: 'execution-v2-ambiguous-after-restart',
        runId: 'run-v2-ambiguous-after-restart'
      })), /ambiguous after v2 migration/)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('persists terminal events and attempts every consumer before surfacing fan-out failure', async () => {
    const order: string[] = []
    const logged: unknown[] = []
    const service = new DomainExecutionEventService({
      trace: {
        append: async () => {
          order.push('trace')
          return {} as TraceEvent
        }
      },
      consumers: [
        {
          consume: async () => {
            order.push('failed-consumer')
            throw new Error('consumer unavailable')
          }
        },
        {
          consume: async (event) => {
            order.push('healthy-consumer')
            assert.equal(event.kind, 'execution-completed')
          }
        }
      ],
      log: (_level, _message, detail) => logged.push(detail)
    })

    await assert.rejects(
      service.publish({ moduleId: 'domain.create-loop', moduleVersion: '1.0.0' }, {
        phase: 'run_failed',
        executionId: 'execution-3',
        runId: 'run-3'
      }),
      AggregateError
    )
    assert.deepEqual(order, ['trace', 'failed-consumer', 'healthy-consumer'])
    assert.equal(logged.length, 1)
  })

  it('retains a failed terminal fan-out and replays it after restart', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'domain-execution-outbox-'))
    try {
      const outbox = new DomainExecutionEventOutbox(userDataDir)
      const failing = new DomainExecutionEventService({
        trace: { append: async () => ({} as TraceEvent) },
        consumers: [{ consume: async () => { throw new Error('temporarily unavailable') } }],
        outbox,
        retryBaseMs: 60_000,
        retryMaxMs: 60_000,
        createEventId: () => 'durable-event',
        resolveCallerWorkspace: () => '/workspace/durable',
        setTimeout: inertSetTimeout,
        clearTimeout: inertClearTimeout
      })
      await failing.publish({ moduleId: 'domain.create-loop', moduleVersion: '1.0.0' }, {
        phase: 'run_completed',
        executionId: 'execution-durable',
        runId: 'run-durable',
        workspaceRoot: '/workspace/durable',
        artifacts: [{ kind: 'sciforge.repro-spec', spec: 'portable' }]
      })
      assert.equal(outbox.all().length, 1)
      await assert.rejects(failing.replayPending(), AggregateError)
      await failing.close()

      const restartedOutbox = new DomainExecutionEventOutbox(userDataDir)
      await restartedOutbox.load()
      await restartedOutbox.markFailed('durable-event', 'retry now', 0)
      const delivered: unknown[] = []
      const restarted = new DomainExecutionEventService({
        trace: { append: async () => ({} as TraceEvent) },
        consumers: [{ consume: async (event) => { delivered.push(event) } }],
        outbox: restartedOutbox
      })
      await restarted.replayPending()

      assert.equal(delivered.length, 1)
      assert.equal(restartedOutbox.all().length, 0)
      assert.deepEqual(
        (delivered[0] as { hostBinding: unknown }).hostBinding,
        {
          contractVersion: 1,
          acceptanceSequence: 1,
          workspaceBinding: 'capability-caller',
          workspaceRoot: '/workspace/durable'
        }
      )
      assert.equal(
        (delivered[0] as { workspaceRoot?: string }).workspaceRoot,
        '/workspace/durable'
      )
      assert.deepEqual(
        (delivered[0] as { artifacts: unknown[] }).artifacts.slice(1),
        [{ kind: 'sciforge.repro-spec', spec: 'portable' }]
      )
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('accepts once and preserves the first envelope across package-version restarts', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'domain-execution-outbox-'))
    try {
      const eventInput = {
        eventId: 'stable-terminal-event',
        phase: 'run_completed' as const,
        executionId: 'execution-versioned',
        runId: 'run-versioned',
        occurredAt: '2026-08-05T00:00:00.000Z',
        payload: { result: 'stable' },
        artifacts: [{ kind: 'sciforge.repro-spec', spec: 'portable' }]
      }
      let traces = 0
      let deliveries = 0
      const firstOutbox = new DomainExecutionEventOutbox(userDataDir)
      const first = new DomainExecutionEventService({
        trace: { append: async () => { traces += 1; return {} as TraceEvent } },
        consumers: [{ consume: async () => { deliveries += 1 } }],
        outbox: firstOutbox,
        setTimeout: inertSetTimeout,
        clearTimeout: inertClearTimeout
      })

      const firstAccepted = await first.publish({
        moduleId: 'domain.create-loop',
        moduleVersion: '1.0.0'
      }, eventInput)
      assert.equal(firstAccepted.producer.moduleVersion, '1.0.0')
      assert.equal(traces, 0)
      assert.equal(deliveries, 0)
      assert.equal(firstOutbox.all().length, 1)
      await first.close()

      // The package crashed after Host acceptance but before clearing its own
      // pending intent, then restarted at a newer package version.
      const restartedOutbox = new DomainExecutionEventOutbox(userDataDir)
      const restarted = new DomainExecutionEventService({
        trace: { append: async (input) => {
          traces += 1
          assert.equal(
            (input.payload.event as { producer: { moduleVersion: string } }).producer.moduleVersion,
            '1.0.0'
          )
          return {} as TraceEvent
        } },
        consumers: [{ consume: async (event) => {
          deliveries += 1
          assert.equal(event.kind, 'execution-completed')
          assert.equal(event.producer.moduleVersion, '1.0.0')
        } }],
        outbox: restartedOutbox,
        setTimeout: inertSetTimeout,
        clearTimeout: inertClearTimeout
      })
      const repeatedPending = await restarted.publish({
        moduleId: 'domain.create-loop',
        moduleVersion: '2.0.0'
      }, eventInput)
      assert.equal(repeatedPending.producer.moduleVersion, '1.0.0')
      assert.equal(restartedOutbox.all().length, 1)
      await assert.rejects(
        restarted.publish({ moduleId: 'domain.create-loop', moduleVersion: '2.0.0' }, {
          ...eventInput,
          payload: { result: 'changed' }
        }),
        /eventId collision/
      )

      await restarted.replayPending()
      assert.equal(traces, 1)
      assert.equal(deliveries, 1)
      assert.equal(restartedOutbox.all().length, 0)
      assert.equal(restartedOutbox.wasDelivered(eventInput.eventId), true)
      await restarted.close()

      // A second crash after delivery but before the package observes the ack
      // is absorbed by the bounded durable receipt, including after restart.
      const receiptOutbox = new DomainExecutionEventOutbox(userDataDir)
      const afterReceipt = new DomainExecutionEventService({
        trace: { append: async () => { traces += 1; return {} as TraceEvent } },
        consumers: [{ consume: async () => { deliveries += 1 } }],
        outbox: receiptOutbox,
        setTimeout: inertSetTimeout,
        clearTimeout: inertClearTimeout
      })
      const repeatedDelivered = await afterReceipt.publish({
        moduleId: 'domain.create-loop',
        moduleVersion: '3.0.0'
      }, eventInput)
      assert.equal(repeatedDelivered.producer.moduleVersion, '1.0.0')
      assert.equal(receiptOutbox.all().length, 0)
      assert.equal(receiptOutbox.wasDelivered(eventInput.eventId), true)
      await afterReceipt.replayPending()
      assert.equal(traces, 1)
      assert.equal(deliveries, 1)
      await assert.rejects(
        afterReceipt.publish({ moduleId: 'domain.create-loop', moduleVersion: '3.0.0' }, {
          ...eventInput,
          artifacts: [{ kind: 'sciforge.repro-spec', spec: 'different' }]
        }),
        /eventId collision/
      )
      await afterReceipt.close()
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('recovers a crash after outbox acceptance by recording trace before fan-out', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'domain-execution-outbox-'))
    try {
      const outbox = new DomainExecutionEventOutbox(userDataDir)
      await outbox.enqueue({
        schemaVersion: 'sciforge.execution-event.v1',
        eventId: 'accepted-before-trace',
        phase: 'run_completed',
        producer: { moduleId: 'domain.create-loop', moduleVersion: '1.0.0' },
        executionId: 'execution-crash-window',
        runId: 'run-crash-window',
        traceId: 'trace-crash-window',
        occurredAt: '2026-08-05T00:00:00.000Z',
        artifacts: []
      })
      const order: string[] = []
      const service = new DomainExecutionEventService({
        trace: { append: async () => { order.push('trace'); return {} as TraceEvent } },
        consumers: [{ consume: async () => { order.push('consumer') } }],
        outbox
      })

      await service.replayPending()

      assert.deepEqual(order, ['trace', 'consumer'])
      assert.equal(outbox.all().length, 0)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})

const inertSetTimeout = ((
  _callback: (...args: unknown[]) => void,
  _delay?: number
) => ({ unref: () => undefined })) as unknown as typeof setTimeout

const inertClearTimeout = (() => undefined) as unknown as typeof clearTimeout

function terminalEvent(input: Readonly<{
  eventId: string
  executionId: string
  runId: string
  phase?: 'run_completed' | 'run_failed'
}>): DomainExecutionEventV1 {
  return {
    schemaVersion: 'sciforge.execution-event.v1',
    eventId: input.eventId,
    phase: input.phase ?? 'run_completed',
    producer: { moduleId: 'domain.create-loop', moduleVersion: '1.0.0' },
    executionId: input.executionId,
    runId: input.runId,
    traceId: `trace-${input.eventId}`,
    occurredAt: '2026-08-05T00:00:00.000Z',
    artifacts: []
  }
}
