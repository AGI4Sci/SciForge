import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'vitest'

import type {
  DomainArtifactConsumer,
  DomainTurnArtifactEvent
} from '@sciforge/domain-sdk/host'

import { TurnArtifactHandoffService } from './turn-artifact-handoff-service'
import {
  TurnArtifactOutbox,
  turnArtifactIntentKey,
  type TurnArtifactIntent
} from './turn-artifact-outbox'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('TurnArtifactHandoffService', () => {
  it('deduplicates repeated lifecycle intents before one materialization and owner-only fan-out', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    let materializations = 0
    const delivered: DomainTurnArtifactEvent[] = []
    const service = handoff({
      outbox,
      materialize: async (value) => {
        materializations += 1
        return event(value, 'first')
      },
      consumers: [{ consume: async (value) => { delivered.push(value as DomainTurnArtifactEvent) } }]
    })

    await service.publish(intent())
    await service.publish(intent())

    assert.equal(outbox.all().length, 1)
    await service.replayPending()
    assert.equal(materializations, 1)
    assert.equal(delivered.length, 1)
    assert.equal(outbox.all().length, 0)
    assert.equal(outbox.wasDelivered(turnArtifactIntentKey(intent())), true)

    await service.publish(intent())
    await service.replayPending()
    assert.equal(materializations, 1)
    assert.equal(delivered.length, 1)
    await assert.rejects(
      service.publish(intent({ occurredAt: '2026-08-05T00:00:01.000Z' })),
      /intent key collision/
    )
    assert.equal((await stat(dirname(outbox.path))).mode & 0o777, 0o700)
    assert.equal((await stat(outbox.path)).mode & 0o777, 0o600)
    await service.close()

    const recoveredOutbox = new TurnArtifactOutbox(root)
    const recovered = handoff({
      outbox: recoveredOutbox,
      materialize: async (value) => {
        materializations += 1
        return event(value, 'must-not-rematerialize')
      },
      consumers: [{ consume: async (value) => { delivered.push(value as DomainTurnArtifactEvent) } }]
    })
    await recovered.publish(intent())
    await recovered.replayPending()
    assert.equal(materializations, 1)
    assert.equal(delivered.length, 1)
    await recovered.close()
  })

  it('rejects a repeated identity when any immutable intent field differs', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const original = intent()

    await outbox.enqueueIntent(original)

    for (const changed of [
      intent({ sequence: 8 }),
      intent({ workspaceRoot: '/another-workspace' }),
      intent({ occurredAt: '2026-08-05T00:00:01.000Z' })
    ]) {
      await assert.rejects(
        outbox.enqueueIntent(changed),
        /intent key collision/
      )
    }

    assert.deepEqual(outbox.record(turnArtifactIntentKey(original))?.intent, original)
  })

  it('requires a materialized envelope to equal its intent and clears retry metadata', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const value = intent({ turnId: 'turn-envelope' })
    const key = turnArtifactIntentKey(value)
    await outbox.enqueueIntent(value)
    await outbox.markFailed(key, new Error('thread not ready'), 60_000)

    for (const changed of [
      { ...event(value, 'bad-sequence'), sequence: 8 },
      { ...event(value, 'bad-workspace'), workspaceRoot: '/another-workspace' },
      { ...event(value, 'bad-time'), occurredAt: '2026-08-05T00:00:01.000Z' },
      { ...event(value, 'bad-watermark'), targetWatermark: 'unrelated-watermark' }
    ]) {
      await assert.rejects(
        outbox.markMaterialized(key, changed),
        /envelope does not match its durable intent/
      )
      assert.equal(outbox.record(key)?.stage, 'pending_materialization')
    }

    const materialized = await outbox.markMaterialized(key, event(value, 'valid'))
    assert.equal(materialized.attempts, 0)
    assert.equal(materialized.nextAttemptAt, undefined)
    assert.equal(materialized.error, undefined)
  })

  it('atomically binds a previously unbound intent to the authoritative materialized workspace', async () => {
    const root = await temporaryRoot()
    const firstOutbox = new TurnArtifactOutbox(root)
    const unbound = intent({ turnId: 'turn-authoritative-bind', workspaceRoot: undefined })
    const authoritative = { ...unbound, workspaceRoot: '/workspace/from-thread-detail' }
    const key = turnArtifactIntentKey(unbound)
    let materializations = 0
    const first = handoff({
      outbox: firstOutbox,
      materialize: async () => {
        materializations += 1
        return event(authoritative, 'authoritative-workspace')
      },
      consumers: [{ consume: async () => { throw new Error('consumer offline') } }]
    })

    await first.publish(unbound)
    await assert.rejects(first.replayPending(), AggregateError)
    const bound = firstOutbox.record(key)
    assert.equal(bound?.stage, 'pending_fanout')
    assert.equal(bound?.intent.workspaceRoot, '/workspace/from-thread-detail')
    assert.equal(
      bound?.stage === 'pending_fanout' ? bound.event.workspaceRoot : undefined,
      '/workspace/from-thread-detail'
    )
    await first.close()

    const restartedOutbox = new TurnArtifactOutbox(root)
    await restartedOutbox.load()
    assert.equal(restartedOutbox.record(key)?.intent.workspaceRoot, '/workspace/from-thread-detail')
    await restartedOutbox.markFailed(key, 'retry now', 0)
    const delivered: DomainTurnArtifactEvent[] = []
    const restarted = handoff({
      outbox: restartedOutbox,
      materialize: async () => {
        materializations += 1
        throw new Error('a bound fan-out must not rematerialize')
      },
      consumers: [{ consume: async (value) => {
        delivered.push(value as DomainTurnArtifactEvent)
      } }]
    })

    await restarted.replayPending()
    assert.equal(materializations, 1)
    assert.equal(delivered[0]?.workspaceRoot, '/workspace/from-thread-detail')
    // The durable receipt is bound. A later unbound or differently bound
    // envelope cannot weaken or replace that authoritative scope.
    await assert.rejects(restarted.publish(unbound), /intent key collision/)
    await assert.rejects(
      restarted.publish({ ...unbound, workspaceRoot: '/workspace/other' }),
      /intent key collision/
    )
    await restarted.close()
  })

  it('does not persist an authoritative workspace candidate when another envelope field is invalid', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const unbound = intent({ turnId: 'turn-invalid-authoritative-bind', workspaceRoot: undefined })
    const key = turnArtifactIntentKey(unbound)
    await outbox.enqueueIntent(unbound)

    await assert.rejects(outbox.markMaterialized(key, {
      ...event({ ...unbound, workspaceRoot: '/workspace/from-thread-detail' }, 'invalid'),
      occurredAt: '2026-08-05T00:00:01.000Z'
    }), /envelope does not match its durable intent/)

    assert.equal(outbox.record(key)?.stage, 'pending_materialization')
    assert.equal(outbox.record(key)?.intent.workspaceRoot, undefined)
  })

  it('keeps pending_materialization durable across a transient thread read failure', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    let attempts = 0
    let deliveries = 0
    const service = handoff({
      outbox,
      materialize: async (value) => {
        attempts += 1
        if (attempts === 1) throw new Error('thread not visible yet')
        return event(value, 'materialized-after-retry')
      },
      consumers: [{ consume: async () => { deliveries += 1 } }]
    })
    const value = intent({ turnId: 'turn-transient' })

    await service.publish(value)
    await assert.rejects(service.replayPending(), AggregateError)
    const key = turnArtifactIntentKey(value)
    assert.equal(outbox.record(key)?.stage, 'pending_materialization')
    assert.equal(deliveries, 0)

    await outbox.markFailed(key, 'retry now', 0)
    await service.replayPending()
    assert.equal(attempts, 2)
    assert.equal(deliveries, 1)
    assert.equal(outbox.all().length, 0)
    await service.close()
  })

  it('restarts from pending_fanout without reading the mutable thread again', async () => {
    const root = await temporaryRoot()
    const firstOutbox = new TurnArtifactOutbox(root)
    let materializations = 0
    const first = handoff({
      outbox: firstOutbox,
      materialize: async (value) => {
        materializations += 1
        return event(value, 'immutable-first-read')
      },
      consumers: [{ consume: async () => { throw new Error('consumer offline') } }]
    })
    const value = intent({ turnId: 'turn-restart' })

    await first.publish(value)
    await assert.rejects(first.replayPending(), AggregateError)
    const key = turnArtifactIntentKey(value)
    const persisted = firstOutbox.record(key)
    assert.equal(persisted?.stage, 'pending_fanout')
    assert.deepEqual(
      persisted?.stage === 'pending_fanout' ? persisted.event.artifacts : [],
      [{ marker: 'immutable-first-read' }]
    )
    await first.close()

    const recoveredOutbox = new TurnArtifactOutbox(root)
    await recoveredOutbox.load()
    await recoveredOutbox.markFailed(key, 'retry now', 0)
    const delivered: DomainTurnArtifactEvent[] = []
    const recovered = handoff({
      outbox: recoveredOutbox,
      materialize: async () => {
        materializations += 1
        throw new Error('materialization must not repeat after restart')
      },
      consumers: [{ consume: async (artifact) => {
        delivered.push(artifact as DomainTurnArtifactEvent)
      } }]
    })

    await recovered.replayPending()
    assert.equal(materializations, 1)
    assert.deepEqual(delivered[0]?.artifacts, [{ marker: 'immutable-first-read' }])
    assert.equal(recoveredOutbox.all().length, 0)
    await recovered.close()
  })

  it('replays the identical event after partial fan-out so consumers can apply it idempotently', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const observed: string[] = []
    const effects = new Set<string>()
    let secondAttempts = 0
    const firstConsumer: DomainArtifactConsumer = {
      consume: async (artifact) => {
        const turn = artifact as DomainTurnArtifactEvent
        const identity = `${turn.runtimeId}:${turn.threadId}:${turn.turnId}`
        observed.push(JSON.stringify(turn))
        effects.add(identity)
      }
    }
    const secondConsumer: DomainArtifactConsumer = {
      consume: async () => {
        secondAttempts += 1
        if (secondAttempts === 1) throw new Error('second consumer unavailable')
      }
    }
    const service = handoff({
      outbox,
      materialize: async (value) => event(value, 'stable-replay'),
      consumers: [firstConsumer, secondConsumer]
    })
    const value = intent({ turnId: 'turn-partial' })

    await service.publish(value)
    await assert.rejects(service.replayPending(), AggregateError)
    await outbox.markFailed(turnArtifactIntentKey(value), 'retry now', 0)
    await service.replayPending()

    assert.equal(observed.length, 2)
    assert.equal(observed[0], observed[1])
    assert.equal(effects.size, 1)
    assert.equal(secondAttempts, 2)
    assert.equal(outbox.all().length, 0)
    await service.close()
  })
})

function handoff(input: {
  outbox: TurnArtifactOutbox
  materialize: (intent: TurnArtifactIntent) => Promise<DomainTurnArtifactEvent>
  consumers: readonly DomainArtifactConsumer[]
}): TurnArtifactHandoffService {
  return new TurnArtifactHandoffService({
    ...input,
    retryBaseMs: 60_000,
    retryMaxMs: 60_000,
    setTimeout: inertSetTimeout,
    clearTimeout: inertClearTimeout
  })
}

function intent(overrides: Partial<TurnArtifactIntent> = {}): TurnArtifactIntent {
  return {
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    sequence: 7,
    workspaceRoot: '/workspace',
    occurredAt: '2026-08-05T00:00:00.000Z',
    ...overrides
  }
}

function event(value: TurnArtifactIntent, marker: string): DomainTurnArtifactEvent {
  return {
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: value.runtimeId,
    threadId: value.threadId,
    turnId: value.turnId,
    targetWatermark: String(value.sequence ?? value.turnId),
    ...(value.sequence === undefined ? {} : { sequence: value.sequence }),
    ...(value.workspaceRoot ? { workspaceRoot: value.workspaceRoot } : {}),
    occurredAt: value.occurredAt,
    artifacts: [{ marker }]
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'turn-artifact-handoff-'))
  roots.push(root)
  return root
}

const inertSetTimeout = ((
  _callback: (...args: unknown[]) => void,
  _delay?: number
) => ({ unref: () => undefined })) as unknown as typeof setTimeout

const inertClearTimeout = (() => undefined) as unknown as typeof clearTimeout
