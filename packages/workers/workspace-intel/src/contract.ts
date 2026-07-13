import { z } from 'zod'
import type { VisualInspectionEvidence } from './visual-inspection.js'

export const WORKSPACE_TREE_RESOURCE_URI = 'workspace://tree'
export const WORKSPACE_FILE_RESOURCE_URI_TEMPLATE = 'workspace://file/{+path}'
export const VISIBLE_CONTEXT_RESOURCE_URI = 'sciforge://visible-context'
export const VISIBLE_CONTEXT_SCHEMA_VERSION = 2
export const VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION = 1

export const WORKSPACE_INTEL_DEFAULT_READ_BYTES = 64 * 1024
export const WORKSPACE_INTEL_MAX_READ_BYTES = 1_500_000
export const WORKSPACE_INTEL_DEFAULT_PREVIEW_CHARS = 8_000
export const WORKSPACE_INTEL_DEFAULT_LIST_LIMIT = 200
export const WORKSPACE_INTEL_MAX_LIST_LIMIT = 2_000
export const WORKSPACE_INTEL_MAX_TREE_DEPTH = 12
export const WorkspaceIntelToolNames = [
  'gui_visible_context',
  'gui_visual_capture',
  'gui_workspace_list',
  'gui_workspace_tree',
  'gui_workspace_read',
  'gui_workspace_preview',
  'gui_workspace_reference_list',
  'gui_workspace_reference_preview',
  'gui_workspace_skill_list',
  'gui_workspace_skill_read'
] as const

export type WorkspaceIntelToolName = typeof WorkspaceIntelToolNames[number]

export type WorkspaceIntelErrorCode =
  | 'workspace_root_required'
  | 'workspace_root_not_found'
  | 'workspace_root_mismatch'
  | 'path_required'
  | 'path_outside_workspace'
  | 'path_not_found'
  | 'not_directory'
  | 'is_directory'
  | 'binary_file'
  | 'invalid_request'
  | 'skill_not_found'
  | 'visible_context_unavailable'
  | 'visual_capture_unavailable'
  | 'visual_capture_timeout'
  | 'visual_capture_failed'
  | 'invalid_visual_capture_request'
  | 'stale_visible_context'
  | 'visual_target_not_found'
  | 'visual_target_bounds_unavailable'
  | 'visual_capture_request_expired'
  | 'visual_capture_broker_failed'
  | 'visual_inspection_unavailable'
  | 'visual_inspection_invalid'
  | 'read_failed'

export type WorkspaceIntelError = {
  code: WorkspaceIntelErrorCode
  message: string
  retryable: boolean
  suggestedFix?: string
}

export type WorkspaceIntelFailure = {
  ok: false
  error: WorkspaceIntelError
}

export type WorkspaceEntryKind = 'file' | 'directory' | 'symlink' | 'other'
export type WorkspaceReferenceKind = 'file' | 'directory' | 'text' | 'image' | 'pdf' | 'binary' | 'symlink' | 'other'
export type WorkspaceSkillScope = 'project' | 'configured'

export type WorkspaceEntry = {
  name: string
  relativePath: string
  kind: WorkspaceEntryKind
  targetKind?: WorkspaceEntryKind
  targetInsideWorkspace?: boolean
  size?: number
  mtimeMs?: number
  mimeType?: string
  resourceUri?: string
}

export type WorkspaceListResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  root: WorkspaceEntry
  entries: WorkspaceEntry[]
  limit: number
  cursor?: string
  nextCursor?: string
  truncated: boolean
}

export type WorkspaceTreeNode = WorkspaceEntry & {
  children?: WorkspaceTreeNode[]
  childrenTruncated?: boolean
}

export type WorkspaceTreeResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  tree: WorkspaceTreeNode
  maxDepth: number
  entryCount: number
  truncated: boolean
}

export type WorkspaceReadResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  relativePath: string
  name: string
  kind: 'text'
  mimeType: string
  encoding: 'utf8'
  size: number
  mtimeMs: number
  offset: number
  bytesRead: number
  content: string
  truncated: boolean
  nextOffset?: number
  resourceUri: string
}

export type WorkspacePreviewResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  relativePath: string
  name: string
  kind: WorkspaceReferenceKind
  mimeType?: string
  size?: number
  mtimeMs?: number
  contentSummary: string
  content?: string
  children?: WorkspaceEntry[]
  truncated: boolean
  resourceUri?: string
}

export type WorkspaceReference = {
  name: string
  relativePath: string
  kind: WorkspaceReferenceKind
  size?: number
  mtimeMs?: number
  mimeType?: string
  resourceUri?: string
}

export type WorkspaceReferenceListResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  references: WorkspaceReference[]
  limit: number
  cursor?: string
  nextCursor?: string
  truncated: boolean
}

export type WorkspaceReferencePreviewResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  reference: WorkspaceReference
  preview: Omit<Extract<WorkspacePreviewResult, { ok: true }>, 'workspaceRoot'>
}

export type WorkspaceSkillSummary = {
  id: string
  name: string
  scope: WorkspaceSkillScope
  legacy: boolean
  description?: string
  packageRelativePath?: string
  entryRelativePath?: string
  entryResourceUri?: string
}

export type WorkspaceSkillListResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot?: string
  skills: WorkspaceSkillSummary[]
  validationErrors: Array<{ root: string; message: string }>
}

export type WorkspaceSkillReadResult = WorkspaceIntelFailure | {
  ok: true
  skill: WorkspaceSkillSummary
  content: string
  size: number
  truncated: boolean
  nextOffset?: number
}

export type VisibleContextResource = {
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
  metadata?: Record<string, unknown>
}

export type VisualContextTarget = {
  id: string
  kind: 'component' | 'document-page' | 'region' | 'window'
  contentType?: string
  bounds?: { x: number; y: number; width: number; height: number }
  page?: number
  active?: boolean
  metadata?: Record<string, unknown>
}

export type VisibleContextVisualSnapshotResource = VisibleContextResource & {
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

export type VisibleContextComponent = {
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

export type VisibleContextResult = WorkspaceIntelFailure | {
  ok: true
  snapshotPath?: string
  windowId?: string
  revision?: number
  publishedAt?: string
  freshness?: {
    stale: boolean
    ageMs: number
    staleAfterMs: number
  }
  activeThreadId?: string | null
  workspaceRoot?: string
  route?: string
  components: VisibleContextComponent[]
  componentCount: number
  unavailable?: boolean
  message?: string
}

export type VisualCaptureResult = WorkspaceIntelFailure | {
  ok: true
  requestId: string
  resource: VisibleContextVisualSnapshotResource
  inspection?: VisualInspectionEvidence
}

export const WorkspaceRootInputSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4096).optional()
}).strict()

export const WorkspaceListInputSchema = WorkspaceRootInputSchema.extend({
  path: z.string().trim().max(4096).optional(),
  recursive: z.boolean().optional(),
  depth: z.number().int().min(0).max(WORKSPACE_INTEL_MAX_TREE_DEPTH).optional(),
  limit: z.number().int().min(1).max(WORKSPACE_INTEL_MAX_LIST_LIMIT).optional(),
  cursor: z.string().trim().min(1).max(64).optional(),
  includeHidden: z.boolean().optional()
}).strict()

export const WorkspaceTreeInputSchema = WorkspaceRootInputSchema.extend({
  path: z.string().trim().max(4096).optional(),
  depth: z.number().int().min(0).max(WORKSPACE_INTEL_MAX_TREE_DEPTH).optional(),
  limit: z.number().int().min(1).max(WORKSPACE_INTEL_MAX_LIST_LIMIT).optional(),
  includeHidden: z.boolean().optional()
}).strict()

export const WorkspaceReadInputSchema = WorkspaceRootInputSchema.extend({
  path: z.string().trim().min(1).max(4096),
  offset: z.number().int().min(0).optional(),
  maxBytes: z.number().int().min(1).max(WORKSPACE_INTEL_MAX_READ_BYTES).optional()
}).strict()

export const WorkspacePreviewInputSchema = WorkspaceRootInputSchema.extend({
  path: z.string().trim().max(4096).optional(),
  maxChars: z.number().int().min(1).max(WORKSPACE_INTEL_DEFAULT_PREVIEW_CHARS).optional()
}).strict()

export const WorkspaceReferenceListInputSchema = WorkspaceListInputSchema

export const WorkspaceReferencePreviewInputSchema = WorkspaceRootInputSchema.extend({
  path: z.string().trim().min(1).max(4096),
  maxChars: z.number().int().min(1).max(WORKSPACE_INTEL_DEFAULT_PREVIEW_CHARS).optional()
}).strict()

export const WorkspaceSkillListInputSchema = WorkspaceRootInputSchema

export const WorkspaceSkillReadInputSchema = WorkspaceRootInputSchema.extend({
  skillId: z.string().trim().min(1).max(256),
  offset: z.number().int().min(0).optional(),
  maxBytes: z.number().int().min(1).max(WORKSPACE_INTEL_MAX_READ_BYTES).optional()
}).strict()

export const VisibleContextInputSchema = z.object({
  includeHidden: z.boolean().optional(),
  region: z.string().trim().min(1).max(128).optional(),
  componentId: z.string().trim().min(1).max(256).optional()
}).strict()

export const VisualCaptureInputSchema = z.object({
  scope: z.enum(['window', 'target']),
  componentId: z.string().trim().min(1).max(256).optional(),
  targetId: z.string().trim().min(1).max(256).optional(),
  requireSemanticInspection: z.boolean().optional(),
  inspectionPrompt: z.string().trim().min(1).max(16_000).optional(),
  truthLockedElements: z.array(z.string().trim().min(1).max(1_000)).max(64).optional()
}).strict().superRefine((request, context) => {
  if (request.scope === 'target' && (!request.componentId || !request.targetId)) {
    context.addIssue({
      code: 'custom',
      path: ['targetId'],
      message: 'Target captures require both componentId and targetId.'
    })
  }
  if (request.scope === 'window' && (request.componentId || request.targetId)) {
    context.addIssue({
      code: 'custom',
      path: ['scope'],
      message: 'Window captures cannot include target identifiers.'
    })
  }
})

const timestampSchema = z.string().datetime({ offset: true })
const absolutePathSchema = z.string().trim().min(1).max(4096).refine(
  (value) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value),
  { message: 'Visual snapshot paths must be absolute.' }
)

export const VisualContextTargetSchema = z.object({
  id: z.string().trim().min(1).max(256),
  kind: z.enum(['component', 'document-page', 'region', 'window']),
  contentType: z.string().trim().max(128).optional(),
  bounds: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive()
  }).strict().optional(),
  page: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict().superRefine((target, context) => {
  if (target.kind !== 'window' && !target.bounds) {
    context.addIssue({ code: 'custom', path: ['bounds'], message: 'Element visual targets require bounds.' })
  }
  if (target.kind === 'document-page' && target.page === undefined) {
    context.addIssue({ code: 'custom', path: ['page'], message: 'Document-page visual targets require a page number.' })
  }
})

export const VisibleContextVisualSnapshotResourceSchema = z.object({
  kind: z.literal('visualSnapshot'),
  role: z.enum(['window', 'target']),
  title: z.string().trim().max(256).optional(),
  accessHint: z.string().trim().max(128).optional(),
  resourceUri: z.string().trim().max(1024).optional(),
  workspaceRoot: z.string().trim().min(1).max(4096).optional(),
  path: absolutePathSchema,
  relativePath: z.string().trim().min(1).max(4096).optional(),
  name: z.string().trim().max(512).optional(),
  mimeType: z.literal('image/png'),
  fileKind: z.string().trim().max(128).optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional(),
  annotationCount: z.number().int().nonnegative().optional(),
  threadCount: z.number().int().nonnegative().optional(),
  openThreadCount: z.number().int().nonnegative().optional(),
  selectedThreadId: z.string().trim().max(256).nullable().optional(),
  updatedAt: z.string().trim().max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  capturedAt: timestampSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scaleFactor: z.number().finite().positive(),
  windowId: z.string().trim().min(1).max(256),
  revision: z.number().int().nonnegative(),
  componentId: z.string().trim().min(1).max(256).optional(),
  targetId: z.string().trim().min(1).max(256).optional(),
  target: VisualContextTargetSchema.optional()
}).strict()

export const VisualCaptureBrokerResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    schemaVersion: z.literal(VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION),
    requestId: z.string().trim().min(1).max(256),
    completedAt: timestampSchema,
    ok: z.literal(true),
    capture: VisibleContextVisualSnapshotResourceSchema
  }).strict(),
  z.object({
    schemaVersion: z.literal(VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION),
    requestId: z.string().trim().min(1).max(256),
    completedAt: timestampSchema,
    ok: z.literal(false),
    error: z.object({
      code: z.string().trim().min(1).max(128),
      message: z.string().trim().min(1).max(1000),
      retryable: z.boolean()
    }).strict()
  }).strict()
])

export type WorkspaceListInput = z.infer<typeof WorkspaceListInputSchema>
export type WorkspaceTreeInput = z.infer<typeof WorkspaceTreeInputSchema>
export type WorkspaceReadInput = z.infer<typeof WorkspaceReadInputSchema>
export type WorkspacePreviewInput = z.infer<typeof WorkspacePreviewInputSchema>
export type WorkspaceReferenceListInput = z.infer<typeof WorkspaceReferenceListInputSchema>
export type WorkspaceReferencePreviewInput = z.infer<typeof WorkspaceReferencePreviewInputSchema>
export type WorkspaceSkillListInput = z.infer<typeof WorkspaceSkillListInputSchema>
export type WorkspaceSkillReadInput = z.infer<typeof WorkspaceSkillReadInputSchema>
export type VisibleContextInput = z.infer<typeof VisibleContextInputSchema>
export type VisualCaptureInput = z.infer<typeof VisualCaptureInputSchema>
export type VisualCaptureBrokerResponse = z.infer<typeof VisualCaptureBrokerResponseSchema>

export function workspaceFileResourceUri(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const encodedPath = normalized
    .split('/')
    .filter((part) => part.length > 0)
    .map(encodeURIComponent)
    .join('/')
  return `workspace://file/${encodedPath}`
}
