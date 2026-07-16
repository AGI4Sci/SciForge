import { z } from 'zod'
import {
  capabilityResourceBindingSchema,
  type CapabilityResourceBinding
} from './capability-broker'

export const VISIBLE_CONTEXT_SCHEMA_VERSION = 3
export const VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION = 2
export const VISIBLE_CONTEXT_MAX_COMPONENTS = 64
export const VISIBLE_CONTEXT_MAX_RESOURCES = 64
export const VISIBLE_CONTEXT_MAX_VISUAL_TARGETS = 64
export const VISIBLE_CONTEXT_DEFAULT_STALE_AFTER_MS = 5_000

const maxPathSchema = z.string().trim().min(1).max(4096)
const timestampSchema = z.string().datetime({ offset: true })
const requestIdSchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9._-]+$/)
const snapshotTokenSchema = z.string().trim().regex(/^vc_[a-f0-9]{64}$/u)
const optionalStringSchema = (max: number): z.ZodOptional<z.ZodString> =>
  z.string().trim().max(max).optional()

export const visibleContextBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive()
}).strict()

export type VisibleContextBounds = z.infer<typeof visibleContextBoundsSchema>

export const visualContextTargetSchema = z.object({
  id: z.string().trim().min(1).max(256),
  kind: z.enum(['component', 'document-page', 'region', 'window']),
  contentType: optionalStringSchema(128),
  bounds: visibleContextBoundsSchema.optional(),
  page: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  redact: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict().superRefine((target, context) => {
  if (target.kind !== 'window' && !target.bounds) {
    context.addIssue({
      code: 'custom',
      path: ['bounds'],
      message: 'Element visual targets require CSS viewport bounds.'
    })
  }
  if (target.kind === 'document-page' && target.page === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['page'],
      message: 'Document-page visual targets require a page number.'
    })
  }
  if (target.redact && !target.bounds) {
    context.addIssue({
      code: 'custom',
      path: ['bounds'],
      message: 'Redaction targets require CSS viewport bounds.'
    })
  }
})

export type VisualContextTarget = z.infer<typeof visualContextTargetSchema>

type VisibleContextResourceBase = {
  kind: string
  role?: string
  title?: string
  accessHint?: string
  resourceUri?: string
  workspaceRoot?: string
  path?: string
  relativePath?: string
  name?: string
  mimeType?: string
  fileKind?: string
  size?: number
  mtimeMs?: number
  annotationCount?: number
  threadCount?: number
  openThreadCount?: number
  selectedThreadId?: string | null
  updatedAt?: string
  capability?: CapabilityResourceBinding
  metadata?: Record<string, unknown>
}

export type VisibleContextVisualSnapshotResource = VisibleContextResourceBase & {
  kind: 'visualSnapshot'
  role: 'window' | 'target'
  path: string
  mimeType: 'image/png'
  capturedAt: string
  width: number
  height: number
  scaleFactor: number
  windowId: string
  revision: number
  componentId?: string
  targetId?: string
  target?: VisualContextTarget
}

export type VisibleContextResource = VisibleContextResourceBase | VisibleContextVisualSnapshotResource

export type VisibleContextFreshness = {
  stale: boolean
  ageMs: number
  staleAfterMs: number
}

export type VisibleContextComponentSnapshot = {
  id: string
  region: string
  component: string
  title?: string
  visible: boolean
  priority?: number
  updatedAt: string
  summary: string
  resources?: VisibleContextResource[]
  visualTargets?: VisualContextTarget[]
  state?: Record<string, unknown>
}

export type VisibleContextSnapshot = {
  schemaVersion: typeof VISIBLE_CONTEXT_SCHEMA_VERSION
  windowId: string
  revision: number
  snapshotToken?: string
  publishedAt: string
  freshness: VisibleContextFreshness
  activeThreadId?: string | null
  workspaceRoot?: string
  route?: string
  components: VisibleContextComponentSnapshot[]
}

export type VisibleContextPublishInput = Omit<VisibleContextSnapshot, 'windowId' | 'snapshotToken'>

const visibleContextResourceBaseSchema = z.object({
  kind: z.string().trim().min(1).max(128),
  role: optionalStringSchema(128),
  title: optionalStringSchema(256),
  accessHint: optionalStringSchema(128),
  resourceUri: optionalStringSchema(1024),
  workspaceRoot: maxPathSchema.optional(),
  path: maxPathSchema.optional(),
  relativePath: maxPathSchema.optional(),
  name: optionalStringSchema(512),
  mimeType: optionalStringSchema(128),
  fileKind: optionalStringSchema(128),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional(),
  annotationCount: z.number().int().nonnegative().optional(),
  threadCount: z.number().int().nonnegative().optional(),
  openThreadCount: z.number().int().nonnegative().optional(),
  selectedThreadId: z.string().trim().max(256).nullable().optional(),
  updatedAt: optionalStringSchema(128),
  capability: capabilityResourceBindingSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict()

export const visibleContextVisualSnapshotResourceSchema = visibleContextResourceBaseSchema.extend({
  kind: z.literal('visualSnapshot'),
  role: z.enum(['window', 'target']),
  path: maxPathSchema.refine(
    (value) => value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(value),
    {
    message: 'Visual snapshot paths must be absolute.'
    }
  ),
  mimeType: z.literal('image/png'),
  capturedAt: timestampSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scaleFactor: z.number().finite().positive(),
  windowId: z.string().trim().min(1).max(256),
  revision: z.number().int().nonnegative(),
  componentId: optionalStringSchema(256),
  targetId: optionalStringSchema(256),
  target: visualContextTargetSchema.optional()
}).strict()

const visibleContextNonVisualResourceSchema = visibleContextResourceBaseSchema.refine(
  (resource) => resource.kind !== 'visualSnapshot',
  { message: 'visualSnapshot resources must use the visual snapshot resource contract.' }
)

export const visibleContextResourceSchema = z.union([
  visibleContextVisualSnapshotResourceSchema,
  visibleContextNonVisualResourceSchema
])

export const visibleContextFreshnessSchema = z.object({
  stale: z.boolean(),
  ageMs: z.number().int().nonnegative(),
  staleAfterMs: z.number().int().positive().max(300_000)
}).strict()

export const visibleContextComponentSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(256),
  region: z.string().trim().min(1).max(128),
  component: z.string().trim().min(1).max(128),
  title: optionalStringSchema(256),
  visible: z.boolean(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  updatedAt: timestampSchema,
  summary: z.string().trim().max(2000),
  resources: z.array(visibleContextResourceSchema).max(VISIBLE_CONTEXT_MAX_RESOURCES).optional(),
  visualTargets: z.array(visualContextTargetSchema).max(VISIBLE_CONTEXT_MAX_VISUAL_TARGETS).optional(),
  state: z.record(z.string(), z.unknown()).optional()
}).strict()

export const visibleContextSnapshotSchema = z.object({
  schemaVersion: z.literal(VISIBLE_CONTEXT_SCHEMA_VERSION),
  windowId: z.string().trim().min(1).max(256),
  revision: z.number().int().nonnegative(),
  snapshotToken: snapshotTokenSchema.optional(),
  publishedAt: timestampSchema,
  freshness: visibleContextFreshnessSchema,
  activeThreadId: z.string().trim().max(256).nullable().optional(),
  workspaceRoot: maxPathSchema.optional(),
  route: z.string().trim().max(128).optional(),
  components: z.array(visibleContextComponentSnapshotSchema).max(VISIBLE_CONTEXT_MAX_COMPONENTS)
}).strict()

export const visibleContextPublishInputSchema = visibleContextSnapshotSchema.omit({
  windowId: true,
  snapshotToken: true
})

const visualCaptureBaseRequestSchema = z.object({
  requestId: requestIdSchema,
  snapshotToken: snapshotTokenSchema,
  windowId: z.string().trim().min(1).max(256),
  revision: z.number().int().nonnegative(),
  activeThreadId: z.string().trim().max(256).nullable().optional()
}).strict()

export const visibleContextCaptureRequestSchema = z.discriminatedUnion('scope', [
  visualCaptureBaseRequestSchema.extend({ scope: z.literal('window') }).strict(),
  visualCaptureBaseRequestSchema.extend({
    scope: z.literal('target'),
    componentId: z.string().trim().min(1).max(256),
    targetId: z.string().trim().min(1).max(256)
  }).strict()
])

export type VisibleContextCaptureRequest = z.infer<typeof visibleContextCaptureRequestSchema>

export const visibleContextCaptureResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    requestId: requestIdSchema,
    resource: visibleContextVisualSnapshotResourceSchema
  }).strict(),
  z.object({
    ok: z.literal(false),
    requestId: requestIdSchema,
    error: z.object({
      code: z.string().trim().min(1).max(128),
      message: z.string().trim().min(1).max(1000),
      retryable: z.boolean()
    }).strict()
  }).strict()
])

export type VisibleContextCaptureResult = z.infer<typeof visibleContextCaptureResultSchema>

export const visibleContextCapturePreviewRequestSchema = z.object({
  path: maxPathSchema
}).strict()

export type VisibleContextCapturePreviewRequest = z.infer<typeof visibleContextCapturePreviewRequestSchema>

export type VisibleContextCapturePreviewResult =
  | {
      ok: true
      path: string
      dataUrl: string
      mimeType: 'image/png'
      size: number
    }
  | { ok: false; message: string }

const visibleContextCaptureBrokerBaseSchema = z.object({
  schemaVersion: z.literal(VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION),
  requestId: requestIdSchema,
  requestedAt: timestampSchema,
  expiresAt: timestampSchema,
  snapshotToken: snapshotTokenSchema,
  windowId: z.string().trim().min(1).max(256),
  revision: z.number().int().nonnegative(),
  activeThreadId: z.string().trim().max(256).nullable().optional()
}).strict()

export const visibleContextCaptureBrokerRequestSchema = z.discriminatedUnion('scope', [
  visibleContextCaptureBrokerBaseSchema.extend({ scope: z.literal('window') }).strict(),
  visibleContextCaptureBrokerBaseSchema.extend({
    scope: z.literal('target'),
    componentId: z.string().trim().min(1).max(256),
    targetId: z.string().trim().min(1).max(256)
  }).strict()
])

export type VisibleContextCaptureBrokerRequest = z.infer<typeof visibleContextCaptureBrokerRequestSchema>

const visibleContextCaptureBrokerResponseBaseSchema = z.object({
  schemaVersion: z.literal(VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION),
  requestId: requestIdSchema,
  completedAt: timestampSchema
}).strict()

export const visibleContextCaptureBrokerResponseSchema = z.discriminatedUnion('ok', [
  visibleContextCaptureBrokerResponseBaseSchema.extend({
    ok: z.literal(true),
    capture: visibleContextVisualSnapshotResourceSchema
  }).strict(),
  visibleContextCaptureBrokerResponseBaseSchema.extend({
    ok: z.literal(false),
    error: z.object({
      code: z.string().trim().min(1).max(128),
      message: z.string().trim().min(1).max(1000),
      retryable: z.boolean()
    }).strict()
  }).strict()
])

export type VisibleContextCaptureBrokerResponse = z.infer<typeof visibleContextCaptureBrokerResponseSchema>

export function emptyVisibleContextSnapshot(
  publishedAt = new Date(0).toISOString(),
  windowId = 'unavailable'
): VisibleContextSnapshot {
  return {
    schemaVersion: VISIBLE_CONTEXT_SCHEMA_VERSION,
    windowId,
    revision: 0,
    publishedAt,
    freshness: {
      stale: true,
      ageMs: Math.max(0, Date.now() - Date.parse(publishedAt)),
      staleAfterMs: VISIBLE_CONTEXT_DEFAULT_STALE_AFTER_MS
    },
    components: []
  }
}
