import { z } from 'zod'

const opaqueRefSuffixPattern = '[A-Za-z0-9_-]{20,}'

export const agentVisualSourceRefSchema = z.string()
  .regex(new RegExp(`^(?:res|artifact|snapshot)_${opaqueRefSuffixPattern}$`, 'u'))

export const agentVisualTargetRefSchema = z.string()
  .regex(new RegExp(`^target_${opaqueRefSuffixPattern}$`, 'u'))

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
  sourceRef: agentVisualSourceRefSchema.optional(),
  targetRef: agentVisualTargetRefSchema.optional(),
  frame: z.number().int().positive().max(1_000_000).optional(),
  task: z.string().trim().min(1).max(16_000),
  intent: z.enum(['describe', 'ocr', 'locate', 'quality-review']).optional(),
  capture: z.enum(['snapshot', 'region']).optional()
}).strict().superRefine((input, context) => {
  if (input.frame && !input.sourceRef) {
    context.addIssue({
      code: 'custom',
      path: ['frame'],
      message: 'A visual frame index requires an opaque sourceRef.'
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
    confidence: z.number().finite().min(0).max(1)
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
