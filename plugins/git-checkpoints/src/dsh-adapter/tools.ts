/**
 * The four Git Checkpoints tools expressed as DSH tool definitions.
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
 * Caller workspace: the static capability derives it from the invocation
 * context; the host does not forward caller identity into tool arguments yet
 * (plugins/GAPS.md, G1), so every tool takes an explicit required
 * `workspaceRoot` parameter. The adapter strips it before strict contract
 * parsing where the static schema does not declare it, and the core applies
 * the same cross-workspace policy checks as the static handlers.
 */
import { z } from 'zod'
import {
  createCheckpoint,
  listCheckpoints,
  previewCheckpoint,
  restoreCheckpoint
} from '../core/operations.js'
import type { GitCheckpointService } from '../core/service.js'

/** Host-side grant table this plugin expects. It is configured by the host, not by the plugin. */
export const EXPECTED_HOST_GRANTS = Object.freeze({
  list: { id: 'git-checkpoints.list', effect: 'read' },
  create: { id: 'git-checkpoints.create', effect: 'workspace-write' },
  preview: { id: 'git-checkpoints.preview', effect: 'read' },
  restore: { id: 'git-checkpoints.restore', effect: 'destructive' }
} as const)

export type DshToolDefinition = Readonly<{
  name: string
  description: string
  parameters: Readonly<Record<string, { type: string; required?: boolean }>>
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

export function gitCheckpointTools(
  getService: () => GitCheckpointService
): readonly DshToolDefinition[] {
  return [
    {
      name: 'list',
      description: 'Lists package-owned checkpoints in the given workspace.',
      parameters: {
        runtimeId: { type: 'string' },
        threadId: { type: 'string' },
        workspaceRoot: { type: 'string', required: true }
      },
      output: { schema: OBJECT_OUTPUT, render },
      execute: async (args) => {
        const { input, workspaceRoot } = splitWorkspaceArgument(args)
        return (await listCheckpoints(getService(), { ...input, workspaceRoot }, workspaceRoot)).output
      }
    },
    {
      name: 'create',
      description: 'Creates a manual checkpoint through the version-control port.',
      parameters: {
        runtimeId: { type: 'string', required: true },
        threadId: { type: 'string', required: true },
        turnId: { type: 'string' },
        workspaceRoot: { type: 'string', required: true },
        phase: { type: 'string' }
      },
      output: { schema: OBJECT_OUTPUT, render },
      execute: async (args) => {
        const { input, workspaceRoot } = splitWorkspaceArgument(args)
        return (await createCheckpoint(getService(), { ...input, workspaceRoot }, workspaceRoot)).output
      }
    },
    {
      name: 'preview',
      description: 'Previews restoring one checkpoint without changing the workspace.',
      parameters: {
        checkpointId: { type: 'string', required: true },
        workspaceRoot: { type: 'string', required: true }
      },
      output: { schema: OBJECT_OUTPUT, render },
      execute: async (args) => {
        const { input, workspaceRoot } = splitWorkspaceArgument(args)
        return (await previewCheckpoint(getService(), input, workspaceRoot)).output
      }
    },
    {
      name: 'restore',
      description: 'Captures a rescue checkpoint, then restores the selected checkpoint.',
      parameters: {
        checkpointId: { type: 'string', required: true },
        workspaceRoot: { type: 'string', required: true }
      },
      output: { schema: OBJECT_OUTPUT, render },
      execute: async (args) => {
        const { input, workspaceRoot } = splitWorkspaceArgument(args)
        return (await restoreCheckpoint(getService(), input, workspaceRoot)).output
      }
    }
  ]
}

export function registerGitCheckpointTools(
  register: (tool: unknown) => unknown,
  defineTool: (definition: DshToolDefinition) => unknown,
  getService: () => GitCheckpointService
): void {
  for (const definition of gitCheckpointTools(getService)) register(defineTool(definition))
}
