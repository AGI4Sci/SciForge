import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { JsonSettingsStore } from '../settings-store'
import { BiologyRoomService } from './biology-room-service'
import { BioGymRuntimeService } from './biogym-runtime-service'

const REAL_BEAM_ENABLED = process.env.SCIFORGE_BIOGYM_REAL_BEAM === '1'
const REAL_TEST_TIMEOUT_MS = 3 * 60 * 60_000
const roots: string[] = []

/**
 * Expensive, explicitly opt-in acceptance coverage. These tests submit real
 * receiver GPU jobs and therefore never run in the normal test suite.
 *
 * SCIFORGE_BIOGYM_REAL_BEAM=1 npx vitest run \
 *   src/main/services/biogym-runtime-service.beam.test.ts
 */
describe.skipIf(!REAL_BEAM_ENABLED)('BioGymRuntimeService real Beam acceptance', () => {
  afterAll(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('runs fixed-backbone ProteinMPNN → Boltz-2', async () => {
    const harness = await createHarness('fixed')
    try {
      let state = await startRun(harness, {
        workflow: 'fixed_backbone',
        objective: 'Real Beam fixed-backbone acceptance smoke.',
        input: { backbonePath: harness.inputs.backbone },
        budget: { maxGpuJobs: 2, maxWallclockHours: 2, maxCandidatesPerStage: 1 }
      })
      state = await advanceAndWait(harness, state, {
        kind: 'sequence',
        backboneAssetId: 'input-backbone',
        chainsToDesign: ['A'],
        numSequences: 1,
        samplingTemperature: 0.1,
        seed: 42
      })
      const candidateSetId = requiredCandidateSet(state)
      state = await advanceAndWait(harness, state, { kind: 'verify', candidateSetId, topN: 1 })
      await finalizeAndWait(harness, state)
    } finally {
      await harness.service.stop()
    }
  }, REAL_TEST_TIMEOUT_MS)

  it('runs de novo RFdiffusion → ProteinMPNN → Boltz-2', async () => {
    const harness = await createHarness('denovo')
    try {
      let state = await startRun(harness, {
        workflow: 'de_novo_scaffold',
        objective: 'Real Beam de novo scaffold acceptance smoke.',
        budget: { maxGpuJobs: 3, maxWallclockHours: 2, maxCandidatesPerStage: 1 }
      })
      state = await advanceAndWait(harness, state, {
        kind: 'backbone', lengthRange: [30, 30], numBackbones: 1
      })
      const backboneAssetId = requiredTopCandidate(state)
      state = await advanceAndWait(harness, state, {
        kind: 'sequence',
        backboneAssetId,
        chainsToDesign: ['A'],
        numSequences: 1,
        samplingTemperature: 0.1,
        seed: 42
      })
      state = await advanceAndWait(harness, state, {
        kind: 'verify', candidateSetId: requiredCandidateSet(state), topN: 1
      })
      await finalizeAndWait(harness, state)
    } finally {
      await harness.service.stop()
    }
  }, REAL_TEST_TIMEOUT_MS)

  it('runs one minimal BindCraft target-binder attempt', async () => {
    const harness = await createHarness('binder')
    try {
      let state = await startRun(harness, {
        workflow: 'target_binder',
        objective: 'Real Beam BindCraft acceptance smoke.',
        input: {
          targetStructurePath: harness.inputs.target,
          targetChain: 'A',
          hotspotResidues: ['56']
        },
        budget: { maxGpuJobs: 1, maxWallclockHours: 2, maxCandidatesPerStage: 1 }
      })
      state = await advanceAndWait(harness, state, {
        kind: 'binder',
        lengthRange: [30, 30],
        numTrajectories: 1,
        numSequences: 1,
        finalDesigns: 1
      })
      await finalizeAndWait(harness, state)
    } finally {
      await harness.service.stop()
    }
  }, REAL_TEST_TIMEOUT_MS)
})

type Harness = Awaited<ReturnType<typeof createHarness>>
type ToolState = {
  snapshot: {
    designRunId: string
    roomId: string
    revision: number
    status: string
    stages: Array<{
      id: string
      status: string
      candidates: Array<{ id: string; assetId?: string }>
    }>
  }
  candidateSets: Array<{ id: string }>
  errors: Array<{ message: string }>
}

async function createHarness(label: string): Promise<{
  service: BioGymRuntimeService
  workspace: string
  userData: string
  inputs: { backbone: string; target: string }
}> {
  const root = await mkdtemp(join(tmpdir(), `sciforge-biogym-beam-${label}-`))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const userData = join(root, 'user-data')
  const inputDirectory = join(workspace, 'inputs')
  await mkdir(inputDirectory, { recursive: true })
  const sourceRoot = join(process.cwd(), '..', 'biogym', 'examples', 'inputs')
  const backbone = join(inputDirectory, 'toy_backbone.pdb')
  const target = join(inputDirectory, 'toy_bindcraft_target.pdb')
  await copyFile(join(sourceRoot, basename(backbone)), backbone)
  await copyFile(join(sourceRoot, basename(target)), target)

  const store = new JsonSettingsStore(userData)
  await store.patch({
    biogym: {
      enabled: true,
      cliPath: join(process.cwd(), '..', 'biogym', '.venv', 'bin', 'biogym'),
      sshHost: 'beam-root',
      remoteRoot: '/mnt/shared-storage-user/beam/chengkaiyao/bio_world'
    }
  })
  const service = new BioGymRuntimeService({
    userDataPath: userData,
    loadSettings: () => store.load(),
    biologyRoomService: new BiologyRoomService(),
    pollIntervalMs: 2_000,
    waitTimeoutMs: 2 * 60 * 60_000
  })
  return {
    service,
    workspace,
    userData,
    inputs: {
      backbone: 'inputs/toy_backbone.pdb',
      target: 'inputs/toy_bindcraft_target.pdb'
    }
  }
}

async function startRun(harness: Harness, request: Record<string, unknown>): Promise<ToolState> {
  const started = await invoke(harness, { operation: 'start', ...request })
  return waitFor(harness, started.snapshot.designRunId, (state) => state.snapshot.status === 'awaiting_agent')
}

async function advanceAndWait(
  harness: Harness,
  state: ToolState,
  stage: Record<string, unknown>
): Promise<ToolState> {
  const queued = await invoke(harness, {
    operation: 'advance',
    designRunId: state.snapshot.designRunId,
    expectedRevision: state.snapshot.revision,
    stage
  })
  const attemptId = queued.snapshot.stages.at(-1)?.id
  if (!attemptId) throw new Error('BioGym did not return a queued stage attempt.')
  return waitFor(harness, state.snapshot.designRunId, (current) => {
    const attempt = current.snapshot.stages.find((candidate) => candidate.id === attemptId)
    return attempt?.status === 'succeeded'
  })
}

async function finalizeAndWait(harness: Harness, state: ToolState): Promise<void> {
  const lastCandidates = state.snapshot.stages.at(-1)?.candidates ?? []
  const selectedCandidateIds = lastCandidates.slice(0, 1).map((candidate) => candidate.id)
  await invoke(harness, {
    operation: 'finalize',
    designRunId: state.snapshot.designRunId,
    expectedRevision: state.snapshot.revision,
    disposition: selectedCandidateIds.length ? 'selected' : 'no_viable_candidate',
    ...(selectedCandidateIds.length ? { selectedCandidateIds } : {}),
    summary: selectedCandidateIds.length
      ? 'Selected the only real Beam smoke candidate for interface verification.'
      : 'The smoke produced no accepted candidate.',
    caveats: ['Computational acceptance smoke only; no wet-lab validation.']
  })
  const completed = await waitFor(
    harness,
    state.snapshot.designRunId,
    (current) => current.snapshot.status === 'completed'
  )
  expect(completed.snapshot.status).toBe('completed')
  const runPath = join(
    harness.workspace,
    '.sciforge',
    'biogym',
    'runs',
    state.snapshot.designRunId,
    'run.json'
  )
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const run = JSON.parse(await readFile(runPath, 'utf8')) as { cleanup?: { completed?: boolean } }
    if (run.cleanup?.completed) return
    await delay(2_000)
  }
  throw new Error('BioGym remote isolated-session cleanup did not complete.')
}

async function waitFor(
  harness: Harness,
  designRunId: string,
  predicate: (state: ToolState) => boolean
): Promise<ToolState> {
  const deadline = Date.now() + 2 * 60 * 60_000
  let latest: ToolState | null = null
  while (Date.now() < deadline) {
    latest = await invoke(harness, { operation: 'status', designRunId })
    if (predicate(latest)) return latest
    if (latest.snapshot.status === 'failed' || latest.snapshot.status === 'indeterminate') {
      throw new Error(`BioGym real Beam run failed: ${JSON.stringify(latest.errors)}`)
    }
    await delay(2_000)
  }
  throw new Error(`Timed out waiting for real Beam run ${designRunId}.`)
}

async function invoke(harness: Harness, request: Record<string, unknown>): Promise<ToolState> {
  return await harness.service.handleEnvelope({
    version: 1,
    request,
    context: {
      threadId: 'real-beam-acceptance',
      turnId: `turn-${Date.now()}`,
      workspace: harness.workspace
    }
  }) as ToolState
}

function requiredCandidateSet(state: ToolState): string {
  const id = state.candidateSets.at(-1)?.id
  if (!id) throw new Error('ProteinMPNN stage did not publish a candidate set.')
  return id
}

function requiredTopCandidate(state: ToolState): string {
  const candidate = state.snapshot.stages.at(-1)?.candidates[0]
  const id = candidate?.assetId ?? candidate?.id
  if (!id) throw new Error('Backbone stage did not publish a candidate.')
  return id
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
