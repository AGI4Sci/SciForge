import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'vitest'

import type {
  DomainArtifactConsumer,
  DomainMainAfterTurnEvent,
  DomainTurnArtifactEvent
} from '@sciforge/domain-sdk/host'
import type {
  PrincipalContextSnapshot,
  PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'

import { TurnArtifactHandoffService } from './turn-artifact-handoff-service'
import {
  TurnArtifactOutbox,
  turnArtifactIntentKey,
  type TurnArtifactIntent,
  type TurnArtifactReplayIntent,
  type TurnArtifactStart,
  type TurnArtifactStartDraft,
  type TurnArtifactWatch
} from './turn-artifact-outbox'

const roots: string[] = []

const HOST_PRINCIPAL: PrincipalSnapshot = Object.freeze({
  authority: 'identity-access.local',
  subject: 'user-a',
  assurance: 'local-selection',
  deviceId: 'device-a',
  identityVersion: 7
})

const FORGED_PRINCIPAL: PrincipalSnapshot = Object.freeze({
  authority: 'forged.provider',
  subject: 'attacker',
  assurance: 'cloud-authenticated',
  deviceId: 'untrusted-device',
  identityVersion: 99
})

const SIGNED_OUT_CONTEXT: PrincipalContextSnapshot = Object.freeze({
  identityVersion: 11,
  principal: null
})

const HOST_PRINCIPAL_CONTEXT: PrincipalContextSnapshot = Object.freeze({
  identityVersion: HOST_PRINCIPAL.identityVersion,
  principal: HOST_PRINCIPAL
})

const FORGED_PRINCIPAL_CONTEXT: PrincipalContextSnapshot = Object.freeze({
  identityVersion: FORGED_PRINCIPAL.identityVersion,
  principal: FORGED_PRINCIPAL
})

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('TurnArtifactHandoffService', () => {
  it('persists a recovery-safe prepared phase before crossing into dispatching', async () => {
    const root = await temporaryRoot()
    const service = handoff({
      outbox: new TurnArtifactOutbox(root),
      materialize: async (value) => event(value, 'unused'),
      consumers: []
    })

    const prepared = await service.registerStart(startDraft({
      threadId: 'thread-start-phase',
      clientDirectiveId: 'directive-start-phase'
    }))
    assert.equal(prepared.phase, 'prepared')

    const recoveredPrepared = new TurnArtifactOutbox(root)
    await recoveredPrepared.load()
    const recoverySafe = recoveredPrepared.pendingStarts()[0]
    assert.equal(recoverySafe?.phase, 'prepared')
    assert.ok(recoverySafe)

    const dispatching = await service.markStartDispatching(prepared)
    assert.equal(dispatching.phase, 'dispatching')
    assert.equal((await service.markStartDispatching(prepared)).phase, 'dispatching')

    const recoveredDispatching = new TurnArtifactOutbox(root)
    await recoveredDispatching.load()
    assert.equal(recoveredDispatching.pendingStarts()[0]?.phase, 'dispatching')
    await service.close()
  })

  it('migrates a phase-less V5 start conservatively as dispatching', async () => {
    const root = await temporaryRoot()
    const first = new TurnArtifactOutbox(root)
    const prepared = await first.registerStart(startDraft({
      threadId: 'thread-v5-start-phase',
      clientDirectiveId: 'directive-v5-start-phase'
    }))
    assert.equal(prepared.phase, 'prepared')
    const persisted = JSON.parse(await readFile(first.path, 'utf8')) as {
      version: number
      starts: Array<Record<string, unknown>>
    }
    persisted.version = 5
    for (const start of persisted.starts) delete start.phase
    await writeFile(first.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const recovered = new TurnArtifactOutbox(root)
    await recovered.load()
    assert.equal(recovered.pendingStarts()[0]?.phase, 'dispatching')
    const migrated = JSON.parse(await readFile(recovered.path, 'utf8')) as {
      version: number
      starts: Array<{ phase?: unknown }>
    }
    assert.equal(migrated.version, 6)
    assert.equal(migrated.starts[0]?.phase, 'dispatching')
  })

  it('refuses provider acceptance while a durable start is still prepared', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const prepared = await outbox.registerStart(startDraft({
      threadId: 'thread-prepared-bind',
      clientDirectiveId: 'directive-prepared-bind'
    }))

    await assert.rejects(
      outbox.bindStart(prepared, {
        ...prepared,
        turnId: 'turn-prepared-bind',
        bindingSource: 'provider-accepted'
      }),
      /must be marked dispatching/
    )
    assert.equal(outbox.pendingStarts()[0]?.phase, 'prepared')
    assert.equal(outbox.pendingWatches().length, 0)
  })

  it('preserves the signed-out Principal context version at durable start', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)

    const start = await outbox.registerStart({
      ...startDraft(),
      principal: null,
      principalContext: SIGNED_OUT_CONTEXT
    } as TurnArtifactStartDraft)

    assert.deepEqual(
      (start as TurnArtifactStart & { principalContext?: PrincipalContextSnapshot }).principalContext,
      SIGNED_OUT_CONTEXT
    )
  })

  it('carries the exact signed-out Principal context through materialization and restart', async () => {
    const root = await temporaryRoot()
    const first = new TurnArtifactOutbox(root)
    const accepted = await acceptTurn(first, {
      turnId: 'turn-signed-out-context',
      principal: null,
      principalContext: SIGNED_OUT_CONTEXT
    })
    await first.enqueueIntent(accepted.intent)
    const key = turnArtifactIntentKey(accepted.intent)
    const untrusted = {
      ...event(accepted.intent, 'signed-out-context'),
      principal: FORGED_PRINCIPAL,
      principalContext: FORGED_PRINCIPAL_CONTEXT
    } as unknown as DomainTurnArtifactEvent

    const materialized = await first.markMaterialized(key, untrusted)
    assert.deepEqual(materialized.intent.principalContext, SIGNED_OUT_CONTEXT)
    assert.deepEqual(materialized.event.principalContext, SIGNED_OUT_CONTEXT)
    assert.deepEqual(
      first.readyLifecycleSettlements()[0]?.event.principalContext,
      SIGNED_OUT_CONTEXT
    )
    assert.deepEqual(
      first.durableTurnBoundarySnapshot().owners[0]?.principalContext,
      SIGNED_OUT_CONTEXT
    )

    const recovered = new TurnArtifactOutbox(root)
    await recovered.load()
    const replay = recovered.record(key)
    assert.deepEqual(replay?.intent.principalContext, SIGNED_OUT_CONTEXT)
    assert.deepEqual(
      replay?.stage === 'pending_fanout' ? replay.event.principalContext : undefined,
      SIGNED_OUT_CONTEXT
    )
    assert.deepEqual(
      recovered.readyLifecycleSettlements()[0]?.event.principalContext,
      SIGNED_OUT_CONTEXT
    )
  })

  it('rejects a signed-out ABA context collision for the same accepted turn', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const accepted = await acceptTurn(outbox, {
      turnId: 'turn-signed-out-aba',
      principal: null,
      principalContext: SIGNED_OUT_CONTEXT
    })
    await outbox.enqueueIntent(accepted.intent)

    await assert.rejects(
      outbox.enqueueIntent({
        ...accepted.intent,
        principalContext: Object.freeze({
          identityVersion: SIGNED_OUT_CONTEXT.identityVersion + 2,
          principal: null
        })
      }),
      /intent key collision/
    )
  })

  it('retains signed-out context in receipts and rejects an ABA replay after restart', async () => {
    const root = await temporaryRoot()
    const first = new TurnArtifactOutbox(root)
    const accepted = await acceptTurn(first, {
      turnId: 'turn-signed-out-receipt',
      principal: null,
      principalContext: SIGNED_OUT_CONTEXT
    })
    const key = turnArtifactIntentKey(accepted.intent)
    await first.enqueueIntent(accepted.intent)
    await first.markMaterialized(key, event(accepted.intent, 'receipt-context'))
    await first.markDelivered(key)
    const lifecycle = first.readyLifecycleSettlements()[0]
    assert.ok(lifecycle)
    await first.markLifecycleSettlementDelivered(lifecycle.key)

    const persisted = JSON.parse(await readFile(first.path, 'utf8')) as {
      receipts: Array<{
        principalContext?: unknown
        principalContextDigest?: unknown
      }>
      lifecycleReceipts: Array<{ event: DomainMainAfterTurnEvent }>
    }
    assert.deepEqual(persisted.receipts[0]?.principalContext, SIGNED_OUT_CONTEXT)
    assert.match(String(persisted.receipts[0]?.principalContextDigest), /^[a-f0-9]{64}$/)
    assert.deepEqual(
      persisted.lifecycleReceipts[0]?.event.principalContext,
      SIGNED_OUT_CONTEXT
    )

    const recovered = new TurnArtifactOutbox(root)
    await recovered.load()
    assert.deepEqual(
      recovered.durableTurnBoundarySnapshot().owners[0]?.principalContext,
      SIGNED_OUT_CONTEXT
    )
    await assert.rejects(
      recovered.enqueueIntent({
        ...accepted.intent,
        principalContext: Object.freeze({
          identityVersion: SIGNED_OUT_CONTEXT.identityVersion + 2,
          principal: null
        })
      }),
      /intent key collision/
    )
  })

  it('does not let a completed intent replace the accepted watch Principal context', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const accepted = await acceptTurn(outbox, {
      turnId: 'turn-watch-context-forgery',
      principal: null,
      principalContext: SIGNED_OUT_CONTEXT
    })

    await assert.rejects(
      outbox.enqueueIntent({
        ...accepted.intent,
        principalContext: Object.freeze({
          identityVersion: SIGNED_OUT_CONTEXT.identityVersion + 2,
          principal: null
        })
      }),
      /watch does not match completed intent/
    )
    assert.deepEqual(
      outbox.pendingWatches()[0]?.principalContext,
      SIGNED_OUT_CONTEXT
    )
  })

  it('rejects reuse of a directive under a different signed-out context version', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    await outbox.registerStart(startDraft({
      principal: null,
      principalContext: SIGNED_OUT_CONTEXT
    }))

    await assert.rejects(
      outbox.registerStart(startDraft({
        principal: null,
        principalContext: Object.freeze({
          identityVersion: SIGNED_OUT_CONTEXT.identityVersion + 2,
          principal: null
        })
      })),
      /start key collision/
    )
  })

  it('rejects a signed-in Principal with an explicit null context', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)

    await assert.rejects(
      outbox.registerStart({
        ...startDraft({
          principal: HOST_PRINCIPAL,
          principalContext: HOST_PRINCIPAL_CONTEXT
        }),
        principalContext: null
      }),
      /signed-in Principal requires an exact context/
    )

    const accepted = await acceptTurn(outbox, {
      turnId: 'turn-v5-explicit-null',
      clientDirectiveId: 'directive-v5-explicit-null',
      principal: HOST_PRINCIPAL,
      principalContext: HOST_PRINCIPAL_CONTEXT
    })
    const persisted = JSON.parse(await readFile(outbox.path, 'utf8')) as {
      watches: Array<Record<string, unknown>>
    }
    persisted.watches[0]!.principalContext = null
    await writeFile(outbox.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const recovered = new TurnArtifactOutbox(root)
    await assert.rejects(
      recovered.load(),
      /signed-in Principal requires an exact context/
    )
    assert.deepEqual(accepted.intent.principalContext, HOST_PRINCIPAL_CONTEXT)
  })

  it('rejects an explicit null Principal context in a compact receipt', async () => {
    const root = await temporaryRoot()
    const first = new TurnArtifactOutbox(root)
    const accepted = await acceptTurn(first, {
      turnId: 'turn-null-receipt-context',
      principal: HOST_PRINCIPAL,
      principalContext: HOST_PRINCIPAL_CONTEXT
    })
    const key = turnArtifactIntentKey(accepted.intent)
    await first.enqueueIntent(accepted.intent)
    await first.markMaterialized(key, event(accepted.intent, 'null-receipt-context'))
    await first.markDelivered(key)
    const persisted = JSON.parse(await readFile(first.path, 'utf8')) as {
      receipts: Array<Record<string, unknown>>
    }
    persisted.receipts[0]!.principalContext = null
    await writeFile(first.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const recovered = new TurnArtifactOutbox(root)
    await assert.rejects(
      recovered.load(),
      /receipt Principal context is invalid/
    )
  })

  it('rejects conflicting boundary Principal contexts before restart replay', async () => {
    const root = await temporaryRoot()
    const first = new TurnArtifactOutbox(root)
    const accepted = await acceptTurn(first, {
      turnId: 'turn-restart-context-collision',
      principal: null,
      principalContext: SIGNED_OUT_CONTEXT
    })
    await first.enqueueIntent(accepted.intent)
    const persisted = JSON.parse(await readFile(first.path, 'utf8')) as {
      lifecycleSettlements: Array<{ event: Record<string, unknown> }>
    }
    persisted.lifecycleSettlements[0]!.event.principalContext = {
      identityVersion: SIGNED_OUT_CONTEXT.identityVersion + 2,
      principal: null
    }
    await writeFile(first.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const recovered = new TurnArtifactOutbox(root)
    await assert.rejects(
      recovered.load(),
      /boundary Principal attribution collision/
    )
    assert.equal(recovered.readyLifecycleSettlements().length, 0)
  })

  it('durably preserves the Host turn principal and overwrites materializer claims', async () => {
    const root = await temporaryRoot()
    const first = new TurnArtifactOutbox(root)
    const draft = {
      ...startDraft(),
      principal: HOST_PRINCIPAL,
      principalContext: HOST_PRINCIPAL_CONTEXT
    } as TurnArtifactStartDraft
    const start = await first.registerStart(draft)
    const watch = {
      ...start,
      turnId: 'turn-principal',
      bindingSource: 'provider-accepted' as const
    }
    await first.markStartDispatching(start)
    await first.bindStart(start, watch)
    const intent = intentFor(start, watch.turnId)
    const key = turnArtifactIntentKey(intent)
    await first.enqueueIntent(intent)

    const untrusted = {
      ...event(intent, 'provider-materialized'),
      principal: FORGED_PRINCIPAL,
      principalContext: FORGED_PRINCIPAL_CONTEXT,
      artifacts: [{ id: 'assistant-1', kind: 'assistant_message', principal: FORGED_PRINCIPAL }]
    } as unknown as DomainTurnArtifactEvent
    const materialized = await first.markMaterialized(key, untrusted)

    assert.deepEqual(materialized.intent.principal, HOST_PRINCIPAL)
    assert.deepEqual(materialized.intent.principalContext, HOST_PRINCIPAL_CONTEXT)
    assert.deepEqual(materialized.event.principal, HOST_PRINCIPAL)
    assert.deepEqual(materialized.event.principalContext, HOST_PRINCIPAL_CONTEXT)
    assert.deepEqual(
      (materialized.event.artifacts[0] as { principal?: PrincipalSnapshot }).principal,
      HOST_PRINCIPAL
    )
    assert.deepEqual(first.readyLifecycleSettlements()[0]?.event.principal, HOST_PRINCIPAL)
    assert.deepEqual(
      first.readyLifecycleSettlements()[0]?.event.principalContext,
      HOST_PRINCIPAL_CONTEXT
    )
    assert.deepEqual(
      first.durableTurnBoundarySnapshot().owners[0]?.principal,
      HOST_PRINCIPAL
    )
    assert.deepEqual(
      first.durableTurnBoundarySnapshot().owners[0]?.principalContext,
      HOST_PRINCIPAL_CONTEXT
    )

    const recovered = new TurnArtifactOutbox(root)
    await recovered.load()
    const replay = recovered.record(key)
    assert.equal(replay?.stage, 'pending_fanout')
    assert.deepEqual(replay?.intent.principal, HOST_PRINCIPAL)
    assert.deepEqual(replay?.intent.principalContext, HOST_PRINCIPAL_CONTEXT)
    assert.deepEqual(
      replay?.stage === 'pending_fanout' ? replay.event.principal : undefined,
      HOST_PRINCIPAL
    )
    assert.deepEqual(
      replay?.stage === 'pending_fanout' ? replay.event.principalContext : undefined,
      HOST_PRINCIPAL_CONTEXT
    )
    assert.deepEqual(
      recovered.readyLifecycleSettlements()[0]?.event.principal,
      HOST_PRINCIPAL
    )
    assert.deepEqual(
      recovered.readyLifecycleSettlements()[0]?.event.principalContext,
      HOST_PRINCIPAL_CONTEXT
    )
    await assert.rejects(
      recovered.enqueueIntent({
        ...intent,
        principal: FORGED_PRINCIPAL,
        principalContext: FORGED_PRINCIPAL_CONTEXT
      }),
      /intent key collision/
    )
  })

  it('migrates a prior V5 signed-in Principal projection to its exact context', async () => {
    const root = await temporaryRoot()
    const first = new TurnArtifactOutbox(root)
    await acceptTurn(first, {
      turnId: 'turn-v5-principal-context',
      principal: HOST_PRINCIPAL,
      principalContext: HOST_PRINCIPAL_CONTEXT
    })
    const persisted = JSON.parse(await readFile(first.path, 'utf8')) as {
      version: number
      watches: Array<Record<string, unknown>>
    }
    assert.equal(persisted.version, 6)
    persisted.version = 5
    for (const watch of persisted.watches) delete watch.principalContext
    await writeFile(first.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const recovered = new TurnArtifactOutbox(root)
    await recovered.load()
    assert.deepEqual(
      recovered.pendingWatches()[0]?.principalContext,
      HOST_PRINCIPAL_CONTEXT
    )
    const migrated = JSON.parse(await readFile(recovered.path, 'utf8')) as {
      version: number
      watches: Array<{ principalContext?: unknown }>
    }
    assert.equal(migrated.version, 6)
    assert.deepEqual(migrated.watches[0]?.principalContext, HOST_PRINCIPAL_CONTEXT)
  })

  it('migrates prior V5 signed-in receipts without changing their intent proof', async () => {
    const root = await temporaryRoot()
    const first = new TurnArtifactOutbox(root)
    const accepted = await acceptTurn(first, {
      turnId: 'turn-v5-principal-receipt',
      principal: HOST_PRINCIPAL,
      principalContext: HOST_PRINCIPAL_CONTEXT
    })
    const key = turnArtifactIntentKey(accepted.intent)
    await first.enqueueIntent(accepted.intent)
    await first.markMaterialized(key, event(accepted.intent, 'v5-principal-receipt'))
    await first.markDelivered(key)
    const lifecycle = first.readyLifecycleSettlements()[0]
    assert.ok(lifecycle)
    await first.markLifecycleSettlementDelivered(lifecycle.key)

    const persisted = JSON.parse(await readFile(first.path, 'utf8')) as {
      version: number
      receipts: Array<Record<string, unknown>>
      lifecycleReceipts: Array<{ event: Record<string, unknown> }>
    }
    assert.equal(persisted.version, 6)
    persisted.version = 5
    for (const receipt of persisted.receipts) {
      delete receipt.outcome
      delete receipt.principalContext
      delete receipt.principalContextDigest
    }
    for (const receipt of persisted.lifecycleReceipts) {
      delete receipt.event.principalContext
    }
    await writeFile(first.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const recovered = new TurnArtifactOutbox(root)
    await recovered.load()
    assert.deepEqual(
      recovered.durableTurnBoundarySnapshot().owners[0]?.principalContext,
      HOST_PRINCIPAL_CONTEXT
    )
    assert.equal(await recovered.enqueueIntent(accepted.intent), undefined)

    const migrated = JSON.parse(await readFile(recovered.path, 'utf8')) as {
      version: number
      receipts: Array<{
        outcome?: unknown
        principalContext?: unknown
        principalContextDigest?: unknown
      }>
      lifecycleReceipts: Array<{ event: { principalContext?: unknown } }>
    }
    assert.equal(migrated.version, 6)
    assert.equal(migrated.receipts[0]?.outcome, 'delivered')
    assert.equal(recovered.wasDelivered(key), true)
    assert.deepEqual(migrated.receipts[0]?.principalContext, HOST_PRINCIPAL_CONTEXT)
    assert.match(String(migrated.receipts[0]?.principalContextDigest), /^[a-f0-9]{64}$/)
    assert.deepEqual(
      migrated.lifecycleReceipts[0]?.event.principalContext,
      HOST_PRINCIPAL_CONTEXT
    )
  })

  it('migrates a prior V5 signed-out projection to unknown without inventing a version', async () => {
    const root = await temporaryRoot()
    const first = new TurnArtifactOutbox(root)
    await acceptTurn(first, { turnId: 'turn-v5-signed-out-unknown' })
    const persisted = JSON.parse(await readFile(first.path, 'utf8')) as {
      version: number
      watches: Array<Record<string, unknown>>
    }
    persisted.version = 5
    for (const watch of persisted.watches) delete watch.principalContext
    await writeFile(first.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const recovered = new TurnArtifactOutbox(root)
    await recovered.load()
    assert.equal(recovered.pendingWatches()[0]?.principal, null)
    assert.equal(recovered.pendingWatches()[0]?.principalContext, null)

    const migrated = JSON.parse(await readFile(recovered.path, 'utf8')) as {
      version: number
      watches: Array<{ principalContext?: unknown }>
    }
    assert.equal(migrated.version, 6)
    assert.equal(migrated.watches[0]?.principalContext, null)
  })

  it('keeps V4 watches recoverable without rebinding their unknown Principal', async () => {
    const root = await temporaryRoot()
    const first = new TurnArtifactOutbox(root)
    await acceptTurn(first, { turnId: 'turn-v4-principal' })
    const persisted = JSON.parse(await readFile(first.path, 'utf8')) as {
      version: number
      watches: Array<Record<string, unknown>>
    }
    persisted.version = 4
    for (const watch of persisted.watches) {
      delete watch.principal
      delete watch.principalContext
    }
    await writeFile(first.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const recovered = new TurnArtifactOutbox(root)
    await recovered.load()
    assert.equal(recovered.pendingWatches()[0]?.principal, null)
    assert.equal(recovered.pendingWatches()[0]?.principalContext, null)

    const migrated = JSON.parse(await readFile(recovered.path, 'utf8')) as {
      version: number
      watches: Array<{ principal?: unknown; principalContext?: unknown }>
    }
    assert.equal(migrated.version, 6)
    assert.equal(migrated.watches[0]?.principal, null)
    assert.equal(migrated.watches[0]?.principalContext, null)

    const legacyWatch = recovered.pendingWatches()[0]
    assert.ok(legacyWatch)
    const completed = {
      ...legacyWatch,
      sequence: 7,
      occurredAt: '2026-08-05T00:00:00.000Z'
    } satisfies TurnArtifactIntent
    await recovered.enqueueIntent(completed)
    assert.equal(recovered.record(turnArtifactIntentKey(completed))?.intent.principalContext, null)
  })

  it('removes forged Principal claims from a signed-out turn artifact', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const { intent } = await acceptTurn(outbox, { turnId: 'turn-signed-out' })
    const key = turnArtifactIntentKey(intent)
    await outbox.enqueueIntent(intent)
    const untrusted = {
      ...event(intent, 'signed-out'),
      principal: FORGED_PRINCIPAL,
      artifacts: [{ id: 'assistant-signed-out', principal: FORGED_PRINCIPAL }]
    } as unknown as DomainTurnArtifactEvent

    const materialized = await outbox.markMaterialized(key, untrusted)
    assert.equal(materialized.intent.principal, null)
    assert.equal(materialized.event.principal, undefined)
    assert.equal(
      (materialized.event.artifacts[0] as { principal?: PrincipalSnapshot }).principal,
      undefined
    )
  })

  it('binds rejected lifecycle settlement to the durable start Principal', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const start = await outbox.registerStart({
      ...startDraft(),
      principal: HOST_PRINCIPAL,
      principalContext: HOST_PRINCIPAL_CONTEXT
    })
    const forgedSettlement = {
      ...lifecycleFor(start, undefined, undefined, 'rejected'),
      principal: FORGED_PRINCIPAL,
      principalContext: FORGED_PRINCIPAL_CONTEXT
    }

    await outbox.rejectStart(start, forgedSettlement)
    assert.deepEqual(
      outbox.readyLifecycleSettlements()[0]?.event.principal,
      HOST_PRINCIPAL
    )
    assert.deepEqual(
      outbox.readyLifecycleSettlements()[0]?.event.principalContext,
      HOST_PRINCIPAL_CONTEXT
    )
    assert.deepEqual(
      outbox.durableTurnBoundarySnapshot().owners[0]?.principal,
      HOST_PRINCIPAL
    )
    assert.deepEqual(
      outbox.durableTurnBoundarySnapshot().owners[0]?.principalContext,
      HOST_PRINCIPAL_CONTEXT
    )

    const recovered = new TurnArtifactOutbox(root)
    await recovered.load()
    assert.deepEqual(
      recovered.readyLifecycleSettlements()[0]?.event.principal,
      HOST_PRINCIPAL
    )
    assert.deepEqual(
      recovered.readyLifecycleSettlements()[0]?.event.principalContext,
      HOST_PRINCIPAL_CONTEXT
    )
  })

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

    const accepted = await acceptTurn(service)
    const value = accepted.intent
    await service.publish(value)
    await service.publish(value)

    assert.equal(outbox.all().length, 1)
    await service.replayPending()
    assert.equal(materializations, 1)
    assert.equal(delivered.length, 1)
    assert.equal(outbox.all().length, 0)
    assert.equal(outbox.wasDelivered(turnArtifactIntentKey(value)), true)

    await service.publish(value)
    await service.replayPending()
    assert.equal(materializations, 1)
    assert.equal(delivered.length, 1)
    await assert.rejects(
      service.publish({ ...value, occurredAt: '2026-08-05T00:00:01.000Z' }),
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
    await recovered.publish(value)
    await recovered.replayPending()
    assert.equal(materializations, 1)
    assert.equal(delivered.length, 1)
    await recovered.close()
  })

  it('rejects a repeated identity when any immutable intent field differs', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const { intent: original } = await acceptTurn(outbox)
    await outbox.enqueueIntent(original)

    for (const changed of [
      { ...original, sequence: 8 },
      { ...original, workspaceRoot: '/another-workspace' },
      { ...original, occurredAt: '2026-08-05T00:00:01.000Z' }
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
    const { intent: value } = await acceptTurn(outbox, { turnId: 'turn-envelope' })
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
    const { intent: unbound } = await acceptTurn(firstOutbox, {
      turnId: 'turn-authoritative-bind',
      workspaceRoot: undefined
    })
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
    const { intent: unbound } = await acceptTurn(outbox, {
      turnId: 'turn-invalid-authoritative-bind',
      workspaceRoot: undefined
    })
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
    const { intent: value } = await acceptTurn(service, { turnId: 'turn-transient' })

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

  it('quarantines an unmaterializable legacy artifact after bounded retries and unblocks the same flush', async () => {
    const root = await temporaryRoot()
    const firstOutbox = new TurnArtifactOutbox(root)
    const { intent } = await acceptTurn(firstOutbox, {
      threadId: 'thread-legacy-quarantine',
      turnId: 'turn-legacy-quarantine'
    })
    const key = turnArtifactIntentKey(intent)
    await firstOutbox.enqueueIntent(intent)
    await rewriteRecordAsLegacyArtifactOnly(firstOutbox, key)

    const outbox = new TurnArtifactOutbox(root)
    await outbox.load()
    assert.equal(outbox.record(key)?.legacyArtifactOnly, true)
    let materializations = 0
    const logs: Array<{ level: string; message: string; detail?: unknown }> = []
    const service = handoff({
      outbox,
      materialize: async () => {
        materializations += 1
        throw new Error('legacy thread is permanently unavailable')
      },
      consumers: [],
      log: (level, message, detail) => { logs.push({ level, message, detail }) }
    })

    for (let attempt = 1; attempt < 8; attempt += 1) {
      await assert.rejects(
        service.flushThread(intent.runtimeId, intent.threadId),
        /predecessor flush failed/
      )
      assert.equal(outbox.record(key)?.attempts, attempt)
    }
    await service.flushThread(intent.runtimeId, intent.threadId)

    assert.equal(materializations, 8)
    assert.equal(outbox.record(key), undefined)
    assert.equal(outbox.wasDelivered(key), false)
    assert.equal(outbox.nextAttemptAt(), null)
    assert.equal(logs.length, 1)
    assert.match(logs[0]?.message ?? '', /quarantined after bounded retries/)
    const persisted = JSON.parse(await readFile(outbox.path, 'utf8')) as {
      records: unknown[]
      receipts: Array<Record<string, unknown>>
    }
    assert.equal(persisted.records.length, 0)
    assert.equal(persisted.receipts[0]?.key, key)
    assert.equal(
      persisted.receipts[0]?.outcome,
      'legacy_materialization_quarantined'
    )
    assert.equal(persisted.receipts[0]?.attempts, 8)
    assert.equal(
      persisted.receipts[0]?.error,
      'legacy thread is permanently unavailable'
    )
    assert.equal(persisted.receipts[0]?.workspaceRoot, undefined)
    assert.equal(persisted.receipts[0]?.fileBaseline, undefined)
    assert.equal(persisted.receipts[0]?.fileEffects, undefined)

    await service.close()
    const restartedOutbox = new TurnArtifactOutbox(root)
    await restartedOutbox.load()
    let replayedMaterializations = 0
    const restarted = handoff({
      outbox: restartedOutbox,
      materialize: async (value) => {
        replayedMaterializations += 1
        return event(value, 'must-not-replay-quarantine')
      },
      consumers: []
    })
    await restarted.replayPending()
    assert.equal(replayedMaterializations, 0)
    assert.equal(restartedOutbox.wasDelivered(key), false)
    assert.equal(restartedOutbox.nextAttemptAt(), null)
    await restarted.close()
  })

  it('never quarantines Host-owned materialization retries', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const service = handoff({
      outbox,
      materialize: async () => { throw new Error('modern thread temporarily unavailable') },
      consumers: []
    })
    const { intent } = await acceptTurn(service, {
      threadId: 'thread-modern-retry',
      turnId: 'turn-modern-retry'
    })
    const key = turnArtifactIntentKey(intent)
    await service.publish(intent)

    for (let attempt = 1; attempt <= 9; attempt += 1) {
      await assert.rejects(
        service.flushThread(intent.runtimeId, intent.threadId),
        /predecessor flush failed/
      )
    }
    assert.equal(outbox.record(key)?.stage, 'pending_materialization')
    assert.equal(outbox.record(key)?.attempts, 9)
    assert.equal(outbox.wasDelivered(key), false)
    await assert.rejects(
      outbox.markLegacyMaterializationQuarantined(key, 'must not quarantine'),
      /Only a legacy artifact-only pending materialization/
    )
    await service.close()
  })

  it('never quarantines a materialized legacy event whose consumer is unavailable', async () => {
    const root = await temporaryRoot()
    const firstOutbox = new TurnArtifactOutbox(root)
    const { intent } = await acceptTurn(firstOutbox, {
      threadId: 'thread-legacy-fanout',
      turnId: 'turn-legacy-fanout'
    })
    const key = turnArtifactIntentKey(intent)
    await firstOutbox.enqueueIntent(intent)
    await firstOutbox.markMaterialized(key, event(intent, 'legacy-immutable-event'))
    await rewriteRecordAsLegacyArtifactOnly(firstOutbox, key)

    const outbox = new TurnArtifactOutbox(root)
    await outbox.load()
    let materializations = 0
    const service = handoff({
      outbox,
      materialize: async (value) => {
        materializations += 1
        return event(value, 'must-not-rematerialize')
      },
      consumers: [{ consume: async () => { throw new Error('consumer remains unavailable') } }]
    })

    for (let attempt = 1; attempt <= 9; attempt += 1) {
      await assert.rejects(
        service.flushThread(intent.runtimeId, intent.threadId),
        /predecessor flush failed/
      )
    }
    assert.equal(materializations, 0)
    assert.equal(outbox.record(key)?.stage, 'pending_fanout')
    assert.equal(outbox.record(key)?.attempts, 9)
    assert.equal(outbox.wasDelivered(key), false)
    await assert.rejects(
      outbox.markLegacyMaterializationQuarantined(key, 'must not quarantine'),
      /Only a legacy artifact-only pending materialization/
    )
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
    const { intent: value } = await acceptTurn(first, { turnId: 'turn-restart' })

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
    const { intent: value } = await acceptTurn(service, { turnId: 'turn-partial' })

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

  it('persists a rejected lifecycle subscriber and replays it after restart', async () => {
    const root = await temporaryRoot()
    const first = handoff({
      outbox: new TurnArtifactOutbox(root),
      materialize: async (value) => event(value, 'unused'),
      consumers: [],
      lifecycleConsumer: async () => { throw new Error('checkpoint store offline') }
    })
    const accepted = await acceptTurn(first)
    const terminal = lifecycleFor(accepted.start, accepted.watch.turnId, undefined, 'failed')
    await first.publishLifecycleSettlement(terminal)
    const pending = (await first.readDurableTurnBoundarySnapshot()).owners
    assert.equal(pending[0]?.boundaryLeaseId, terminal.boundaryLeaseId)
    assert.equal(pending[0]?.phase, 'terminal-settlement')
    assert.equal(pending[0]?.terminalState, 'failed')
    await first.close()

    const delivered: DomainMainAfterTurnEvent[] = []
    const recovered = handoff({
      outbox: new TurnArtifactOutbox(root),
      materialize: async (value) => event(value, 'unused'),
      consumers: [],
      lifecycleConsumer: async (value) => { delivered.push(value) }
    })
    await recovered.flushThread('codex', 'thread-1')
    assert.deepEqual(delivered, [terminal])
    assert.equal((await recovered.readDurableTurnBoundarySnapshot()).owners[0]?.phase, 'terminal-settlement')
    await recovered.close()
  })

  it('blocks completed artifact fan-out until its durable lifecycle settlement is acknowledged', async () => {
    const root = await temporaryRoot()
    const artifacts: DomainTurnArtifactEvent[] = []
    const first = handoff({
      outbox: new TurnArtifactOutbox(root),
      materialize: async (value) => event(value, 'completed-after-settlement'),
      consumers: [{ consume: async (value) => { artifacts.push(value as DomainTurnArtifactEvent) } }],
      lifecycleConsumer: async () => { throw new Error('lifecycle consumer offline') }
    })
    const accepted = await acceptTurn(first)
    await first.publish(accepted.intent)
    await first.publishLifecycleSettlement(accepted.lifecycle)
    assert.equal(artifacts.length, 0)
    await first.close()

    const ordering: string[] = []
    const recovered = handoff({
      outbox: new TurnArtifactOutbox(root),
      materialize: async (value) => event(value, 'completed-after-settlement'),
      consumers: [{ consume: async () => { ordering.push('artifact') } }],
      lifecycleConsumer: async () => { ordering.push('settlement') }
    })
    await recovered.flushThread('codex', 'thread-1')
    assert.deepEqual(ordering, ['settlement', 'artifact'])
    await recovered.close()
  })

  it('replays an accepted open watch to completion after a process restart', async () => {
    const root = await temporaryRoot()
    const first = handoff({
      outbox: new TurnArtifactOutbox(root),
      materialize: async (value) => event(value, 'unused-before-crash'),
      consumers: []
    })
    const accepted = await acceptTurn(first)
    await first.close()

    const artifacts: DomainTurnArtifactEvent[] = []
    const recovered = handoff({
      outbox: new TurnArtifactOutbox(root),
      materialize: async (value) => event(value, 'replayed-after-crash'),
      consumers: [{ consume: async (value) => { artifacts.push(value as DomainTurnArtifactEvent) } }]
    })
    assert.equal((await recovered.pending()).length, 1)
    await recovered.publish(accepted.intent)
    await recovered.flushThread('codex', 'thread-1')
    assert.equal(artifacts.length, 1)
    assert.deepEqual(artifacts[0]?.artifacts, [{ marker: 'replayed-after-crash' }])
    assert.equal((await recovered.readDurableTurnBoundarySnapshot()).owners[0]?.terminalState, 'completed')
    await recovered.close()
  })

  it('coalesces authoritative phases and fails closed on unresolved predecessors', async () => {
    const root = await temporaryRoot()
    const service = handoff({
      outbox: new TurnArtifactOutbox(root),
      materialize: async (value) => event(value, 'coalesced'),
      consumers: []
    })
    const draft = startDraft()
    const acceptedStart = await service.registerStart(draft)
    await assert.rejects(
      service.registerStart({ ...draft, workspaceRoot: '/different-workspace' }),
      /start key collision/
    )
    assert.equal((await service.readDurableTurnBoundarySnapshot()).owners[0]?.phase, 'pending-start')
    await assert.rejects(
      service.flushThread('codex', 'thread-1'),
      (error: unknown) => error instanceof AggregateError && error.errors.some(
        (cause) => String(cause).includes('unresolved accepted/prepared predecessor')
      )
    )
    const acceptedWatch: TurnArtifactWatch = {
      ...acceptedStart,
      turnId: 'turn-1',
      bindingSource: 'provider-accepted'
    }
    await service.markStartDispatching(acceptedStart)
    await service.bindStart(acceptedStart, acceptedWatch)
    assert.equal((await service.readDurableTurnBoundarySnapshot()).owners[0]?.phase, 'watching')
    const acceptedIntent = intentFor(acceptedStart, acceptedWatch.turnId)
    await service.publish(acceptedIntent)
    assert.equal((await service.readDurableTurnBoundarySnapshot()).owners[0]?.phase, 'terminal-settlement')
    await service.publishLifecycleSettlement(lifecycleFor(acceptedStart, acceptedWatch.turnId))
    const boundaries = (await service.readDurableTurnBoundarySnapshot()).owners
    assert.equal(boundaries.length, 1)
    assert.equal(boundaries[0]?.phase, 'terminal-settlement')
    assert.equal(boundaries[0]?.terminalState, 'completed')
    await service.close()
  })

  it('rejects a settlement that changes the durable workspace binding', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const acceptedStart = await outbox.registerStart(startDraft())
    await assert.rejects(
      outbox.enqueueLifecycleSettlement({
        ...lifecycleFor(acceptedStart, undefined, undefined, 'rejected'),
        state: 'rejected',
        turnId: undefined,
        workspaceRoot: '/different-workspace'
      }),
      /does not match its durable boundary owner/
    )
  })

  it('persists the explicit pending-start release source for audit and replay', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    const acceptedStart = await outbox.registerStart(startDraft())
    await outbox.enqueueLifecycleSettlement({
      ...lifecycleFor(acceptedStart, undefined, undefined, 'rejected'),
      settlementSource: 'explicit-pending-start-release'
    })

    const recovered = new TurnArtifactOutbox(root)
    await recovered.load()
    assert.equal(recovered.pendingStarts().length, 0)
    assert.equal(
      recovered.readyLifecycleSettlements()[0]?.event.settlementSource,
      'explicit-pending-start-release'
    )
    const boundary = recovered.durableTurnBoundarySnapshot().owners[0]
    assert.equal(boundary?.boundaryLeaseId, acceptedStart.boundaryLeaseId)
    assert.equal(boundary?.phase, 'terminal-settlement')
    assert.equal(boundary?.terminalState, 'rejected')
  })

  it('atomically resolves or releases each pending start exactly once', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)

    const raced = await outbox.registerStart(startDraft({
      threadId: 'thread-raced',
      clientDirectiveId: 'directive-raced'
    }))
    const racedWatch: TurnArtifactWatch = {
      ...raced,
      turnId: 'turn-raced',
      bindingSource: 'explicit-resolution'
    }
    const racedRelease = {
      ...lifecycleFor(raced, undefined, undefined, 'rejected'),
      settlementSource: 'explicit-pending-start-release' as const
    }
    await outbox.markStartDispatching(raced)
    const raceResults = await Promise.all([
      outbox.bindStart(raced, racedWatch),
      outbox.rejectStart(raced, racedRelease)
    ])
    assert.equal(raceResults.filter(Boolean).length, 1)
    assert.equal(outbox.pendingStarts().length, 0)
    assert.equal(
      outbox.pendingWatches().length + outbox.readyLifecycleSettlements().length,
      1
    )

    const releaseFirst = await outbox.registerStart(startDraft({
      threadId: 'thread-release-first',
      clientDirectiveId: 'directive-release-first'
    }))
    const releaseFirstWatch: TurnArtifactWatch = {
      ...releaseFirst,
      turnId: 'turn-release-first',
      bindingSource: 'explicit-resolution'
    }
    const releaseFirstEvent = {
      ...lifecycleFor(releaseFirst, undefined, undefined, 'rejected'),
      settlementSource: 'explicit-pending-start-release' as const
    }
    await outbox.markStartDispatching(releaseFirst)
    assert.deepEqual(await Promise.all([
      outbox.rejectStart(releaseFirst, releaseFirstEvent),
      outbox.bindStart(releaseFirst, releaseFirstWatch)
    ]), [true, false])
    assert.equal(outbox.pendingWatches().some(
      (watch) => watch.boundaryLeaseId === releaseFirst.boundaryLeaseId
    ), false)
    assert.equal(outbox.readyLifecycleSettlements().some(
      (record) => record.event.boundaryLeaseId === releaseFirst.boundaryLeaseId
    ), true)

    const doubleResolve = await outbox.registerStart(startDraft({
      threadId: 'thread-double-resolve',
      clientDirectiveId: 'directive-double-resolve'
    }))
    await outbox.markStartDispatching(doubleResolve)
    const differentHandles = await Promise.allSettled([
      outbox.bindStart(doubleResolve, {
        ...doubleResolve,
        turnId: 'turn-resolution-a',
        bindingSource: 'explicit-resolution'
      }),
      outbox.bindStart(doubleResolve, {
        ...doubleResolve,
        turnId: 'turn-resolution-b',
        bindingSource: 'explicit-resolution'
      })
    ])
    assert.equal(differentHandles.filter(
      (result) => result.status === 'fulfilled' && result.value
    ).length, 1)
    const collision = differentHandles.find((result) => result.status === 'rejected')
    assert.match(String(collision && collision.status === 'rejected' ? collision.reason : ''), /collision/)

    const doubleRelease = await outbox.registerStart(startDraft({
      threadId: 'thread-double-release',
      clientDirectiveId: 'directive-double-release'
    }))
    const doubleReleaseEvent = {
      ...lifecycleFor(doubleRelease, undefined, undefined, 'rejected'),
      settlementSource: 'explicit-pending-start-release' as const
    }
    const releaseResults = await Promise.all([
      outbox.rejectStart(doubleRelease, doubleReleaseEvent),
      outbox.rejectStart(doubleRelease, doubleReleaseEvent)
    ])
    assert.deepEqual([...releaseResults].sort(), [false, true])

    const restarted = new TurnArtifactOutbox(root)
    await restarted.load()
    assert.equal(await restarted.rejectStart(doubleRelease, doubleReleaseEvent), false)
    assert.equal(restarted.pendingStarts().length, 0)
    assert.equal(restarted.pendingWatches().some(
      (watch) => watch.boundaryLeaseId === doubleRelease.boundaryLeaseId
    ), false)

    const resolvedBeforeRestart = await outbox.registerStart(startDraft({
      threadId: 'thread-resolved-before-restart',
      clientDirectiveId: 'directive-resolved-before-restart'
    }))
    const resolvedWatch: TurnArtifactWatch = {
      ...resolvedBeforeRestart,
      turnId: 'turn-resolved-before-restart',
      bindingSource: 'explicit-resolution'
    }
    await outbox.markStartDispatching(resolvedBeforeRestart)
    assert.equal(await outbox.bindStart(resolvedBeforeRestart, resolvedWatch), true)
    const afterResolveRestart = new TurnArtifactOutbox(root)
    await afterResolveRestart.load()
    assert.equal(await afterResolveRestart.rejectStart(resolvedBeforeRestart, {
      ...lifecycleFor(resolvedBeforeRestart, undefined, undefined, 'rejected'),
      settlementSource: 'explicit-pending-start-release'
    }), false)
    assert.equal(afterResolveRestart.pendingWatches().some(
      (watch) => watch.boundaryLeaseId === resolvedBeforeRestart.boundaryLeaseId
    ), true)

    assert.equal(await restarted.bindStart(doubleRelease, {
      ...doubleRelease,
      turnId: 'turn-stale-after-release',
      bindingSource: 'explicit-resolution'
    }), false)
    assert.equal(restarted.pendingWatches().some(
      (watch) => watch.boundaryLeaseId === doubleRelease.boundaryLeaseId
    ), false)
  })

  it('fails closed when an issued ordinal is neither live nor exactly retired', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root)
    await outbox.registerStart(startDraft({
      threadId: 'thread-first',
      clientDirectiveId: 'directive-first'
    }))
    await outbox.registerStart(startDraft({
      threadId: 'thread-second',
      clientDirectiveId: 'directive-second'
    }))
    const persisted = JSON.parse(await readFile(outbox.path, 'utf8')) as {
      starts: unknown[]
    }
    persisted.starts.shift()
    await writeFile(outbox.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    await assert.rejects(
      new TurnArtifactOutbox(root).load(),
      /ledger is missing ordinal 1/
    )
  })

  it('bounds mixed terminal receipts with an exact sparse retirement ledger across restart', async () => {
    const root = await temporaryRoot()
    const outbox = new TurnArtifactOutbox(root, {
      maxArtifactReceipts: 1,
      maxLifecycleReceipts: 1
    })
    const service = handoff({
      outbox,
      materialize: async (value) => event(value, value.turnId),
      consumers: [{ consume: async () => undefined }]
    })

    const hole = await service.registerStart(startDraft({
      threadId: 'thread-hole',
      clientDirectiveId: 'directive-hole'
    }))
    const retiredCandidates: TurnArtifactIntent[] = []
    for (let index = 0; index < 16; index += 1) {
      const identity = String(index).padStart(2, '0')
      const threadId = `thread-${identity}`
      const clientDirectiveId = `directive-${identity}`
      const state = (['completed', 'failed', 'cancelled', 'rejected'] as const)[index % 4]!
      if (state === 'rejected') {
        const start = await service.registerStart(startDraft({ threadId, clientDirectiveId }))
        await service.publishLifecycleSettlement(lifecycleFor(start, undefined, undefined, state))
        continue
      }
      const accepted = await acceptTurn(service, {
        threadId,
        turnId: `turn-${identity}`,
        clientDirectiveId
      })
      if (state === 'completed') {
        retiredCandidates.push(accepted.intent)
        await service.publish(accepted.intent)
        await service.flushThread('codex', threadId)
      } else {
        await service.publishLifecycleSettlement(lifecycleFor(
          accepted.start,
          accepted.watch.turnId,
          undefined,
          state
        ))
      }
    }

    const snapshot = await service.readDurableTurnBoundarySnapshot()
    assert.equal(snapshot.owners.some((owner) => owner.boundaryLeaseId === hole.boundaryLeaseId), true)
    assert.equal(snapshot.owners.some((owner) => owner.deliveryAttemptOrdinal === 2), false)
    assert.equal(snapshot.retiredThroughOrdinal, 0)
    assert.equal(snapshot.retiredOrdinalRanges.some((range) => range.first === 2), true)

    const persisted = JSON.parse(await readFile(outbox.path, 'utf8')) as {
      records: unknown[]
      receipts: unknown[]
      lifecycleReceipts: unknown[]
      attemptIssuer: { retiredOrdinalRanges: Array<{ first: number; last: number }> }
    }
    assert.equal(persisted.records.length, 0)
    assert.ok(persisted.receipts.length <= 1)
    assert.ok(persisted.lifecycleReceipts.length <= 1)
    assert.ok(persisted.attemptIssuer.retiredOrdinalRanges.length <= 2)

    await service.close()
    const recovered = handoff({
      outbox: new TurnArtifactOutbox(root, {
        maxArtifactReceipts: 1,
        maxLifecycleReceipts: 1
      }),
      materialize: async (value) => event(value, value.turnId),
      consumers: [{ consume: async () => undefined }]
    })
    const retired = retiredCandidates[0]!
    await assert.rejects(
      recovered.publish(retired),
      /permanently retired/
    )
    await assert.rejects(
      recovered.publish({ ...retired, occurredAt: '2026-08-05T00:00:01.000Z' }),
      /permanently retired/
    )
    const next = await recovered.registerStart(startDraft({
      threadId: 'thread-after-restart',
      clientDirectiveId: 'directive-after-restart'
    }))
    assert.equal(next.deliveryAttemptOrdinal, snapshot.nextDeliveryAttemptOrdinal)
    await recovered.close()
  })
})

function handoff(input: {
  outbox: TurnArtifactOutbox
  materialize: (intent: TurnArtifactReplayIntent) => Promise<DomainTurnArtifactEvent>
  consumers: readonly DomainArtifactConsumer[]
  lifecycleConsumer?: (event: DomainMainAfterTurnEvent) => Promise<void>
  log?: (level: 'warn' | 'error', message: string, detail?: unknown) => void
}): TurnArtifactHandoffService {
  const service = new TurnArtifactHandoffService({
    ...input,
    retryBaseMs: 60_000,
    retryMaxMs: 60_000,
    setTimeout: inertSetTimeout,
    clearTimeout: inertClearTimeout
  })
  service.attachLifecycleSettlementConsumer(input.lifecycleConsumer ?? (async () => undefined))
  return service
}

async function rewriteRecordAsLegacyArtifactOnly(
  outbox: TurnArtifactOutbox,
  key: string
): Promise<void> {
  const persisted = JSON.parse(await readFile(outbox.path, 'utf8')) as {
    version: number
    starts: unknown[]
    watches: unknown[]
    records: Array<Record<string, unknown>>
    receipts: unknown[]
    lifecycleSettlements: unknown[]
    lifecycleReceipts: unknown[]
  }
  const record = persisted.records.find((candidate) => candidate.key === key)
  assert.ok(record)
  const intent = record.intent as Record<string, unknown>
  delete intent.issuerEpoch
  delete intent.deliveryAttemptId
  delete intent.deliveryAttemptOrdinal
  delete intent.boundaryLeaseId
  if (record.stage === 'pending_fanout') {
    const materialized = record.event as Record<string, unknown>
    delete materialized.issuerEpoch
    delete materialized.deliveryAttemptId
    delete materialized.deliveryAttemptOrdinal
    delete materialized.boundaryLeaseId
  }
  persisted.version = 3
  persisted.starts = []
  persisted.watches = []
  persisted.receipts = []
  persisted.lifecycleSettlements = []
  persisted.lifecycleReceipts = []
  await writeFile(outbox.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')
}

async function acceptTurn(
  owner: Pick<
    TurnArtifactHandoffService,
    'registerStart' | 'markStartDispatching' | 'bindStart'
  > | TurnArtifactOutbox,
  overrides: Readonly<{
    runtimeId?: string
    threadId?: string
    turnId?: string
    clientDirectiveId?: string
    inputDigest?: string
    workspaceRoot?: string
    principal?: PrincipalSnapshot | null
    principalContext?: PrincipalContextSnapshot
  }> = {}
): Promise<Readonly<{
  start: TurnArtifactStart
  watch: TurnArtifactWatch
  intent: TurnArtifactIntent
  lifecycle: DomainMainAfterTurnEvent
}>> {
  const draft = startDraft(overrides)
  const start = await owner.registerStart(draft)
  const watchValue: TurnArtifactWatch = {
    ...start,
    turnId: overrides.turnId ?? 'turn-1',
    bindingSource: 'provider-accepted'
  }
  await owner.markStartDispatching(start)
  await owner.bindStart(start, watchValue)
  const intentValue = intentFor(start, watchValue.turnId)
  return Object.freeze({
    start,
    watch: watchValue,
    intent: intentValue,
    lifecycle: lifecycleFor(start, watchValue.turnId, intentValue.occurredAt)
  })
}

function startDraft(overrides: Readonly<{
  runtimeId?: string
  threadId?: string
  clientDirectiveId?: string
  inputDigest?: string
  workspaceRoot?: string
  principal?: PrincipalSnapshot | null
  principalContext?: PrincipalContextSnapshot
}> = {}): TurnArtifactStartDraft {
  const principal = Object.prototype.hasOwnProperty.call(overrides, 'principal')
    ? overrides.principal ?? null
    : null
  const principalContext = overrides.principalContext ?? (
    principal ? Object.freeze({ identityVersion: principal.identityVersion, principal }) : SIGNED_OUT_CONTEXT
  )
  return {
    runtimeId: overrides.runtimeId ?? 'codex',
    threadId: overrides.threadId ?? 'thread-1',
    clientDirectiveId: overrides.clientDirectiveId ?? 'directive-1',
    inputDigest: overrides.inputDigest ?? 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    principal,
    principalContext,
    ...(Object.prototype.hasOwnProperty.call(overrides, 'workspaceRoot')
      ? (overrides.workspaceRoot ? { workspaceRoot: overrides.workspaceRoot } : {})
      : { workspaceRoot: '/workspace' })
  }
}

function intentFor(start: TurnArtifactStart, turnId: string): TurnArtifactIntent {
  const {
    key: _key,
    registeredAt: _registeredAt,
    phase: _phase,
    ...binding
  } = start as TurnArtifactStart & {
    key?: string
    registeredAt?: string
    phase?: 'prepared' | 'dispatching'
  }
  return {
    ...binding,
    turnId,
    bindingSource: 'provider-accepted',
    sequence: 7,
    occurredAt: '2026-08-05T00:00:00.000Z'
  }
}

function lifecycleFor(
  start: TurnArtifactStart,
  turnId: string | undefined,
  occurredAt = '2026-08-05T00:00:00.000Z',
  state: DomainMainAfterTurnEvent['state'] = 'completed'
): DomainMainAfterTurnEvent {
  return {
    kind: 'after-turn',
    state,
    issuerEpoch: start.issuerEpoch,
    deliveryAttemptOrdinal: start.deliveryAttemptOrdinal,
    deliveryAttemptId: start.deliveryAttemptId,
    boundaryLeaseId: start.boundaryLeaseId,
    runtimeId: start.runtimeId,
    threadId: start.threadId,
    ...(turnId ? { turnId } : {}),
    clientDirectiveId: start.clientDirectiveId,
    ...(start.principal ? { principal: start.principal } : {}),
    ...(start.principalContext ? { principalContext: start.principalContext } : {}),
    ...(start.workspaceRoot ? { workspaceRoot: start.workspaceRoot } : {}),
    settlementSource: 'runtime',
    occurredAt
  } as DomainMainAfterTurnEvent
}

function event(value: TurnArtifactReplayIntent, marker: string): DomainTurnArtifactEvent {
  return {
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: value.runtimeId,
    threadId: value.threadId,
    turnId: value.turnId,
    ...(value.issuerEpoch ? { issuerEpoch: value.issuerEpoch } : {}),
    ...(value.deliveryAttemptOrdinal === undefined
      ? {}
      : { deliveryAttemptOrdinal: value.deliveryAttemptOrdinal }),
    deliveryAttemptId: value.deliveryAttemptId,
    boundaryLeaseId: value.boundaryLeaseId,
    ...(value.clientDirectiveId ? { clientDirectiveId: value.clientDirectiveId } : {}),
    targetWatermark: String(value.sequence ?? value.turnId),
    ...(value.sequence === undefined ? {} : { sequence: value.sequence }),
    ...(value.workspaceRoot ? { workspaceRoot: value.workspaceRoot } : {}),
    occurredAt: value.occurredAt,
    artifacts: [{ marker }],
    ...(value.principal ? { principal: value.principal } : {})
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
