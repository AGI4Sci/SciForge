/**
 * Capability-layer parity with the in-tree static module. Every capability is
 * exercised through both surfaces with the same scripted runtime underneath:
 * the static side goes through `createResearchCheckpointsCapabilityFactory`
 * handlers (caller workspace via invocation context), the plugin side through
 * `core/operations` (caller workspace as an explicit argument — G1). Both must
 * produce byte-identical `{ output }` results — successes, domain errors and
 * input-validation failures alike — and must forward identical arguments to
 * the runtime. The static module is imported by relative path, which is
 * allowed in tests only.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createResearchCheckpointsCapabilityFactory,
  type ResearchCheckpointsCapabilityOptions
} from '../../../packages/domains/research-checkpoints/src/main.js'
import { RESEARCH_CHECKPOINT_CAPABILITY_IDS } from '../src/contract.js'
import {
  importLegacy,
  listCheckpoints,
  previewLegacy,
  readCheckpoint,
  readStatus,
  readTurnStatus,
  resolveConflict,
  restoreAsNew,
  startRecording,
  stopRecording,
  type ResearchCheckpointOperationResult,
  type ResearchCheckpointOperationRuntime
} from '../src/core/operations.js'
import { EXPECTED_HOST_GRANTS } from '../src/dsh-adapter/tools.js'

const WORKSPACE = '/workspace/parity'

type CallRecord = Readonly<{ method: string; args: readonly unknown[] }>

/** A runtime double that records every call and either returns a sentinel or throws. */
function scriptedRuntime(
  sink: CallRecord[],
  mode: 'value' | 'throw'
): ResearchCheckpointOperationRuntime {
  const entry = (method: string, args: readonly unknown[]): unknown => {
    sink.push({ method, args })
    if (mode === 'throw') throw new Error(`scripted ${method} failure`)
    return { sentinel: `scripted-${method}` }
  }
  return {
    start: async (workspace: string, input: never) => entry('start', [workspace, input]) as never,
    stop: async (workspace: string, input: never) => entry('stop', [workspace, input]) as never,
    checkpointStatus: async (workspace: string, runtimeId: string, threadId: string) =>
      entry('checkpointStatus', [workspace, runtimeId, threadId]) as never,
    read: async (workspace: string, input: never) => entry('read', [workspace, input]) as never,
    list: async (workspace: string, input: never) => entry('list', [workspace, input]) as never,
    turnStatus: async (workspace: string, runtimeId: string, threadId: string, turnId: string) =>
      entry('turnStatus', [workspace, runtimeId, threadId, turnId]) as never,
    resolve: async (workspace: string, input: never) => entry('resolve', [workspace, input]) as never,
    restoreAsNew: async (workspace: string, input: never) =>
      entry('restoreAsNew', [workspace, input]) as never,
    previewLegacy: async (workspace: string, input: never) =>
      entry('previewLegacy', [workspace, input]) as never,
    importLegacy: async (workspace: string, input: never) =>
      entry('importLegacy', [workspace, input]) as never
  }
}

type StaticDefinition = ResearchCheckpointsCapabilityOptions

function staticDefinitions(
  runtime: ResearchCheckpointOperationRuntime
): ReadonlyMap<string, StaticDefinition> {
  const factory = createResearchCheckpointsCapabilityFactory<StaticDefinition>({
    defineCapability: (value) => value,
    getRuntime: () => runtime
  })
  return new Map(factory.createDefinitions().map((definition) => [definition.id, definition]))
}

type Operation = (
  runtime: ResearchCheckpointOperationRuntime,
  rawInput: unknown,
  workspaceRoot: string
) => Promise<ResearchCheckpointOperationResult>

const OPERATION_HEX = 'a'.repeat(64)

const CASES: ReadonlyArray<Readonly<{
  capabilityId: string
  operation: Operation
  input: unknown
}>> = [
  {
    capabilityId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.start,
    operation: startRecording,
    input: {
      runtimeId: 'codex',
      threadId: 'thread-1',
      expectedPolicyRevision: 0,
      idempotencyKey: 'parity-start-1'
    }
  },
  {
    capabilityId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.stop,
    operation: stopRecording,
    input: {
      runtimeId: 'codex',
      threadId: 'thread-1',
      expectedPolicyRevision: 1,
      idempotencyKey: 'parity-stop-1',
      recordingId: 'research-recording:parity-1'
    }
  },
  {
    capabilityId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.status,
    operation: readStatus,
    input: { runtimeId: 'codex', threadId: 'thread-1' }
  },
  {
    capabilityId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.read,
    operation: readCheckpoint,
    input: { recordingId: 'research-recording:parity-1' }
  },
  {
    capabilityId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.list,
    operation: listCheckpoints,
    input: { runtimeId: 'codex', threadId: 'thread-1', limit: 10 }
  },
  {
    capabilityId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.turnStatus,
    operation: readTurnStatus,
    input: { runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1' }
  },
  {
    capabilityId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.resolve,
    operation: resolveConflict,
    input: {
      runtimeId: 'codex',
      threadId: 'thread-1',
      recordingId: 'research-recording:parity-1',
      operationId: `research-checkpoint-operation:${OPERATION_HEX}`,
      resolution: 'rebase',
      idempotencyKey: 'parity-resolve-1'
    }
  },
  {
    capabilityId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.restoreAsNew,
    operation: restoreAsNew,
    input: {
      recordingId: 'research-recording:parity-1',
      artifactId: 'artifact:parity-1',
      sourceVersionId: 'artifact-version:parity-1',
      expectedCurrentVersionId: 'artifact-version:parity-0',
      idempotencyKey: 'parity-restore-1'
    }
  },
  {
    capabilityId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.previewLegacy,
    operation: previewLegacy,
    input: { runtimeId: 'codex', threadId: 'thread-1', selectedTurnIds: ['turn-1'] }
  },
  {
    capabilityId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.importLegacy,
    operation: importLegacy,
    input: {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'parity-import-1',
      title: 'Parity import',
      expectedTranscriptDigest: OPERATION_HEX,
      selectedTurnIds: ['turn-1']
    }
  }
]

async function runBoth(
  testCase: (typeof CASES)[number],
  mode: 'value' | 'throw',
  workspace: string | undefined
): Promise<Readonly<{ staticOutput: unknown; pluginOutput: unknown; staticCalls: readonly CallRecord[]; pluginCalls: readonly CallRecord[] }>> {
  const staticCalls: CallRecord[] = []
  const pluginCalls: CallRecord[] = []
  const definitions = staticDefinitions(scriptedRuntime(staticCalls, mode))
  const definition = definitions.get(testCase.capabilityId)
  assert.ok(definition, `static definition missing for ${testCase.capabilityId}`)
  const staticResult = await definition.handler(
    testCase.input,
    { caller: workspace === undefined ? {} : { workspaceId: workspace } }
  )
  const pluginResult = await testCase.operation(
    scriptedRuntime(pluginCalls, mode),
    testCase.input,
    workspace ?? ''
  )
  return {
    staticOutput: staticResult.output,
    pluginOutput: pluginResult.output,
    staticCalls,
    pluginCalls
  }
}

test('every capability forwards identical runtime arguments and outputs through both surfaces', async () => {
  assert.equal(CASES.length, 10)
  for (const testCase of CASES) {
    const { staticOutput, pluginOutput, staticCalls, pluginCalls } = await runBoth(
      testCase,
      'value',
      WORKSPACE
    )
    assert.deepEqual(pluginOutput, staticOutput, `${testCase.capabilityId} output diverged`)
    assert.deepEqual(pluginCalls, staticCalls, `${testCase.capabilityId} runtime calls diverged`)
    assert.equal(pluginCalls.length, 1, `${testCase.capabilityId} must call the runtime exactly once`)
    assert.equal(pluginCalls[0]?.args[0], WORKSPACE)
    assert.deepEqual(
      (pluginOutput as { ok: boolean }).ok,
      true,
      `${testCase.capabilityId} happy path must succeed: ${JSON.stringify(pluginOutput)}`
    )
  }
})

test('domain errors are wrapped into identical { ok: false, issue } results on both surfaces', async () => {
  for (const testCase of CASES) {
    const { staticOutput, pluginOutput, staticCalls, pluginCalls } = await runBoth(
      testCase,
      'throw',
      WORKSPACE
    )
    assert.deepEqual(pluginOutput, staticOutput, `${testCase.capabilityId} error output diverged`)
    assert.deepEqual(pluginCalls, staticCalls)
    assert.equal((pluginOutput as { ok: boolean }).ok, false)
  }
})

test('invalid inputs fail identically before any runtime call on both surfaces', async () => {
  for (const testCase of CASES) {
    const invalidCase = { ...testCase, input: { runtimeId: 123 } }
    const { staticOutput, pluginOutput, staticCalls, pluginCalls } = await runBoth(
      invalidCase,
      'value',
      WORKSPACE
    )
    assert.deepEqual(pluginOutput, staticOutput, `${testCase.capabilityId} invalid-input output diverged`)
    assert.equal((pluginOutput as { ok: boolean }).ok, false)
    assert.deepEqual(pluginCalls, [])
    assert.deepEqual(staticCalls, [])
  }
})

test('missing caller workspace scope fails identically on both surfaces', async () => {
  for (const testCase of CASES) {
    const { staticOutput, pluginOutput } = await runBoth(testCase, 'value', undefined)
    assert.deepEqual(pluginOutput, staticOutput, `${testCase.capabilityId} scope error diverged`)
    const issue = (pluginOutput as { ok: boolean; issue: { message: string } }).issue
    assert.equal(
      issue.message,
      'Research Checkpoints capability requires caller workspace scope.'
    )
  }
})

test('grant table effects match the static capability governance metadata', () => {
  const definitions = staticDefinitions(scriptedRuntime([], 'value'))
  const expectedByCapability = new Map<string, string>(
    Object.values(EXPECTED_HOST_GRANTS).map((grant) => [grant.id, grant.effect])
  )
  assert.equal(definitions.size, expectedByCapability.size)
  for (const [id, definition] of definitions) {
    assert.equal(
      expectedByCapability.get(id),
      definition.effect,
      `${id} effect must match the host grant`
    )
    assert.equal(definition.scope, 'workspace')
    assert.equal(definition.concurrency.revision, 'none')
    assert.equal(
      definition.concurrency.idempotency,
      definition.effect === 'read' ? 'none' : 'required'
    )
  }
})

test('static governance snapshot: administrative mutations stay UI-only with confirmation', () => {
  const definitions = staticDefinitions(scriptedRuntime([], 'value'))
  const snapshot = Object.fromEntries(
    [...definitions.values()].map((definition) => [
      definition.id,
      {
        audiences: definition.audiences,
        approval: definition.approval,
        effect: definition.effect
      }
    ])
  )
  assert.deepEqual(snapshot, {
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.start]: {
      audiences: ['ui'], approval: 'none', effect: 'workspace-write'
    },
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.stop]: {
      audiences: ['ui'], approval: 'none', effect: 'workspace-write'
    },
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.status]: {
      audiences: ['ui', 'agent', 'system'], approval: 'none', effect: 'read'
    },
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.read]: {
      audiences: ['ui', 'agent', 'system'], approval: 'none', effect: 'read'
    },
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.list]: {
      audiences: ['ui', 'agent', 'system'], approval: 'none', effect: 'read'
    },
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.turnStatus]: {
      audiences: ['ui', 'agent', 'system'], approval: 'none', effect: 'read'
    },
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.resolve]: {
      audiences: ['ui'], approval: 'confirmation', effect: 'workspace-write'
    },
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.restoreAsNew]: {
      audiences: ['ui'], approval: 'confirmation', effect: 'workspace-write'
    },
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.previewLegacy]: {
      audiences: ['ui'], approval: 'none', effect: 'read'
    },
    [RESEARCH_CHECKPOINT_CAPABILITY_IDS.importLegacy]: {
      audiences: ['ui'], approval: 'confirmation', effect: 'workspace-write'
    }
  })
})
