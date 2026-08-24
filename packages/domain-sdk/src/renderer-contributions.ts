import { z } from 'zod'

import {
  domainPackageContributionIdSchema,
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from './contract.js'
import type { DomainWorkbenchOpenResourceInput } from './host.js'

export const RENDERER_COMMAND_CONTRIBUTION_KIND = 'renderer.command' as const
export const RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND =
  'renderer.workbench-toolbar-action' as const
export const RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND =
  'renderer.workbench-right-panel' as const
export const RENDERER_WORKBENCH_BOTTOM_PANEL_CONTRIBUTION_KIND =
  'renderer.workbench-bottom-panel' as const
export const RENDERER_WORKBENCH_GLOBAL_OVERLAY_CONTRIBUTION_KIND =
  'renderer.workbench-global-overlay' as const
export const RENDERER_COMPOSER_CONTEXT_PROVIDER_CONTRIBUTION_KIND =
  'renderer.composer-context-provider' as const
export const RENDERER_CHAT_RESULT_PANEL_CONTRIBUTION_KIND =
  'renderer.chat-result-panel' as const
export const RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION_KIND =
  'renderer.resource-navigation' as const
export const RENDERER_EXTENSION_CONTRIBUTION_KIND = 'renderer.extension' as const

export const WORKBENCH_TOPBAR_LOCATION = 'workbench.topbar' as const
export const WORKBENCH_RIGHT_PANEL_LOCATION = 'workbench.right-panel' as const
export const WORKBENCH_BOTTOM_PANEL_LOCATION = 'workbench.bottom-panel' as const
export const WORKBENCH_GLOBAL_OVERLAY_LOCATION = 'workbench.global-overlay' as const
export const COMPOSER_CONTEXT_LOCATION = 'composer.context' as const

export const domainWorkbenchRightPanelPlacementSchema = z.enum(['focused', 'new'])

export const domainRendererExtensionContractSchema = z.object({
  location: z.string().trim().min(1).max(192)
}).passthrough()

export type DomainRendererExtensionContract = z.infer<
  typeof domainRendererExtensionContractSchema
>

export const domainCapabilityResourceHandleSchema = z.object({
  token: z.string().min(1).max(4_096),
  semanticRevision: z.string().min(1).max(512),
  expiresAt: z.string().min(1).max(128)
}).strict()

export const domainRendererSessionResourceSchema = z.object({
  kind: z.string().trim().min(1).max(192),
  resourceRef: z.string().trim().min(1).max(512),
  resource: domainCapabilityResourceHandleSchema
}).strict()

export const domainRendererActiveSurfaceSchema = z.object({
  kind: z.enum(['right-panel', 'bottom-panel', 'global-overlay']),
  contributionId: domainPackageContributionIdSchema
}).strict()

export const domainRendererCommandInvocationSchema = z.object({
  sessionId: z.string().trim().min(1).max(256).optional(),
  runtimeId: z.string().trim().min(1).max(256).optional(),
  workspaceRoot: z.string().min(1).max(4_096).optional(),
  resources: z.array(domainRendererSessionResourceSchema).max(1_000).optional(),
  activeSurface: domainRendererActiveSurfaceSchema.optional(),
  payload: domainPackageJsonValueSchema.optional()
}).strict()

export const domainRendererWorkbenchSendMessageInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(256),
  text: z.string().min(1).max(100_000),
  displayText: z.string().min(1).max(10_000).optional()
}).strict()

export const domainRendererWorkbenchSendMessageResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string().trim().min(1).max(128),
      message: z.string().trim().min(1).max(1_000)
    }).strict()
  }).strict()
])

export const domainRendererWorkspaceFilePickerFilterSchema = z.object({
  name: z.string().trim().min(1).max(160),
  extensions: z.array(
    z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9*]+$/)
  ).min(1).max(100)
}).strict()

export const domainRendererWorkspaceFilePickerRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  defaultPath: z.string().min(1).max(4_096).optional(),
  filters: z.array(domainRendererWorkspaceFilePickerFilterSchema).max(64)
}).strict()

export const domainRendererWorkspacePickResultSchema = z.object({
  canceled: z.boolean(),
  path: z.string().min(1).max(4_096).nullable()
}).strict().superRefine((result, context) => {
  if (
    (result.canceled && result.path === null) ||
    (!result.canceled && result.path !== null)
  ) return
  context.addIssue({
    code: 'custom',
    path: ['path'],
    message: 'Canceled picks must return null; completed picks must return a path.'
  })
})

const domainWorkbenchOpenResourceInputFields = {
  sessionId: z.string().trim().min(1).max(256),
  resource: z.object({
    resourceKind: z.string().trim().min(1).max(192),
    resourceId: z.string().trim().min(1).max(512),
    integrity: z.object({
      algorithm: z.literal('sha256'),
      expectedDigest: z.string().trim().toLowerCase()
        .regex(/^sha256:[0-9a-f]{64}$/u)
    }).strict().optional()
  }).strict()
} as const

export const domainWorkbenchOpenResourceInputSchema: z.ZodType<
  DomainWorkbenchOpenResourceInput
> = z.union([
  z.object({
    ...domainWorkbenchOpenResourceInputFields,
    placement: z.literal('focused').optional()
  }).strict(),
  z.object({
    ...domainWorkbenchOpenResourceInputFields,
    placement: z.literal('new')
  }).strict(),
  z.object({
    ...domainWorkbenchOpenResourceInputFields,
    surfaceId: z.string().min(1).max(512)
  }).strict()
])

export type DomainCapabilityResourceHandle = z.infer<
  typeof domainCapabilityResourceHandleSchema
>
export type DomainRendererSessionResource = z.infer<typeof domainRendererSessionResourceSchema>
export type DomainRendererActiveSurface = z.infer<typeof domainRendererActiveSurfaceSchema>
export type DomainRendererCommandInvocation = z.infer<
  typeof domainRendererCommandInvocationSchema
>
export type DomainRendererWorkbenchSendMessageInput = z.infer<
  typeof domainRendererWorkbenchSendMessageInputSchema
>
export type DomainRendererWorkbenchSendMessageResult = z.infer<
  typeof domainRendererWorkbenchSendMessageResultSchema
>
export type DomainRendererWorkspaceFilePickerFilter = z.infer<
  typeof domainRendererWorkspaceFilePickerFilterSchema
>
export type DomainRendererWorkspaceFilePickerRequest = z.infer<
  typeof domainRendererWorkspaceFilePickerRequestSchema
>
export type DomainRendererWorkspacePickResult = z.infer<
  typeof domainRendererWorkspacePickResultSchema
>

export type DomainRendererChatResultPanelRenderContext = Readonly<{
  blocks: readonly unknown[]
  workspaceRoot?: string
  sessionId?: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  turnLifecycle?: Readonly<{
    phase: 'active' | 'terminal' | 'settled'
    revision: string
    isLatest: boolean
    status?: string
  }>
  onContinuePrompt?: (prompt: string) => void
}>

export type DomainRendererChatResultPanelValue<View = unknown> = Readonly<{
  id: string
  render: (context: DomainRendererChatResultPanelRenderContext) => View | null
}>

export function isDomainRendererChatResultPanelValue(
  value: unknown
): value is DomainRendererChatResultPanelValue {
  return hasOnlyKeys(value, ['id', 'render']) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.render === 'function'
}

export type DomainRendererCommandHandler = Readonly<{
  execute: (invocation: DomainRendererCommandInvocation) => void | Promise<void>
  isAvailable?: (invocation: DomainRendererCommandInvocation) => boolean
  isActive?: (invocation: DomainRendererCommandInvocation) => boolean
}>

export function isDomainRendererCommandHandler(
  value: unknown
): value is DomainRendererCommandHandler {
  if (!hasOnlyKeys(value, ['execute', 'isAvailable', 'isActive'])) return false
  return typeof value.execute === 'function' &&
    (value.isAvailable === undefined || typeof value.isAvailable === 'function') &&
    (value.isActive === undefined || typeof value.isActive === 'function')
}

export function isDomainRendererCommandAvailable(
  handler: DomainRendererCommandHandler,
  invocation: DomainRendererCommandInvocation
): boolean {
  try {
    return handler.isAvailable?.(domainRendererCommandInvocationSchema.parse(invocation)) ?? true
  } catch {
    return false
  }
}

export function isDomainRendererCommandActive(
  handler: DomainRendererCommandHandler,
  invocation: DomainRendererCommandInvocation
): boolean {
  try {
    return handler.isActive?.(domainRendererCommandInvocationSchema.parse(invocation)) ?? false
  } catch {
    return false
  }
}

export const domainRendererWorkbenchToolbarActionContractSchema = z.object({
  location: z.literal(WORKBENCH_TOPBAR_LOCATION),
  commandId: domainPackageContributionIdSchema,
  label: z.string().trim().min(1).max(160),
  group: z.object({
    id: domainPackageContributionIdSchema,
    label: z.string().trim().min(1).max(160)
  }).strict().optional()
}).strict()

export type DomainRendererWorkbenchToolbarActionContract = z.infer<
  typeof domainRendererWorkbenchToolbarActionContractSchema
>

export type DomainRendererWorkbenchToolbarActionValue<Icon = unknown> = Readonly<{
  icon: Icon
}>

export function isDomainRendererWorkbenchToolbarActionValue(
  value: unknown
): value is DomainRendererWorkbenchToolbarActionValue {
  return hasOnlyKeys(value, ['icon']) && value.icon !== undefined && value.icon !== null
}

const surfaceContractFields = {
  title: z.string().trim().min(1).max(160),
  resourceKind: z.string().trim().min(1).max(192).optional()
} as const

export const domainRendererWorkbenchRightPanelContractSchema = z.object({
  location: z.literal(WORKBENCH_RIGHT_PANEL_LOCATION),
  ...surfaceContractFields
}).strict()

export const domainRendererWorkbenchBottomPanelContractSchema = z.object({
  location: z.literal(WORKBENCH_BOTTOM_PANEL_LOCATION),
  ...surfaceContractFields
}).strict()

export const domainRendererWorkbenchGlobalOverlayContractSchema = z.object({
  location: z.literal(WORKBENCH_GLOBAL_OVERLAY_LOCATION),
  ...surfaceContractFields
}).strict()

export const domainRendererWorkbenchSurfaceContractSchema = z.discriminatedUnion('location', [
  domainRendererWorkbenchRightPanelContractSchema,
  domainRendererWorkbenchBottomPanelContractSchema,
  domainRendererWorkbenchGlobalOverlayContractSchema
])

export type DomainRendererWorkbenchRightPanelContract = z.infer<
  typeof domainRendererWorkbenchRightPanelContractSchema
>
export type DomainRendererWorkbenchBottomPanelContract = z.infer<
  typeof domainRendererWorkbenchBottomPanelContractSchema
>
export type DomainRendererWorkbenchGlobalOverlayContract = z.infer<
  typeof domainRendererWorkbenchGlobalOverlayContractSchema
>
export type DomainRendererWorkbenchSurfaceContract = z.infer<
  typeof domainRendererWorkbenchSurfaceContractSchema
>

export type DomainRendererWorkbenchSession = Readonly<{
  id: string
  title?: string
  runtimeId?: string
  workspaceRoot?: string
  resources?: readonly DomainRendererSessionResource[]
}>

export type DomainRendererWorkbenchSurfaceActivation = Readonly<{
  revision: number
  payload: DomainPackageJsonValue
}>

type DomainRendererWorkbenchSurfaceRenderContext = Readonly<{
  /** Foreground viewport visibility; mounted offscreen surfaces remain inactive. */
  active: boolean
  className: string
  session: DomainRendererWorkbenchSession
  activation?: DomainRendererWorkbenchSurfaceActivation
}>

export type DomainRendererWorkbenchRightPanelRenderContext =
  DomainRendererWorkbenchSurfaceRenderContext & Readonly<{
    /** Keyboard and command-routing focus within the owning Session dock. */
    focused: boolean
    /** Stable opaque Host identity that nested requests may echo, but never create. */
    surfaceId: string
    onCollapse: () => void
  }>

export type DomainRendererWorkbenchBottomPanelRenderContext =
  DomainRendererWorkbenchSurfaceRenderContext & Readonly<{
    height: number
    onCollapse: () => void
  }>

export type DomainRendererWorkbenchGlobalOverlayRenderContext =
  DomainRendererWorkbenchSurfaceRenderContext & Readonly<{
    onClose: () => void
  }>

export type DomainRendererWorkbenchSurfaceValue<Context, View = unknown> = Readonly<{
  render: (context: Context) => View
}>

export type DomainRendererWorkbenchRightPanelValue<View = unknown> =
  DomainRendererWorkbenchSurfaceValue<DomainRendererWorkbenchRightPanelRenderContext, View>

export type DomainRendererWorkbenchBottomPanelValue<View = unknown> =
  DomainRendererWorkbenchSurfaceValue<DomainRendererWorkbenchBottomPanelRenderContext, View>

export type DomainRendererWorkbenchGlobalOverlayValue<View = unknown> =
  DomainRendererWorkbenchSurfaceValue<DomainRendererWorkbenchGlobalOverlayRenderContext, View>

export const domainRendererResourceNavigationContractSchema = z.object({
  resourceKinds: z.array(z.string().trim().min(1).max(192)).min(1).max(64),
  target: z.object({
    surface: z.literal('right-panel'),
    contributionId: domainPackageContributionIdSchema
  }).strict()
}).strict().superRefine((contract, context) => {
  const seen = new Set<string>()
  for (const [index, resourceKind] of contract.resourceKinds.entries()) {
    if (seen.has(resourceKind)) {
      context.addIssue({
        code: 'custom',
        path: ['resourceKinds', index],
        message: `Resource kind ${resourceKind} is duplicated.`
      })
      continue
    }
    seen.add(resourceKind)
  }
})

export type DomainRendererResourceNavigationContract = z.infer<
  typeof domainRendererResourceNavigationContractSchema
>

export type DomainRendererResourceNavigationTarget = Readonly<{
  activation?: DomainRendererWorkbenchSurfaceActivation
}>

export type DomainRendererResourceNavigationValue = Readonly<{
  resolve: (input: DomainWorkbenchOpenResourceInput) =>
    DomainRendererResourceNavigationTarget | null
}>

export function isDomainRendererResourceNavigationValue(
  value: unknown
): value is DomainRendererResourceNavigationValue {
  return hasOnlyKeys(value, ['resolve']) && typeof value.resolve === 'function'
}

export function isDomainRendererWorkbenchSurfaceValue(
  value: unknown
): value is DomainRendererWorkbenchSurfaceValue<unknown> {
  return hasOnlyKeys(value, ['render']) && typeof value.render === 'function'
}

export const domainRendererComposerContextProviderContractSchema = z.object({
  location: z.literal(COMPOSER_CONTEXT_LOCATION),
  label: z.string().trim().min(1).max(160)
}).strict()

export const domainRendererComposerContextItemSchema = z.object({
  id: domainPackageContributionIdSchema,
  title: z.string().trim().min(1).max(160),
  content: z.string().min(1).max(100_000),
  metadata: domainPackageJsonValueSchema.optional()
}).strict()

export const domainRendererComposerContextResultSchema = z.object({
  items: z.array(domainRendererComposerContextItemSchema).max(100)
}).strict().superRefine((result, context) => {
  const characters = result.items.reduce((total, item) => total + item.content.length, 0)
  if (characters <= 200_000) return
  context.addIssue({
    code: 'custom',
    path: ['items'],
    message: 'Composer context cannot exceed 200000 content characters.'
  })
})

export type DomainRendererComposerContextProviderContract = z.infer<
  typeof domainRendererComposerContextProviderContractSchema
>

export type DomainRendererComposerContextRequest = Readonly<{
  sessionId?: string
  runtimeId?: string
  workspaceRoot?: string
  draftText: string
  signal: AbortSignal
}>

export type DomainRendererComposerContextItem = z.infer<
  typeof domainRendererComposerContextItemSchema
>
export type DomainRendererComposerContextResult = z.infer<
  typeof domainRendererComposerContextResultSchema
>

export type DomainRendererComposerContextProvider = Readonly<{
  provide: (
    request: DomainRendererComposerContextRequest
  ) => DomainRendererComposerContextResult | Promise<DomainRendererComposerContextResult>
}>

export function isDomainRendererComposerContextProvider(
  value: unknown
): value is DomainRendererComposerContextProvider {
  return hasOnlyKeys(value, ['provide']) && typeof value.provide === 'function'
}

export function defineDomainRendererWorkbenchToolbarActionContract(
  input: DomainRendererWorkbenchToolbarActionContract
): DomainRendererWorkbenchToolbarActionContract {
  return Object.freeze(domainRendererWorkbenchToolbarActionContractSchema.parse(input))
}

export function defineDomainRendererWorkbenchSurfaceContract(
  input: DomainRendererWorkbenchSurfaceContract
): DomainRendererWorkbenchSurfaceContract {
  return Object.freeze(domainRendererWorkbenchSurfaceContractSchema.parse(input))
}

export function defineDomainRendererComposerContextProviderContract(
  input: DomainRendererComposerContextProviderContract
): DomainRendererComposerContextProviderContract {
  return Object.freeze(domainRendererComposerContextProviderContractSchema.parse(input))
}

function hasOnlyKeys(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).every((key) => keys.includes(key)) &&
    keys.some((key) => Object.hasOwn(value, key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
