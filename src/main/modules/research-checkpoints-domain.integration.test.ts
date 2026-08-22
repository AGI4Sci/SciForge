import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ARTIFACT_VERSIONS_CAPABILITY_IDS } from '@sciforge/domain-artifact-versions/contract'
import { createDomainMainEntry as createArtifactVersionsMainEntry } from '@sciforge/domain-artifact-versions/main'
import { createDomainMainEntry as createGitCheckpointsMainEntry } from '@sciforge/domain-git-checkpoints/main'
import { createDomainMainEntry as createResearchCheckpointsMainEntry } from '@sciforge/domain-research-checkpoints/main'
import type {
  DomainAgentThreadTurn,
  DomainMainBeforeTurnEvent,
  DomainMainTurnLifecycleEvent,
  DomainTurnArtifactEvent
} from '@sciforge/domain-sdk/host'
import { domainExecutionEventSchema } from '@sciforge/domain-sdk/reproducibility'
import { createExecutionReceipt } from '@sciforge/execution-governance'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  createDefaultAgentRuntimeCapabilities,
  type AgentRuntimeEvent,
  type AgentRuntimeThread,
  type AgentRuntimeThreadPage,
  type AgentRuntimeThreadStatus,
  type AgentRuntimeUsageResponse
} from '../../shared/agent-runtime-contract'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import { CapabilityBroker } from '../capabilities/broker'
import { defineCapability } from '../capabilities/registry'
import type { AgentRuntimeAdapter } from '../runtime/agent-runtime/adapter'
import { createAgentRuntimeHost } from '../runtime/agent-runtime/host'
import {
  createApplicationCapabilityRegistry,
  createApplicationDomainCatalog
} from './application-composition'
import { DomainModuleCatalog } from './catalog'
import { TurnArtifactHandoffService } from '../services/turn-artifact-handoff-service'
import {
  TurnArtifactOutbox,
  type PendingTurnArtifactStart
} from '../services/turn-artifact-outbox'
import {
  activateMainRuntimeContributions,
  createMainSystemCapabilityInvokerFactory,
  listMainArtifactConsumers
} from './runtime-contributions'
import { createNonSecretPackageStorageForTest } from './domain-package-storage.test-helper'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  ))
})

describe('installed Research Checkpoints and Artifact Versions domains', () => {
  it('commits authenticated file output through production registry, broker, and scoped lifecycle authority', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-checkpoint-composition-'))
    temporaryDirectories.push(userDataDir)
    const workspaceRoot = join(userDataDir, 'workspace')
    const domainHost = {
      getUserDataDir: () => userDataDir,
      defineCapability: (options: unknown) => defineCapability(options as never),
      textSanitizer: { sanitizeText: (value: string) => value }
    }
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([
      createArtifactVersionsMainEntry(domainHost),
      createGitCheckpointsMainEntry(domainHost),
      createResearchCheckpointsMainEntry(domainHost)
    ])
    const broker = new CapabilityBroker(
      createApplicationCapabilityRegistry(catalog, unavailableCoreDependencies())
    )
    const requiredBeforeTurnListeners = new Set<
      (event: DomainMainBeforeTurnEvent) => void | Promise<void>
    >()
    const turnListeners = new Set<
      (event: DomainMainTurnLifecycleEvent) => void | Promise<void>
    >()
    const turns: DomainAgentThreadTurn[] = []
    const activated = await activateMainRuntimeContributions(catalog, {
      userDataDir,
      appRoot: '/app',
      environment: Object.freeze({ NODE_ENV: 'test' }),
      agentThreads: {
        list: async () => [],
        read: async ({ runtimeId, threadId }) => ({
          id: threadId,
          runtimeId,
          workspaceRoot,
          watermark: `wm-${turns.length}`,
          turns: [...turns],
          artifacts: []
        }),
        subscribeMessages: async function* () {},
        hasActiveTurns: () => false
      },
      turnEvents: {
        subscribe: (listener) => {
          turnListeners.add(listener)
          return () => { turnListeners.delete(listener) }
        },
        subscribeRequiredBeforeTurn: (listener) => {
          requiredBeforeTurnListeners.add(listener)
          return () => { requiredBeforeTurnListeners.delete(listener) }
        },
        readDurableTurnBoundarySnapshot: async () => emptyDurableBoundarySnapshot()
      },
      capabilityInvokers: createMainSystemCapabilityInvokerFactory(broker),
      modelAccess: { textReasoner: async () => null },
      executionEvents: {
        publish: async (owner, event) => domainExecutionEventSchema.parse({
          ...event,
          schemaVersion: 'sciforge.execution-event.v1' as const,
          eventId: event.eventId ?? 'execution-event-test',
          producer: owner,
          occurredAt: event.occurredAt ?? '2099-08-11T08:00:00.000Z',
          artifacts: event.artifacts ?? []
        })
      },
      enablement: {
        isEnabled: async () => true,
        subscribe: () => () => undefined
      },
      log: () => undefined
    })

    try {
      const event = exactOutputEvent(workspaceRoot)
      const beforeTurn: DomainMainBeforeTurnEvent = {
        kind: 'before-turn',
        state: 'starting',
        issuerEpoch: event.issuerEpoch!,
        deliveryAttemptOrdinal: event.deliveryAttemptOrdinal!,
        deliveryAttemptId: event.deliveryAttemptId!,
        boundaryLeaseId: event.boundaryLeaseId!,
        clientDirectiveId: event.clientDirectiveId!,
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        workspaceRoot,
        occurredAt: event.occurredAt
      }
      for (const listener of requiredBeforeTurnListeners) await listener(beforeTurn)
      turns.push({
        id: event.turnId,
        status: 'completed',
        completedAt: event.occurredAt,
        messages: [],
        artifacts: event.artifacts
      })
      await Promise.all(activated.artifactConsumers.map((consumer) => consumer.consume(event)))

      await waitFor(async () => broker.listAuditRecords().some((record) => (
        record.actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2 &&
        record.status === 'success'
      )))
      const commitAudit = broker.listAuditRecords().find((record) => (
        record.actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2 &&
        record.status === 'success'
      ))
      expect(commitAudit?.caller).toEqual({
        audience: 'system',
        callerId: 'domain-runtime:sciforge.research-checkpoints',
        workspaceId: workspaceRoot
      })
      expect(broker.listAuditRecords().some((record) => (
        record.actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2 &&
        record.status === 'failed'
      ))).toBe(false)
    } finally {
      await activated.dispose()
      catalog.dispose()
    }
  })

  it('retains an accepted open lease across app restart until the durable completion replays', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-checkpoint-crash-replay-'))
    temporaryDirectories.push(userDataDir)
    const workspaceRoot = join(userDataDir, 'workspace')
    let event = exactOutputEvent(workspaceRoot)
    const startDraft = {
      runtimeId: event.runtimeId,
      threadId: event.threadId,
      clientDirectiveId: event.clientDirectiveId!,
      inputDigest: `sha256:${digest('crash-replay-input')}`,
      principal: null,
      principalContext: { identityVersion: 0, principal: null },
      workspaceRoot
    }

    const firstCatalog = createResearchCatalog(userDataDir)
    const firstBroker = new CapabilityBroker(
      createApplicationCapabilityRegistry(firstCatalog, unavailableCoreDependencies())
    )
    const firstRequired = new Set<
      (value: DomainMainBeforeTurnEvent) => void | Promise<void>
    >()
    const firstLifecycle = new Set<
      (value: DomainMainTurnLifecycleEvent) => void | Promise<void>
    >()
    const firstHandoff = new TurnArtifactHandoffService({
      outbox: new TurnArtifactOutbox(userDataDir),
      consumers: listMainArtifactConsumers(firstCatalog),
      materialize: async () => event,
      retryBaseMs: 10,
      retryMaxMs: 20
    })
    firstHandoff.attachLifecycleSettlementConsumer(async (value) => {
      await Promise.all([...firstLifecycle].map((listener) => listener(value)))
    })
    const start = await firstHandoff.registerStart(startDraft)
    event = exactOutputEvent(workspaceRoot, start)
    const watch = {
      runtimeId: start.runtimeId,
      threadId: start.threadId,
      turnId: event.turnId,
      issuerEpoch: start.issuerEpoch,
      deliveryAttemptId: start.deliveryAttemptId,
      deliveryAttemptOrdinal: start.deliveryAttemptOrdinal,
      boundaryLeaseId: start.boundaryLeaseId,
      clientDirectiveId: start.clientDirectiveId,
      inputDigest: start.inputDigest,
      principal: start.principal,
      principalContext: start.principalContext,
      workspaceRoot
    }
    const firstActivated = await activateResearchComposition({
      catalog: firstCatalog,
      broker: firstBroker,
      userDataDir,
      workspaceRoot,
      requiredBeforeTurnListeners: firstRequired,
      turnListeners: firstLifecycle,
      readDurableTurnBoundarySnapshot: () => firstHandoff.readDurableTurnBoundarySnapshot()
    })

    try {
      const beforeTurn: DomainMainBeforeTurnEvent = {
        kind: 'before-turn',
        state: 'starting',
        issuerEpoch: start.issuerEpoch,
        deliveryAttemptOrdinal: start.deliveryAttemptOrdinal,
        deliveryAttemptId: start.deliveryAttemptId,
        boundaryLeaseId: start.boundaryLeaseId,
        clientDirectiveId: start.clientDirectiveId,
        runtimeId: start.runtimeId,
        threadId: start.threadId,
        workspaceRoot,
        occurredAt: '2099-08-11T08:00:00.000Z'
      }
      for (const listener of firstRequired) await listener(beforeTurn)
      await firstHandoff.bindStart(start, watch)
    } finally {
      await firstActivated.dispose()
      await firstHandoff.close()
      firstCatalog.dispose()
    }

    const restartedCatalog = createResearchCatalog(userDataDir)
    const restartedBroker = new CapabilityBroker(
      createApplicationCapabilityRegistry(restartedCatalog, unavailableCoreDependencies())
    )
    const restartedRequired = new Set<
      (value: DomainMainBeforeTurnEvent) => void | Promise<void>
    >()
    const restartedLifecycle = new Set<
      (value: DomainMainTurnLifecycleEvent) => void | Promise<void>
    >()
    const restartedHandoff = new TurnArtifactHandoffService({
      outbox: new TurnArtifactOutbox(userDataDir),
      consumers: listMainArtifactConsumers(restartedCatalog),
      materialize: async () => event,
      retryBaseMs: 10,
      retryMaxMs: 20
    })
    restartedHandoff.attachLifecycleSettlementConsumer(async (value) => {
      await Promise.all([...restartedLifecycle].map((listener) => listener(value)))
    })
    const restartedActivated = await activateResearchComposition({
      catalog: restartedCatalog,
      broker: restartedBroker,
      userDataDir,
      workspaceRoot,
      requiredBeforeTurnListeners: restartedRequired,
      turnListeners: restartedLifecycle,
      readDurableTurnBoundarySnapshot: () => restartedHandoff.readDurableTurnBoundarySnapshot()
    })

    try {
      expect((await restartedHandoff.readDurableTurnBoundarySnapshot()).owners).toEqual([
        expect.objectContaining({
          issuerEpoch: start.issuerEpoch,
          boundaryLeaseId: event.boundaryLeaseId,
          deliveryAttemptId: event.deliveryAttemptId,
          deliveryAttemptOrdinal: start.deliveryAttemptOrdinal,
          phase: 'watching',
          turnId: event.turnId
        })
      ])
      await restartedHandoff.publish({
        ...watch,
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        fileEffects: event.fileEffects,
        filePatchReceipts: event.filePatchReceipts
      })
      await restartedHandoff.publishLifecycleSettlement({
        kind: 'after-turn',
        state: 'completed',
        issuerEpoch: start.issuerEpoch,
        deliveryAttemptOrdinal: start.deliveryAttemptOrdinal,
        deliveryAttemptId: event.deliveryAttemptId!,
        boundaryLeaseId: event.boundaryLeaseId!,
        clientDirectiveId: event.clientDirectiveId!,
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        turnId: event.turnId,
        workspaceRoot,
        occurredAt: event.occurredAt
      })

      await waitFor(async () => restartedBroker.listAuditRecords().some((record) => (
        record.actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2 &&
        record.status === 'success'
      )))
      expect(restartedBroker.listAuditRecords().some((record) => (
        record.actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2 &&
        record.status === 'failed'
      ))).toBe(false)
    } finally {
      await restartedActivated.dispose()
      await restartedHandoff.close()
      restartedCatalog.dispose()
    }
  }, 15_000)

  it('replays an accepted Host turn through the production domain composition after a crash', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-checkpoint-host-crash-'))
    temporaryDirectories.push(userDataDir)
    const workspaceRoot = join(userDataDir, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
    const runtimeState: CrashReplayRuntimeState = {
      completed: false,
      workspaceRoot
    }
    const first = await createProductionCrashComposition(userDataDir, runtimeState)

    let durableBoundary: Awaited<
      ReturnType<typeof first.host.readDurableTurnBoundarySnapshot>
    >['owners'][number]
    try {
      await expect(first.host.startTurn({
        runtimeId: 'codex',
        threadId: CRASH_REPLAY_THREAD_ID,
        text: CRASH_REPLAY_PROMPT,
        displayText: CRASH_REPLAY_PROMPT,
        workspace: workspaceRoot,
        clientDirectiveId: CRASH_REPLAY_DIRECTIVE_ID
      })).resolves.toEqual({
        threadId: CRASH_REPLAY_THREAD_ID,
        turnId: CRASH_REPLAY_TURN_ID,
        userMessageItemId: 'user-host-crash-replay'
      })
      const boundaries = (await first.host.readDurableTurnBoundarySnapshot()).owners
      expect(boundaries).toEqual([
        expect.objectContaining({
          runtimeId: 'codex',
          threadId: CRASH_REPLAY_THREAD_ID,
          turnId: CRASH_REPLAY_TURN_ID,
          clientDirectiveId: CRASH_REPLAY_DIRECTIVE_ID,
          workspaceRoot,
          phase: 'watching'
        })
      ])
      durableBoundary = boundaries[0]!
    } finally {
      await first.dispose()
    }

    await mkdir(join(workspaceRoot, 'outputs'), { recursive: true })
    await writeFile(join(workspaceRoot, CRASH_REPLAY_OUTPUT_PATH), CRASH_REPLAY_OUTPUT_BYTES)
    runtimeState.completed = true
    const restarted = await createProductionCrashComposition(userDataDir, runtimeState)
    try {
      expect((await restarted.host.readDurableTurnBoundarySnapshot()).owners).toEqual([
        expect.objectContaining({
          issuerEpoch: durableBoundary.issuerEpoch,
          boundaryLeaseId: durableBoundary.boundaryLeaseId,
          deliveryAttemptId: durableBoundary.deliveryAttemptId,
          deliveryAttemptOrdinal: durableBoundary.deliveryAttemptOrdinal,
          phase: 'watching',
          turnId: CRASH_REPLAY_TURN_ID
        })
      ])

      await expect(restarted.host.recoverCompletedTurnArtifacts()).resolves.toBeGreaterThanOrEqual(1)
      await waitFor(async () => restarted.broker.listAuditRecords().some((record) => (
        record.actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2 &&
        record.status === 'success'
      )))
      expect(restarted.broker.listAuditRecords().find((record) => (
        record.actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2 &&
        record.status === 'success'
      ))?.caller).toEqual({
        audience: 'system',
        callerId: 'domain-runtime:sciforge.research-checkpoints',
        workspaceId: workspaceRoot
      })
      expect((await restarted.host.readDurableTurnBoundarySnapshot()).owners).toEqual([
        expect.objectContaining({
          issuerEpoch: durableBoundary.issuerEpoch,
          boundaryLeaseId: durableBoundary.boundaryLeaseId,
          deliveryAttemptId: durableBoundary.deliveryAttemptId,
          deliveryAttemptOrdinal: durableBoundary.deliveryAttemptOrdinal,
          phase: 'terminal-settlement',
          terminalState: 'completed',
          turnId: CRASH_REPLAY_TURN_ID
        })
      ])
    } finally {
      await restarted.dispose()
    }
  }, 20_000)
})

const CRASH_REPLAY_THREAD_ID = 'thread-host-crash-replay'
const CRASH_REPLAY_TURN_ID = 'turn-host-crash-replay'
const CRASH_REPLAY_DIRECTIVE_ID = 'directive-host-crash-replay'
const CRASH_REPLAY_PROMPT = 'Create the durable research output.'
const CRASH_REPLAY_OUTPUT_PATH = 'outputs/result.csv'
const CRASH_REPLAY_OUTPUT_TEXT = 'value\n1\n'
const CRASH_REPLAY_OUTPUT_BYTES = Buffer.from(CRASH_REPLAY_OUTPUT_TEXT)
const CRASH_REPLAY_OCCURRED_AT = '2099-08-15T08:00:01.000Z'
const CRASH_REPLAY_TOOL_CALL_ID = 'apply-patch-host-crash-replay'

type CrashReplayRuntimeState = {
  completed: boolean
  workspaceRoot: string
}

async function createProductionCrashComposition(
  userDataDir: string,
  runtimeState: CrashReplayRuntimeState
) {
  let capabilityInvokers: ReturnType<typeof createMainSystemCapabilityInvokerFactory> | undefined
  const catalog = createApplicationDomainCatalog({
    getUserDataDir: () => userDataDir,
    getDeviceId: () => 'device-crash-replay-test',
    getAppVersion: () => '0.1.0',
    textSanitizer: { sanitizeText: (value) => value },
    packageStorageFor: createNonSecretPackageStorageForTest(),
    capabilityInvokerFor: (owner) => Object.freeze({
      invoke: (contract, input, options) => {
        if (!capabilityInvokers) throw new Error('Test capability broker is not ready.')
        return capabilityInvokers.forDomain(owner).invoke(contract, input, options)
      }
    })
  })
  const broker = new CapabilityBroker(
    createApplicationCapabilityRegistry(catalog, unavailableCoreDependencies())
  )
  capabilityInvokers = createMainSystemCapabilityInvokerFactory(broker)
  const adapter = createCrashReplayAdapter(runtimeState)
  let host!: ReturnType<typeof createAgentRuntimeHost>
  const handoff = new TurnArtifactHandoffService({
    outbox: new TurnArtifactOutbox(userDataDir),
    consumers: listMainArtifactConsumers(catalog),
    materialize: (intent) => host.materializeCompletedTurnArtifact(intent),
    retryBaseMs: 10,
    retryMaxMs: 20
  })
  host = createAgentRuntimeHost({
    settings: async () => crashReplaySettings(runtimeState.workspaceRoot),
    adapters: [adapter],
    turnArtifacts: handoff
  })
  const activated = await activateMainRuntimeContributions(catalog, {
    userDataDir,
    appRoot: '/app',
    environment: Object.freeze({ NODE_ENV: 'test' }),
    agentExecution: {
      run: async () => {
        throw new Error('Agent execution is unavailable in this checkpoint-only test.')
      }
    },
    agentThreads: {
      list: async () => [],
      read: async ({ runtimeId, threadId }) => ({
        id: threadId,
        runtimeId,
        workspaceRoot: runtimeState.workspaceRoot,
        watermark: runtimeState.completed ? 'wm-host-crash-completed' : 'wm-host-crash-open',
        turns: runtimeState.completed
          ? [{
              id: CRASH_REPLAY_TURN_ID,
              status: 'completed',
              completedAt: CRASH_REPLAY_OCCURRED_AT,
              messages: [],
              artifacts: crashReplayArtifacts()
            }]
          : [],
        artifacts: []
      }),
      subscribeMessages: async function* () {},
      hasActiveTurns: () => !runtimeState.completed
    },
    turnEvents: {
      subscribe: (listener) => host.subscribeTurnLifecycle(listener),
      subscribeRequiredBeforeTurn: (listener) => host.subscribeRequiredBeforeTurn(listener),
      readDurableTurnBoundarySnapshot: () => host.readDurableTurnBoundarySnapshot()
    },
    capabilityInvokers,
    modelAccess: { textReasoner: async () => null },
    executionEvents: {
      publish: async (owner, event) => domainExecutionEventSchema.parse({
        ...event,
        schemaVersion: 'sciforge.execution-event.v1' as const,
        eventId: event.eventId ?? 'execution-event-host-crash-replay',
        producer: owner,
        occurredAt: event.occurredAt ?? CRASH_REPLAY_OCCURRED_AT,
        artifacts: event.artifacts ?? []
      })
    },
    enablement: {
      isEnabled: async (moduleId) => moduleId === 'sciforge.research-checkpoints',
      subscribe: () => () => undefined
    },
    log: () => undefined
  })
  return Object.freeze({
    host,
    broker,
    dispose: async () => {
      host.dispose()
      await activated.dispose()
      await handoff.close()
      catalog.dispose()
    }
  })
}

function createCrashReplayAdapter(state: CrashReplayRuntimeState): AgentRuntimeAdapter {
  const thread = (): AgentRuntimeThread => ({
    id: CRASH_REPLAY_THREAD_ID,
    runtimeId: 'codex',
    title: 'Crash replay research',
    workspace: state.workspaceRoot,
    updatedAt: CRASH_REPLAY_OCCURRED_AT,
    ...(state.completed ? {
      status: 'completed',
      latestTurnId: CRASH_REPLAY_TURN_ID,
      latestTurnStatus: 'completed'
    } : {})
  })
  const status = (): AgentRuntimeThreadStatus => ({
    id: CRASH_REPLAY_THREAD_ID,
    runtimeId: 'codex',
    status: state.completed ? 'completed' : 'idle',
    latestSeq: state.completed ? 2 : 0,
    ...(state.completed ? {
      latestTurnId: CRASH_REPLAY_TURN_ID,
      latestTurnStatus: 'completed'
    } : {})
  })
  const page = (): AgentRuntimeThreadPage => ({
    runtimeId: 'codex',
    threadId: CRASH_REPLAY_THREAD_ID,
    latestSeq: state.completed ? 2 : 0,
    turns: state.completed
      ? [{
          id: CRASH_REPLAY_TURN_ID,
          threadId: CRASH_REPLAY_THREAD_ID,
          status: 'completed',
          completedAt: CRASH_REPLAY_OCCURRED_AT,
          items: crashReplayArtifacts()
        }]
      : [],
    nextCursor: null
  })
  return {
    id: 'codex',
    transport: 'jsonrpc_stdio',
    connect: async () => undefined,
    capabilities: async () => createDefaultAgentRuntimeCapabilities({
      runtimeId: 'codex',
      transport: 'jsonrpc_stdio'
    }),
    listThreads: async () => [thread()],
    startThread: async () => thread(),
    readThreadStatus: async () => status(),
    readThreadPage: async () => page(),
    readToolArtifact: async (_context, input) => ({ ...input, content: '' }),
    startTurn: async (_context, input) => ({
      threadId: input.threadId,
      turnId: CRASH_REPLAY_TURN_ID,
      userMessageItemId: 'user-host-crash-replay'
    }),
    interruptTurn: async () => undefined,
    steerTurn: async () => undefined,
    renameThread: async () => undefined,
    deleteThread: async () => undefined,
    usage: async (_context, input) => ({
      supported: true,
      groupBy: input.groupBy,
      buckets: [],
      totals: { totalTokens: 0 }
    }) satisfies AgentRuntimeUsageResponse,
    subscribeEvents: async function* (_context, input) {
      if (!state.completed) {
        await waitForAbort(input.signal)
        return
      }
      yield crashReplayFileChangeEvent()
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'codex',
        threadId: CRASH_REPLAY_THREAD_ID,
        turnId: CRASH_REPLAY_TURN_ID,
        state: 'completed',
        seq: 2,
        createdAt: CRASH_REPLAY_OCCURRED_AT
      } satisfies AgentRuntimeEvent
    }
  }
}

function crashReplayFileChangeEvent(): AgentRuntimeEvent {
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: CRASH_REPLAY_THREAD_ID,
    turnId: CRASH_REPLAY_TURN_ID,
    itemId: CRASH_REPLAY_TOOL_CALL_ID,
    seq: 1,
    callId: CRASH_REPLAY_TOOL_CALL_ID,
    toolName: 'apply_patch',
    toolKind: 'file_change',
    status: 'success',
    receipt: createExecutionReceipt({ status: 'success' }),
    phase: 'succeeded',
    factSource: 'executor_result',
    evidenceStrength: 'executor_receipt',
    effects: ['local_write'],
    detail: JSON.stringify([{
      path: CRASH_REPLAY_OUTPUT_PATH,
      kind: 'add',
      content: CRASH_REPLAY_OUTPUT_TEXT
    }])
  }
}

function crashReplayArtifacts() {
  return [
    { id: 'user-host-crash-replay', kind: 'user_message' as const, text: CRASH_REPLAY_PROMPT },
    {
      id: 'assistant-host-crash-replay',
      kind: 'assistant_message' as const,
      text: `Created ${CRASH_REPLAY_OUTPUT_PATH}.`
    },
    {
      id: CRASH_REPLAY_TOOL_CALL_ID,
      kind: 'tool' as const,
      toolKind: 'file_change' as const,
      status: 'success' as const,
      summary: 'File changes',
      detail: JSON.stringify([{ path: CRASH_REPLAY_OUTPUT_PATH, kind: 'add' }])
    }
  ]
}

async function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (!signal || signal.aborted) return
  await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

function crashReplaySettings(workspaceRoot: string): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'codex',
    modelRouter: defaultModelRouterSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot,
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    skills: defaultSkillsSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function createResearchCatalog(userDataDir: string): DomainModuleCatalog {
  const domainHost = {
    getUserDataDir: () => userDataDir,
    defineCapability: (options: unknown) => defineCapability(options as never),
    textSanitizer: { sanitizeText: (value: string) => value }
  }
  const catalog = new DomainModuleCatalog()
  catalog.registerBatch([
    createArtifactVersionsMainEntry(domainHost),
    createGitCheckpointsMainEntry(domainHost),
    createResearchCheckpointsMainEntry(domainHost)
  ])
  return catalog
}

async function activateResearchComposition(input: Readonly<{
  catalog: DomainModuleCatalog
  broker: CapabilityBroker
  userDataDir: string
  workspaceRoot: string
  requiredBeforeTurnListeners: Set<
    (event: DomainMainBeforeTurnEvent) => void | Promise<void>
  >
  turnListeners: Set<
    (event: DomainMainTurnLifecycleEvent) => void | Promise<void>
  >
  readDurableTurnBoundarySnapshot: () => ReturnType<
    TurnArtifactHandoffService['readDurableTurnBoundarySnapshot']
  >
}>) {
  return activateMainRuntimeContributions(input.catalog, {
    userDataDir: input.userDataDir,
    appRoot: '/app',
    environment: Object.freeze({ NODE_ENV: 'test' }),
    agentThreads: {
      list: async () => [],
      read: async ({ runtimeId, threadId }) => ({
        id: threadId,
        runtimeId,
        workspaceRoot: input.workspaceRoot,
        watermark: 'wm-crash-replay',
        turns: [],
        artifacts: []
      }),
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    },
    turnEvents: {
      subscribe: (listener) => {
        input.turnListeners.add(listener)
        return () => { input.turnListeners.delete(listener) }
      },
      subscribeRequiredBeforeTurn: (listener) => {
        input.requiredBeforeTurnListeners.add(listener)
        return () => { input.requiredBeforeTurnListeners.delete(listener) }
      },
      readDurableTurnBoundarySnapshot: input.readDurableTurnBoundarySnapshot
    },
    capabilityInvokers: createMainSystemCapabilityInvokerFactory(input.broker),
    modelAccess: { textReasoner: async () => null },
    executionEvents: {
      publish: async (owner, event) => domainExecutionEventSchema.parse({
        ...event,
        schemaVersion: 'sciforge.execution-event.v1' as const,
        eventId: event.eventId ?? 'execution-event-crash-replay',
        producer: owner,
        occurredAt: event.occurredAt ?? '2099-08-11T08:00:00.000Z',
        artifacts: event.artifacts ?? []
      })
    },
    enablement: {
      isEnabled: async () => true,
      subscribe: () => () => undefined
    },
    log: () => undefined
  })
}

function exactOutputEvent(
  workspaceRoot: string,
  attempt?: Pick<
    PendingTurnArtifactStart,
    'issuerEpoch' | 'deliveryAttemptId' | 'deliveryAttemptOrdinal' | 'boundaryLeaseId'
  >
): DomainTurnArtifactEvent {
  const bytes = Buffer.from('value\n1\n')
  const patchText = 'value\n1\n'
  const occurredAt = '2099-08-11T08:00:01.000Z'
  const receipt = {
    contractVersion: 1 as const,
    kind: 'host-authenticated-file-patch' as const,
    issuer: 'sciforge.agent-runtime-host' as const,
    source: 'codex-app-server-file-change' as const,
    callId: 'file-change-composition-test',
    executorSequence: 1,
    path: 'outputs/result.csv',
    operation: 'add' as const,
    patchFormat: 'full-content' as const,
    patchText,
    patchDigest: digest(patchText)
  }
  return {
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-composition-test',
    turnId: 'turn-composition-test',
    issuerEpoch: attempt?.issuerEpoch ?? 'issuer-composition-test',
    deliveryAttemptId: attempt?.deliveryAttemptId ?? 'composition-test-attempt',
    deliveryAttemptOrdinal: attempt?.deliveryAttemptOrdinal ?? 1,
    boundaryLeaseId: attempt?.boundaryLeaseId ?? 'turn-boundary:composition-test-attempt',
    clientDirectiveId: 'directive-composition-test',
    targetWatermark: '2',
    sequence: 2,
    workspaceRoot,
    occurredAt,
    artifacts: [
      { kind: 'user_message', text: 'Create the research output.' },
      { kind: 'assistant_message', text: 'Created outputs/result.csv.' },
      {
        kind: 'tool',
        itemId: receipt.callId,
        toolKind: 'file_change',
        status: 'success',
        summary: 'File changes',
        detail: JSON.stringify([{ path: receipt.path, kind: receipt.operation }])
      }
    ],
    fileEffects: {
      contractVersion: 1,
      capture: 'host-turn-boundary',
      baselineDigest: digest('empty-workspace'),
      baselineCapturedAt: '2099-08-11T08:00:00.000Z',
      terminalCapturedAt: occurredAt,
      effects: [{
        contractVersion: 1,
        kind: 'created',
        path: receipt.path,
        contentDigest: digest(bytes),
        byteLength: bytes.byteLength,
        mediaType: 'text/csv',
        dataBase64: bytes.toString('base64')
      }],
      issues: []
    },
    filePatchReceipts: [receipt]
  }
}

function emptyDurableBoundarySnapshot() {
  return Object.freeze({
    issuerEpoch: 'issuer-composition-test',
    nextDeliveryAttemptOrdinal: 1,
    retiredThroughOrdinal: 0,
    retiredOrdinalRanges: Object.freeze([]),
    owners: Object.freeze([])
  })
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for the composed checkpoint commit.')
}

function unavailableCoreDependencies(): AppCapabilityDependencies {
  const unavailable = () => undefined
  return new Proxy({}, { get: () => unavailable }) as AppCapabilityDependencies
}
