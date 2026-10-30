/**
 * DSH entrypoint for the unit conversion plugin.
 *
 * Entry shape: `export const inject = ['tools']` and `export function apply(ctx, config)`.
 * Stage-one configuration is empty and validated strictly.
 */
import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import {
  convert,
  listUnits,
  UnitConversionError,
  UNIT_CONVERSION_EXAMPLES,
  type Conversion
} from '../core/units.js'

export const inject = ['tools']

type ToolResult = Readonly<{ ok: true; result: unknown } | { ok: false; error: Readonly<{ code: string; message: string }> }>

function render(value: unknown): readonly { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const OBJECT_OUTPUT = Object.freeze({ type: 'object', additionalProperties: true })

function conversionResult(args: unknown): ToolResult {
  try {
    return { ok: true, result: convert(args) }
  } catch (error) {
    if (error instanceof UnitConversionError) {
      return { ok: false, error: { code: error.code, message: error.message } }
    }
    return { ok: false, error: { code: 'invalid_request', message: error instanceof Error ? error.message : String(error) } }
  }
}

export function apply(ctx: Context & { tools: ToolRuntime }, config?: unknown): void {
  const supplied = config ?? {}
  if (typeof supplied !== 'object' || supplied === null || Object.keys(supplied as object).length > 0) {
    throw new Error('unit-conversion takes no configuration; received unexpected keys.')
  }

  ctx.tools.register(defineTool({
    name: 'unit_conversion_convert',
    description: 'Converts a value between units of the same dimension (length, mass, time, volume, energy, pressure, temperature). Refuses unknown units and cross-dimension conversions, and returns the exact k/b transform it used.',
    parameters: {
      value: { type: 'number', required: true },
      from: { type: 'string', required: true },
      to: { type: 'string', required: true }
    },
    output: { schema: OBJECT_OUTPUT, render: (_args: unknown, value: unknown) => render(value) },
    execute: async (args: unknown) => conversionResult(args)
  } as never))

  ctx.tools.register(defineTool({
    name: 'unit_conversion_list',
    description: 'Lists every supported unit grouped by dimension, with its description and the accepted spellings.',
    parameters: {},
    output: { schema: OBJECT_OUTPUT, render: (_args: unknown, value: unknown) => render(value) },
    execute: async () => ({
      ok: true,
      result: { dimensions: listUnits(), examples: UNIT_CONVERSION_EXAMPLES }
    }) as ToolResult
  } as never))
}

/** Exported for the plugin's own tests; the DSH runtime ignores extra exports. */
export const __internals = Object.freeze({ conversionResult, render } satisfies Record<string, unknown>)
export type { Conversion }