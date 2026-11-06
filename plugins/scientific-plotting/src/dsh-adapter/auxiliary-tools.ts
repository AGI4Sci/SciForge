import { defineContractTool } from '@sciforge/plugin-sdk'
import { z } from 'zod'
import {
  compositeScientificPlotLayers,
  createScientificPlottingReviewPacket,
  listScientificPlottingStyleProfiles,
  prepareScientificPlottingReference
} from '../worker/scientific-plotting-engine.js'
import { splitWorkspaceArgument } from '../review-adapter/tools.js'
import type { DshToolDefinition, DshToolParameter } from './tools.js'
import {
  scientificPlottingCompositeInputSchema,
  scientificPlottingCompositeOutputSchema,
  scientificPlottingPrepareReferenceInputSchema,
  scientificPlottingPrepareReferenceOutputSchema,
  scientificPlottingReviewPacketInputSchema,
  scientificPlottingReviewPacketOutputSchema,
  scientificPlottingStyleProfilesInputSchema,
  scientificPlottingStyleProfilesOutputSchema
} from './auxiliary-schemas.js'

export * from './auxiliary-schemas.js'
export const SCIENTIFIC_PLOTTING_AUXILIARY_CAPABILITY_IDS = Object.freeze({
  styleProfiles: 'scientific-plotting.style-profiles',
  composite: 'scientific-plotting.composite',
  prepareReference: 'scientific-plotting.prepare-reference',
  reviewPacket: 'scientific-plotting.review-packet'
} as const)
export const EXPECTED_AUXILIARY_HOST_GRANTS = Object.freeze({
  style_profiles: { id: SCIENTIFIC_PLOTTING_AUXILIARY_CAPABILITY_IDS.styleProfiles, effect: 'read', readResource: 'workspace' },
  composite: { id: SCIENTIFIC_PLOTTING_AUXILIARY_CAPABILITY_IDS.composite, effect: 'workspace-write', scope: 'workspace' },
  prepare_reference: { id: SCIENTIFIC_PLOTTING_AUXILIARY_CAPABILITY_IDS.prepareReference, effect: 'workspace-write', scope: 'workspace' },
  review_packet: { id: SCIENTIFIC_PLOTTING_AUXILIARY_CAPABILITY_IDS.reviewPacket, effect: 'workspace-write', scope: 'workspace' }
} as const)

/** Canonical contracts validate both sides; no MCP wrapper or duplicate business implementation. */
function auxiliaryTool<Input extends { workspaceRoot?: string }, Output>(definition: {
  name: string
  description: string
  inputSchema: z.ZodType<Input>
  outputSchema: z.ZodType<Output>
  run: (input: Input & { workspaceRoot: string }) => Promise<Output>
}): DshToolDefinition {
  const inputSchema = z.toJSONSchema(definition.inputSchema, { target: 'draft-7' })
  const parameters: Record<string, DshToolParameter> = {}
  const properties = inputSchema.properties as Record<string, { type?: string; items?: { type?: string }; enum?: string[] }>
  const required = new Set(inputSchema.required as string[] | undefined)
  for (const [name, field] of Object.entries(properties)) {
    const parameter: DshToolParameter = field.type === 'string' ? { type: 'string', ...(field.enum ? { enum: field.enum } : {}) }
      : field.type === 'integer' ? { type: 'integer' }
        : field.type === 'number' ? { type: 'number' }
          : field.type === 'boolean' ? { type: 'boolean' }
            : field.type === 'array' && field.items?.type === 'string' ? { type: 'array', items: { type: 'string' } }
              : { type: 'json' }
    parameters[name] = required.has(name) ? { ...parameter, required: true } : parameter
  }
  return Object.freeze({
    name: definition.name, description: definition.description, parameters: Object.freeze(parameters), inputSchema,
    output: {
      schema: z.toJSONSchema(definition.outputSchema, { target: 'draft-7' }),
      render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
    },
    execute: async (args: unknown) => {
      // Optional in discovery, mandatory during execution; the Host overwrites this identity.
      const { input, workspaceRoot } = splitWorkspaceArgument(args)
      const request = definition.inputSchema.parse(input)
      return definition.outputSchema.parse(await definition.run({ ...request, workspaceRoot }))
    }
  })
}

export function scientificPlottingAuxiliaryTools(): readonly DshToolDefinition[] {
  return [
    auxiliaryTool({
      name: 'style_profiles',
      description: 'List, read or reference-match built-in scientific figure style profiles. Styling guidance never changes source data or statistics.',
      inputSchema: scientificPlottingStyleProfilesInputSchema, outputSchema: scientificPlottingStyleProfilesOutputSchema,
      run: listScientificPlottingStyleProfiles
    }),
    auxiliaryTool({
      name: 'composite',
      description: 'Compose real image layers for a locked hybrid plan. Model layers are drawn first and code-owned truth layers last at full opacity. Release requires manifest-bound image_generation_review_candidate QA.',
      inputSchema: scientificPlottingCompositeInputSchema, outputSchema: scientificPlottingCompositeOutputSchema,
      run: async (request) => {
        const result = await compositeScientificPlotLayers(request)
        return result.ok ? { ...result, nextCall: {
          tool: 'image_generation_review_candidate' as const,
          arguments: {
            workspaceRoot: request.workspaceRoot, outputPath: result.outputPath,
            manifestPath: result.manifestPath, task: request.reviewTask,
            ...(request.reviewReferencePath ? { referencePath: request.reviewReferencePath } : {})
          }
        } } : result
      }
    }),
    auxiliaryTool({
      name: 'prepare_reference',
      description: 'Crop a workspace image or PDF page into a PNG reference and optionally extract a style spec and template profile.',
      inputSchema: scientificPlottingPrepareReferenceInputSchema, outputSchema: scientificPlottingPrepareReferenceOutputSchema,
      run: prepareScientificPlottingReference
    }),
    auxiliaryTool({
      name: 'review_packet',
      description: 'Create Markdown and JSON review packets from hash-verified existing scientific plotting render manifests without rerendering.',
      inputSchema: scientificPlottingReviewPacketInputSchema, outputSchema: scientificPlottingReviewPacketOutputSchema,
      run: createScientificPlottingReviewPacket
    })
  ]
}

export function registerScientificPlottingAuxiliaryTools(register: (tool: unknown) => unknown): void {
  for (const tool of scientificPlottingAuxiliaryTools()) register(defineContractTool(tool))
}
