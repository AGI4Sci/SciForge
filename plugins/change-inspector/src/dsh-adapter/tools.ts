import { CHANGE_INSPECTOR_CAPABILITY_IDS } from '../contract.js'
import { listChanges, openSession } from '../core/operations.js'
import type { ChangeInspectorService } from '../core/service.js'

export const EXPECTED_HOST_GRANTS = Object.freeze({
  open_session: { id: CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, effect: 'read' },
  list_changes: { id: CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges, effect: 'read' }
} as const)

export type DshToolDefinition = Readonly<{
  name: string
  description: string
  parameters: Readonly<Record<string, { type: string; required?: boolean }>>
  output: Readonly<{ schema: Readonly<Record<string, unknown>>; render: (args: unknown, value: unknown) => readonly { type: 'text'; text: string }[] }>
  execute: (args: unknown) => Promise<unknown>
}>
const render = (_args: unknown, value: unknown): readonly { type: 'text'; text: string }[] => [{ type: 'text', text: JSON.stringify(value) }]
const OBJECT_OUTPUT = Object.freeze({ type: 'object', additionalProperties: true })

export function changeInspectorTools(getService: () => ChangeInspectorService): readonly DshToolDefinition[] {
  return [
    {
      name: 'open_session',
      description: 'Inspect actual file_change artifacts from the current Agent session after edits or tests. Returns a bounded unified-diff snapshot, content revision, original patch byte counts and explicit truncation reasons. Omit sessionId/runtimeId to inspect this authenticated session. Read-only; cannot modify or roll back files.',
      parameters: { sessionId: { type: 'string' }, runtimeId: { type: 'string' } },
      output: { schema: OBJECT_OUTPUT, render },
      execute: async args => (await openSession(getService(), args)).output
    },
    {
      name: 'list_changes',
      description: 'Page actual file_change summaries from the current authenticated Agent session. Use limit=1 to locate individual diffs; follow nextCursor. Cursor is bound to this session and revision: restart listing after further edits. Returns bounded patch previews, original byte counts and truncation explanations. Read-only.',
      parameters: { sessionId: { type: 'string' }, limit: { type: 'number' }, cursor: { type: 'string' } },
      output: { schema: OBJECT_OUTPUT, render },
      execute: async args => (await listChanges(getService(), args)).output
    }
  ]
}
export function registerChangeInspectorTools(register: (tool: unknown) => unknown, defineTool: (definition: DshToolDefinition) => unknown, getService: () => ChangeInspectorService): void {
  for (const definition of changeInspectorTools(getService)) register(defineTool(definition))
}
