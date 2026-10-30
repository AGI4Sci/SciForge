import { z } from 'zod'
import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/** Publish the canonical contract's complete structure in the fixed DSH subset.
 * Length/range/format refinements are not supported by DSH 0.2.0-rc.2;
 * canonical Zod validation remains authoritative at invocation.
 */
function structural(node: Record<string, any>): ValueSchemaSpec {
  if (node.anyOf) return { oneOf: node.anyOf.map(structural) as [ValueSchemaSpec, ValueSchemaSpec, ...ValueSchemaSpec[]] }
  if (node.type === 'object') return { type: 'object', properties: properties(node), additionalProperties: node.additionalProperties !== false }
  if (node.type === 'array') return { type: 'array', items: structural(node.items ?? {}) }
  if (!node.type) return { type: 'json' }
  return { type: node.type, ...(node.enum ? { enum: node.enum } : {}), ...('const' in node ? { const: node.const } : {}) } as ValueSchemaSpec
}
function properties(node: Record<string, any>): ParameterSchemaSpec {
  return Object.fromEntries(Object.entries(node.properties ?? {}).map(([key, value]) => [key, {
    ...structural(value as Record<string, any>), ...(node.required?.includes(key) ? { required: true as const } : {})
  }]))
}
export function canonicalParameters(schema: z.ZodType): ParameterSchemaSpec {
  return properties(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }))
}
