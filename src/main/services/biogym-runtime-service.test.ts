import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultBioGymSettings,
  defaultCodexRuntimeSettings,
  defaultConnectPhoneSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultRemoteChannelSettings,
  defaultRemoteExecutorSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1,
  type BioGymSettingsV1
} from '../../shared/app-settings'
import type { BioGymRunEvent } from '../../shared/biogym'
import { BiologyRoomService } from './biology-room-service'
import {
  BIOGYM_INTERNAL_DESIGN_PATH,
  BioGymRuntimeService
} from './biogym-runtime-service'
import { BioGymCliError, type BioGymCliExecution } from './biogym-cli-executor'

const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('BioGymRuntimeService', () => {
  it('returns canonical direct-call guidance for the native BioGym tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-capabilities-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings(),
      cliRunner: fakeCli().run
    })

    const capabilities = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'capabilities'
    })))

    expect(capabilities.canonicalCalls).toMatchObject({
      startDeNovo: {
        operation: 'start',
        workflow: 'de_novo_scaffold'
      },
      advanceBackbone: {
        operation: 'advance',
        stage: { kind: 'backbone', lengthRange: [80, 100], numBackbones: 3 }
      }
    })
    expect(capabilities.argumentRules).toEqual(expect.arrayContaining([
      expect.stringContaining('params wrapper'),
      expect.stringContaining('stage'),
      expect.stringContaining('host continuation')
    ]))
    await service.stop()
  })

  it('derives active native-tool context from durable owner state and removes it at terminal status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-native-tool-context-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const otherWorkspace = join(root, 'other-workspace')
    const userData = join(root, 'user-data')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(otherWorkspace, { recursive: true })
    ])
    const options = {
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      pollIntervalMs: 1
    }
    const initial = new BioGymRuntimeService(options)
    const started = asResult(await initial.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'native tool context test'
    })))
    const runId = started.snapshot.designRunId as string
    await waitForSnapshot(initial, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')

    await expect(initial.hasActiveDesignRun({
      runtimeId: 'sciforge', threadId: 'thread-1', workspace
    })).resolves.toBe(true)
    await expect(initial.hasActiveDesignRun({
      runtimeId: 'sciforge', threadId: 'thread-other', workspace
    })).resolves.toBe(false)
    await expect(initial.hasActiveDesignRun({
      runtimeId: 'sciforge', threadId: 'thread-1', workspace: otherWorkspace
    })).resolves.toBe(false)
    await expect(initial.hasActiveDesignRun({
      runtimeId: 'codex', threadId: 'thread-1', workspace
    })).resolves.toBe(false)
    await initial.stop()

    const resumed = new BioGymRuntimeService(options)
    await resumed.start()
    await expect(resumed.hasActiveDesignRun({
      runtimeId: 'sciforge', threadId: 'thread-1', workspace
    })).resolves.toBe(true)

    const current = asResult(await resumed.handleEnvelope(envelope(workspace, {
      operation: 'status', designRunId: runId
    })))
    await resumed.handleEnvelope(envelope(workspace, {
      operation: 'cancel', designRunId: runId, expectedRevision: current.snapshot.revision
    }))
    await expect(resumed.hasActiveDesignRun({
      runtimeId: 'sciforge', threadId: 'thread-1', workspace
    })).resolves.toBe(false)
    await resumed.stop()
  }, 15_000)

  it('rejects stale ready and stage continuations after revision, advance, and cancel changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-continuation-freshness-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      pollIntervalMs: 1
    })
    const readyFreshness = (runId: string, revision: number, threadId = 'thread-1') => ({
      runtimeId: 'sciforge' as const,
      threadId,
      workspaceRoot: workspace,
      designRunId: runId,
      expectedRevision: revision,
      hostRequestId: `biogym:${runId}:ready:${revision}`,
      phase: 'ready' as const
    })

    const revisionRun = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'revision freshness'
    })))
    const revisionRunId = revisionRun.snapshot.designRunId as string
    const revisionReady = await waitForSnapshot(
      service, workspace, revisionRunId, (snapshot) => snapshot.status === 'awaiting_agent'
    )
    const initialFreshness = readyFreshness(revisionRunId, revisionReady.snapshot.revision)
    await expect(service.checkContinuationFreshness(initialFreshness)).resolves.toEqual({ allow: true })
    await expect(service.checkContinuationFreshness({
      ...initialFreshness,
      threadId: 'different-owner-thread'
    })).resolves.toMatchObject({ allow: false, reason: 'run_owner_changed' })
    await service.handleEnvelope(envelope(workspace, {
      operation: 'extend_budget',
      designRunId: revisionRunId,
      expectedRevision: revisionReady.snapshot.revision,
      additionalGpuJobs: 1,
      reason: 'freshness revision regression'
    }))
    await expect(service.checkContinuationFreshness(initialFreshness)).resolves.toMatchObject({
      allow: false,
      reason: 'run_revision_changed'
    })

    const stageRun = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'stage freshness'
    })))
    const stageRunId = stageRun.snapshot.designRunId as string
    const stageReady = await waitForSnapshot(
      service, workspace, stageRunId, (snapshot) => snapshot.status === 'awaiting_agent'
    )
    await service.handleEnvelope(envelope(workspace, {
      operation: 'advance',
      designRunId: stageRunId,
      expectedRevision: stageReady.snapshot.revision,
      stage: { kind: 'backbone', lengthRange: [30, 30], numBackbones: 1 }
    }))
    const firstTerminal = await waitForSnapshot(
      service, workspace, stageRunId, (snapshot) => snapshot.stages?.[0]?.status === 'succeeded'
    )
    const firstAttempt = firstTerminal.snapshot.stages[0]
    const stageFreshness = {
      runtimeId: 'sciforge' as const,
      threadId: 'thread-1',
      workspaceRoot: workspace,
      designRunId: stageRunId,
      expectedRevision: firstTerminal.snapshot.revision,
      hostRequestId: `biogym:${stageRunId}:stage:${firstAttempt.id}`,
      phase: 'stage' as const,
      stageAttemptId: firstAttempt.id
    }
    await expect(service.checkContinuationFreshness(stageFreshness)).resolves.toEqual({ allow: true })
    await expect(service.checkContinuationFreshness(
      readyFreshness(stageRunId, firstTerminal.snapshot.revision)
    )).resolves.toMatchObject({ allow: false, reason: 'ready_phase_superseded' })
    const secondAdvance = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'advance',
      designRunId: stageRunId,
      expectedRevision: firstTerminal.snapshot.revision,
      stage: {
        kind: 'sequence',
        backboneAssetId: firstAttempt.candidates[0].id,
        numSequences: 1
      }
    })))
    await expect(service.checkContinuationFreshness({
      ...stageFreshness,
      expectedRevision: secondAdvance.snapshot.revision
    })).resolves.toMatchObject({ allow: false, reason: 'stage_phase_superseded' })
    await waitForRawSnapshot(service, workspace, stageRunId, (snapshot) =>
      snapshot.stages?.[1] && !['queued', 'running'].includes(snapshot.stages[1].status)
    )

    const cancelledRun = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'cancelled freshness'
    })))
    const cancelledRunId = cancelledRun.snapshot.designRunId as string
    const cancelReady = await waitForSnapshot(
      service, workspace, cancelledRunId, (snapshot) => snapshot.status === 'awaiting_agent'
    )
    const cancelled = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'cancel',
      designRunId: cancelledRunId,
      expectedRevision: cancelReady.snapshot.revision
    })))
    await expect(service.checkContinuationFreshness(
      readyFreshness(cancelledRunId, cancelled.snapshot.revision)
    )).resolves.toMatchObject({ allow: false, reason: 'ready_phase_superseded' })
    await service.stop()
  }, 15_000)

  it('durably runs a stage, verifies artifacts, and registers the result in one Biology Room', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-service-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const userData = join(root, 'user-data')
    await mkdir(workspace, { recursive: true })
    const events: BioGymRunEvent[] = []
    const continuations: string[] = []
    const cli = fakeCli()
    const service = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({
        enabled: true,
        cliPath: process.execPath,
        sshHost: 'test-biogym-host',
        remoteRoot: '/srv/biogym'
      }),
      biologyRoomService: new BiologyRoomService(),
      cliRunner: cli.run,
      pollIntervalMs: 1,
      waitTimeoutMs: 5_000,
      emitRunEvent: (_channel, event) => events.push(event),
      continueAgent: async (input) => {
        continuations.push(input.text)
        return { threadId: 'thread-1', turnId: `turn-continuation-${continuations.length}` }
      }
    })

    const start = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start',
      workflow: 'de_novo_scaffold',
      objective: 'Generate one compact scaffold'
    })))
    expect(start.nextAction).toMatchObject({
      kind: 'wait_for_host_continuation',
      callToolNow: false,
      instruction: expect.stringContaining('Do not call status or advance yet')
    })
    const runId = start.snapshot.designRunId as string
    const ready = await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')
    expect(ready.allowedNextStages).toContain('backbone')

    await service.handleEnvelope(envelope(workspace, {
      operation: 'advance',
      designRunId: runId,
      expectedRevision: ready.snapshot.revision,
      stage: { kind: 'backbone', lengthRange: [30, 40], numBackbones: 1 }
    }))
    const complete = await waitForSnapshot(service, workspace, runId, (snapshot) =>
      snapshot.stages?.[0]?.status === 'succeeded'
    )

    expect(complete.snapshot.stages[0]).toMatchObject({
      kind: 'backbone',
      status: 'succeeded',
      candidateCount: 1
    })
    expect(complete.snapshot.stages[0].assetIds).toHaveLength(1)
    const room = await new BiologyRoomService().load({
      workspaceRoot: workspace,
      roomId: complete.snapshot.roomId
    })
    expect(room.assets).toHaveLength(1)
    expect(room.assets[0]).toMatchObject({ format: 'pdb', sha256: cli.pdbSha256 })
    expect(await readFile(join(workspace, room.assets[0].path), 'utf8')).toContain('ATOM')
    const provenance = JSON.parse(await readFile(join(
      workspace,
      '.sciforge',
      'biogym',
      'runs',
      runId,
      'derived',
      complete.snapshot.stages[0].id,
      'provenance.json'
    ), 'utf8')) as Record<string, any>
    expect(provenance).toMatchObject({
      actor: { runtimeId: 'sciforge', threadId: 'thread-1', turnId: 'turn-1' },
      model: { names: ['test-model'], checkpointHashes: ['sha256:test-checkpoint'] },
      completeness: { modelCheckpointHash: 'recorded', sourceHashes: 'recorded' }
    })
    expect(events.some((event) => event.type === 'artifact_ready')).toBe(true)
    const readyContinuation = continuations.find((text) => text.includes(`run ${runId} is ready`))
    expect(readyContinuation).toMatch(
      new RegExp(`\\{"operation":"advance","designRunId":"${runId}","expectedRevision":\\d+,"stage":\\{"kind":"backbone"`)
    )
    expect(readyContinuation).toContain('Do not use params or add stage.description.')
    expect(complete.canonicalNextCalls).toEqual([
      expect.objectContaining({
        operation: 'advance',
        designRunId: runId,
        expectedRevision: complete.snapshot.revision,
        stage: expect.objectContaining({
          kind: 'sequence',
          backboneAssetId: complete.snapshot.stages[0].candidates[0].id,
          numSequences: 5
        })
      })
    ])
    const stageContinuation = continuations.find((text) => text.includes('BioGym stage terminal'))
    expect(stageContinuation).toContain('Valid ready-to-send next-stage calls')
    expect(stageContinuation).toContain('"kind":"sequence"')
    await service.stop()
  }, 15_000)

  it('materializes an exact globally ranked candidate CSV before Boltz and preserves candidate identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-exact-verify-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const cli = verificationCli()
    const continuations: string[] = []
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: cli.run,
      pollIntervalMs: 1,
      waitTimeoutMs: 5_000,
      continueAgent: async (input) => {
        continuations.push(input.text)
        return { threadId: input.threadId, turnId: `turn-exact-${continuations.length}` }
      }
    })

    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'exact verify identity test'
    })))
    const runId = started.snapshot.designRunId as string
    await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')
    const runPath = join(workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json')
    const run = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>

    const seeded = [
      {
        stageAttemptId: 'sequence-01-seeded',
        remotePath: 'intermediate/proteinmpnn/seed-1/designed_sequences.csv',
        rows: [
          ['job_000002_candidate_001', 'AAAA', 1.20],
          ['job_000002_candidate_005', 'EEEA', 1.05]
        ]
      },
      {
        stageAttemptId: 'sequence-02-seeded',
        remotePath: 'intermediate/proteinmpnn/seed-2/designed_sequences.csv',
        rows: [
          ['job_000003_candidate_001', 'CCCC', 1.18],
          ['job_000003_candidate_004', 'DDDD', 0.99]
        ]
      }
    ]
    for (const [stageIndex, source] of seeded.entries()) {
      const csv = `candidate_id,sequence,score\n${source.rows.map((row) => row.join(',')).join('\n')}\n`
      const sha256 = createHash('sha256').update(csv).digest('hex')
      const sourcePath = join(
        workspace,
        '.sciforge',
        'biogym',
        'runs',
        runId,
        'artifacts',
        source.stageAttemptId,
        source.remotePath
      )
      await mkdir(join(sourcePath, '..'), { recursive: true })
      await writeFile(sourcePath, csv)
      const candidateSetId = `set:${source.stageAttemptId}`
      const sortedRows = [...source.rows].sort((left, right) => Number(left[2]) - Number(right[2]))
      run.candidateSets.push({
        id: candidateSetId,
        stageAttemptId: source.stageAttemptId,
        remotePath: source.remotePath,
        candidateIds: sortedRows.map((row) => row[0]),
        sourceSha256: sha256
      })
      const candidates = sortedRows.map((row) => ({
        id: row[0],
        label: row[0],
        sequence: row[1],
        score: row[2],
        scoreLabel: 'ProteinMPNN score (lower is better)',
        candidateSetId,
        sourceArtifactId: `art-sequence-${stageIndex + 1}`,
        sourceSha256: sha256
      }))
      run.candidates.push(...candidates)
      run.stages.push({
        id: source.stageAttemptId,
        kind: 'sequence',
        attempt: stageIndex + 1,
        status: 'succeeded',
        backend: 'proteinmpnn',
        candidateCount: candidates.length,
        assetIds: [],
        candidates,
        request: { kind: 'sequence', backboneAssetId: `backbone-${stageIndex + 1}`, numSequences: candidates.length },
        outputDir: `intermediate/proteinmpnn/seed-${stageIndex + 1}`,
        capability: 'protein.sequence.design_fixed_backbone',
        callRequestId: `seed-call-${stageIndex + 1}`,
        waitRequestId: `seed-wait-${stageIndex + 1}`,
        actorTurnId: 'turn-seeded',
        remoteArtifactIds: [`art-sequence-${stageIndex + 1}`],
        continuationDelivered: true,
        continuationTurnId: `turn-sequence-${stageIndex + 1}`
      })
    }
    run.budget.usedGpuJobs = 2
    run.revision += 1
    run.updatedAt = new Date().toISOString()
    await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`)

    const status = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'status', designRunId: runId
    })))
    expect(status.canonicalNextCalls).toContainEqual(expect.objectContaining({
      stage: {
        kind: 'verify',
        candidateIds: ['job_000003_candidate_004', 'job_000002_candidate_005']
      }
    }))
    const verifyCall = status.canonicalNextCalls.find((call: any) => call.stage?.kind === 'verify')
    await service.handleEnvelope(envelope(workspace, verifyCall))
    const completed = await waitForSnapshot(service, workspace, runId, (snapshot) =>
      snapshot.stages?.at(-1)?.kind === 'verify' && snapshot.stages.at(-1)?.status === 'succeeded'
    )

    expect(cli.preparedAction).toMatchObject({ type: 'WRITE_FILE', kind: 'verification_input' })
    expect(cli.preparedAction?.content).toContain('job_000003_candidate_004,DDDD,0.99')
    expect(cli.preparedAction?.content).toContain('job_000002_candidate_005,EEEA,1.05')
    expect(cli.preparedAction?.content).not.toContain('job_000002_candidate_001,AAAA')
    expect(cli.lastCallAction).toMatchObject({
      type: 'CALL_TOOL',
      args: {
        candidate_sequences: cli.preparedAction?.path,
        top_n: 2
      }
    })
    expect(cli.callToolSubmissions).toBe(1)
    const verifyStage = completed.snapshot.stages.at(-1)
    expect(verifyStage.candidates.map((candidate: any) => candidate.id).sort()).toEqual([
      'job_000002_candidate_005',
      'job_000003_candidate_004'
    ])
    expect(verifyStage.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'job_000003_candidate_004',
        metrics: expect.objectContaining({ proteinmpnn_score: 0.99 })
      }),
      expect.objectContaining({
        id: 'job_000002_candidate_005',
        metrics: expect.objectContaining({ proteinmpnn_score: 1.05 })
      })
    ]))
    const persisted = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
    const persistedVerify = persisted.stages.at(-1)
    expect(persistedVerify.verificationCandidateIds).toEqual([
      'job_000003_candidate_004',
      'job_000002_candidate_005'
    ])
    expect(persistedVerify.verificationInputSha256).toMatch(/^[a-f0-9]{64}$/)
    await waitForCondition(() => continuations.some((text) =>
      text.includes('[BioGym stage terminal: verify attempt 1]') &&
      text.includes('Valid ready-to-send finalization calls')
    ))
    const verifyContinuation = continuations.find((text) =>
      text.includes('[BioGym stage terminal: verify attempt 1]')
    )
    expect(verifyContinuation).toContain(`"operation":"finalize","designRunId":"${runId}"`)
    expect(verifyContinuation).toContain('"expectedRevision":')
    expect(verifyContinuation).toContain('"selectedCandidateIds":["job_000003_candidate_004","job_000002_candidate_005"]')
    expect(verifyContinuation).toContain('"caveats":[')
    await service.stop()
  }, 15_000)

  it('retries an accepted-turn response loss with the same deterministic host request ID', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-ready-continuation-retry-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const userData = join(root, 'user-data')
    await mkdir(workspace, { recursive: true })
    let attempts = 0
    const hostRequests: Array<{
      hostRequestId: string
      expectedRevision: number
      phase: string
    }> = []
    const service = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      pollIntervalMs: 1,
      continuationRetryMs: 1,
      continueAgent: async (input) => {
        attempts += 1
        hostRequests.push({
          hostRequestId: input.hostRequestId,
          expectedRevision: input.freshness.expectedRevision,
          phase: input.freshness.phase
        })
        if (attempts === 1) throw new Error('response lost after the agent runtime accepted the turn')
        return { threadId: 'thread-1', turnId: 'turn-ready-continuation' }
      }
    })

    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'continuation retry test'
    })))
    const runId = started.snapshot.designRunId as string
    await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')
    await waitForCondition(() => attempts === 2)

    const runPath = join(workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json')
    const run = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
    expect(run).toMatchObject({
      status: 'awaiting_agent',
      remote: {
        state: 'ready',
        readyContinuationDelivered: true,
        readyContinuationDeliveryAttempts: 2,
        readyContinuationTurnId: 'turn-ready-continuation'
      }
    })
    expect(run.remote.readyContinuationDeliveryError).toBeUndefined()
    expect(hostRequests).toHaveLength(2)
    expect(new Set(hostRequests.map((request) => request.hostRequestId))).toEqual(new Set([
      `biogym:${runId}:ready:${run.revision}`
    ]))
    expect(new Set(hostRequests.map((request) => request.expectedRevision))).toEqual(new Set([run.revision]))
    expect(hostRequests.every((request) => request.phase === 'ready')).toBe(true)
    const journal = await readFile(join(workspace, '.sciforge', 'biogym', 'runs', runId, 'events.ndjson'), 'utf8')
    expect(journal).toContain('ready_continuation_delivery_failed')
    expect(journal).toContain('ready_continuation_delivered')
    await service.stop()
  })

  it('persists typed pre-start suppression after a queued ready continuation is cancelled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-continuation-suppression-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const userData = join(root, 'user-data')
    await mkdir(workspace, { recursive: true })
    let releaseGuard!: () => void
    const guardGate = new Promise<void>((resolve) => { releaseGuard = resolve })
    let observeContinuation!: (input: any) => void
    const continuationObserved = new Promise<any>((resolve) => { observeContinuation = resolve })
    let continuationCalls = 0
    let service!: BioGymRuntimeService
    service = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      continuationRetryMs: 1,
      continueAgent: async (input) => {
        continuationCalls += 1
        observeContinuation(input)
        await guardGate
        const decision = await service.checkContinuationFreshness(input.freshness)
        if (!decision.allow) throw continuationSuppressedError(decision.reason)
        return { threadId: input.threadId, turnId: 'turn-should-not-start' }
      }
    })
    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'suppression persistence'
    })))
    const runId = started.snapshot.designRunId as string
    const queued = await continuationObserved
    expect(queued.hostRequestId).toBe(`biogym:${runId}:ready:${queued.freshness.expectedRevision}`)
    const ready = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'status', designRunId: runId
    })))
    const cancelled = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'cancel', designRunId: runId, expectedRevision: ready.snapshot.revision
    })))
    expect(cancelled.snapshot.status).toBe('cancelled')
    releaseGuard()
    const runPath = join(workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json')
    await waitForCondition(async () => {
      const run = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
      return Boolean(run.remote.readyContinuationSuppressedAt)
    })
    const suppressed = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
    expect(suppressed.remote).toMatchObject({
      readyContinuationDelivered: false,
      readyContinuationSuppressionReason: 'run_revision_changed'
    })
    expect(suppressed.remote.readyContinuationTurnId).toBeUndefined()
    expect(suppressed.continuationSuppressions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        hostRequestId: queued.hostRequestId,
        phase: 'ready',
        reason: 'run_revision_changed'
      })
    ]))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(continuationCalls).toBe(1)
    await service.stop()

    let replayCalls = 0
    const resumed = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      continuationRetryMs: 1,
      continueAgent: async (input) => {
        replayCalls += 1
        return { threadId: input.threadId, turnId: 'turn-unexpected-replay' }
      }
    })
    await resumed.start()
    await resumed.hasActiveDesignRun({ runtimeId: 'sciforge', threadId: 'thread-1', workspace })
    expect(replayCalls).toBe(0)
    await resumed.stop()
  })

  it('persists exponential continuation backoff beyond five failures and resumes it after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-continuation-backoff-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const userData = join(root, 'user-data')
    await mkdir(workspace, { recursive: true })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-07-13T06:00:00.000Z'))
    let attempts = 0
    const service = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      continuationRetryMs: 1,
      continueAgent: async () => {
        attempts += 1
        throw new Error(`agent runtime unavailable ${attempts}`)
      }
    })
    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'durable continuation backoff'
    })))
    const runId = started.snapshot.designRunId as string
    const runPath = join(workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json')
    const waitForScheduledAttempt = async (expectedAttempts: number): Promise<Record<string, any>> => {
      let persisted: Record<string, any> = {}
      await waitForFakeTimerCondition(async () => {
        persisted = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
        return persisted.remote.readyContinuationDeliveryAttempts >= expectedAttempts &&
          Boolean(persisted.remote.readyContinuationNextRetryAt)
      })
      await waitForFakeTimerCondition(() => vi.getTimerCount() > 0)
      return persisted
    }
    let persisted = await waitForScheduledAttempt(1)
    for (let expectedAttempts = 2; expectedAttempts <= 6; expectedAttempts += 1) {
      const delayMs = Date.parse(persisted.remote.readyContinuationNextRetryAt) - Date.now()
      expect(delayMs).toBe(2 ** (expectedAttempts - 2))
      await vi.advanceTimersByTimeAsync(delayMs)
      persisted = await waitForScheduledAttempt(expectedAttempts)
    }
    const failedDelivery = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'status', designRunId: runId
    })))
    expect(failedDelivery.snapshot.status).toBe('awaiting_agent')
    expect(failedDelivery.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'ready_continuation', message: 'agent runtime unavailable 6' })
    ]))
    expect(failedDelivery.continuationDelivery.ready).toMatchObject({
      delivered: false,
      attempts: 6,
      error: 'agent runtime unavailable 6'
    })
    const nextRetryAt = Date.parse(failedDelivery.continuationDelivery.ready.nextRetryAt)
    expect(nextRetryAt - Date.now()).toBe(32)
    await service.stop()

    let resumedAttempts = 0
    const resumed = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      continuationRetryMs: 1,
      continueAgent: async (input) => {
        resumedAttempts += 1
        return { threadId: input.threadId, turnId: 'turn-after-persisted-backoff' }
      }
    })
    await resumed.start()
    await resumed.hasActiveDesignRun({ runtimeId: 'sciforge', threadId: 'thread-1', workspace })
    expect(resumedAttempts).toBe(0)
    await vi.advanceTimersByTimeAsync(31)
    expect(resumedAttempts).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    let delivered: Record<string, any> = {}
    await waitForFakeTimerCondition(async () => {
      delivered = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
      return delivered.remote.readyContinuationTurnId === 'turn-after-persisted-backoff'
    })
    expect(resumedAttempts).toBe(1)
    expect(delivered.remote).toMatchObject({
      readyContinuationDelivered: true,
      readyContinuationDeliveryAttempts: 7,
      readyContinuationTurnId: 'turn-after-persisted-backoff'
    })
    expect(delivered.remote.readyContinuationNextRetryAt).toBeUndefined()
    await resumed.stop()
  })

  it('keeps controller recovery scheduled when a diagnostic continuation is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-diagnostic-recovery-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-07-13T07:00:00.000Z'))
    const cli = fakeCli()
    let remoteStartCalls = 0
    let diagnosticCalls = 0
    const diagnosticHostRequests: Array<{ id: string; revision: number }> = []
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: async (executable, args, options) => {
        if (remoteCommand(args) === 'start' && remoteStartCalls++ < 2) {
          throw structuredCliFailure({
            code: 'remote_transport_error',
            outcomeUnknown: true,
            requestId: 'start-recovery-request'
          })
        }
        return cli.run(executable, args, options)
      },
      continueAgent: async (input) => {
        if (input.metadata.event === 'diagnostic') {
          diagnosticCalls += 1
          diagnosticHostRequests.push({
            id: input.hostRequestId,
            revision: input.freshness.expectedRevision
          })
          throw new Error('diagnostic turn rejected')
        }
        return { threadId: input.threadId, turnId: 'turn-ready-after-recovery' }
      }
    })
    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'diagnostic isolation'
    })))
    const runId = started.snapshot.designRunId as string
    await waitForFakeTimerCondition(() => diagnosticCalls === 1)
    const recovering = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'status', designRunId: runId
    })))
    expect(recovering.snapshot.status).toBe('indeterminate')
    await vi.advanceTimersByTimeAsync(5_000)
    await waitForFakeTimerCondition(async () => {
      const state = asResult(await service.handleEnvelope(envelope(workspace, {
        operation: 'status', designRunId: runId
      })))
      return state.snapshot.status === 'awaiting_agent'
    })
    expect(remoteStartCalls).toBe(3)
    expect(diagnosticCalls).toBe(1)
    expect(diagnosticHostRequests[0]?.id).toBe(
      `biogym:${runId}:diagnostic:${diagnosticHostRequests[0]?.revision}`
    )
    await waitForFakeTimerCondition(async () => {
      const run = JSON.parse(await readFile(join(
        workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json'
      ), 'utf8')) as Record<string, any>
      return run.remote.readyContinuationTurnId === 'turn-ready-after-recovery'
    })
    await service.stop()
  })

  it('persists legacy ready migration per owner thread and never resurrects suppressed runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-legacy-continuation-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const userData = join(root, 'user-data')
    await mkdir(workspace, { recursive: true })
    const initial = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      pollIntervalMs: 1,
      continueAgent: async (input) => ({
        threadId: 'thread-1',
        turnId: `turn-initial-${String(input.metadata.designRunId)}`
      })
    })
    const older = asResult(await initial.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'older legacy continuation'
    })))
    const newer = asResult(await initial.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'newer legacy continuation'
    })))
    const otherThread = asResult(await initial.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'independent thread continuation'
    }, 'thread-2')))
    const olderRunId = older.snapshot.designRunId as string
    const newerRunId = newer.snapshot.designRunId as string
    const otherThreadRunId = otherThread.snapshot.designRunId as string
    await waitForSnapshot(initial, workspace, olderRunId, (snapshot) => snapshot.status === 'awaiting_agent')
    await waitForSnapshot(initial, workspace, newerRunId, (snapshot) => snapshot.status === 'awaiting_agent')
    await waitForSnapshot(initial, workspace, otherThreadRunId, (snapshot) => snapshot.status === 'awaiting_agent', 'thread-2')
    const olderRunPath = join(workspace, '.sciforge', 'biogym', 'runs', olderRunId, 'run.json')
    const newerRunPath = join(workspace, '.sciforge', 'biogym', 'runs', newerRunId, 'run.json')
    const otherThreadRunPath = join(workspace, '.sciforge', 'biogym', 'runs', otherThreadRunId, 'run.json')
    await waitForCondition(async () => {
      const [olderRun, newerRun, independentRun] = await Promise.all([
        readFile(olderRunPath, 'utf8').then((text) => JSON.parse(text) as Record<string, any>),
        readFile(newerRunPath, 'utf8').then((text) => JSON.parse(text) as Record<string, any>),
        readFile(otherThreadRunPath, 'utf8').then((text) => JSON.parse(text) as Record<string, any>)
      ])
      return Boolean(olderRun.remote.readyContinuationTurnId && newerRun.remote.readyContinuationTurnId &&
        independentRun.remote.readyContinuationTurnId)
    })
    await initial.stop()

    const olderLegacy = JSON.parse(await readFile(olderRunPath, 'utf8')) as Record<string, any>
    olderLegacy.remote.readyContinuationDelivered = true
    delete olderLegacy.remote.readyContinuationTurnId
    olderLegacy.updatedAt = '2026-07-13T04:00:00.000Z'
    await writeFile(olderRunPath, `${JSON.stringify(olderLegacy, null, 2)}\n`)
    const newerLegacy = JSON.parse(await readFile(newerRunPath, 'utf8')) as Record<string, any>
    newerLegacy.remote.readyContinuationDelivered = true
    delete newerLegacy.remote.readyContinuationTurnId
    newerLegacy.updatedAt = '2026-07-13T05:00:00.000Z'
    await writeFile(newerRunPath, `${JSON.stringify(newerLegacy, null, 2)}\n`)
    const independentLegacy = JSON.parse(await readFile(otherThreadRunPath, 'utf8')) as Record<string, any>
    independentLegacy.remote.readyContinuationDelivered = true
    delete independentLegacy.remote.readyContinuationTurnId
    independentLegacy.updatedAt = '2026-07-13T04:30:00.000Z'
    await writeFile(otherThreadRunPath, `${JSON.stringify(independentLegacy, null, 2)}\n`)

    const replayed: string[] = []
    const resumed = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      continuationRetryMs: 1,
      continueAgent: async (input) => {
        replayed.push(String(input.metadata.designRunId))
        return { threadId: 'thread-1', turnId: 'turn-replayed' }
      }
    })
    await resumed.start()
    await waitForCondition(() => replayed.length === 2)
    expect(new Set(replayed)).toEqual(new Set([newerRunId, otherThreadRunId]))
    await waitForCondition(async () => {
      const run = JSON.parse(await readFile(newerRunPath, 'utf8')) as Record<string, any>
      return run.remote.readyContinuationTurnId === 'turn-replayed'
    })
    const suppressedOlder = JSON.parse(await readFile(olderRunPath, 'utf8')) as Record<string, any>
    expect(suppressedOlder.remote).toMatchObject({
      readyContinuationLegacyDisposition: 'suppressed_older'
    })
    expect(suppressedOlder.remote.readyContinuationTurnId).toBeUndefined()
    await resumed.stop()

    const replayedAfterSecondRestart: string[] = []
    const restartedAgain = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      continuationRetryMs: 1,
      continueAgent: async (input) => {
        replayedAfterSecondRestart.push(String(input.metadata.designRunId))
        return { threadId: String(input.threadId), turnId: 'turn-unexpected-replay' }
      }
    })
    await restartedAgain.start()
    await restartedAgain.hasActiveDesignRun({ runtimeId: 'sciforge', threadId: 'thread-1', workspace })
    expect(replayedAfterSecondRestart).toEqual([])
    await restartedAgain.stop()
  })

  it('replays only the newest actionable legacy terminal stage and persists older suppression', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-legacy-stage-continuation-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const userData = join(root, 'user-data')
    await mkdir(workspace, { recursive: true })
    const initial = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      pollIntervalMs: 1,
      continueAgent: async (input) => ({
        threadId: input.threadId,
        turnId: `turn-initial-${String(input.metadata.stageAttemptId ?? 'ready')}`
      })
    })
    const started = asResult(await initial.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'legacy stage migration'
    })))
    const runId = started.snapshot.designRunId as string
    const ready = await waitForSnapshot(initial, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')
    await initial.handleEnvelope(envelope(workspace, {
      operation: 'advance',
      designRunId: runId,
      expectedRevision: ready.snapshot.revision,
      stage: { kind: 'backbone', lengthRange: [30, 30], numBackbones: 1 }
    }))
    await waitForSnapshot(initial, workspace, runId, (snapshot) => snapshot.stages?.[0]?.status === 'succeeded')
    const runPath = join(workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json')
    await waitForCondition(async () => {
      const run = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
      return Boolean(run.stages[0].continuationTurnId)
    })
    await initial.stop()

    const legacy = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
    const olderAttempt = legacy.stages[0]
    olderAttempt.continuationDelivered = true
    delete olderAttempt.continuationTurnId
    olderAttempt.completedAt = '2026-07-13T04:00:00.000Z'
    const newerAttempt = {
      ...JSON.parse(JSON.stringify(olderAttempt)),
      id: 'backbone-02-legacy',
      attempt: 2,
      completedAt: '2026-07-13T05:00:00.000Z',
      continuationDelivered: true
    }
    delete newerAttempt.continuationTurnId
    legacy.stages.push(newerAttempt)
    legacy.updatedAt = '2026-07-13T05:00:00.000Z'
    await writeFile(runPath, `${JSON.stringify(legacy, null, 2)}\n`)

    const replayedStages: string[] = []
    const resumed = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      continueAgent: async (input) => {
        if (input.metadata.stageAttemptId) replayedStages.push(String(input.metadata.stageAttemptId))
        return { threadId: input.threadId, turnId: 'turn-replayed-stage' }
      }
    })
    await resumed.start()
    await waitForCondition(() => replayedStages.length === 1)
    expect(replayedStages).toEqual(['backbone-02-legacy'])
    await waitForCondition(async () => {
      const run = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
      return run.stages[1].continuationTurnId === 'turn-replayed-stage'
    })
    const migrated = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
    expect(migrated.stages[0]).toMatchObject({
      continuationLegacyDisposition: 'suppressed_older'
    })
    expect(migrated.stages[1]).toMatchObject({
      continuationLegacyDisposition: 'replay_selected',
      continuationTurnId: 'turn-replayed-stage'
    })
    await resumed.stop()

    const replayedAfterRestart: string[] = []
    const restartedAgain = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      continueAgent: async (input) => {
        replayedAfterRestart.push(String(input.metadata.stageAttemptId))
        return { threadId: input.threadId, turnId: 'turn-unexpected-stage' }
      }
    })
    await restartedAgain.start()
    await restartedAgain.hasActiveDesignRun({ runtimeId: 'sciforge', threadId: 'thread-1', workspace })
    expect(replayedAfterRestart).toEqual([])
    await restartedAgain.stop()
  })

  it('permanently suppresses legacy wakes for completed, cancelled, finalizing, and cleanup-pending runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-legacy-inactive-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const userData = join(root, 'user-data')
    await mkdir(workspace, { recursive: true })
    const initial = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      continueAgent: async (input) => ({ threadId: input.threadId, turnId: `turn-${input.threadId}` })
    })
    const statuses = ['completed', 'cancelled', 'finalizing', 'cleanup_pending'] as const
    const seeded: Array<{ runId: string; runPath: string; threadId: string; status: typeof statuses[number] }> = []
    for (const [index, status] of statuses.entries()) {
      const threadId = `inactive-thread-${index + 1}`
      const started = asResult(await initial.handleEnvelope(envelope(workspace, {
        operation: 'start', workflow: 'de_novo_scaffold', objective: `legacy ${status}`
      }, threadId)))
      const runId = started.snapshot.designRunId as string
      await waitForSnapshot(initial, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent', threadId)
      const runPath = join(workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json')
      await waitForCondition(async () => {
        const run = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
        return Boolean(run.remote.readyContinuationTurnId)
      })
      seeded.push({ runId, runPath, threadId, status })
    }
    await initial.stop()

    for (const entry of seeded) {
      const run = JSON.parse(await readFile(entry.runPath, 'utf8')) as Record<string, any>
      run.remote.readyContinuationDelivered = true
      delete run.remote.readyContinuationTurnId
      if (entry.status === 'cleanup_pending') {
        run.status = 'awaiting_agent'
        run.cleanup.requested = true
        run.cleanup.completed = false
        run.cleanup.requestId = `${entry.runId.replaceAll('-', '_')}_cleanup`
      } else {
        run.status = entry.status
      }
      await writeFile(entry.runPath, `${JSON.stringify(run, null, 2)}\n`)
    }

    const readyWakes: string[] = []
    const resumed = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      continueAgent: async (input) => {
        if (input.metadata.event === 'remote_ready') readyWakes.push(String(input.metadata.designRunId))
        return { threadId: input.threadId, turnId: 'turn-diagnostic-only' }
      }
    })
    await resumed.start()
    await resumed.hasActiveDesignRun({ runtimeId: 'sciforge', threadId: seeded[0].threadId, workspace })
    expect(readyWakes).toEqual([])
    for (const entry of seeded) {
      const migrated = JSON.parse(await readFile(entry.runPath, 'utf8')) as Record<string, any>
      expect(migrated.remote.readyContinuationLegacyDisposition).toBe('suppressed_inactive')
    }
    await resumed.stop()
  })

  it('retries a rejected stage continuation without rewriting a succeeded scientific stage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-stage-continuation-retry-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    let stageAttempts = 0
    const stageHostRequestIds: string[] = []
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: fakeCli().run,
      pollIntervalMs: 1,
      continuationRetryMs: 1,
      continueAgent: async (input) => {
        if (input.metadata.event === 'remote_ready') {
          return { threadId: 'thread-1', turnId: 'turn-ready' }
        }
        stageAttempts += 1
        stageHostRequestIds.push(input.hostRequestId)
        if (stageAttempts === 1) throw new Error('agent turn rejected')
        return { threadId: 'thread-1', turnId: 'turn-stage-continuation' }
      }
    })

    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'stage continuation retry test'
    })))
    const runId = started.snapshot.designRunId as string
    const ready = await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')
    await service.handleEnvelope(envelope(workspace, {
      operation: 'advance',
      designRunId: runId,
      expectedRevision: ready.snapshot.revision,
      stage: { kind: 'backbone', lengthRange: [30, 30], numBackbones: 1 }
    }))
    await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.stages?.[0]?.status === 'succeeded')
    const runPath = join(workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json')
    await waitForCondition(async () => {
      const persisted = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
      return persisted.stages[0].continuationTurnId === 'turn-stage-continuation'
    })

    const run = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
    expect(run.status).toBe('awaiting_agent')
    expect(run.stages[0]).toMatchObject({
      status: 'succeeded',
      continuationDelivered: true,
      continuationDeliveryAttempts: 2,
      continuationTurnId: 'turn-stage-continuation'
    })
    expect(run.stages[0].continuationDeliveryError).toBeUndefined()
    expect(new Set(stageHostRequestIds)).toEqual(new Set([
      `biogym:${runId}:stage:${run.stages[0].id}`
    ]))
    await service.stop()
  })

  it('authenticates its loopback interface and rejects model-supplied context fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-http-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings(),
      cliRunner: fakeCli().run
    })
    const server = await service.start()
    const unauthorized = await fetch(`${server.baseUrl}${BIOGYM_INTERNAL_DESIGN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope(workspace, { operation: 'capabilities' }))
    })
    expect(unauthorized.status).toBe(401)

    const invalid = await fetch(`${server.baseUrl}${BIOGYM_INTERNAL_DESIGN_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${server.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...envelope(workspace, { operation: 'capabilities' }),
        request: { operation: 'capabilities', sshHost: 'attacker' }
      })
    })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_request' }
    })
    await service.stop()
  })

  it('rejects stale revisions before another GPU job is submitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-revision-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const cli = fakeCli()
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: cli.run,
      pollIntervalMs: 1
    })
    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'revision test'
    })))
    const runId = started.snapshot.designRunId as string
    const ready = await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')
    await expect(service.handleEnvelope(envelope(workspace, {
      operation: 'advance',
      designRunId: runId,
      expectedRevision: ready.snapshot.revision - 1,
      stage: { kind: 'backbone', lengthRange: [30, 30], numBackbones: 1 }
    }))).rejects.toMatchObject({ code: 'biogym_revision_conflict' })
    expect(cli.callToolSubmissions).toBe(0)
    await service.stop()
  })

  it('preserves the remote run when BioGym validation does not pass', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-finalize-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const cli = fakeCli({ validationStatus: 'fail' })
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: cli.run,
      pollIntervalMs: 1
    })
    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'validation failure test'
    })))
    const runId = started.snapshot.designRunId as string
    let state = await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')
    await service.handleEnvelope(envelope(workspace, {
      operation: 'advance',
      designRunId: runId,
      expectedRevision: state.snapshot.revision,
      stage: { kind: 'backbone', lengthRange: [30, 30], numBackbones: 1 }
    }))
    state = await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.stages?.[0]?.status === 'succeeded')
    const candidateId = state.snapshot.stages[0].candidates[0].id
    await service.handleEnvelope(envelope(workspace, {
      operation: 'finalize',
      designRunId: runId,
      expectedRevision: state.snapshot.revision,
      disposition: 'selected',
      selectedCandidateIds: [candidateId],
      summary: 'Controlled validation-failure test.',
      caveats: ['Computational prediction only.']
    }))
    const failed = await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.status === 'failed')
    expect(failed.errors.some((entry: { message: string }) => entry.message.includes('validation'))).toBe(true)
    expect(cli.finishCalls).toBe(0)
    expect(cli.cleanupCalls).toBe(0)
    const run = JSON.parse(await readFile(
      join(workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json'),
      'utf8'
    )) as { cleanup: { completed: boolean }; remote: { state: string } }
    expect(run.cleanup.completed).toBe(false)
    expect(run.remote.state).toBe('ready')
    await service.stop()
  })

  it('mirrors BioGym compound-suffix materialization for trusted inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-suffix-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const input = join(workspace, 'inputs', 'backbone.v1.pdb')
    await mkdir(join(workspace, 'inputs'), { recursive: true })
    const pdb = 'ATOM      1  CA  GLY A   1       0.000   0.000   0.000  1.00 20.00           C\nEND\n'
    await writeFile(input, pdb)
    const expectedHash = createHash('sha256').update(pdb).digest('hex').slice(0, 12)
    const cli = fakeCli()
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: cli.run,
      pollIntervalMs: 1
    })
    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start',
      workflow: 'fixed_backbone',
      objective: 'compound suffix test',
      input: { backbonePath: 'inputs/backbone.v1.pdb' }
    })))
    const ready = await waitForSnapshot(
      service,
      workspace,
      started.snapshot.designRunId,
      (snapshot) => snapshot.status === 'awaiting_agent'
    )
    await service.handleEnvelope(envelope(workspace, {
      operation: 'advance',
      designRunId: started.snapshot.designRunId,
      expectedRevision: ready.snapshot.revision,
      stage: { kind: 'sequence', backboneAssetId: 'input-backbone', numSequences: 1 }
    }))
    await waitForSnapshot(
      service,
      workspace,
      started.snapshot.designRunId,
      (snapshot) => snapshot.stages?.[0]?.status === 'succeeded'
    )
    expect((cli.lastCallAction?.args as Record<string, unknown>)?.backbone_path).toBe(
      `input/backbone_path-${expectedHash}.v1.pdb`
    )
    const journal = JSON.parse(await readFile(join(
      workspace,
      '.sciforge',
      'biogym',
      'runs',
      started.snapshot.designRunId,
      'run.json'
    ), 'utf8')) as { stages: Array<{ id: string }> }
    const provenance = JSON.parse(await readFile(join(
      workspace,
      '.sciforge',
      'biogym',
      'runs',
      started.snapshot.designRunId,
      'derived',
      journal.stages[0].id,
      'provenance.json'
    ), 'utf8')) as { sources: Array<{ role: string; sha256: string }> }
    expect(provenance.sources).toEqual([{
      role: 'backbone',
      referenceId: 'input-backbone',
      sha256: createHash('sha256').update(pdb).digest('hex')
    }])
    await service.stop()
  })

  it('cancels a running backend stage when its approved wall-clock budget expires', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-wallclock-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const cli = fakeCli({ waitOperationDelayMs: 500 })
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: cli.run,
      pollIntervalMs: 1
    })
    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start',
      workflow: 'de_novo_scaffold',
      objective: 'wall-clock enforcement test',
      budget: { maxWallclockHours: 0.0001 }
    })))
    const runId = started.snapshot.designRunId as string
    const ready = await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')
    await service.handleEnvelope(envelope(workspace, {
      operation: 'advance',
      designRunId: runId,
      expectedRevision: ready.snapshot.revision,
      stage: { kind: 'backbone', lengthRange: [30, 30], numBackbones: 1 }
    }))
    const failed = await waitForRawSnapshot(service, workspace, runId, (snapshot) => snapshot.status === 'failed')
    expect(failed.errors[0].message).toContain('wall-clock budget expired')
    expect(cli.callToolSubmissions).toBe(1)
    expect(cli.cancellationCalls).toBe(1)
    await service.stop()
  })

  it('cancels a persisted backend job before failing an expired resumed attempt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-expired-resume-job-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const userData = join(root, 'user-data')
    await mkdir(workspace, { recursive: true })
    let runPath = ''
    let statusAtCancellation = ''
    const cli = fakeCli({
      onCancellation: async () => {
        statusAtCancellation = (JSON.parse(await readFile(runPath, 'utf8')) as { status: string }).status
      }
    })
    const seeded = await seedExpiredResumedAttempt({
      workspace,
      userData,
      cliRunner: cli.run,
      jobId: 'job_000001'
    })
    runPath = seeded.runPath
    const resumed = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: cli.run,
      pollIntervalMs: 1
    })

    await resumed.start()
    const failed = await waitForRawSnapshot(resumed, workspace, seeded.runId, (snapshot) => snapshot.status === 'failed')

    expect(failed.errors[0].message).toContain('wall-clock budget expired')
    expect(cli.cancellationCalls).toBe(1)
    expect(statusAtCancellation).toBe('running')
    await resumed.stop()
  })

  it('read-only recovers an accepted CALL_TOOL job before cancelling an expired resumed attempt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-expired-resume-operation-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const userData = join(root, 'user-data')
    await mkdir(workspace, { recursive: true })
    const callOperationId = 'b'.repeat(32)
    let runPath = ''
    let statusAtCancellation = ''
    const cli = fakeCli({
      preloadedOperations: {
        [callOperationId]: {
          status: 'done',
          result: { status: 'accepted', message: 'queued', data: { job_id: 'job_recovered_001' } }
        }
      },
      onCancellation: async () => {
        statusAtCancellation = (JSON.parse(await readFile(runPath, 'utf8')) as { status: string }).status
      }
    })
    const seeded = await seedExpiredResumedAttempt({
      workspace,
      userData,
      cliRunner: cli.run,
      callOperationId
    })
    runPath = seeded.runPath
    const resumed = new BioGymRuntimeService({
      userDataPath: userData,
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: cli.run,
      pollIntervalMs: 1
    })

    await resumed.start()
    await waitForRawSnapshot(resumed, workspace, seeded.runId, (snapshot) => snapshot.status === 'failed')

    expect(cli.operationReads).toBeGreaterThanOrEqual(1)
    expect(cli.callToolSubmissions).toBe(0)
    expect(cli.cancellationCalls).toBe(1)
    expect(statusAtCancellation).toBe('running')
    const journal = JSON.parse(await readFile(runPath, 'utf8')) as {
      stages: Array<{ jobId?: string }>
    }
    expect(journal.stages[0].jobId).toBe('job_recovered_001')
    const events = (await readFile(join(
      workspace,
      '.sciforge',
      'biogym',
      'runs',
      seeded.runId,
      'events.ndjson'
    ), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { type: string })
    expect(events.findIndex((event) => event.type === 'backend_job_recovered_after_deadline')).toBeLessThan(
      events.findIndex((event) => event.type === 'stage_failed')
    )
    await resumed.stop()
  })

  it('recovers a transient operation read without submitting a duplicate CALL_TOOL job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-read-retry-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const cli = fakeCli()
    let opReads = 0
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: async (executable, args, options) => {
        if (remoteCommand(args) === 'op' && opReads++ === 0) {
          throw structuredCliFailure({
            code: 'remote_transport_error',
            outcomeUnknown: true,
            requestId: 'read-op-request'
          })
        }
        return cli.run(executable, args, options)
      },
      pollIntervalMs: 1
    })

    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'transient read retry test'
    })))
    const ready = await waitForSnapshot(
      service,
      workspace,
      started.snapshot.designRunId,
      (snapshot) => snapshot.status === 'awaiting_agent'
    )
    await service.handleEnvelope(envelope(workspace, {
      operation: 'advance',
      designRunId: started.snapshot.designRunId,
      expectedRevision: ready.snapshot.revision,
      stage: { kind: 'backbone', lengthRange: [30, 30], numBackbones: 1 }
    }))
    await waitForSnapshot(
      service,
      workspace,
      started.snapshot.designRunId,
      (snapshot) => snapshot.stages?.[0]?.status === 'succeeded'
    )

    expect(opReads).toBeGreaterThanOrEqual(3)
    expect(cli.callToolSubmissions).toBe(1)
    await service.stop()
  })

  it('preserves a gateway-indeterminate mutation as a terminal indeterminate run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-indeterminate-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const cli = fakeCli()
    let actCalls = 0
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: async (executable, args, options) => {
        if (remoteCommand(args) === 'act') {
          actCalls += 1
          throw structuredCliFailure({
            code: 'indeterminate',
            requestId: 'req-gateway-indeterminate'
          })
        }
        return cli.run(executable, args, options)
      },
      pollIntervalMs: 1
    })

    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'indeterminate mutation test'
    })))
    const runId = started.snapshot.designRunId as string
    const ready = await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')
    await service.handleEnvelope(envelope(workspace, {
      operation: 'advance',
      designRunId: runId,
      expectedRevision: ready.snapshot.revision,
      stage: { kind: 'backbone', lengthRange: [30, 30], numBackbones: 1 }
    }))
    const terminal = await waitForRawSnapshot(service, workspace, runId, (snapshot) =>
      snapshot.status === 'indeterminate'
    )

    expect(terminal.snapshot).toMatchObject({
      status: 'indeterminate',
      stages: [{ status: 'indeterminate' }]
    })
    expect(terminal.errors[0].message).toContain('indeterminate remote operation')
    expect(actCalls).toBe(1)
    expect(cli.callToolSubmissions).toBe(0)
    const journal = JSON.parse(await readFile(
      join(workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json'),
      'utf8'
    )) as { status: string; remote: { state: string }; cleanup: { completed: boolean } }
    expect(journal).toMatchObject({
      status: 'indeterminate',
      remote: { state: 'ready' },
      cleanup: { completed: false }
    })
    await service.stop()
  })

  it('retries transient cleanup with the same idempotency request and eventually completes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-biogym-cleanup-retry-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const cli = fakeCli()
    const cleanupRequestIds: string[] = []
    let cleanupAttempts = 0
    const service = new BioGymRuntimeService({
      userDataPath: join(root, 'user-data'),
      loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
      cliRunner: async (executable, args, options) => {
        if (remoteCommand(args) === 'cleanup') {
          cleanupAttempts += 1
          cleanupRequestIds.push(args[args.indexOf('--request-id') + 1])
          if (cleanupAttempts === 1) {
            throw structuredCliFailure({
              code: 'remote_transport_error',
              outcomeUnknown: true,
              requestId: cleanupRequestIds[0]
            })
          }
        }
        return cli.run(executable, args, options)
      },
      pollIntervalMs: 1
    })

    const started = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'start', workflow: 'de_novo_scaffold', objective: 'cleanup retry test'
    })))
    const runId = started.snapshot.designRunId as string
    const ready = await waitForSnapshot(service, workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')
    await service.handleEnvelope(envelope(workspace, {
      operation: 'cleanup', designRunId: runId, expectedRevision: ready.snapshot.revision
    }))
    const cleaned = await waitForRawSnapshot(service, workspace, runId, (snapshot) =>
      snapshot.status === 'cancelled'
    )

    expect(cleaned.snapshot.status).toBe('cancelled')
    expect(cleanupAttempts).toBe(2)
    expect(new Set(cleanupRequestIds)).toHaveLength(1)
    expect(cli.cleanupCalls).toBe(1)
    const journal = JSON.parse(await readFile(
      join(workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json'),
      'utf8'
    )) as { remote: { state: string }; cleanup: { requested: boolean; completed: boolean } }
    expect(journal).toMatchObject({
      remote: { state: 'cleaned' },
      cleanup: { requested: true, completed: true }
    })
    await service.stop()
  })
})

function envelope(
  workspace: string,
  request: Record<string, unknown>,
  threadId = 'thread-1'
): Record<string, unknown> {
  return {
    version: 1,
    request,
    context: {
      threadId,
      turnId: 'turn-1',
      workspace
    }
  }
}

async function seedExpiredResumedAttempt(input: {
  workspace: string
  userData: string
  cliRunner: (
    executable: string,
    args: readonly string[],
    options: { cwd: string }
  ) => Promise<BioGymCliExecution>
  jobId?: string
  callOperationId?: string
}): Promise<{ runId: string; runPath: string }> {
  const initial = new BioGymRuntimeService({
    userDataPath: input.userData,
    loadSettings: async () => testSettings({ enabled: true, cliPath: process.execPath }),
    cliRunner: input.cliRunner,
    pollIntervalMs: 1
  })
  const started = asResult(await initial.handleEnvelope(envelope(input.workspace, {
    operation: 'start', workflow: 'de_novo_scaffold', objective: 'expired restart recovery test'
  })))
  const runId = started.snapshot.designRunId as string
  await waitForSnapshot(initial, input.workspace, runId, (snapshot) => snapshot.status === 'awaiting_agent')
  await initial.stop()

  const runPath = join(input.workspace, '.sciforge', 'biogym', 'runs', runId, 'run.json')
  const run = JSON.parse(await readFile(runPath, 'utf8')) as Record<string, any>
  run.status = 'running'
  run.startedAtMs = Date.now() - 60_000
  run.budget.maxWallclockHours = 0.0001
  run.revision += 1
  run.updatedAt = new Date().toISOString()
  run.stages = [{
    id: 'backbone-01-resumed',
    kind: 'backbone',
    attempt: 1,
    status: 'running',
    backend: 'rfdiffusion',
    candidateCount: 0,
    assetIds: [],
    candidates: [],
    request: { kind: 'backbone', lengthRange: [30, 30], numBackbones: 1 },
    outputDir: 'intermediate/rfdiffusion/sciforge_backbone-01-resumed',
    capability: 'protein.backbone.generate',
    callRequestId: `${runId.replaceAll('-', '_')}_backbone_01_resumed_call`,
    waitRequestId: `${runId.replaceAll('-', '_')}_backbone_01_resumed_wait`,
    actorTurnId: 'turn-1',
    ...(input.callOperationId ? { callOperationId: input.callOperationId } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    remoteArtifactIds: [],
    continuationDelivered: false,
    startedAt: new Date(Date.now() - 60_000).toISOString()
  }]
  await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`)
  return { runId, runPath }
}

function testSettings(biogym: Partial<BioGymSettingsV1> = {}): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    activeAgentRuntime: 'sciforge',
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot: '',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: false },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    remoteExecutor: defaultRemoteExecutorSettings(),
    biogym: {
      ...defaultBioGymSettings(),
      sshHost: 'test-biogym-host',
      remoteRoot: '/srv/biogym',
      ...biogym
    },
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function asResult(value: unknown): any {
  return value as any
}

async function waitForSnapshot(
  service: BioGymRuntimeService,
  workspace: string,
  designRunId: string,
  predicate: (snapshot: any) => boolean,
  threadId = 'thread-1'
): Promise<any> {
  const deadline = Date.now() + 5_000
  let last: any = null
  while (Date.now() < deadline) {
    const result = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'status', designRunId
    }, threadId)))
    last = result
    if (predicate(result.snapshot)) return result
    if (result.snapshot.status === 'failed' || result.snapshot.status === 'indeterminate') {
      throw new Error(`BioGym run became terminal: ${JSON.stringify(result)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for ${designRunId}: ${JSON.stringify(last)}`)
}

async function waitForRawSnapshot(
  service: BioGymRuntimeService,
  workspace: string,
  designRunId: string,
  predicate: (snapshot: any) => boolean
): Promise<any> {
  const deadline = Date.now() + 5_000
  let last: any = null
  while (Date.now() < deadline) {
    const result = asResult(await service.handleEnvelope(envelope(workspace, {
      operation: 'status', designRunId
    })))
    last = result
    if (predicate(result.snapshot)) return result
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for ${designRunId}: ${JSON.stringify(last)}`)
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for condition.')
}

async function waitForFakeTimerCondition(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return
    await vi.advanceTimersByTimeAsync(0)
    // Filesystem promises are not controlled by fake timers. Yield through a
    // native microtask so their completions can progress without moving time.
    await Promise.resolve()
  }
  throw new Error('Timed out waiting for fake-timer condition.')
}

function remoteCommand(args: readonly string[]): string | undefined {
  const remoteIndex = args.indexOf('remote')
  return remoteIndex < 0 ? undefined : args[remoteIndex + 5]
}

function structuredCliFailure(input: {
  code: string
  outcomeUnknown?: boolean
  requestId?: string
}): BioGymCliError {
  const failure = {
    status: 'error' as const,
    message: `Structured BioGym failure: ${input.code}`,
    code: input.code,
    ...(input.outcomeUnknown === undefined ? {} : { outcomeUnknown: input.outcomeUnknown }),
    ...(input.requestId ? { requestId: input.requestId } : {})
  }
  const execution: BioGymCliExecution = {
    argv: [process.execPath],
    exitCode: 1,
    stdout: JSON.stringify({
      status: 'error',
      message: failure.message,
      code: failure.code,
      outcome_unknown: failure.outcomeUnknown,
      request_id: failure.requestId
    }),
    stderr: '',
    durationMs: 1,
    timedOut: false
  }
  return new BioGymCliError('biogym_cli_failed', failure.message, execution, failure)
}

function continuationSuppressedError(reason: string): Error & {
  code: 'agent_runtime_continuation_suppressed'
  reason: string
  retryable: false
} {
  return Object.assign(new Error(`Continuation suppressed: ${reason}`), {
    code: 'agent_runtime_continuation_suppressed' as const,
    reason,
    retryable: false as const
  })
}

function fakeCli(options: {
  validationStatus?: 'pass' | 'fail'
  waitOperationDelayMs?: number
  preloadedOperations?: Record<string, Record<string, unknown>>
  onCancellation?: () => Promise<void> | void
} = {}): {
  run: (
    executable: string,
    args: readonly string[],
    options: { cwd: string }
  ) => Promise<BioGymCliExecution>
  pdbSha256: string
  callToolSubmissions: number
  finishCalls: number
  cleanupCalls: number
  cancellationCalls: number
  operationReads: number
  lastCallAction: Record<string, unknown> | null
} {
  const pdb = [
    'ATOM      1  N   GLY A   1      11.104  13.207   9.128  1.00 20.00           N',
    'ATOM      2  CA  GLY A   1      12.000  12.200   9.500  1.00 20.00           C',
    'END',
    ''
  ].join('\n')
  const pdbSha256 = createHash('sha256').update(pdb).digest('hex')
  let callToolSubmissions = 0
  let finishCalls = 0
  let cleanupCalls = 0
  let cancellationCalls = 0
  let operationReads = 0
  let lastCallAction: Record<string, unknown> | null = null
  const operations = new Map<string, Record<string, unknown>>(
    Object.entries(options.preloadedOperations ?? {})
  )
  const run = async (
    executable: string,
    args: readonly string[],
    _options: { cwd: string }
  ): Promise<BioGymCliExecution> => {
    const remoteIndex = args.indexOf('remote')
    const command = args[remoteIndex + 5]
    const commandArgs = args.slice(remoteIndex + 6)
    let payload: unknown
    if (command === 'start') {
      payload = { session_id: 'a'.repeat(32), run_id: 'run_000001', ref: `${'a'.repeat(32)}:run_000001` }
    } else if (command === 'act') {
      const fileIndex = commandArgs.indexOf('--file')
      const action = JSON.parse(await readFile(commandArgs[fileIndex + 1], 'utf8')) as Record<string, unknown>
      const opId = action.type === 'CALL_TOOL' ? 'b'.repeat(32) : 'c'.repeat(32)
      if (action.type === 'CALL_TOOL') {
        lastCallAction = action
        callToolSubmissions += 1
        operations.set(opId, {
          status: 'done',
          result: { status: 'accepted', message: 'queued', data: { job_id: 'job_000001' } }
        })
      } else {
        if (action.type === 'CANCEL_JOB') {
          await options.onCancellation?.()
          cancellationCalls += 1
        }
        operations.set(opId, {
          status: 'done',
          result: {
            status: 'accepted',
            message: 'Job succeeded.',
            data: { result: { status: 'succeeded' } }
          }
        })
      }
      payload = { operation_id: opId, request_id: 'request' }
    } else if (command === 'op') {
      operationReads += 1
      if (commandArgs[1] === 'c'.repeat(32) && options.waitOperationDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.waitOperationDelayMs))
      }
      payload = operations.get(commandArgs[1])
    } else if (command === 'artifacts') {
      payload = [{
        artifact_id: 'art_1',
        path: 'intermediate/rfdiffusion/sciforge_backbone/backbones/backbone_001.pdb',
        provenance: {
          job_id: 'job_000001',
          runtime: {
            model_name: 'test-model',
            model_checkpoint_hash: 'sha256:test-checkpoint'
          }
        }
      }]
    } else if (command === 'fetch') {
      const outputIndex = commandArgs.indexOf('--output')
      const output = commandArgs[outputIndex + 1]
      const relativePath = 'intermediate/rfdiffusion/sciforge_backbone/backbones/backbone_001.pdb'
      const destination = join(output, relativePath)
      await mkdir(join(destination, '..'), { recursive: true })
      await writeFile(destination, pdb)
      payload = [{
        artifact_id: 'art_1',
        relative_path: relativePath,
        local_path: destination,
        size: Buffer.byteLength(pdb),
        sha256: pdbSha256,
        fetched_at: new Date().toISOString()
      }]
    } else if (command === 'validate') {
      payload = {
        status: options.validationStatus ?? 'pass',
        results: options.validationStatus === 'fail'
          ? [{ status: 'fail', path: 'results/sciforge_design_decision.json' }]
          : [{ status: 'pass' }]
      }
    } else if (command === 'finish') {
      finishCalls += 1
      payload = { status: 'completed' }
    } else if (command === 'cleanup') {
      cleanupCalls += 1
      payload = { cleaned: true }
    } else if (command === 'doctor') {
      payload = { ok: true }
    } else {
      payload = { ok: true }
    }
    return {
      argv: [executable, ...args],
      exitCode: 0,
      stdout: JSON.stringify(payload),
      stderr: '',
      durationMs: 1,
      timedOut: false
    }
  }
  return {
    run,
    pdbSha256,
    get callToolSubmissions() { return callToolSubmissions },
    get finishCalls() { return finishCalls },
    get cleanupCalls() { return cleanupCalls },
    get cancellationCalls() { return cancellationCalls },
    get operationReads() { return operationReads },
    get lastCallAction() { return lastCallAction }
  }
}

function verificationCli(): {
  run: (
    executable: string,
    args: readonly string[],
    options: { cwd: string }
  ) => Promise<BioGymCliExecution>
  readonly preparedAction: Record<string, any> | null
  readonly lastCallAction: Record<string, any> | null
  readonly callToolSubmissions: number
} {
  const operations = new Map<string, Record<string, unknown>>()
  let preparedAction: Record<string, any> | null = null
  let lastCallAction: Record<string, any> | null = null
  let callToolSubmissions = 0
  const selectedRows = (): Array<{ candidateId: string; sequence: string; score: string }> => {
    const lines = String(preparedAction?.content ?? '').trim().split(/\r?\n/)
    return lines.slice(1).map((line) => {
      const [candidateId = '', sequence = '', score = ''] = line.split(',')
      return { candidateId, sequence, score }
    }).filter((row) => row.candidateId && row.sequence)
  }
  const outputDir = (): string => String(lastCallAction?.args?.output_dir ?? 'intermediate/boltz2/test')
  const artifactRows = (): Array<Record<string, unknown>> => [
    {
      artifact_id: 'art-verified-csv',
      path: `${outputDir()}/verified_candidates.csv`,
      provenance: { job_id: 'job_verify' }
    },
    ...selectedRows().map((row, index) => ({
      artifact_id: `art-structure-${index + 1}`,
      path: `${outputDir()}/structures/${row.candidateId}.cif`,
      provenance: { job_id: 'job_verify' }
    }))
  ]
  const artifactContent = (artifactId: string): { relativePath: string; content: string } => {
    if (artifactId === 'art-verified-csv') {
      const header = 'candidate_id,sequence,structure_path,confidence_score,ptm,iptm,complex_plddt\n'
      const rows = selectedRows().map((row, index) => [
        row.candidateId,
        row.sequence,
        `${outputDir()}/structures/${row.candidateId}.cif`,
        String(0.95 - index * 0.02),
        String(0.90 - index * 0.02),
        '0',
        String(0.96 - index * 0.02)
      ].join(',')).join('\n')
      return { relativePath: `${outputDir()}/verified_candidates.csv`, content: `${header}${rows}\n` }
    }
    const index = Number(artifactId.replace('art-structure-', '')) - 1
    const row = selectedRows()[index]
    if (!row) throw new Error(`Unknown verification artifact ${artifactId}`)
    return {
      relativePath: `${outputDir()}/structures/${row.candidateId}.cif`,
      content: `data_${row.candidateId}\n_atom_site.id\n`
    }
  }
  const run = async (
    executable: string,
    args: readonly string[],
    _options: { cwd: string }
  ): Promise<BioGymCliExecution> => {
    const remoteIndex = args.indexOf('remote')
    const command = args[remoteIndex + 5]
    const commandArgs = args.slice(remoteIndex + 6)
    let payload: unknown
    if (command === 'start') {
      payload = { session_id: 'a'.repeat(32), run_id: 'run_000001', ref: `${'a'.repeat(32)}:run_000001` }
    } else if (command === 'act') {
      const fileIndex = commandArgs.indexOf('--file')
      const action = JSON.parse(await readFile(commandArgs[fileIndex + 1], 'utf8')) as Record<string, any>
      const opId = action.type === 'WRITE_FILE'
        ? 'd'.repeat(32)
        : action.type === 'CALL_TOOL'
          ? 'b'.repeat(32)
          : 'c'.repeat(32)
      if (action.type === 'WRITE_FILE') preparedAction = action
      if (action.type === 'CALL_TOOL') {
        lastCallAction = action
        callToolSubmissions += 1
      }
      operations.set(opId, action.type === 'CALL_TOOL'
        ? { status: 'done', result: { status: 'accepted', data: { job_id: 'job_verify' } } }
        : action.type === 'WAIT_FOR_JOB'
          ? { status: 'done', result: { status: 'accepted', data: { result: { status: 'succeeded' } } } }
          : { status: 'done', result: { status: 'accepted', data: {} } })
      payload = { operation_id: opId, request_id: 'request' }
    } else if (command === 'op') {
      payload = operations.get(commandArgs[1])
    } else if (command === 'artifacts') {
      payload = artifactRows()
    } else if (command === 'fetch') {
      const output = commandArgs[commandArgs.indexOf('--output') + 1]
      const requestedIds = commandArgs.flatMap((value, index) =>
        value === '--artifact' && commandArgs[index + 1] ? [commandArgs[index + 1]] : []
      )
      payload = await Promise.all(requestedIds.map(async (artifactId) => {
        const artifact = artifactContent(artifactId)
        const destination = join(output, artifact.relativePath)
        await mkdir(join(destination, '..'), { recursive: true })
        await writeFile(destination, artifact.content)
        return {
          artifact_id: artifactId,
          relative_path: artifact.relativePath,
          local_path: destination,
          size: Buffer.byteLength(artifact.content),
          sha256: createHash('sha256').update(artifact.content).digest('hex'),
          fetched_at: new Date().toISOString()
        }
      }))
    } else if (command === 'doctor') {
      payload = { ok: true }
    } else {
      payload = { ok: true }
    }
    return {
      argv: [executable, ...args],
      exitCode: 0,
      stdout: JSON.stringify(payload),
      stderr: '',
      durationMs: 1,
      timedOut: false
    }
  }
  return {
    run,
    get preparedAction() { return preparedAction },
    get lastCallAction() { return lastCallAction },
    get callToolSubmissions() { return callToolSubmissions }
  }
}
