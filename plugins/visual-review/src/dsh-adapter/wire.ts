import { z } from 'zod'
import {
  visualReviewApplyStyleReferenceInputSchema,
  visualReviewDocumentInputSchema,
  visualReviewOpenInputSchema,
  visualReviewReadImageInputSchema,
  visualReviewRevisionDecisionInputSchema,
  visualReviewSaveAnnotationsInputSchema,
  visualReviewUpdateContextInputSchema
} from '../core/contract.js'

/**
 * Wire schemas for the runtime-plugin entry, mirrored from the static adapter
 * (packages/domains/visual-review/src/main.ts). For workspace-scoped
 * capabilities the host extension bridge binds input.workspaceRoot to the
 * caller's workspace before dispatch (and the host broker gates workspace
 * scope by caller identity), so the field cannot smuggle a foreign directory
 * into the plugin. The field stays required here so handlers also work when
 * driven directly in tests.
 */

const workspaceRootWireField = z.string().trim().min(1).max(4_096)

export const visualReviewOpenWireSchema = visualReviewOpenInputSchema.extend({
  workspaceRoot: workspaceRootWireField
})

export const visualReviewReadDocumentWireSchema = visualReviewDocumentInputSchema.extend({
  workspaceRoot: workspaceRootWireField
})

export const visualReviewReadImageWireSchema = visualReviewReadImageInputSchema.extend({
  workspaceRoot: workspaceRootWireField
})

export const visualReviewUpdateContextWireSchema = visualReviewUpdateContextInputSchema.extend({
  workspaceRoot: workspaceRootWireField
})

export const visualReviewApplyStyleReferenceWireSchema = visualReviewApplyStyleReferenceInputSchema.extend({
  workspaceRoot: workspaceRootWireField
})

export const visualReviewSaveAnnotationsWireSchema = visualReviewSaveAnnotationsInputSchema.extend({
  workspaceRoot: workspaceRootWireField
})

export const visualReviewExportReviewPacketWireSchema = visualReviewDocumentInputSchema.extend({
  workspaceRoot: workspaceRootWireField
})

export const visualReviewRejectCandidateWireSchema = visualReviewRevisionDecisionInputSchema.extend({
  workspaceRoot: workspaceRootWireField
})

export const visualReviewAcceptCandidateWireSchema = visualReviewRevisionDecisionInputSchema.extend({
  workspaceRoot: workspaceRootWireField
})

// The static boundary validates review evidence timestamps with
// z.string().datetime({ offset: true }). The host broker rebuilds the
// published JSON Schema input with z.fromJSONSchema, whose format: date-time
// mapping drops offset support and would reject valid invocations at the
// broker layer, so the wire schema pins the exact ISO-8601 offset pattern
// instead (pattern survives the JSON Schema round trip unchanged).
const isoDateTimeOffsetPattern =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$/u

const wirePathSchema = z.string().trim().min(1).max(4_096)
const wireSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)

export const visualReviewCreateCandidateWireSchema = z.object({
  workspaceRoot: workspaceRootWireField,
  documentId: z.string().trim().min(1).max(120),
  candidatePath: z.string().trim().min(1).max(4_096)
    .refine((path) => /\.(?:avif|bmp|gif|jpe?g|png|webp)$/iu.test(path), 'Visual Review supports bounded raster images only.'),
  summary: z.string().trim().min(1).max(20_000),
  reviewEvidence: z.object({
    tool: z.literal('image_generation_review_candidate'),
    ok: z.literal(true),
    reviewedArtifactPath: wirePathSchema,
    reviewedArtifactHash: wireSha256Schema,
    reviewedAt: z.string().regex(isoDateTimeOffsetPattern),
    score: z.object({
      overall: z.number().finite().min(0).max(1),
      dimensions: z.number().finite().min(0).max(1),
      nonEmpty: z.number().finite().min(0).max(1),
      background: z.number().finite().min(0).max(1),
      reference: z.number().finite().min(0).max(1).optional(),
      semantic: z.number().finite().min(0).max(1),
      warnings: z.array(z.string().max(10_000)).max(1_000)
    }).strict(),
    semantic: z.object({
      pass: z.literal(true),
      summary: z.string().max(20_000),
      violations: z.array(z.string().max(10_000)).max(1_000),
      repairInstructions: z.array(z.string().max(10_000)).max(1_000)
    }).strict(),
    repairable: z.literal(false),
    warnings: z.array(z.string().max(10_000)).max(1_000)
  }).strict(),
  expectedBaseHash: wireSha256Schema.optional(),
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional()
}).strict()
