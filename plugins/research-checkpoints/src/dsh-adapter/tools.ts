/**
 * The ten Research Checkpoints capabilities expressed as DSH tool definitions.
 *
 * This file has no DSH import on purpose: `defineTool` is passed in, so the
 * wiring (names, parameters, delegation to the core, error behaviour) can be
 * tested without the official runtime packages. `index.ts` supplies the real one.
 *
 * Host contract, read from `packages/plugin-sdk/src/process-extension-runner.mjs`:
 *   - the host grants each tool by its DSH name; the grant must have an id
 *     matching ^[a-z][a-z0-9]*([._-][a-z0-9]+)+$ and an approved effect
 *   - granted non-read tools are projected with idempotency 'required'
 *   - `output.schema` is converted with `z.fromJSONSchema`, so it must be plain JSON Schema
 *
 * Caller workspace: the static capabilities derive it from the invocation
 * context; the host does not forward caller identity into tool arguments yet
 * (plugins/GAPS.md, G1), so every tool takes an explicit required
 * `workspaceRoot` parameter. The adapter strips it before strict contract
 * parsing, and the operations wrap domain errors into `{ ok, issue }` results
 * exactly like the static handlers.
 */
import { z } from 'zod'
import { RESEARCH_CHECKPOINT_CAPABILITY_IDS } from '../contract.js'
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
  type ResearchCheckpointOperationRuntime
} from '../core/operations.js'

/** Host-side grant table this plugin expects. It is configured by the host, not by the plugin. */
export const EXPECTED_HOST_GRANTS = Object.freeze({
  start: { id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.start, effect: 'workspace-write' },
  stop: { id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.stop, effect: 'workspace-write' },
  status: { id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.status, effect: 'read' },
  read: { id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.read, effect: 'read' },
  list: { id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.list, effect: 'read' },
  turn_status: { id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.turnStatus, effect: 'read' },
  resolve: { id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.resolve, effect: 'workspace-write' },
  restore_as_new: { id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.restoreAsNew, effect: 'workspace-write' },
  legacy_preview: { id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.previewLegacy, effect: 'read' },
  legacy_import: { id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.importLegacy, effect: 'workspace-write' }
} as const)

export type DshToolParameter = Readonly<{
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array'
  required?: true
  items?: Readonly<{ type: 'string' }>
  enum?: readonly string[]
}>

export type DshToolDefinition = Readonly<{
  name: string
  description: string
  parameters: Readonly<Record<string, DshToolParameter>>
  output: Readonly<{
    schema: Readonly<Record<string, unknown>>
    render: (args: unknown, value: unknown) => readonly { type: 'text'; text: string }[]
  }>
  execute: (args: unknown) => Promise<unknown>
}>

const render = (_args: unknown, value: unknown): readonly { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value) }
]

/** Plain JSON Schema: the results are validated precisely by the core's zod schemas. */
const OBJECT_OUTPUT = Object.freeze({ type: 'object', additionalProperties: true })

const workspaceArgumentSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096)
}).passthrough()

function splitWorkspaceArgument(args: unknown): Readonly<{ input: unknown; workspaceRoot: string }> {
  const parsed = workspaceArgumentSchema.parse(args ?? {})
  const { workspaceRoot, ...input } = parsed
  return Object.freeze({ input, workspaceRoot })
}

const WORKSPACE_ROOT: DshToolParameter = { type: 'string', required: true }
const RUNTIME_THREAD = Object.freeze({
  runtimeId: { type: 'string', required: true },
  threadId: { type: 'string', required: true }
} as const)

export function researchCheckpointTools(
  getRuntime: () => ResearchCheckpointOperationRuntime
): readonly DshToolDefinition[] {
  const tool = (
    definition: Readonly<{
      name: string
      description: string
      parameters: Readonly<Record<string, DshToolParameter>>
      run: (
        runtime: ResearchCheckpointOperationRuntime,
        input: unknown,
        workspaceRoot: string
      ) => Promise<Readonly<{ output: unknown }>>
    }>
  ): DshToolDefinition => ({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    output: { schema: OBJECT_OUTPUT, render },
    execute: async (args) => {
      const { input, workspaceRoot } = splitWorkspaceArgument(args)
      return (await definition.run(getRuntime(), input, workspaceRoot)).output
    }
  })
  return [
    tool({
      name: 'start',
      description: 'Opts the exact workspace runtime/thread into durable Research Checkpoints.',
      parameters: {
        ...RUNTIME_THREAD,
        expectedPolicyRevision: { type: 'integer', required: true },
        idempotencyKey: { type: 'string', required: true },
        title: { type: 'string' },
        changeReason: { type: 'string' },
        workspaceRoot: WORKSPACE_ROOT
      },
      run: startRecording
    }),
    tool({
      name: 'stop',
      description: 'Stops automatic checkpoint creation without deleting immutable history.',
      parameters: {
        ...RUNTIME_THREAD,
        expectedPolicyRevision: { type: 'integer', required: true },
        idempotencyKey: { type: 'string', required: true },
        recordingId: { type: 'string' },
        workspaceRoot: WORKSPACE_ROOT
      },
      run: stopRecording
    }),
    tool({
      name: 'status',
      description: 'Reads the latest exact recording binding for one runtime/thread.',
      parameters: { ...RUNTIME_THREAD, workspaceRoot: WORKSPACE_ROOT },
      run: readStatus
    }),
    tool({
      name: 'read',
      description: 'Reads a committed checkpoint by recording or exact Artifact Version.',
      parameters: {
        recordingId: { type: 'string' },
        versionId: { type: 'string' },
        workspaceRoot: WORKSPACE_ROOT
      },
      run: readCheckpoint
    }),
    tool({
      name: 'list',
      description: 'Lists bounded committed checkpoint versions without scanning Artifact history.',
      parameters: {
        runtimeId: { type: 'string' },
        threadId: { type: 'string' },
        recordingId: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'integer' },
        workspaceRoot: WORKSPACE_ROOT
      },
      run: listCheckpoints
    }),
    tool({
      name: 'turn_status',
      description: 'Reads durable pending/committed/conflict/failure status for one producing turn.',
      parameters: { ...RUNTIME_THREAD, turnId: { type: 'string', required: true }, workspaceRoot: WORKSPACE_ROOT },
      run: readTurnStatus
    }),
    tool({
      name: 'resolve',
      description: 'Explicitly rebases or discards one stale checkpoint while preserving immutable history.',
      parameters: {
        ...RUNTIME_THREAD,
        recordingId: { type: 'string', required: true },
        operationId: { type: 'string', required: true },
        resolution: { type: 'string', enum: ['rebase', 'discard'], required: true },
        idempotencyKey: { type: 'string', required: true },
        workspaceRoot: WORKSPACE_ROOT
      },
      run: resolveConflict
    }),
    tool({
      name: 'restore_as_new',
      description: 'Restores historical bytes and advances the owning recording to the exact new current Version.',
      parameters: {
        recordingId: { type: 'string', required: true },
        artifactId: { type: 'string', required: true },
        sourceVersionId: { type: 'string', required: true },
        expectedCurrentVersionId: { type: 'string', required: true },
        idempotencyKey: { type: 'string', required: true },
        workspaceRoot: WORKSPACE_ROOT
      },
      run: restoreAsNew
    }),
    tool({
      name: 'legacy_preview',
      description: 'Lists bounded durable turn summaries and computes a selection-bound transcript digest.',
      parameters: {
        ...RUNTIME_THREAD,
        selectedTurnIds: { type: 'array', items: { type: 'string' } },
        workspaceRoot: WORKSPACE_ROOT
      },
      run: previewLegacy
    }),
    tool({
      name: 'legacy_import',
      description: 'Reads selected durable turns and saves an explicitly incomplete legacy checkpoint.',
      parameters: {
        ...RUNTIME_THREAD,
        idempotencyKey: { type: 'string', required: true },
        title: { type: 'string', required: true },
        expectedTranscriptDigest: { type: 'string', required: true },
        selectedTurnIds: { type: 'array', items: { type: 'string' }, required: true },
        workspaceRoot: WORKSPACE_ROOT
      },
      run: importLegacy
    })
  ]
}

export function registerResearchCheckpointTools(
  register: (tool: unknown) => unknown,
  defineTool: (definition: DshToolDefinition) => unknown,
  getRuntime: () => ResearchCheckpointOperationRuntime
): void {
  for (const definition of researchCheckpointTools(getRuntime)) register(defineTool(definition))
}
