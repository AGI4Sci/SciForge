import { z } from 'zod'

import {
  domainPackageContributionIdSchema,
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from './contract.js'
import type {
  DomainWorkbenchExactResource,
  DomainWorkbenchOpenResourceInput
} from './host.js'

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
/** Bounded, read-only owner summaries consumed by the primary Research surface. */
export const RENDERER_RESEARCH_SUMMARY_CONTRIBUTION_KIND =
  'renderer.research-summary.v1' as const
export const RENDERER_EXTENSION_CONTRIBUTION_KIND = 'renderer.extension' as const

export const RESEARCH_SUMMARY_SLOTS = [
  'goal',
  'scope',
  'status',
  'artifacts',
  'attention'
] as const
export type DomainRendererResearchSummarySlot = typeof RESEARCH_SUMMARY_SLOTS[number]

export const WORKBENCH_TOPBAR_LOCATION = 'workbench.topbar' as const
export const WORKBENCH_RIGHT_PANEL_LOCATION = 'workbench.right-panel' as const
export const WORKBENCH_BOTTOM_PANEL_LOCATION = 'workbench.bottom-panel' as const
export const WORKBENCH_GLOBAL_OVERLAY_LOCATION = 'workbench.global-overlay' as const
export const COMPOSER_CONTEXT_LOCATION = 'composer.context' as const
export const WORKBENCH_NAVIGATION_SECTION_LOCATION =
  'workbench.navigation-section' as const
export const WORKBENCH_NAVIGATION_SECTION_CONTRACT_VERSION = '1.0.0' as const
export const WORKBENCH_WORKSPACE_SECTION_LOCATION =
  'workbench.workspace-section' as const
export const WORKBENCH_WORKSPACE_SECTION_CONTRACT_VERSION = '1.0.0' as const

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
    resourceRef: z.string().trim().regex(/^res_[A-Za-z0-9_-]{20,}$/u).optional(),
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
  label: z.string().trim().min(1).max(160)
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
  ...surfaceContractFields,
  preferredWidth: z.number().int().min(300).max(1_200).optional()
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

/**
 * Presentation-only navigation contributed to the global Workbench sidebar.
 * Domain identity and activation remain private to the renderer value.
 */
export const domainRendererWorkbenchNavigationSectionContractSchema = z.object({
  location: z.literal(WORKBENCH_NAVIGATION_SECTION_LOCATION),
  contractVersion: z.literal(WORKBENCH_NAVIGATION_SECTION_CONTRACT_VERSION),
  label: z.string().trim().min(1).max(160)
}).strict()

export type DomainRendererWorkbenchNavigationSectionContract = z.infer<
  typeof domainRendererWorkbenchNavigationSectionContractSchema
>

export const domainRendererWorkbenchNavigationSessionSchema = z.object({
  id: z.string().trim().min(1).max(512),
  runtimeId: z.string().trim().min(1).max(128).optional(),
  title: z.string().trim().min(1).max(1_000),
  updatedAt: z.string().trim().min(1).max(128),
  workspaceRoot: z.string().min(1).max(4_096).optional(),
  status: z.string().trim().min(1).max(128).optional(),
  archived: z.boolean().optional()
}).strict().readonly()

export const domainRendererWorkbenchNavigationSessionCatalogSchema = z.array(
  domainRendererWorkbenchNavigationSessionSchema
).max(10_000).superRefine((sessions, context) => {
  const ids = new Set<string>()
  sessions.forEach(({ id }, index) => {
    if (!ids.has(id)) {
      ids.add(id)
      return
    }
    context.addIssue({
      code: 'custom',
      path: [index, 'id'],
      message: `Workbench navigation Session ${id} is duplicated.`
    })
  })
}).readonly()

export type DomainRendererWorkbenchNavigationSession = z.infer<
  typeof domainRendererWorkbenchNavigationSessionSchema
>

/**
 * Declarative navigation contributed to a package-owned composed workspace.
 *
 * The Host treats this as an ordinary renderer extension. The workspace owner
 * discovers matching sections lazily, so installing or removing a contributor
 * never requires a central feature map or a cross-package renderer import.
 */
export const domainRendererWorkbenchWorkspaceSectionContractSchema = z.object({
  location: z.literal(WORKBENCH_WORKSPACE_SECTION_LOCATION),
  contractVersion: z.literal(WORKBENCH_WORKSPACE_SECTION_CONTRACT_VERSION),
  workspaceId: domainPackageContributionIdSchema,
  sectionId: z.string().trim().min(1).max(96).regex(
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u,
    'Use a stable lowercase workspace section slug.'
  ),
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(320).optional(),
  placement: z.enum(['navigation', 'settings']),
  order: z.number().int().min(-10_000).max(10_000)
}).strict()

export type DomainRendererWorkbenchWorkspaceSectionContract = z.infer<
  typeof domainRendererWorkbenchWorkspaceSectionContractSchema
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

export type DomainRendererWorkbenchNavigationSectionRenderContext = Readonly<{
  active: boolean
  className: string
  session: DomainRendererWorkbenchSession
  sessions: readonly DomainRendererWorkbenchNavigationSession[]
  selectSession: (sessionId: string) => void
}>

export type DomainRendererWorkbenchNavigationSectionValue<View = unknown> = Readonly<{
  render: (context: DomainRendererWorkbenchNavigationSectionRenderContext) => View
}>

export type DomainRendererWorkbenchWorkspaceSectionRenderContext = Readonly<{
  active: boolean
  className: string
  session: DomainRendererWorkbenchSession
}>

export type DomainRendererWorkbenchWorkspaceSectionValue<
  View = unknown,
  Icon = unknown
> = Readonly<{
  icon?: Icon
  render: (context: DomainRendererWorkbenchWorkspaceSectionRenderContext) => View
}>

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

/**
 * Generic metadata for a bounded Research summary. The contribution id and
 * contract order provide stable identity and ordering; this contract only
 * describes the applicable scope/resource kinds and the researcher-facing label.
 */
export const domainRendererResearchSummaryContractSchema = z.object({
  slot: z.enum(RESEARCH_SUMMARY_SLOTS),
  label: z.string().trim().min(1).max(160),
  order: z.number().int().min(-10_000).max(10_000),
  scopeKinds: z.array(z.string().trim().min(1).max(192)).min(1).max(32),
  resourceKinds: z.array(z.string().trim().min(1).max(192)).max(64).default([])
}).strict().superRefine((contract, context) => {
  for (const field of ['scopeKinds', 'resourceKinds'] as const) {
    const seen = new Set<string>()
    for (const [index, value] of contract[field].entries()) {
      if (seen.has(value)) {
        context.addIssue({
          code: 'custom',
          path: [field, index],
          message: `${field} entry ${value} is duplicated.`
        })
      }
      seen.add(value)
    }
  }
})

export type DomainRendererResearchSummaryContract = z.infer<
  typeof domainRendererResearchSummaryContractSchema
>

export type DomainRendererResearchSummaryRequest = Readonly<{
  session: DomainRendererWorkbenchSession
  scope: Readonly<{
    kind: string
    id: string
  }>
  resource?: DomainWorkbenchExactResource
}>

/** Exact, domain-neutral resource action returned by an owner summary. */
export const domainRendererResearchSummaryNavigationSchema = z.object({
  label: z.string().trim().min(1).max(160),
  resource: z.object({
    resourceKind: z.string().trim().min(1).max(192),
    resourceId: z.string().trim().min(1).max(512),
    resourceRef: z.string().trim().regex(/^res_[A-Za-z0-9_-]{20,}$/u).optional(),
    integrity: z.object({
      algorithm: z.literal('sha256'),
      expectedDigest: z.string().trim().toLowerCase()
        .regex(/^sha256:[0-9a-f]{64}$/u)
    }).strict().optional()
  }).strict()
}).strict()

export const domainRendererResearchSummaryResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    title: z.string().trim().min(1).max(160).optional(),
    items: z.array(z.object({
      label: z.string().trim().min(1).max(160),
      value: z.string().trim().min(1).max(2_000),
      tone: z.enum(['neutral', 'positive', 'warning', 'critical']).default('neutral')
    }).strict()).max(16),
    actions: z.array(domainRendererResearchSummaryNavigationSchema).max(16)
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    reason: z.string().trim().min(1).max(500).optional()
  }).strict()
])

export type DomainRendererResearchSummaryNavigation = z.infer<
  typeof domainRendererResearchSummaryNavigationSchema
>
export type DomainRendererResearchSummaryResult = z.infer<
  typeof domainRendererResearchSummaryResultSchema
>
export type DomainRendererResearchSummaryValue = Readonly<{
  provide: (
    request: DomainRendererResearchSummaryRequest
  ) => DomainRendererResearchSummaryResult | Promise<DomainRendererResearchSummaryResult>
}>

export function isDomainRendererResearchSummaryValue(
  value: unknown
): value is DomainRendererResearchSummaryValue {
  return hasOnlyKeys(value, ['provide']) && typeof value.provide === 'function'
}

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

export function isDomainRendererWorkbenchNavigationSectionValue(
  value: unknown
): value is DomainRendererWorkbenchNavigationSectionValue {
  return hasOnlyKeys(value, ['render']) && typeof value.render === 'function'
}

export function isDomainRendererWorkbenchWorkspaceSectionValue(
  value: unknown
): value is DomainRendererWorkbenchWorkspaceSectionValue {
  return hasOnlyKeys(value, ['icon', 'render']) &&
    typeof value.render === 'function' &&
    (value.icon === undefined || value.icon !== null)
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

export function defineDomainRendererResearchSummaryContract(
  input: DomainRendererResearchSummaryContract
): DomainRendererResearchSummaryContract {
  return Object.freeze(domainRendererResearchSummaryContractSchema.parse(input))
}

/** Parse owner output at the host boundary and return unavailable on errors. */
export async function resolveDomainRendererResearchSummary(
  contribution: DomainRendererResearchSummaryValue,
  request: DomainRendererResearchSummaryRequest
): Promise<DomainRendererResearchSummaryResult> {
  try {
    return domainRendererResearchSummaryResultSchema.parse(
      await contribution.provide(request)
    )
  } catch {
    return { status: 'unavailable' }
  }
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
