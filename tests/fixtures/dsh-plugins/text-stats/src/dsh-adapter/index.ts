/**
 * DSH entrypoint for the text statistics plugin.
 *
 * Entry shape: `export const inject = ['tools']` and `export function apply(ctx, config)`
 * registering tools with `defineTool`. Stage-one configuration is empty and is
 * validated strictly, so a host that passes unexpected configuration fails here
 * instead of silently ignoring it.
 */
import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { countText, describeRules, TEXT_STATS_EXAMPLES, type TextStatsCounts } from '../core/count.js'

export const inject = ['tools']

type ToolResult = Readonly<{ ok: true; result: unknown } | { ok: false; error: Readonly<{ code: string; message: string }> }>

const render = (value: unknown): readonly { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value) }
]

const OBJECT_OUTPUT = Object.freeze({ type: 'object', additionalProperties: true })

function failure(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } }
}

function countResult(args: unknown): ToolResult {
  const text = (args as { text?: unknown } | null)?.text
  if (typeof text !== 'string') {
    return failure('invalid_request', 'Provide `text` as a string.')
  }
  try {
    return { ok: true, result: countText(text) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof RangeError ? 'text_too_long' : 'invalid_request'
    return failure(code, message)
  }
}

export function apply(ctx: Context & { tools: ToolRuntime }, config?: unknown): void {
  const supplied = config ?? {}
  if (typeof supplied !== 'object' || supplied === null || Object.keys(supplied as object).length > 0) {
    throw new Error('text-stats takes no configuration; received unexpected keys.')
  }

  ctx.tools.register(defineTool({
    name: 'text_stats_count',
    description: 'Counts characters, CJK characters, Latin words, words, lines, paragraphs, whitespace and UTF-8 bytes for a piece of text. Returns the counting rule version so results are comparable.',
    parameters: {
      text: { type: 'string', required: true }
    },
    output: { schema: OBJECT_OUTPUT, render: (_args: unknown, value: unknown) => render(value) },
    execute: async (args: unknown) => countResult(args)
  } as never))

  ctx.tools.register(defineTool({
    name: 'text_stats_explain',
    description: 'Explains exactly how this plugin counts: what a character is, how Chinese/Japanese/Korean text and Latin words are counted, how lines and paragraphs are split, and the limits.',
    parameters: {},
    output: { schema: OBJECT_OUTPUT, render: (_args: unknown, value: unknown) => render(value) },
    execute: async () => ({
      ok: true,
      result: { ...describeRules(), examples: TEXT_STATS_EXAMPLES }
    }) as ToolResult
  } as never))
}

/** Exported for the plugin's own tests; the DSH runtime ignores extra exports. */
export const __internals = Object.freeze({ countResult, render, countText, describeRules } satisfies Record<string, unknown>)
export type { TextStatsCounts }