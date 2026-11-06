import { z } from 'zod'
import {
  controlledPlottingPlanSchema,
  figureStyleSpecSchema,
  rendererDiagnosticsSchema,
  scientificPlottingReferenceProfileSchema,
  scientificPlottingStyleProfileMatchSchema,
  scientificPlottingStyleProfileSummarySchema,
  scientificPlottingTemplateSchema,
  visualStyleSimilarityMetricSchema
} from '../worker/contract.js'
import type {
  ScientificPlottingPrepareReferenceResult,
  ScientificPlottingReviewPacketResult,
  ScientificPlottingStyleProfilesResult
} from '../worker/types.js'

const path = z.string().trim().min(1).max(4096)
const optionalPath = z.string().trim().max(4096).optional()
const optionalId = z.string().trim().max(120).optional()
const warnings = z.array(z.string().trim().min(1).max(4000)).max(256)
const score = z.number().finite().min(0).max(1)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const workspace = { workspaceRoot: path.optional() }

export const scientificPlottingStyleProfilesInputSchema = z.object({
  ...workspace,
  profileId: z.string().trim().max(160).optional(),
  query: z.string().trim().max(240).optional(),
  referencePath: optionalPath,
  styleSpecPath: optionalPath,
  styleSpec: figureStyleSpecSchema.optional(),
  includeStyleSpec: z.boolean().optional(),
  topK: z.number().int().min(1).max(20).optional()
}).strict()

export const scientificPlottingStyleProfilesOutputSchema: z.ZodType<ScientificPlottingStyleProfilesResult> = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true), status: z.enum(['listed', 'found', 'matched']),
    profiles: z.array(scientificPlottingStyleProfileSummarySchema).max(20),
    total: z.number().int().nonnegative(),
    selectedProfile: scientificPlottingStyleProfileSummarySchema.optional(),
    profileMatches: z.array(scientificPlottingStyleProfileMatchSchema).max(20).optional(),
    referenceProfile: scientificPlottingReferenceProfileSchema.optional(),
    recommendedNextTools: z.array(z.enum(['visual_generate', 'sciforge_invoke', 'image_generation_review_candidate'])).max(3),
    recommendedCapabilityIds: z.array(z.enum(['scientific-plotting.map-data', 'scientific-plotting.render'])).max(2),
    warnings
  }).strict(),
  z.object({
    ok: z.literal(false), status: z.enum(['not_found', 'invalid_request']),
    message: z.string().trim().min(1).max(8000),
    availableProfileIds: z.array(z.string().trim().min(1).max(256)).max(256), warnings
  }).strict()
])

export const scientificPlottingCropBoxSchema = z.object({
  unit: z.enum(['ratio', 'pixel']).optional(),
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite(), height: z.number().finite()
}).strict()
const layerShape = {
  path,
  owner: z.enum(['model', 'code']),
  bounds: scientificPlottingCropBoxSchema.extend({
    width: z.number().finite().positive(), height: z.number().finite().positive()
  }).strict().optional(),
  fit: z.enum(['contain', 'cover', 'stretch']).optional(),
  opacity: z.number().finite().min(0).max(1).optional()
}
export const scientificPlottingCompositeInputSchema = z.object({
  ...workspace,
  visualPlan: controlledPlottingPlanSchema.extend({ route: z.literal('hybrid') }),
  reviewTask: z.string().trim().min(1).max(16000),
  reviewReferencePath: path.optional(),
  layers: z.array(z.object(layerShape).strict()).min(2).max(32),
  canvas: z.object({
    width: z.number().int().min(128).max(4096),
    height: z.number().int().min(128).max(4096),
    background: z.string().trim().min(1).max(120).optional()
  }).strict().optional(),
  figureId: optionalId, outputDir: optionalPath,
  visualDocumentId: optionalId, threadId: optionalId
}).strict().superRefine((input, context) => {
  const sceneOwners = new Set(input.visualPlan.scene?.layers.map((layer) => layer.owner) ?? [])
  if (input.visualPlan.reproducibleInputs.length === 0 && !input.visualPlan.inlineSpecification && !input.visualPlan.scene) {
    context.addIssue({ code: 'custom', path: ['visualPlan', 'reproducibleInputs'], message: 'A locked hybrid handoff requires reproducible inputs, inline specification or a scene.' })
  }
  if (input.visualPlan.lockedElements.length === 0 && !sceneOwners.has('code')) {
    context.addIssue({ code: 'custom', path: ['visualPlan', 'lockedElements'], message: 'A locked hybrid handoff requires code-owned truth.' })
  }
  if (input.visualPlan.modelOwnedElements.length === 0 && !sceneOwners.has('model')) {
    context.addIssue({ code: 'custom', path: ['visualPlan', 'modelOwnedElements'], message: 'A hybrid handoff requires model-owned elements.' })
  }
  if (!input.layers.some((layer) => layer.owner === 'model') || !input.layers.some((layer) => layer.owner === 'code')) {
    context.addIssue({ code: 'custom', path: ['layers'], message: 'Hybrid composition requires both model and code layers.' })
  }
})

export const scientificPlottingCompositeOutputSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true), status: z.literal('composed'),
    outputPath: path, manifestPath: path, artifactManifestPath: path,
    nextCall: z.object({
      tool: z.literal('image_generation_review_candidate'),
      arguments: z.object({ workspaceRoot: path, outputPath: path, manifestPath: path,
        task: z.string().trim().min(1).max(16000), referencePath: path.optional() }).strict()
    }).strict(),
    layers: z.array(z.object({ ...layerShape, resolvedPath: path, sha256: hash }).strict()).min(2).max(32), warnings
  }).strict().superRefine((result, context) => {
    let codeSeen = false
    let modelSeen = false
    for (const [index, layer] of result.layers.entries()) {
      if (layer.owner === 'code') {
        codeSeen = true
        if (layer.opacity !== 1) context.addIssue({ code: 'custom', path: ['layers', index, 'opacity'], message: 'Code-owned truth layers must have full opacity.' })
      } else {
        modelSeen = true
        if (codeSeen) context.addIssue({ code: 'custom', path: ['layers', index], message: 'Model layers must precede code-owned truth layers.' })
      }
    }
    if (!codeSeen || !modelSeen) context.addIssue({ code: 'custom', path: ['layers'], message: 'Hybrid composition requires both owners.' })
  }),
  z.object({
    ok: z.literal(false), status: z.enum(['invalid_request', 'invalid_workspace', 'image_unreadable', 'write_failed']),
    message: z.string().trim().min(1).max(8000), warnings: warnings.optional()
  }).strict()
])

export const scientificPlottingPrepareReferenceInputSchema = z.object({
  ...workspace, sourcePath: path,
  sourceType: z.enum(['image', 'pdf']).optional(),
  page: z.number().int().min(1).max(5000).optional(),
  cropBox: scientificPlottingCropBoxSchema.optional(),
  figureId: optionalId, outputDir: optionalPath,
  dpi: z.number().min(72).max(360).optional(), extractStyle: z.boolean().optional()
}).strict()
const sourceSchema = z.object({
  path, type: z.enum(['image', 'pdf']), page: z.number().int().min(1).max(5000).optional(),
  width: z.number().int().positive(), height: z.number().int().positive()
}).strict()
const pixelCropSchema = scientificPlottingCropBoxSchema.extend({
  unit: z.literal('pixel'), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
  width: z.number().int().positive(), height: z.number().int().positive()
}).strict()
const referenceDetails = {
  source: sourceSchema, cropBox: pixelCropSchema, croppedImagePath: path,
  styleSpecPath: path.optional(), referenceProfile: scientificPlottingReferenceProfileSchema.optional(),
  styleProfileMatches: z.array(scientificPlottingStyleProfileMatchSchema).max(3).optional(),
  recommendedStyleProfile: scientificPlottingStyleProfileSummarySchema.optional(), warnings
}
export const scientificPlottingReferenceManifestSchema = z.object({
  version: z.literal(1), tool: z.literal('scientific_plotting_prepare_reference'),
  createdAt: z.iso.datetime({ offset: true }), requestHash: hash, ...referenceDetails,
  nextWorkflow: z.object({
    styleSpecPath: path.optional(), referencePath: path,
    suggestedStyleProfileId: z.string().trim().min(1).max(256).optional(),
    suggestedProfileTool: z.literal('sciforge_discover'),
    suggestedProfileArguments: z.object({
      capabilityId: z.literal('scientific-plotting.style-profiles'),
      includeSchema: z.literal(true), limit: z.literal(1)
    }).strict(),
    recommendedArguments: z.object({
      referencePath: path, profileId: z.string().trim().min(1).max(256).optional()
    }).strict(),
    suggestedPlanTool: z.literal('visual_generate'), suggestedRenderTool: z.literal('sciforge_invoke'),
    suggestedRenderCapability: z.literal('scientific-plotting.render'),
    suggestedReviewTool: z.literal('image_generation_review_candidate'), guardrails: warnings
  }).strict()
}).strict()
export const scientificPlottingPrepareReferenceOutputSchema: z.ZodType<ScientificPlottingPrepareReferenceResult> = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true), status: z.literal('prepared'), ...referenceDetails,
    referenceManifestPath: path, referenceManifest: scientificPlottingReferenceManifestSchema,
    styleSpec: figureStyleSpecSchema.optional()
  }).strict(),
  z.object({
    ok: z.literal(false), status: z.enum(['invalid_request', 'invalid_workspace', 'unsupported_source', 'pdf_renderer_unavailable', 'crop_failed']),
    message: z.string().trim().min(1).max(8000), stdoutTail: z.string().max(32000).optional(),
    stderrTail: z.string().max(32000).optional(), warnings: warnings.optional()
  }).strict()
])

export const scientificPlottingReviewPacketInputSchema = z.object({
  ...workspace, manifestPaths: z.array(path).min(1).max(30), packetId: optionalId,
  outputDir: optionalPath, title: z.string().trim().max(240).optional(),
  maxItems: z.number().int().min(1).max(30).optional()
}).strict()
export const scientificPlottingReviewPacketItemSchema = z.object({
  manifestPath: path, outputPath: path, template: scientificPlottingTemplateSchema,
  status: z.enum(['rendered', 'repaired', 'review_failed', 'unknown']),
  createdAt: z.iso.datetime({ offset: true }).optional(), styleSimilarity: visualStyleSimilarityMetricSchema.optional(),
  styleRepairSuggested: z.boolean(), repairAttempted: z.boolean(), attempts: z.number().int().nonnegative(), warnings,
  layoutQuality: rendererDiagnosticsSchema.shape.layoutQuality,
  typography: rendererDiagnosticsSchema.shape.typography, notes: warnings, recommendedActions: warnings
}).strict()
export const scientificPlottingReviewPacketSchema = z.object({
  version: z.literal(1), tool: z.literal('scientific_plotting_review_packet'),
  createdAt: z.iso.datetime({ offset: true }), title: z.string().trim().min(1).max(240),
  itemCount: z.number().int().min(1).max(30), items: z.array(scientificPlottingReviewPacketItemSchema).min(1).max(30),
  summary: z.object({
    rendered: z.number().int().nonnegative(), repaired: z.number().int().nonnegative(),
    reviewFailed: z.number().int().nonnegative(), needsAttention: z.number().int().nonnegative(),
    styleRepairSuggested: z.number().int().nonnegative(), bestOverall: score.optional(),
    worstOverall: score.optional(), averageOverall: score.optional(), warnings
  }).strict(), guardrails: warnings
}).strict()
export const scientificPlottingReviewPacketOutputSchema: z.ZodType<ScientificPlottingReviewPacketResult> = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true), status: z.literal('created'), packetPath: path, packetJsonPath: path,
    packet: scientificPlottingReviewPacketSchema, warnings
  }).strict(),
  z.object({
    ok: z.literal(false), status: z.enum(['invalid_request', 'invalid_workspace', 'manifest_read_failed']),
    message: z.string().trim().min(1).max(8000), warnings: warnings.optional()
  }).strict()
])
