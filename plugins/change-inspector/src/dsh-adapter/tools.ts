/**
 * The Change Inspector tool expressed as a DSH tool definition.
 *
 * This file has no DSH import on purpose: `defineTool` is passed in, so the
 * wiring (name, parameters, delegation to the core, error behaviour) can be
 * tested without the official runtime packages. `index.ts` supplies the real one.
 *
 * Host contract, read from `packages/plugin-sdk/src/process-extension-runner.mjs`:
 *   - the host grants each tool by its DSH name; the grant must have an id
 *     matching ^[a-z][a-z0-9]*([._-][a-z0-9]+)+$ and an approved effect
 *   - `output.schema` is converted with `z.fromJSONSchema`, so it must be plain JSON Schema
 *
 * Caller workspace: the static capability derives it from the invocation
 * context; the host does not forward caller identity into tool arguments yet
 * (plugins/GAPS.md, G1), so the tool takes an explicit required
 * `workspaceRoot` parameter. The adapter strips it before strict contract
 * parsing, and the core applies the same cross-workspace policy checks as the
 * static handler.
 *
 * Result shape (G3 option a): the tool returns the snapshot data and the
 * canonical resource id. The static handler instead issues a Broker resource
 * via `context.issueResource`; that wrapping stays in the host thin layer.
 */
import { z } from 'zod'
import { CHANGE_INSPECTOR_CAPABILITY_IDS } from '../contract.js'
import { listChanges, openSession } from '../core/operations.js'
import type { ChangeInspectorService } from '../core/service.js'

/** Host-side grant table this plugin expects. It is configured by the host, not by the plugin. */
export const EXPECTED_HOST_GRANTS = Object.freeze({
  open_session: { id: CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, effect: 'read' },
  list_changes: { id: CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges, effect: 'read' }
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

/** Plain JSON Schema: the result is validated precisely by the core's zod schemas. */
const OBJECT_OUTPUT = Object.freeze({ type: 'object', additionalProperties: true })

const workspaceArgumentSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096)
}).passthrough()

function splitWorkspaceArgument(args: unknown): Readonly<{ input: unknown; workspaceRoot: string }> {
  const parsed = workspaceArgumentSchema.parse(args ?? {})
  const { workspaceRoot, ...input } = parsed
  return Object.freeze({ input, workspaceRoot })
}

export function changeInspectorTools(
  getService: () => ChangeInspectorService
): readonly DshToolDefinition[] {
  return [
    {
      name: 'open_session',
      description: 'Projects the unified-diff change snapshot of one agent session.',
      parameters: {
        sessionId: { type: 'string', required: true },
        runtimeId: { type: 'string', required: true },
        workspaceRoot: { type: 'string', required: true }
      },
      output: { schema: OBJECT_OUTPUT, render },
      execute: async (args) => {
        const { input, workspaceRoot } = splitWorkspaceArgument(args)
        return (await openSession(getService(), input, workspaceRoot)).output
      }
    },
    {
      name: 'list_changes',
      description: 'Read bounded change summaries for one session with cursor pagination.',
      parameters: {
        sessionId: { type: 'string', required: true },
        workspaceRoot: { type: 'string', required: true },
        limit: { type: 'number' },
        cursor: { type: 'string' }
      },
      output: { schema: OBJECT_OUTPUT, render },
      execute: async args => {
        const { input, workspaceRoot } = splitWorkspaceArgument(args)
        return (await listChanges(getService(), input, workspaceRoot)).output
      }
    }
  ]
}

export function registerChangeInspectorTools(
  register: (tool: unknown) => unknown,
  defineTool: (definition: DshToolDefinition) => unknown,
  getService: () => ChangeInspectorService
): void {
  for (const definition of changeInspectorTools(getService)) register(defineTool(definition))
}
