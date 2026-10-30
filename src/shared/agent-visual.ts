import { z } from 'zod'

const opaqueRefSuffixPattern = '[A-Za-z0-9_-]{20,}'

export const AGENT_VISUAL_LOOK_DEFAULT_TIMEOUT_MS = 180_000
export const AGENT_VISUAL_LOOK_MIN_TIMEOUT_MS = 30_000
export const AGENT_VISUAL_LOOK_MAX_TIMEOUT_MS = 600_000

export const agentVisualSourceRefSchema = z.string()
  .regex(
    new RegExp(`^(?:res|artifact|snapshot)_${opaqueRefSuffixPattern}$`, 'u'),
    'sourceRef must be an opaque res_/artifact_/snapshot_ reference returned by a SciForge tool; for a workspace file, pass the resourceRef returned by the Workspace Preview open operation.'
  )

export const agentVisualTargetRefSchema = z.string()
  .regex(
    new RegExp(`^target_${opaqueRefSuffixPattern}$`, 'u'),
    'targetRef only accepts opaque target_ references published by surface.current or a browser aria snapshot; res_/artifact_/snapshot_ references are sourceRef values and belong in sourceRef, not targetRef.'
  )

export const agentVisualSnapshotRefSchema = z.string()
  .regex(new RegExp(`^snapshot_${opaqueRefSuffixPattern}$`, 'u'))

export const agentVisualRegionRefSchema = z.string()
  .regex(new RegExp(`^region_${opaqueRefSuffixPattern}$`, 'u'))

export const agentVisualArtifactRefSchema = z.string()
  .regex(new RegExp(`^artifact_${opaqueRefSuffixPattern}$`, 'u'))

export const agentVisualProofRefSchema = z.string()
  .regex(new RegExp(`^visual_proof_${opaqueRefSuffixPattern}$`, 'u'))

export const agentVisualAttestationSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u)

const agentVisualArtifactRelativePathSchema = z.string()
  .trim()
  .min(1)
  .max(4_096)
  .regex(
    /^(?![/\\])(?![A-Za-z]:[/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$)).+$/u,
    'Visual capture destinations must be workspace-relative and cannot traverse parent directories.'
  )

export const agentVisualLookInputSchema = z.object({
  sourceRef: agentVisualSourceRefSchema.optional().describe(
    'Opaque res_/artifact_/snapshot_ reference to inspect. For a workspace file, pass the resourceRef returned by the Workspace Preview open operation. Omit only to inspect the caller-bound current SciForge surface.'
  ),
  targetRef: agentVisualTargetRefSchema.optional().describe(
    'Opaque target_ reference for a live surface or browser DOM target, published by surface.current or a browser aria snapshot. Never pass res_/artifact_/snapshot_ references here; those are sourceRef values.'
  ),
  frame: z.number().int().positive().max(1_000_000).optional(),
  fullPage: z.boolean().optional().describe(
    'Capture the whole scrollable browser page as one bounded visual frame. Requires an authorized browser resource sourceRef.'
  ),
  task: z.string().trim().min(1).max(16_000),
  intent: z.enum(['describe', 'ocr', 'locate', 'quality-review']).optional(),
  capture: z.enum(['snapshot', 'region']).optional(),
  cachePolicy: z.enum(['use', 'bypass', 'refresh']).optional().describe(
    'Visual observation cache policy: use (default) reuses matching evidence; bypass reads fresh evidence without caching; refresh discards matching cached evidence and replaces it with a fresh successful observation. Use refresh or bypass when previous visual evidence appears unreliable.'
  ),
  timeoutMs: z.number()
    .int()
    .min(AGENT_VISUAL_LOOK_MIN_TIMEOUT_MS)
    .max(AGENT_VISUAL_LOOK_MAX_TIMEOUT_MS)
    .optional()
    .describe(
      `End-to-end visual inspection budget in milliseconds. Defaults to ${AGENT_VISUAL_LOOK_DEFAULT_TIMEOUT_MS}. ` +
      'When a retryable timeout returns a suggested timeoutMs, retry the same source and task once with that exact value.'
    )
}).strict().superRefine((input, context) => {
  if (input.frame && !input.sourceRef) {
    context.addIssue({
      code: 'custom',
      path: ['frame'],
      message: 'A visual frame index requires an opaque sourceRef.'
    })
  }
  if (input.fullPage && !input.sourceRef) {
    context.addIssue({
      code: 'custom',
      path: ['fullPage'],
      message: 'A full-page visual frame requires an opaque browser sourceRef.'
    })
  }
  if (input.capture === 'region' && input.intent !== 'locate') {
    context.addIssue({
      code: 'custom',
      path: ['capture'],
      message: 'A required region capture must use intent=locate.'
    })
  }
})

export type AgentVisualLookInput = z.infer<typeof agentVisualLookInputSchema>

export const agentVisualEvidenceClaimSchema = z.object({
  kind: z.enum(['observation', 'issue', 'recommendation']),
  text: z.string().trim().min(1).max(8_000),
  regionRef: agentVisualRegionRefSchema.optional(),
  bbox: z.object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1)
  }).strict().optional(),
  coordinateSpace: z.literal('normalized').optional(),
  imageDimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict().optional(),
  confidence: z.number().finite().min(0).max(1)
}).strict()

export const agentVisualEvidenceSchema = z.object({
  summary: z.string().trim().min(1).max(16_000),
  claims: z.array(agentVisualEvidenceClaimSchema).max(256),
  uncertainties: z.array(z.string().trim().min(1).max(4_000)).max(128),
  structuredResult: z.unknown().optional()
}).strict()

export const agentVisualLookProofSchema = z.object({
  schema: z.literal('sciforge.visual-proof.v1'),
  kind: z.literal('look'),
  status: z.literal('verified'),
  proofRef: agentVisualProofRefSchema,
  parentProofRef: agentVisualProofRefSchema.optional(),
  sourceRef: agentVisualSourceRefSchema.optional(),
  snapshotRef: agentVisualSnapshotRefSchema,
  provider: z.literal('model-router'),
  attestation: agentVisualAttestationSchema,
  createdAt: z.string().datetime({ offset: true })
}).strict()

export const agentVisualLookOutputSchema = z.object({
  snapshotRef: agentVisualSnapshotRefSchema,
  regions: z.array(z.object({
    regionRef: agentVisualRegionRefSchema,
    label: z.string().trim().min(1).max(512).optional(),
    confidence: z.number().finite().min(0).max(1),
    bbox: z.object({
      x: z.number().finite().min(0).max(1),
      y: z.number().finite().min(0).max(1),
      width: z.number().finite().positive().max(1),
      height: z.number().finite().positive().max(1)
    }).strict().optional(),
    coordinateSpace: z.literal('normalized').optional(),
    imageDimensions: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    }).strict().optional()
  }).strict()).max(256),
  evidence: agentVisualEvidenceSchema,
  proof: agentVisualLookProofSchema
}).strict().superRefine((output, context) => {
  if (output.proof.snapshotRef !== output.snapshotRef) {
    context.addIssue({
      code: 'custom',
      path: ['proof', 'snapshotRef'],
      message: 'The visual proof must attest the returned snapshot.'
    })
  }
})

export type AgentVisualLookOutput = z.infer<typeof agentVisualLookOutputSchema>

export const agentVisualCaptureInputSchema = z.object({
  snapshotRef: agentVisualSnapshotRefSchema,
  regionRef: agentVisualRegionRefSchema.optional(),
  purpose: z.enum(['workspace-asset', 'visual-evidence']).optional()
}).strict()

export type AgentVisualCaptureInput = z.infer<typeof agentVisualCaptureInputSchema>

export const agentVisualCaptureProofSchema = z.object({
  schema: z.literal('sciforge.visual-proof.v1'),
  kind: z.literal('capture'),
  status: z.literal('persisted'),
  proofRef: agentVisualProofRefSchema,
  inspectionProofRef: agentVisualProofRefSchema,
  snapshotRef: agentVisualSnapshotRefSchema,
  regionRef: agentVisualRegionRefSchema.optional(),
  artifactRef: agentVisualArtifactRefSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  cropped: z.boolean(),
  createdAt: z.string().datetime({ offset: true })
}).strict().superRefine((proof, context) => {
  if (proof.cropped !== Boolean(proof.regionRef)) {
    context.addIssue({
      code: 'custom',
      path: ['cropped'],
      message: 'Capture proofs must report cropped=true exactly when a region was persisted.'
    })
  }
})

export const agentVisualCaptureOutputSchema = z.object({
  artifactRef: agentVisualArtifactRefSchema,
  relativePath: agentVisualArtifactRelativePathSchema,
  mimeType: z.string().trim().regex(/^image\/[A-Za-z0-9.+-]+$/u),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  changed: z.boolean(),
  proof: agentVisualCaptureProofSchema
}).strict().superRefine((output, context) => {
  if (output.proof.artifactRef !== output.artifactRef) {
    context.addIssue({
      code: 'custom',
      path: ['proof', 'artifactRef'],
      message: 'The visual proof must attest the returned artifact.'
    })
  }
  if (output.proof.sha256 !== output.sha256) {
    context.addIssue({
      code: 'custom',
      path: ['proof', 'sha256'],
      message: 'The visual proof digest must match the returned artifact digest.'
    })
  }
})

export type AgentVisualCaptureOutput = z.infer<typeof agentVisualCaptureOutputSchema>
