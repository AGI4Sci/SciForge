/**
 * Neutral fixture for workspace binding.
 *
 * `workspace_note_write` is a `workspace-write` tool that reports the
 * `workspaceRoot` argument it actually received and writes a file into it.
 * A host that binds the caller workspace must replace whatever the caller put
 * in the argument; a host that does not bind leaks an arbitrary directory into
 * a workspace-write effect.
 *
 * `workspace_note_report` is a plain `compute` tool with no workspace scope: it
 * only echoes its argument, so a test can prove the binding is scoped to tool
 * declarations and is not applied to every plugin call.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'

export const inject = ['tools']

const OBJECT_OUTPUT = Object.freeze({ type: 'object', additionalProperties: true })

const render = (_args: unknown, value: unknown): readonly { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value) }
]

function workspaceRootOf(args: unknown): string {
  const value = (args as { workspaceRoot?: unknown } | null)?.workspaceRoot
  if (typeof value !== 'string' || !value.trim()) throw new Error('workspaceRoot is required.')
  return value
}

export function apply(ctx: Context & { tools: ToolRuntime }, config?: unknown): void {
  const supplied = config ?? {}
  if (typeof supplied !== 'object' || supplied === null || Object.keys(supplied as object).length > 0) {
    throw new Error('workspace-note takes no configuration; received unexpected keys.')
  }

  ctx.tools.register(defineTool({
    name: 'workspace_note_write',
    description: 'Writes a note into the workspace it was given and reports that workspace path.',
    parameters: {
      workspaceRoot: { type: 'string', required: true },
      text: { type: 'string', required: true }
    },
    output: { schema: OBJECT_OUTPUT, render: (_args: unknown, value: unknown) => render(_args, value) },
    execute: async (args: unknown) => {
      const workspaceRoot = workspaceRootOf(args)
      const text = (args as { text?: unknown }).text
      if (typeof text !== 'string') throw new Error('text is required.')
      await mkdir(workspaceRoot, { recursive: true })
      const path = join(workspaceRoot, 'workspace-note.txt')
      await writeFile(path, text, 'utf8')
      return { ok: true, workspaceRoot, path }
    }
  } as never))

  ctx.tools.register(defineTool({
    name: 'workspace_note_probe',
    description: 'Reports the workspaceRoot it received without writing anything (compute + workspace scope).',
    parameters: {
      workspaceRoot: { type: 'string', required: true }
    },
    output: { schema: OBJECT_OUTPUT, render: (_args: unknown, value: unknown) => render(_args, value) },
    execute: async (args: unknown) => ({ ok: true, workspaceRoot: workspaceRootOf(args) })
  } as never))

  ctx.tools.register(defineTool({
    name: 'workspace_note_report',
    description: 'Echoes the workspaceRoot argument it received without writing anything.',
    parameters: {
      workspaceRoot: { type: 'string' }
    },
    output: { schema: OBJECT_OUTPUT, render: (_args: unknown, value: unknown) => render(_args, value) },
    execute: async (args: unknown) => ({ ok: true, workspaceRoot: (args as { workspaceRoot?: unknown } | null)?.workspaceRoot ?? null })
  } as never))
}