import { z } from 'zod'

export const VISUAL_CAPTURE_MAX_PNG_BYTES = 20 * 1_024 * 1_024

export const domainMainVisualCaptureRequestSchema = z.object({
  targetRef: z.string().trim().min(1).max(512),
  annotation: z.enum(['none', 'callout']).default('none'),
  label: z.string().trim().min(1).max(500).optional()
}).strict()

export const domainMainVisualCaptureSuccessSchema = z.object({
  ok: z.literal(true),
  png: z.instanceof(Uint8Array).refine(
    (value) => value.byteLength <= VISUAL_CAPTURE_MAX_PNG_BYTES,
    `PNG cannot exceed ${VISUAL_CAPTURE_MAX_PNG_BYTES} bytes.`
  ),
  width: z.number().int().min(1).max(100_000),
  height: z.number().int().min(1).max(100_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  redacted: z.boolean()
}).strict()

export const domainMainVisualCaptureFailureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      'target-not-found',
      'target-redacted',
      'capture-failed',
      'capture-too-large'
    ]),
    message: z.string().trim().min(1).max(1_000)
  }).strict()
}).strict()

export const domainMainVisualCaptureResultSchema = z.discriminatedUnion('ok', [
  domainMainVisualCaptureSuccessSchema,
  domainMainVisualCaptureFailureSchema
])

export type DomainMainVisualCaptureRequest = z.input<
  typeof domainMainVisualCaptureRequestSchema
>
export type DomainMainVisualCaptureResult = z.infer<
  typeof domainMainVisualCaptureResultSchema
>

/**
 * Captures only a target previously registered with the host visual-context
 * registry. The host owns target lookup, sensitive-target policy, redaction,
 * annotation rendering, and byte limits.
 */
export type DomainMainVisualCaptureHost = Readonly<{
  captureRegisteredTarget: (
    request: DomainMainVisualCaptureRequest
  ) => Promise<DomainMainVisualCaptureResult>
}>
