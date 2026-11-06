import { z } from 'zod'
import { artifactVersionRefV1Schema } from '@sciforge/domain-artifact-versions/contract'

const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const path = z.string().min(1).max(4096)
export const modelRequestCaptureSchema = z.object({
  schemaVersion: z.literal(1),
  operation: z.enum(['generation', 'edit']),
  model: z.string().min(1).max(512),
  prompt: z.string().min(1).max(200000),
  promptHash: digest,
  parameters: z.object({
    size: z.string().min(1).max(64), n: z.number().int().positive(),
    seed: z.number().finite().optional(), quality: z.string().max(64).optional(),
    input_fidelity: z.string().max(64).optional()
  }).strict(),
  references: z.array(z.object({
    role: z.enum(['image', 'mask']), origin: z.enum(['workspace', 'derived']), derivedFrom: z.array(digest).min(1).max(16).optional(), path, snapshotPath: path,
    contentDigest: digest, byteLength: z.number().int().nonnegative().max(47 * 1024 * 1024),
    mediaType: z.string().min(1).max(200)
  }).strict()).max(16),
  gaps: z.array(z.string().max(2000)).max(32)
}).strict()
export const visualModelSourceSchema = z.object({
  schemaVersion: z.literal(1), outputHash: digest, manifestDigest: digest,
  request: modelRequestCaptureSchema,
  referenceVersions: z.array(artifactVersionRefV1Schema).max(16)
}).strict()
export type VisualModelSource = z.infer<typeof visualModelSourceSchema>
