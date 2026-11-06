import { z } from 'zod'
import { VISUAL_REVIEW_CAPABILITY_IDS } from '../review/contract.js'
import { createVisualReviewOperations, type VisualReviewOperations } from '../review/operations.js'

/** Names stay stable while ownership moves into the plotting release unit. */
export const REVIEW_TOOL_CAPABILITIES = Object.freeze({
  visual_review_open: VISUAL_REVIEW_CAPABILITY_IDS.open,
  visual_review_read_document: VISUAL_REVIEW_CAPABILITY_IDS.readDocument,
  visual_review_read_image: VISUAL_REVIEW_CAPABILITY_IDS.readImage,
  visual_review_update_context: VISUAL_REVIEW_CAPABILITY_IDS.updateContext,
  visual_review_apply_style_reference: VISUAL_REVIEW_CAPABILITY_IDS.applyStyleReference,
  visual_review_save_annotations: VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations,
  visual_review_export_review_packet: VISUAL_REVIEW_CAPABILITY_IDS.exportReviewPacket,
  visual_review_create_candidate: VISUAL_REVIEW_CAPABILITY_IDS.createCandidate,
  visual_review_accept_candidate: VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate,
  visual_review_reject_candidate: VISUAL_REVIEW_CAPABILITY_IDS.rejectCandidate
})

/** Declarations are expectations, not authorization; only the host grants them. */
const canonicalDefinitions = new Map(createVisualReviewOperations().definitions().map(
  (definition) => [definition.id, definition]
))
export const EXPECTED_REVIEW_HOST_GRANTS = Object.freeze(Object.fromEntries(
  Object.entries(REVIEW_TOOL_CAPABILITIES).map(([name, id]) => {
    const definition = canonicalDefinitions.get(id)
    if (!definition) throw new Error(`Missing canonical review capability: ${id}`)
    return [name, Object.freeze({
      id, effect: definition.effect, scope: definition.scope, approval: definition.approval
    })]
  })
))

export type DshToolParameter = Readonly<{
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'json'
  required?: true
  items?: Readonly<{ type: 'string' }>
  enum?: readonly string[]
}>
export type DshToolDefinition = Readonly<{
  name: string
  description: string
  parameters: Readonly<Record<string, DshToolParameter>>
  /** Full public contract, including nested constraints absent from DSH scalars. */
  inputSchema: Readonly<Record<string, unknown>>
  output: Readonly<{
    schema: Readonly<Record<string, unknown>>
    render: (args: unknown, value: unknown) => readonly { type: 'text'; text: string }[]
  }>
  execute: (args: unknown) => Promise<unknown>
}>

type JsonProperty = Readonly<{
  type?: string
  enum?: readonly string[]
  items?: Readonly<{ type?: string }>
}>
type JsonObjectSchema = Readonly<Record<string, unknown>> & Readonly<{
  properties?: Readonly<Record<string, JsonProperty>>
  required?: readonly string[]
}>
function jsonSchema(schema: z.ZodType): JsonObjectSchema {
  return z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as JsonObjectSchema
}
function parameter(field: JsonProperty, required: boolean): DshToolParameter {
  const value: DshToolParameter = field.type === 'string'
    ? { type: 'string', ...(field.enum ? { enum: field.enum } : {}) }
    : field.type === 'integer' ? { type: 'integer' }
      : field.type === 'number' ? { type: 'number' }
        : field.type === 'boolean' ? { type: 'boolean' }
          : field.type === 'array' && field.items?.type === 'string'
            ? { type: 'array', items: { type: 'string' } }
            : { type: 'json' }
  return required ? { ...value, required: true } : value
}

const workspaceArgumentSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096)
}).passthrough()
/** The host stamps workspaceRoot from the caller; a missing binding fails. */
export function splitWorkspaceArgument(args: unknown): Readonly<{ input: unknown; workspaceRoot: string }> {
  const { workspaceRoot, ...input } = workspaceArgumentSchema.parse(args ?? {})
  return Object.freeze({ input, workspaceRoot })
}

/** Every metadata/schema/handler fact is obtained from the canonical factory. */
export function visualReviewTools(operations: VisualReviewOperations): readonly DshToolDefinition[] {
  const definitions = new Map(operations.definitions().map((definition) => [definition.id, definition]))
  return Object.entries(REVIEW_TOOL_CAPABILITIES).map(([name, id]) => {
    const definition = definitions.get(id)
    if (!definition) throw new Error(`Missing canonical review capability: ${id}`)
    const input = jsonSchema(definition.inputSchema)
    const required = new Set(input.required ?? [])
    const parameters = Object.fromEntries(Object.entries(input.properties ?? {}).map(
      ([key, field]) => [key, parameter(field, required.has(key))]
    ))
    // Optional in model-facing schema: callers must not choose workspace identity.
    const workspaceRoot = { type: 'string', minLength: 1, maxLength: 4_096 }
    return Object.freeze({
      name,
      description: definition.description,
      parameters: Object.freeze({ ...parameters, workspaceRoot: { type: 'string' as const } }),
      inputSchema: Object.freeze({ ...input, properties: { ...input.properties, workspaceRoot } }),
      output: Object.freeze({
        schema: jsonSchema(definition.outputSchema),
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
      }),
      execute: async (args: unknown) => {
        const { input, workspaceRoot } = splitWorkspaceArgument(args)
        return operations.invoke(id, input, workspaceRoot)
      }
    })
  })
}

export function registerVisualReviewTools(
  operations: VisualReviewOperations,
  register: (tool: unknown) => unknown,
  defineTool: (definition: DshToolDefinition) => unknown
): void {
  for (const definition of visualReviewTools(operations)) register(defineTool(definition))
}
