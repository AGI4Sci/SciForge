/**
 * Plugin-owned DSH tool definitions. The exact-version Host grant table and
 * manifest declare workspace scope for every operation. The Host must bind the
 * caller workspace before invocation; a model-provided path is not authority.
 * Capability input is parsed strictly after the Host-bound field is stripped.
 * Approval declarations raise, never lower, the Host's effect-derived floor.
 * Rendering is data/text only, independent of any legacy UI or static domain.
 */
import { z } from 'zod'
import {
  ANCHORED_COMMENT_CAPABILITY_IDS,
  anchoredCommentCaptureRequestSchema,
  anchoredCommentListInputSchema,
  anchoredCommentReadAssetInputSchema,
  anchoredCommentThreadIdInputSchema,
  anchoredCommentUpsertInputSchema,
  feedbackSubmissionRequestSchema,
  feedbackSubmissionStatusRequestSchema
} from '../core/contract.js'
import type { AnchoredCommentsOperations } from '../core/operations.js'
import type { VisualCapturePort } from '../ports/visual-capture.js'

/** Host-side grant table this plugin expects. Configured by the host, not the plugin. */
export const EXPECTED_HOST_GRANTS = Object.freeze({
  anchored_comments_list: {
    id: ANCHORED_COMMENT_CAPABILITY_IDS.list,
    effect: 'read',
    // Every read is bound to the same authenticated caller workspace.
    scope: 'workspace'
  },
  anchored_comments_get: {
    id: ANCHORED_COMMENT_CAPABILITY_IDS.get,
    effect: 'read',
    scope: 'workspace'
  },
  anchored_comments_upsert: {
    id: ANCHORED_COMMENT_CAPABILITY_IDS.upsert,
    scope: 'workspace',
    effect: 'workspace-write'
  },
  anchored_comments_delete: {
    id: ANCHORED_COMMENT_CAPABILITY_IDS.delete,
    scope: 'workspace',
    effect: 'workspace-write',
    // Host projection may raise this level, never lower confirmation.
    approval: 'confirmation'
  },
  anchored_comments_read_asset: {
    id: ANCHORED_COMMENT_CAPABILITY_IDS.readAsset,
    effect: 'read',
    scope: 'workspace'
  },
  anchored_comments_capture: {
    id: ANCHORED_COMMENT_CAPABILITY_IDS.capture,
    scope: 'workspace',
    effect: 'workspace-write'
  },
  anchored_comments_submit_feedback: {
    id: ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback,
    scope: 'workspace',
    effect: 'external-write',
    approval: 'confirmation'
  },
  anchored_comments_feedback_status: {
    id: ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus,
    effect: 'read',
    scope: 'workspace'
  }
} as const)

export type DshToolParameter = Readonly<{
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'json'
  required?: true
  items?: Readonly<{ type: 'string' }>
  enum?: readonly string[]
}>

export type DshToolDefinition = Readonly<{
  name: string
  description: string
  parameters: Readonly<Record<string, DshToolParameter>>
  output: Readonly<{
    schema: Readonly<Record<string, unknown>>
    render: (args: unknown, value: unknown) => readonly { type: 'text'; text: string }[]
  }>
  execute: (args: unknown) => Promise<unknown>
}>

const render = (_args: unknown, value: unknown): readonly { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value) }
]

/** Plain JSON Schema: results are validated precisely by the vendored zod schemas. */
const OBJECT_OUTPUT = Object.freeze({ type: 'object', additionalProperties: true })

const workspaceArgumentSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096)
}).passthrough()

/** Strips the tool-level workspace argument; every other key is capability input. */
export function splitWorkspaceArgument(
  args: unknown
): Readonly<{ input: unknown; workspaceRoot: string }> {
  const parsed = workspaceArgumentSchema.parse(args ?? {})
  const { workspaceRoot, __sciforgeHostWorkspace: _transportMarker, ...input } = parsed
  // Transport metadata is not business input or proof of authorization. The
  // authenticated Host caller and exact-version grant authorize this call.
  return Object.freeze({ input, workspaceRoot })
}

const WORKSPACE_ROOT: DshToolParameter = { type: 'string', required: true }
const THREAD_ID: DshToolParameter = { type: 'string', required: true }

const LIST_FILTERS = {
  workspaceKey: { type: 'string' },
  targetKey: { type: 'string' },
  purpose: { type: 'string', enum: ['research', 'product_feedback'] },
  status: {
    type: 'string',
    enum: ['open', 'attached', 'ai_responded', 'awaiting_verification', 'resolved']
  },
  includeResolved: { type: 'boolean' }
} as const satisfies Record<string, DshToolParameter>

/**
 * The tool table. `inputSchemaKey` documents which strict contract schema the
 * operation parses; the module-level assertion below keeps the table honest.
 */
export function anchoredCommentsTools(
  operations: AnchoredCommentsOperations,
  visualCapture?: VisualCapturePort
): readonly DshToolDefinition[] {
  const invoke = (capabilityId: string) => async (args: unknown) => {
    const { input, workspaceRoot } = splitWorkspaceArgument(args)
    return operations.invoke(capabilityId, input, workspaceRoot)
  }
  const capture = async (args: unknown): Promise<unknown> => {
    const { input, workspaceRoot } = splitWorkspaceArgument(args)
    const { action, ...captureInput } = z.object({
      action: z.enum(['enumerate', 'capture']).default('capture')
    }).passthrough().parse(input)
    if (action === 'enumerate') {
      z.object({}).strict().parse(captureInput)
      if (!visualCapture?.listTargets) {
        return { ok: false, message: 'Safe registered-target capture is unavailable in this build.' }
      }
      return visualCapture.listTargets()
    }
    // Production capture attaches to an existing canonical document anchor.
    // The Host port validates source data; engineering factory ports remain
    // usable without weakening this production tool requirement.
    z.object({ threadId: z.string().trim().min(1).max(256) }).passthrough().parse(captureInput)
    return operations.invoke(ANCHORED_COMMENT_CAPABILITY_IDS.capture, captureInput, workspaceRoot)
  }
  return [
    {
      name: 'anchored_comments_list',
      description:
        'Lists package-owned anchored comment threads for one workspace through a bounded filter. Call without a resourceRef; filters belong in the arguments.',
      parameters: { ...LIST_FILTERS, workspaceRoot: WORKSPACE_ROOT },
      output: { schema: OBJECT_OUTPUT, render },
      execute: invoke(ANCHORED_COMMENT_CAPABILITY_IDS.list)
    },
    {
      name: 'anchored_comments_get',
      description:
        'Reads one anchored comment thread, including its anchor, capture bundle, messages and feedback state.',
      parameters: { threadId: THREAD_ID, workspaceRoot: WORKSPACE_ROOT },
      output: { schema: OBJECT_OUTPUT, render },
      execute: invoke(ANCHORED_COMMENT_CAPABILITY_IDS.get)
    },
    {
      name: 'anchored_comments_upsert',
      description:
        'Persists a validated thread. Required fields: schemaVersion=1, id, workspaceKey (caller workspace), purpose=research, anchor={targetKey,targetLabel,canonical:{kind:research,resourceKind:document,resourceId:relative path,selection:{quote:exact paragraph,lineStart,lineEnd},contentDigest:optional opaque preview snapshot or digest identifier (not necessarily raw file SHA-256; omit if unsure)},bounds:{x:0,y:0,width:1,height:1}}, capture={capturedAt:ISO,appVersion,platform,viewport:{width:1,height:1,scaleFactor:1},targetLabel,targetBounds:{x:0,y:0,width:1,height:1},unavailableReason:not yet captured}, messages=[{id,authorKind:ai,body,createdAt:ISO,updatedAt:ISO}], status=open, anchorResolution=resolved, feedback={state:local}, createdAt:ISO, updatedAt:ISO. For updates read the existing thread first and preserve canonical target, createdAt and evidence. Use capture with threadId to attach real evidence; never invent image bytes or source.',
      parameters: {
        thread: { type: 'json', required: true },
        workspaceRoot: WORKSPACE_ROOT
      },
      output: { schema: OBJECT_OUTPUT, render },
      execute: invoke(ANCHORED_COMMENT_CAPABILITY_IDS.upsert)
    },
    {
      name: 'anchored_comments_delete',
      description:
        'Deletes one comment thread and its unreferenced evidence assets. Requires real Host confirmation; denial must not execute.',
      parameters: { threadId: THREAD_ID, workspaceRoot: WORKSPACE_ROOT },
      output: { schema: OBJECT_OUTPUT, render },
      execute: invoke(ANCHORED_COMMENT_CAPABILITY_IDS.delete)
    },
    {
      name: 'anchored_comments_read_asset',
      description:
        'Reads one integrity-checked anchored comment screenshot as a renderer-safe data URL.',
      parameters: {
        asset: { type: 'json', required: true },
        workspaceRoot: WORKSPACE_ROOT
      },
      output: { schema: OBJECT_OUTPUT, render },
      execute: invoke(ANCHORED_COMMENT_CAPABILITY_IDS.readAsset)
    },
    {
      name: 'anchored_comments_capture',
      description:
        'Uses the controlled Host proxy for registered task views in this instance and caller workspace. First call action=enumerate with workspaceRoot only to obtain authorized targets. Then action=capture (default) requires threadId of an existing canonical document comment, targetRef, targetBounds, targetLabel and viewport. Captures apply Host redaction and bind trusted source to the comment document; never provide desktop or other-application targets. Missing authorization or service is refused.',
      parameters: {
        action: { type: 'string', enum: ['enumerate', 'capture'] },
        threadId: { type: 'string' },
        targetRef: { type: 'string' },
        targetBounds: { type: 'json' },
        targetLabel: { type: 'string' },
        route: { type: 'string' },
        viewport: { type: 'json' },
        theme: { type: 'string' },
        locale: { type: 'string' },
        workspaceRoot: WORKSPACE_ROOT
      },
      output: { schema: OBJECT_OUTPUT, render },
      execute: capture
    },
    {
      name: 'anchored_comments_submit_feedback',
      description:
        'Publishes explicitly disclosed product feedback through the configured gateway. Requires real Host confirmation; no gateway configuration is refused.',
      parameters: {
        packet: { type: 'json', required: true },
        workspaceRoot: WORKSPACE_ROOT
      },
      output: { schema: OBJECT_OUTPUT, render },
      execute: invoke(ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback)
    },
    {
      name: 'anchored_comments_feedback_status',
      description: 'Reads the feedback submission state of one anchored comment thread.',
      parameters: { threadId: THREAD_ID, workspaceRoot: WORKSPACE_ROOT },
      output: { schema: OBJECT_OUTPUT, render },
      execute: invoke(ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus)
    }
  ]
}

/** Contract schemas each capability parses (kept for the parity/forge tests). */
export const CAPABILITY_INPUT_SCHEMAS = Object.freeze({
  [ANCHORED_COMMENT_CAPABILITY_IDS.list]: anchoredCommentListInputSchema,
  [ANCHORED_COMMENT_CAPABILITY_IDS.get]: anchoredCommentThreadIdInputSchema,
  [ANCHORED_COMMENT_CAPABILITY_IDS.upsert]: anchoredCommentUpsertInputSchema,
  [ANCHORED_COMMENT_CAPABILITY_IDS.delete]: anchoredCommentThreadIdInputSchema,
  [ANCHORED_COMMENT_CAPABILITY_IDS.readAsset]: anchoredCommentReadAssetInputSchema,
  [ANCHORED_COMMENT_CAPABILITY_IDS.capture]: anchoredCommentCaptureRequestSchema,
  [ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback]: feedbackSubmissionRequestSchema,
  [ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus]: feedbackSubmissionStatusRequestSchema
} as const)

export function registerAnchoredCommentsTools(
  operations: AnchoredCommentsOperations,
  register: (tool: unknown) => unknown,
  defineTool: (definition: DshToolDefinition) => unknown,
  visualCapture?: VisualCapturePort
): void {
  for (const definition of anchoredCommentsTools(operations, visualCapture)) register(defineTool(definition))
}