import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS
} from '@sciforge/domain-artifact-versions/contract'
import type {
  DomainMainBeforeTurnEvent,
  DomainMainDurableTurnBoundarySnapshot,
  DomainMainRuntimeLifecycleContext,
  DomainTurnArtifactEvent
} from '@sciforge/domain-sdk/host'
import {
  RESEARCH_CHECKPOINT_CAPABILITY_IDS,
  type ResearchCheckpointRecordV1
} from './contract.js'
import {
  createDomainMainEntry,
  createResearchCheckpointsCapabilityFactory,
  type ResearchCheckpointsCapabilityOptions
} from './main.js'
import { RESEARCH_CHECKPOINTS_RUNTIME_LIFECYCLE_CONTRIBUTION } from './definition.js'
import {
  createArtifactVersionsCapabilityTestHarness,
  type ArtifactVersionsCapabilityTestHarness
} from './main/artifact-versions-capability-test-harness.js'
import { ResearchCheckpointRuntime } from './main/runtime.js'

test('administrative recording and legacy mutation capabilities are UI-only with explicit stale/import confirmation', () => {
  const runtime = {
    start: async () => { throw new Error('unused') },
    stop: async () => { throw new Error('unused') },
    status: async () => null,
    read: async () => { throw new Error('unused') },
    list: async () => ({ records: [] }),
    turnStatus: async () => { throw new Error('unused') },
    resolve: async () => { throw new Error('unused') },
    restoreAsNew: async () => { throw new Error('unused') },
    previewLegacy: async () => { throw new Error('unused') },
    importLegacy: async () => { throw new Error('unused') }
  }
  const definitions = createResearchCheckpointsCapabilityFactory<ResearchCheckpointsCapabilityOptions>({
    defineCapability: (value) => value,
    getRuntime: () => runtime as never
  }).createDefinitions()
  const byId = new Map(definitions.map((item) => [item.id, item]))

  assert.deepEqual(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.start)?.audiences, ['ui'])
  assert.equal(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.start)?.approval, 'none')
  assert.deepEqual(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.stop)?.audiences, ['ui'])
  assert.deepEqual(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.resolve)?.audiences, ['ui'])
  assert.equal(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.resolve)?.approval, 'confirmation')
  assert.deepEqual(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.restoreAsNew)?.audiences, ['ui'])
  assert.equal(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.restoreAsNew)?.approval, 'confirmation')
  assert.deepEqual(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.previewLegacy)?.audiences, ['ui'])
  assert.equal(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.previewLegacy)?.effect, 'read')
  assert.deepEqual(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.importLegacy)?.audiences, ['ui'])
  assert.equal(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.importLegacy)?.approval, 'confirmation')
  assert.deepEqual(byId.get(RESEARCH_CHECKPOINT_CAPABILITY_IDS.status)?.audiences, ['ui', 'agent', 'system'])
})

test('registry mutations do not claim a Broker resource revision change', async () => {
  const timestamp = '2026-08-11T08:00:00.000Z'
  const recording = {
    recordingId: 'research-recording:broker-test',
    origin: 'live' as const,
    runtimeId: 'codex',
    threadId: 'thread-1',
    title: 'Broker test',
    state: 'active' as const,
    versionCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const ref = {
    artifactId: 'artifact:broker-test',
    versionId: 'artifact-version:broker-test-v1',
    contentDigest: 'a'.repeat(64),
    byteLength: 42,
    mediaType: 'application/vnd.sciforge.research-checkpoint+json',
    availability: 'available' as const,
    retention: 'snapshot' as const,
    accessPolicy: { visibility: 'workspace' as const, principals: [], allowExport: true }
  }
  const committed = {
    state: 'committed' as const,
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'legacy-turn-1',
    recordingId: 'research-recording:legacy-broker-test',
    operationId: `research-checkpoint-operation:${'1'.repeat(64)}`,
    changeReason: 'Imported selected legacy turn.',
    attempts: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    changeKind: 'new' as const,
    title: 'Legacy broker test',
    artifactRef: ref,
    ordinal: 1,
    inputs: [],
    outputs: [],
    outputArtifacts: [],
    reproduction: { status: 'not-run' as const },
    provenance: { status: 'incomplete' as const },
    control: { status: 'untracked' as const },
    untrackedOperationCount: 1,
    evidence: { status: 'unavailable' as const }
  }
  const runtime = {
    start: async () => ({ created: true, recording }),
    stop: async () => ({
      recording: { ...recording, state: 'stopped' as const, stoppedAt: timestamp }
    }),
    status: async () => recording,
    read: async () => { throw new Error('unused') },
    list: async () => ({ records: [] }),
    turnStatus: async () => { throw new Error('unused') },
    resolve: async () => ({
      resolution: 'discard' as const,
      status: {
        state: 'failed' as const,
        runtimeId: 'codex',
        threadId: 'thread-1',
        turnId: 'turn-1',
        recordingId: recording.recordingId,
        operationId: `research-checkpoint-operation:${'2'.repeat(64)}`,
        changeReason: 'Discard stale checkpoint.',
        attempts: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        error: 'Explicitly discarded.',
        retryable: false
      }
    }),
    restoreAsNew: async () => ({
      recording: {
        ...recording,
        versionCount: 2,
        artifactId: ref.artifactId,
        currentVersionId: 'artifact-version:broker-test-v2',
        currentContentDigest: 'b'.repeat(64),
        currentOrdinal: 2
      },
      restoredRef: {
        ...ref,
        versionId: 'artifact-version:broker-test-v2',
        contentDigest: 'b'.repeat(64)
      },
      ordinal: 2,
      transactionId: 'artifact-commit:broker-test-v2',
      idempotentReplay: false
    }),
    previewLegacy: async () => ({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turns: [{ turnId: 'legacy-turn-1', status: 'completed', summary: 'Historical result' }],
      selectedTurnIds: [],
      selectedTranscriptDigest: null
    }),
    importLegacy: async () => committed
  }
  const definitions = createResearchCheckpointsCapabilityFactory<ResearchCheckpointsCapabilityOptions>({
    defineCapability: (value) => value,
    getRuntime: () => runtime as never
  }).createDefinitions()
  const byId = new Map(definitions.map((item) => [item.id, item]))
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.start, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'broker-start-1'
    }],
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.stop, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'broker-stop-1'
    }],
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.resolve, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      recordingId: recording.recordingId,
      operationId: `research-checkpoint-operation:${'2'.repeat(64)}`,
      resolution: 'discard',
      idempotencyKey: 'broker-resolve-1'
    }],
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.restoreAsNew, {
      recordingId: recording.recordingId,
      artifactId: ref.artifactId,
      sourceVersionId: ref.versionId,
      expectedCurrentVersionId: 'artifact-version:broker-test-current',
      idempotencyKey: 'broker-restore-1'
    }],
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.importLegacy, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'broker-legacy-1',
      title: 'Legacy broker test',
      expectedTranscriptDigest: 'a'.repeat(64),
      selectedTurnIds: ['legacy-turn-1']
    }]
  ]
  for (const [id, input] of cases) {
    const definition = byId.get(id)
    assert.ok(definition)
    const result = await definition.handler(input, { caller: { workspaceId: '/workspace' } })
    assert.equal(Object.hasOwn(result, 'changed'), false, `${id} must not claim a Broker resource change`)
    assert.equal(definition.outputSchema.safeParse(result.output).success, true, `${id} output must match its public schema`)
  }
})

test('domain entry commits, reads, lists, restarts, and rejects wrong exact owner scope or identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'research-checkpoint-domain-entry-'))
  let artifactVersions: ArtifactVersionsCapabilityTestHarness | undefined
  try {
    const userDataDir = join(root, 'user-data')
    const workspaceRoot = join(root, 'workspace')
    await mkdir(userDataDir)
    await mkdir(workspaceRoot)
    const activeArtifactVersions = await createArtifactVersionsCapabilityTestHarness(userDataDir)
    artifactVersions = activeArtifactVersions
    let runtime: ResearchCheckpointRuntime | undefined
    const entry = createDomainMainEntry({
      defineCapability: (value: unknown) => value,
      createResearchCheckpointRuntime: (options: ConstructorParameters<typeof ResearchCheckpointRuntime>[0]) => (
        runtime = new ResearchCheckpointRuntime(options)
      ),
      textSanitizer: { sanitizeText: (value: string) => value }
    } as never)
    const lifecycle = entry.contributions.find(
      (item) => item.id === RESEARCH_CHECKPOINTS_RUNTIME_LIFECYCLE_CONTRIBUTION.id
    )!.value as { activate: (context: DomainMainRuntimeLifecycleContext) => Promise<() => Promise<void>> }
    const required = new Set<(event: DomainMainBeforeTurnEvent) => void | Promise<void>>()
    let readMutation: ((value: unknown) => unknown) | undefined
    let durableBoundarySnapshot: DomainMainDurableTurnBoundarySnapshot = {
      issuerEpoch: 'test-issuer-epoch',
      nextDeliveryAttemptOrdinal: 1,
      retiredThroughOrdinal: 0,
      retiredOrdinalRanges: [],
      owners: []
    }
    const context = {
      owner: { moduleId: 'sciforge.research-checkpoints', moduleVersion: '1.0.0' },
      signal: new AbortController().signal,
      userDataDir,
      appRoot: '/app',
      environment: {},
      agentThreads: {
        list: async () => [],
        read: async () => ({
          id: 'thread-1', runtimeId: 'codex', workspaceRoot, watermark: 'wm-0', turns: [], artifacts: []
        }),
        hasActiveTurns: () => false
      },
      turnEvents: {
        subscribe: () => () => undefined,
        subscribeRequiredBeforeTurn: (listener: (event: DomainMainBeforeTurnEvent) => void | Promise<void>) => {
          required.add(listener)
          return () => { required.delete(listener) }
        },
        readDurableTurnBoundarySnapshot: async () => durableBoundarySnapshot
      },
      capabilities: {
        invoke: async (contract: { actionId: string; outputSchema: { parse: (value: unknown) => unknown } }, input: unknown, options?: { workspaceId?: string }) => {
          const workspace = options?.workspaceId ?? workspaceRoot
          if (contract.actionId.startsWith('artifact-versions.')) {
            const result = await activeArtifactVersions.invokeAction(
              contract.actionId,
              input,
              workspace
            )
            if (contract.actionId !== ARTIFACT_VERSIONS_CAPABILITY_IDS.read) {
              return contract.outputSchema.parse(result)
            }
            return contract.outputSchema.parse(readMutation ? readMutation(result) : result)
          }
          if (contract.actionId === 'git-checkpoints.list') {
            return contract.outputSchema.parse({ ok: true, value: [] })
          }
          throw new Error(`unexpected action ${contract.actionId}`)
        }
      },
      modelAccess: { textReasoner: async () => null },
      executionEvents: { publish: async () => undefined },
      workflowExecutionReceipts: [],
      enablement: { isEnabled: async () => true, subscribe: () => () => undefined },
      log: () => undefined
    } as unknown as DomainMainRuntimeLifecycleContext
    const deactivate = await lifecycle.activate(context)
    assert.ok(runtime)
    const before: DomainMainBeforeTurnEvent = {
      kind: 'before-turn', state: 'starting', runtimeId: 'codex', threadId: 'thread-1',
      issuerEpoch: 'test-issuer-epoch', deliveryAttemptOrdinal: 1,
      boundaryLeaseId: 'directive-entry', deliveryAttemptId: 'directive-entry', clientDirectiveId: 'directive-entry',
      workspaceRoot, occurredAt: '2099-08-13T01:00:00.000Z'
    }
    for (const listener of required) await listener(before)
    const event: DomainTurnArtifactEvent = {
      contractVersion: 1, kind: 'turn-completed', runtimeId: 'codex', threadId: 'thread-1',
      issuerEpoch: 'test-issuer-epoch', deliveryAttemptOrdinal: 1,
      turnId: 'turn-entry', targetWatermark: 'wm-1', boundaryLeaseId: 'directive-entry',
      deliveryAttemptId: 'directive-entry', clientDirectiveId: 'directive-entry',
      workspaceRoot, occurredAt: '2099-08-13T01:01:00.000Z',
      artifacts: [{ kind: 'assistant_message', text: 'Exact entry result' }]
    }
    await runtime.consume(event)
    durableBoundarySnapshot = {
      issuerEpoch: 'test-issuer-epoch',
      nextDeliveryAttemptOrdinal: 2,
      retiredThroughOrdinal: 0,
      retiredOrdinalRanges: [],
      owners: [{
        issuerEpoch: 'test-issuer-epoch',
        deliveryAttemptOrdinal: 1,
        boundaryLeaseId: 'directive-entry',
        deliveryAttemptId: 'directive-entry',
        clientDirectiveId: 'directive-entry',
        runtimeId: 'codex',
        threadId: 'thread-1',
        workspaceRoot,
        phase: 'completed-intent',
        turnId: 'turn-entry',
        occurredAt: '2099-08-13T01:01:00.000Z'
      }]
    }
    let terminalStatus: unknown
    let record: ResearchCheckpointRecordV1 | undefined
    let lastReadError: unknown
    for (let attempt = 0; attempt < 100 && !record; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      terminalStatus = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', 'turn-entry')
      try { record = await runtime.read(workspaceRoot, {}) } catch (error) { lastReadError = error }
    }
    assert.ok(record, `${lastReadError instanceof Error ? lastReadError.message : String(lastReadError)} ${JSON.stringify(terminalStatus)}`)
    assert.equal(record?.manifest.narrative.canonicalText, 'Exact entry result')
    assert.equal((await runtime.list(workspaceRoot, {})).records[0]?.manifest.narrative.canonicalText, 'Exact entry result')
    await deactivate()

    const restarted = new ResearchCheckpointRuntime({ userDataDir })
    const restartDeactivate = await restarted.activate(context)
    assert.equal((await restarted.read(workspaceRoot, {})).manifest.narrative.canonicalText, 'Exact entry result')
    await restartDeactivate()

    const wrongScope = new ResearchCheckpointRuntime({ userDataDir })
    const wrongScopeDeactivate = await wrongScope.activate(context)
    await assert.rejects(
      wrongScope.read(join(root, 'other-workspace'), {}),
      /not found|another workspace|scope/iu
    )
    await wrongScopeDeactivate()

    readMutation = (value) => {
      if (!value || typeof value !== 'object' || !('ok' in value) || value.ok !== true) return value
      const result = value as { ok: true; value: Record<string, unknown> }
      const exact = result.value as {
        artifact: Record<string, unknown>
        version: Record<string, unknown>
        ref: Record<string, unknown>
      }
      return {
        ...result,
        value: {
          ...exact,
          ref: { ...exact.ref, availability: 'remote' }
        }
      }
    }
    const tampered = new ResearchCheckpointRuntime({ userDataDir })
    const tamperedDeactivate = await tampered.activate(context)
    await assert.rejects(
      tampered.read(workspaceRoot, {}),
      /wrong exact reference/u
    )
    await tamperedDeactivate()
  } finally {
    await artifactVersions?.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
