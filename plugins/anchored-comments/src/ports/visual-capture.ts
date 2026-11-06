/** Plugin-local adapter for the generic, Host-authorized visual capture service. */
import { z } from 'zod'
import type { DomainMainVisualCaptureHost } from '@sciforge/domain-sdk/visual-capture'

export const captureSourceSchema = z.object({
  instanceId: z.string().min(1).max(256),
  workspaceRoot: z.string().min(1).max(4096),
  threadId: z.string().min(1).max(256),
  windowId: z.string().min(1).max(256),
  targetRef: z.string().min(1).max(512),
  resourcePath: z.string().min(1).max(4096),
  // Host validates this registry revision before capture; pixels are not an atomic revision snapshot.
  validatedRevision: z.number().int().nonnegative(),
  captureRevisionAtomic: z.literal(false),
  capturedAt: z.string().min(1).max(64),
  redactionPolicy: z.literal('registered-target-v1')
}).strict()
export type CaptureSource = z.infer<typeof captureSourceSchema>
export type VisualCapturePort = Readonly<{
  listTargets?: () => Promise<Readonly<{ targets: readonly Readonly<{ targetRef: string; resourcePath: string; label: string }>[] }>>
  captureRegisteredTarget: (request: Parameters<DomainMainVisualCaptureHost['captureRegisteredTarget']>[0] & { expectedResourcePath?: string }) => Promise<Awaited<ReturnType<DomainMainVisualCaptureHost['captureRegisteredTarget']>> & { source?: CaptureSource }>
}>
export type VisualCaptureClient = Readonly<{ invoke(operation: string, input: unknown): Promise<unknown> }>

const targetListSchema = z.object({ targets: z.array(z.object({
  targetRef: z.string().min(1).max(512), resourcePath: z.string().min(1).max(4096), label: z.string().max(4096)
}).strict()).max(1024) }).strict()
const successSchema = z.object({
  ok: z.literal(true), pngBase64: z.string().max(28 * 1024 * 1024),
  width: z.number().int().positive().max(100_000), height: z.number().int().positive().max(100_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive().max(20 * 1024 * 1024),
  redacted: z.boolean(), source: captureSourceSchema
}).strict()

export function createHostVisualCapturePort(client: VisualCaptureClient): VisualCapturePort {
  return {
    async listTargets() { return targetListSchema.parse(await client.invoke('listTargets', {})) },
    async captureRegisteredTarget(request) {
      if (!request.expectedResourcePath) throw new Error('Capture requires the comment canonical resource path.')
      const value = await client.invoke('captureRegisteredTarget', {
        targetRef: request.targetRef, expectedResourcePath: request.expectedResourcePath,
        ...(request.annotation ? { annotation: request.annotation } : {}), ...(request.label ? { label: request.label } : {})
      })
      const failure = z.object({ ok: z.literal(false), error: z.object({ code: z.enum(['target-not-found', 'target-redacted', 'capture-failed', 'capture-too-large']), message: z.string() }).strict() }).strict().safeParse(value)
      if (failure.success) return failure.data
      const parsed = successSchema.parse(value)
      const png = Uint8Array.from(Buffer.from(parsed.pngBase64, 'base64'))
      if (png.byteLength !== parsed.byteLength || Buffer.from(png).toString('base64') !== parsed.pngBase64) throw new Error('Invalid Host PNG encoding or byte count.')
      return { ok: true, png, width: parsed.width, height: parsed.height, sha256: parsed.sha256, redacted: parsed.redacted, source: parsed.source }
    }
  }
}
