/**
 * Baseline scenario runner: drives the plugin runtime through its capability
 * operations with the shared harness, a fixed store clock and a fixed
 * recording-id sequence, so every recorded step and the durable store document
 * are fully deterministic. Used by generate-baseline.ts (writes golden.json)
 * and baseline.test.ts (replays and compares). While the static module exists,
 * the ported runtime.test.ts and capability-parity.test.ts are the primary
 * guards; the golden file keeps the baseline after the static module is
 * removed.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspaceBindingDigest } from '../src/core/crypto.js'
import {
  importLegacy,
  listCheckpoints,
  previewLegacy,
  readCheckpoint,
  readStatus,
  readTurnStatus,
  startRecording,
  stopRecording
} from '../src/core/operations.js'
import { ResearchCheckpointRuntime } from '../src/core/runtime.js'
import { ResearchCheckpointStore } from '../src/core/store.js'
import {
  ArtifactHarness,
  completedThreadTurn,
  context,
  turnEvent,
  waitForAsync,
  type RuntimeTestContext
} from './harness.js'

const FIXED_NOW = new Date('2099-08-11T08:00:00.000Z')
// Fixed logical workspace root: checkpoint digests bind to it, so the golden
// file must not inherit mkdtemp's random userDataDir path.
const WORKSPACE_ROOT = '/workspace/baseline'

export type BaselineStep = Readonly<{ step: string; output: unknown }>
export type BaselineScenario = Readonly<{
  steps: readonly BaselineStep[]
  store: unknown
}>
export type BaselineGolden = Readonly<{ scenarios: Record<string, BaselineScenario> }>

type Fixture = Readonly<{
  runtime: ResearchCheckpointRuntime
  lifecycle: RuntimeTestContext
  userDataDir: string
  workspaceRoot: string
  deactivate: () => void | Promise<void>
}>

async function activateFixture(
  prefix: string,
  turns: Parameters<typeof context>[3] = []
): Promise<Fixture> {
  const userDataDir = await mkdtemp(join(tmpdir(), prefix))
  const workspaceRoot = WORKSPACE_ROOT
  let recordingSequence = 0
  const store = new ResearchCheckpointStore({
    userDataDir,
    now: () => FIXED_NOW,
    createRecordingId: () => `research-recording:baseline-${++recordingSequence}`
  })
  const runtime = new ResearchCheckpointRuntime({ userDataDir, store })
  const lifecycle = context(userDataDir, workspaceRoot, new ArtifactHarness(), turns)
  const deactivate = await runtime.activate(lifecycle)
  return { runtime, lifecycle, userDataDir, workspaceRoot, deactivate }
}

async function storeDocument(userDataDir: string, workspaceRoot: string): Promise<unknown> {
  const directory = join(
    userDataDir,
    'research-checkpoints',
    'workspaces'
  )
  const file = join(directory, `${workspaceBindingDigest(workspaceRoot)}.json`)
  return JSON.parse(await readFile(file, 'utf8'))
}

async function currentPolicyRevision(
  runtime: ResearchCheckpointRuntime,
  workspaceRoot: string
): Promise<number> {
  const result = await readStatus(runtime, { runtimeId: 'codex', threadId: 'thread-1' }, workspaceRoot)
  const status = (result.output as { ok: true; value: { policyRevision: number } }).value
  return status.policyRevision
}

/** before-turn → automatic commit → read/list/turn-status → stop. */
async function automaticRecordingScenario(): Promise<BaselineScenario> {
  const fixture = await activateFixture('rc-baseline-auto-')
  const steps: BaselineStep[] = []
  const record = (step: string, result: Readonly<{ output: unknown }>): void => {
    steps.push({ step, output: result.output })
  }
  try {
    const { runtime, lifecycle, workspaceRoot } = fixture
    await lifecycle.publishRequiredBeforeTurn({
      kind: 'before-turn',
      state: 'starting',
      boundaryLeaseId: 'directive-turn-baseline-1',
      deliveryAttemptId: 'directive-turn-baseline-1',
      clientDirectiveId: 'directive-turn-baseline-1',
      runtimeId: 'codex',
      threadId: 'thread-1',
      workspaceRoot,
      occurredAt: '2099-08-11T08:00:01.000Z'
    })
    record('status-after-automatic-start', await readStatus(
      runtime, { runtimeId: 'codex', threadId: 'thread-1' }, workspaceRoot
    ))

    const event = turnEvent(workspaceRoot, 'turn-baseline-1', 1, true)
    await runtime.consume(event)
    await waitForAsync(async () => {
      const status = await readTurnStatus(
        runtime,
        { runtimeId: 'codex', threadId: 'thread-1', turnId: event.turnId },
        workspaceRoot
      )
      const value = (status.output as { ok: true; value: { state: string } }).value
      return value.state === 'committed'
    })
    record('turn-status-committed', await readTurnStatus(
      runtime,
      { runtimeId: 'codex', threadId: 'thread-1', turnId: event.turnId },
      workspaceRoot
    ))
    record('status-after-commit', await readStatus(
      runtime, { runtimeId: 'codex', threadId: 'thread-1' }, workspaceRoot
    ))
    record('list', await listCheckpoints(
      runtime, { runtimeId: 'codex', threadId: 'thread-1' }, workspaceRoot
    ))
    record('read', await readCheckpoint(
      runtime, { recordingId: 'research-recording:baseline-1' }, workspaceRoot
    ))
    record('stop', await stopRecording(
      runtime,
      {
        runtimeId: 'codex',
        threadId: 'thread-1',
        expectedPolicyRevision: await currentPolicyRevision(runtime, workspaceRoot),
        idempotencyKey: 'baseline-stop-1',
        recordingId: 'research-recording:baseline-1'
      },
      workspaceRoot
    ))
    record('status-after-stop', await readStatus(
      runtime, { runtimeId: 'codex', threadId: 'thread-1' }, workspaceRoot
    ))
    await fixture.deactivate()
    return { steps, store: await storeDocument(fixture.userDataDir, workspaceRoot) }
  } finally {
    await rm(fixture.userDataDir, { recursive: true, force: true })
  }
}

/** Explicit start/stop policy receipts without any turn traffic. */
async function explicitStartStopScenario(): Promise<BaselineScenario> {
  const fixture = await activateFixture('rc-baseline-explicit-')
  const steps: BaselineStep[] = []
  const record = (step: string, result: Readonly<{ output: unknown }>): void => {
    steps.push({ step, output: result.output })
  }
  try {
    const { runtime, workspaceRoot } = fixture
    record('start', await startRecording(
      runtime,
      {
        runtimeId: 'codex',
        threadId: 'thread-1',
        expectedPolicyRevision: 0,
        idempotencyKey: 'baseline-start-1',
        title: 'Baseline recording'
      },
      workspaceRoot
    ))
    record('status-after-start', await readStatus(
      runtime, { runtimeId: 'codex', threadId: 'thread-1' }, workspaceRoot
    ))
    record('stop', await stopRecording(
      runtime,
      {
        runtimeId: 'codex',
        threadId: 'thread-1',
        expectedPolicyRevision: await currentPolicyRevision(runtime, workspaceRoot),
        idempotencyKey: 'baseline-stop-1'
      },
      workspaceRoot
    ))
    record('status-after-stop', await readStatus(
      runtime, { runtimeId: 'codex', threadId: 'thread-1' }, workspaceRoot
    ))
    record('list-empty', await listCheckpoints(
      runtime, { runtimeId: 'codex', threadId: 'thread-1' }, workspaceRoot
    ))
    await fixture.deactivate()
    return { steps, store: await storeDocument(fixture.userDataDir, workspaceRoot) }
  } finally {
    await rm(fixture.userDataDir, { recursive: true, force: true })
  }
}

/** Legacy preview binds the transcript digest; import commits one incomplete checkpoint. */
async function legacyImportScenario(): Promise<BaselineScenario> {
  const turns = [
    {
      id: 'turn-legacy-a',
      status: 'completed',
      completedAt: '2026-08-01T10:00:00.000Z',
      messages: [],
      artifacts: [
        { kind: 'user_message', text: 'legacy request a' },
        { kind: 'assistant_message', text: 'legacy result a' }
      ]
    },
    {
      id: 'turn-legacy-b',
      status: 'completed',
      completedAt: '2026-08-01T11:00:00.000Z',
      messages: [],
      artifacts: [
        { kind: 'user_message', text: 'legacy request b' },
        { kind: 'assistant_message', text: 'legacy result b' }
      ]
    }
  ]
  const fixture = await activateFixture('rc-baseline-legacy-', turns)
  const steps: BaselineStep[] = []
  const record = (step: string, result: Readonly<{ output: unknown }>): void => {
    steps.push({ step, output: result.output })
  }
  try {
    const { runtime, workspaceRoot } = fixture
    const preview = await previewLegacy(
      runtime,
      { runtimeId: 'codex', threadId: 'thread-1', selectedTurnIds: ['turn-legacy-a'] },
      workspaceRoot
    )
    record('legacy-preview', preview)
    const digest = (preview.output as {
      ok: true
      value: { selectedTranscriptDigest: string | null }
    }).value.selectedTranscriptDigest
    record('legacy-import', await importLegacy(
      runtime,
      {
        runtimeId: 'codex',
        threadId: 'thread-1',
        idempotencyKey: 'baseline-import-1',
        title: 'Baseline legacy import',
        expectedTranscriptDigest: digest ?? '',
        selectedTurnIds: ['turn-legacy-a']
      },
      workspaceRoot
    ))
    record('list', await listCheckpoints(
      runtime, { runtimeId: 'codex', threadId: 'thread-1' }, workspaceRoot
    ))
    await fixture.deactivate()
    return { steps, store: await storeDocument(fixture.userDataDir, workspaceRoot) }
  } finally {
    await rm(fixture.userDataDir, { recursive: true, force: true })
  }
}

export async function runBaselineScenarios(): Promise<BaselineGolden> {
  return {
    scenarios: {
      'automatic-recording': await automaticRecordingScenario(),
      'explicit-start-stop': await explicitStartStopScenario(),
      'legacy-import': await legacyImportScenario()
    }
  }
}
