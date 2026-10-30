/**
 * Capability orchestration equivalent to the static capability handlers in
 * `packages/domains/research-checkpoints/src/main.ts`. Each operation mirrors
 * its static handler body: strict input parse inside the wrapped closure, the
 * caller workspace arriving as an explicit argument (the host does not
 * forward caller identity into tool arguments yet — plugins/GAPS.md, G1), and
 * every error wrapped into the `{ ok: false, issue }` result contract via
 * `checkpointErrorResult` rather than thrown.
 */
import {
  researchCheckpointLegacyImportInputV1Schema,
  researchCheckpointLegacyPreviewInputV1Schema,
  researchCheckpointListInputV1Schema,
  researchCheckpointReadInputV1Schema,
  researchCheckpointResolveInputV1Schema,
  researchCheckpointRestoreAsNewInputV1Schema,
  researchCheckpointStartInputV1Schema,
  researchCheckpointStatusInputV1Schema,
  researchCheckpointStopInputV1Schema,
  researchCheckpointTurnStatusInputV1Schema
} from '../contract.js'
import {
  checkpointErrorResult,
  type ResearchCheckpointRuntime
} from './runtime.js'

export type ResearchCheckpointOperationRuntime = Pick<ResearchCheckpointRuntime,
  'start' | 'stop' | 'checkpointStatus' | 'read' | 'list' | 'turnStatus' | 'resolve' | 'restoreAsNew' |
  'previewLegacy' | 'importLegacy'>

export type ResearchCheckpointOperationResult = Readonly<{ output: unknown }>

function workspace(workspaceRoot: string): string {
  const value = workspaceRoot.trim()
  if (!value) throw new Error('Research Checkpoints capability requires caller workspace scope.')
  return value
}

async function readResult<T>(operation: () => Promise<T>): Promise<ResearchCheckpointOperationResult> {
  try {
    return { output: { ok: true, value: await operation() } }
  } catch (error) {
    return { output: { ok: false, issue: checkpointErrorResult(error) } }
  }
}

async function mutationResult<T>(
  operation: () => Promise<T>
): Promise<ResearchCheckpointOperationResult> {
  try {
    // These capabilities mutate the domain-owned registry through its durable
    // journal. They do not mutate a Broker resource/revision and therefore
    // must not claim `changed`, which would require a resource handle.
    return { output: { ok: true, value: await operation() } }
  } catch (error) {
    return { output: { ok: false, issue: checkpointErrorResult(error) } }
  }
}

export async function startRecording(
  runtime: ResearchCheckpointOperationRuntime,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ResearchCheckpointOperationResult> {
  return mutationResult(async () => {
    const input = researchCheckpointStartInputV1Schema.parse(rawInput)
    return runtime.start(workspace(workspaceRoot), input)
  })
}

export async function stopRecording(
  runtime: ResearchCheckpointOperationRuntime,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ResearchCheckpointOperationResult> {
  return mutationResult(async () => {
    const input = researchCheckpointStopInputV1Schema.parse(rawInput)
    return runtime.stop(workspace(workspaceRoot), input)
  })
}

export async function readStatus(
  runtime: ResearchCheckpointOperationRuntime,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ResearchCheckpointOperationResult> {
  return readResult(async () => {
    const input = researchCheckpointStatusInputV1Schema.parse(rawInput)
    return runtime.checkpointStatus(workspace(workspaceRoot), input.runtimeId, input.threadId)
  })
}

export async function readTurnStatus(
  runtime: ResearchCheckpointOperationRuntime,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ResearchCheckpointOperationResult> {
  return readResult(async () => {
    const input = researchCheckpointTurnStatusInputV1Schema.parse(rawInput)
    return runtime.turnStatus(workspace(workspaceRoot), input.runtimeId, input.threadId, input.turnId)
  })
}

export async function readCheckpoint(
  runtime: ResearchCheckpointOperationRuntime,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ResearchCheckpointOperationResult> {
  return readResult(async () => {
    const input = researchCheckpointReadInputV1Schema.parse(rawInput)
    return runtime.read(workspace(workspaceRoot), input)
  })
}

export async function listCheckpoints(
  runtime: ResearchCheckpointOperationRuntime,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ResearchCheckpointOperationResult> {
  return readResult(async () => {
    const input = researchCheckpointListInputV1Schema.parse(rawInput)
    return runtime.list(workspace(workspaceRoot), input)
  })
}

export async function resolveConflict(
  runtime: ResearchCheckpointOperationRuntime,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ResearchCheckpointOperationResult> {
  return mutationResult(async () => {
    const input = researchCheckpointResolveInputV1Schema.parse(rawInput)
    return runtime.resolve(workspace(workspaceRoot), input)
  })
}

export async function restoreAsNew(
  runtime: ResearchCheckpointOperationRuntime,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ResearchCheckpointOperationResult> {
  return mutationResult(async () => {
    const input = researchCheckpointRestoreAsNewInputV1Schema.parse(rawInput)
    return runtime.restoreAsNew(workspace(workspaceRoot), input)
  })
}

export async function previewLegacy(
  runtime: ResearchCheckpointOperationRuntime,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ResearchCheckpointOperationResult> {
  return readResult(async () => {
    const input = researchCheckpointLegacyPreviewInputV1Schema.parse(rawInput)
    return runtime.previewLegacy(workspace(workspaceRoot), input)
  })
}

export async function importLegacy(
  runtime: ResearchCheckpointOperationRuntime,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ResearchCheckpointOperationResult> {
  return mutationResult(async () => {
    const input = researchCheckpointLegacyImportInputV1Schema.parse(rawInput)
    return runtime.importLegacy(workspace(workspaceRoot), input)
  })
}
