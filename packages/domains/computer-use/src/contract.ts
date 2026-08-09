import { z } from 'zod'

const safeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)

export const computerUseEmptyInputSchema = z.object({}).strict()

export const computerUseIsolationSchema = z.enum([
  'auto',
  'agent-isolated',
  'host-app-scoped',
  'host-global',
  'host-approved'
])

export const computerUseBackendSchema = z.enum([
  'browser-cdp', 'windows-uia', 'isolated-desktop', 'legacy-pyautogui', 'static-image'
])

export const computerUseVerificationSchema = z.enum([
  'verified', 'unverified', 'failed', 'not-applicable'
])

export const computerUseLeaseScopeSchema = z.enum(['target', 'environment', 'process-global'])

export const computerUseTargetKindSchema = z.enum([
  'browser-page',
  'electron-webcontents',
  'windows-uia',
  'isolated-desktop',
  'host-desktop',
  'static-image'
])

export const COMPUTER_USE_ERROR_CODES = [
  'INVALID_ARGUMENT', 'SESSION_NOT_FOUND', 'SESSION_OWNER_MISMATCH',
  'REQUEST_ID_CONFLICT', 'SESSION_BUSY', 'TARGET_BUSY', 'HOST_INPUT_BUSY',
  'BACKEND_UNAVAILABLE', 'ISOLATION_UNAVAILABLE', 'ISOLATED_DESKTOP_UNAVAILABLE',
  'DEGRADATION_NOT_ALLOWED',
  'TARGET_NOT_FOUND', 'TARGET_LOST', 'STALE_OBSERVATION', 'ACTION_UNSUPPORTED',
  'ACTION_UNVERIFIED', 'ACTION_OUTCOME_UNKNOWN', 'LEASE_EXPIRED',
  'CANCEL_PENDING', 'CLEANUP_INCOMPLETE',
  'APPROVAL_PROOF_REQUIRED', 'APPROVAL_PROOF_INVALID', 'APPROVAL_PROOF_EXPIRED',
  'APPROVAL_PROOF_REPLAYED', 'APPROVAL_PROOF_CAPACITY',
  'INVOCATION_IDENTITY_MISMATCH',
  'QUEUE_NOT_SUPPORTED'
] as const

export type ComputerUseErrorCode = typeof COMPUTER_USE_ERROR_CODES[number]

const targetLocatorFields = {
  'browser-page': ['cdpEndpoint', 'cdpTargetId'],
  'electron-webcontents': ['webContentsId', 'cdpTargetId'],
  'windows-uia': ['processId', 'nativeWindowHandle', 'automationId'],
  'isolated-desktop': ['isolatedEnvironmentId'],
  'host-desktop': ['monitorId'],
  'static-image': ['imageRef']
} as const

export const computerUseTargetSchema = z.object({
  targetId: safeId.optional(),
  kind: computerUseTargetKindSchema,
  ownership: z.enum(['attached', 'managed']).default('attached'),
  locator: z.record(z.string(), z.unknown()).default({}),
  display: z.object({
    monitorId: z.string().min(1).max(256).optional(),
    scaleFactor: z.number().positive().optional(),
    viewport: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional()
  }).strict().optional(),
  backendHint: z.string().trim().min(1).max(256).optional(),
  generation: z.string().trim().min(1).max(256).optional(),
  metadata: z.object({
    title: z.string().max(2_048).optional(),
    url: z.string().max(2_048).optional(),
    processName: z.string().max(2_048).optional()
  }).strict().optional()
}).strict().superRefine((target, context) => {
  const allowed = targetLocatorFields[target.kind] as readonly string[]
  const unknown = Object.keys(target.locator).filter((field) => !allowed.includes(field))
  if (unknown.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['locator'],
      message: `locator fields are unsupported for ${target.kind}: ${unknown.join(', ')}`
    })
  }
  const has = (field: string): boolean => Object.hasOwn(target.locator, field)
  const hasRequiredLocator = target.kind === 'host-desktop' ||
    (target.kind === 'browser-page' && has('cdpEndpoint') && has('cdpTargetId')) ||
    (target.kind === 'electron-webcontents' && (has('webContentsId') || has('cdpTargetId'))) ||
    (target.kind === 'windows-uia' && (
      has('processId') || has('nativeWindowHandle') || has('automationId')
    )) ||
    (target.kind === 'isolated-desktop' && has('isolatedEnvironmentId')) ||
    (target.kind === 'static-image' && has('imageRef'))
  if (!hasRequiredLocator) {
    context.addIssue({
      code: 'custom',
      path: ['locator'],
      message: `locator does not identify a ${target.kind} target`
    })
  }
  for (const [field, value] of Object.entries(target.locator)) {
    if (field === 'processId' || field === 'webContentsId') {
      if (!Number.isInteger(value) || (value as number) <= 0) {
        context.addIssue({ code: 'custom', path: ['locator', field], message: 'must be a positive integer' })
      }
    } else if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2_048) {
      context.addIssue({ code: 'custom', path: ['locator', field], message: 'must be a non-empty string' })
    }
  }
  if (target.kind === 'windows-uia' && has('nativeWindowHandle')) {
    if (!has('processId')) {
      context.addIssue({ code: 'custom', path: ['locator'], message: 'nativeWindowHandle requires processId' })
    }
    if (!target.generation) {
      context.addIssue({ code: 'custom', path: ['generation'], message: 'nativeWindowHandle requires generation' })
    }
  }
})

export const computerUseRunInputSchema = z.object({
  instruction: z.string().trim().min(1).max(16_384),
  sessionId: safeId.optional(),
  target: computerUseTargetSchema.optional(),
  requestedIsolation: computerUseIsolationSchema.optional(),
  allowDegraded: z.boolean().optional(),
  queueIfBusy: z.boolean().optional(),
  deadlineMs: z.number().int().min(1).max(600_000).optional()
}).strict()

export type ComputerUseRunInput = z.infer<typeof computerUseRunInputSchema>

export type NormalizedComputerUseRunInput = ComputerUseRunInput & {
  requestedIsolation: z.infer<typeof computerUseIsolationSchema>
  allowDegraded: boolean
  queueIfBusy: boolean
  protocolVersion: 1 | 2
}

export const computerUseBindTargetInputSchema = z.object({
  sessionId: safeId.optional(),
  target: computerUseTargetSchema
}).strict()

export const computerUseReleaseSessionInputSchema = z.object({
  sessionId: safeId,
  reason: z.string().trim().min(1).max(256).optional(),
  force: z.boolean().optional()
}).strict()

export const COMPUTER_USE_V2_FIELDS = [
  'sessionId',
  'target',
  'requestedIsolation',
  'allowDegraded',
  'queueIfBusy',
  'deadlineMs'
] as const

export function isComputerUseV2Input(input: ComputerUseRunInput): boolean {
  return COMPUTER_USE_V2_FIELDS.some((field) => Object.hasOwn(input, field))
}

export function normalizeComputerUseRunInput(value: unknown): NormalizedComputerUseRunInput {
  const input = computerUseRunInputSchema.parse(value)
  return {
    ...input,
    requestedIsolation: input.requestedIsolation ?? 'auto',
    allowDegraded: input.allowDegraded ?? false,
    queueIfBusy: input.queueIfBusy ?? false,
    protocolVersion: isComputerUseV2Input(input) ? 2 : 1
  }
}

export const computerUseBackendCapabilitiesSchema = z.object({
  backend: computerUseBackendSchema,
  available: z.boolean(),
  targetKinds: z.array(computerUseTargetKindSchema),
  actions: z.array(z.string()),
  effectiveIsolation: computerUseIsolationSchema.exclude(['auto']),
  backgroundInput: z.enum(['semantic', 'targeted', 'none']),
  requiresHostFocus: z.boolean(),
  affectsUserInput: z.boolean(),
  usesHostClipboard: z.boolean(),
  supportsReadback: z.array(z.string()),
  leaseScope: computerUseLeaseScopeSchema,
  maxConcurrency: z.number().int().nonnegative(),
  reason: z.string().nullable(),
  mayActivateTarget: z.boolean().optional(),
  instanceId: z.string().min(1).max(128).nullable().optional(),
  generation: z.string().min(1).max(128).nullable().optional()
}).strict()

export const computerUseRuntimeStatusSchema = z.object({
  serverInstanceId: safeId,
  updatedAt: z.string().datetime({ offset: true }),
  protocolVersion: z.literal(2),
  approvalProof: z.enum(['legacy-trust-boundary', 'invocation-proof-v1']),
  backendsConnected: z.boolean(),
  backends: z.array(computerUseBackendCapabilitiesSchema),
  activeChannels: z.number().int().nonnegative(),
  active: z.array(z.object({
    sessionId: safeId,
    requestId: safeId,
    targetId: safeId,
    leaseId: safeId.nullable(),
    runtimeId: z.string().min(1).max(128),
    threadId: z.string().min(1).max(128),
    turnId: z.string().max(128),
    backend: computerUseBackendSchema.nullable(),
    leaseScope: computerUseLeaseScopeSchema.nullable(),
    requestedIsolation: computerUseIsolationSchema,
    effectiveIsolation: computerUseIsolationSchema.exclude(['auto']).nullable(),
    degraded: z.boolean(),
    degradedReason: z.string().max(512).nullable(),
    verification: computerUseVerificationSchema,
    state: z.string().min(1).max(64),
    updatedAt: z.string().datetime({ offset: true })
  }).strict()),
  lifecycleState: z.enum(['running', 'stopping', 'stopped']),
  cleanupPending: z.array(z.object({
    requestId: safeId,
    sessionId: safeId,
    targetId: safeId,
    leaseId: safeId,
    backend: computerUseBackendSchema,
    closed: z.boolean(),
    leaseReleased: z.boolean(),
    errors: z.array(z.string().max(512))
  }).strict()),
  recentRejections: z.array(z.object({
    requestId: safeId,
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(512),
    updatedAt: z.string().datetime({ offset: true })
  }).strict()).max(20),
  reaper: z.object({
    running: z.boolean(),
    intervalSeconds: z.number().positive().nullable(),
    leaseTtlSeconds: z.number().positive().nullable(),
    lastError: z.string().max(512).nullable()
  }).strict(),
  registry: z.object({
    counts: z.object({
      sessions: z.number().int().nonnegative(),
      requests: z.number().int().nonnegative(),
      activeLeases: z.number().int().nonnegative(),
      tombstones: z.number().int().nonnegative(),
      releasedLeaseTombstones: z.number().int().nonnegative()
    }),
    closed: z.boolean(),
    generation: z.number().int().nonnegative(),
    sessions: z.array(z.record(z.string(), z.unknown())),
    requests: z.array(z.record(z.string(), z.unknown())),
    leases: z.array(z.record(z.string(), z.unknown()))
  }).strict()
}).strict()

export const computerUseCapabilitiesStatusSchema = z.object({
  protocolVersion: z.literal(2),
  backends: z.array(computerUseBackendCapabilitiesSchema),
  approvalProof: z.enum(['legacy-trust-boundary', 'invocation-proof-v1'])
}).strict()

export const computerUseCleanupPendingStatusSchema = z.object({
  items: computerUseRuntimeStatusSchema.shape.cleanupPending
}).strict()

export const computerUseStatusEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: computerUseRuntimeStatusSchema
}).strict()

export const computerUseCapabilitiesEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: computerUseCapabilitiesStatusSchema
}).strict()

export const computerUseCleanupPendingEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: computerUseCleanupPendingStatusSchema
}).strict()

export type ComputerUseSidecarRuntimeStatus = z.infer<typeof computerUseRuntimeStatusSchema>
export type ComputerUseSidecarCapabilities = z.infer<typeof computerUseCapabilitiesStatusSchema>

export const computerUseSettingsSchema = z.object({
  enabled: z.boolean(),
  runtimeEnabled: z.object({
    sciforge: z.boolean(),
    codex: z.boolean(),
    claude: z.boolean()
  }).strict()
}).strict()

export const computerUsePermissionsSchema = z.object({
  platform: z.string(),
  supported: z.boolean(),
  needsPermission: z.boolean(),
  accessibility: z.enum(['granted', 'denied', 'unknown']),
  screenRecording: z.enum(['granted', 'denied', 'unknown']),
  accessibilityNeedsRestart: z.boolean()
}).strict()

export const computerUseRuntimeViewSchema = z.object({
  connection: z.enum(['online', 'offline', 'stale']),
  stale: z.boolean(),
  lastSuccessAt: z.string().nullable(),
  lastStatusError: z.string().nullable(),
  serverInstanceId: z.string().nullable(),
  generation: z.number().int().nullable(),
  updatedAt: z.string(),
  protocolVersion: z.literal(2).nullable(),
  approvalProof: z.enum(['legacy-trust-boundary', 'invocation-proof-v1', 'unavailable']),
  lifecycleState: z.enum(['running', 'stopping', 'stopped', 'unknown']),
  backends: z.array(computerUseBackendCapabilitiesSchema),
  counts: computerUseRuntimeStatusSchema.shape.registry.shape.counts,
  active: computerUseRuntimeStatusSchema.shape.active,
  cleanupPending: computerUseRuntimeStatusSchema.shape.cleanupPending,
  recentRejections: computerUseRuntimeStatusSchema.shape.recentRejections,
  reaper: computerUseRuntimeStatusSchema.shape.reaper.nullable()
}).strict()

export const computerUseSettingsStatusInputSchema = z.object({
  settings: computerUseSettingsSchema
}).strict()
export const computerUseSettingsStatusOutputSchema = z.object({
  settings: computerUseSettingsSchema,
  permissions: computerUsePermissionsSchema,
  runtime: computerUseRuntimeViewSchema
}).strict()
export const computerUsePermissionRequestInputSchema = z.object({
  kind: z.enum(['accessibility', 'screenRecording'])
}).strict()

export const COMPUTER_USE_CAPABILITY_IDS = Object.freeze({
  status: 'computer-use.status',
  requestPermission: 'computer-use.request-permission'
})

export const COMPUTER_USE_STATUS_CONTRACT = Object.freeze({
  actionId: COMPUTER_USE_CAPABILITY_IDS.status,
  effect: 'read' as const,
  inputSchema: computerUseSettingsStatusInputSchema,
  outputSchema: computerUseSettingsStatusOutputSchema
})

export const COMPUTER_USE_REQUEST_PERMISSION_CONTRACT = Object.freeze({
  actionId: COMPUTER_USE_CAPABILITY_IDS.requestPermission,
  effect: 'external-write' as const,
  inputSchema: computerUsePermissionRequestInputSchema,
  outputSchema: computerUsePermissionsSchema
})

export function redactComputerUseTarget(
  target: z.infer<typeof computerUseTargetSchema>
): Record<string, unknown> {
  const locator = { ...target.locator }
  if (target.kind === 'browser-page' && 'cdpEndpoint' in locator) {
    locator.cdpEndpoint = '<redacted>'
  }
  if (target.kind === 'static-image' && 'imageRef' in locator) {
    locator.imageRef = '<redacted>'
  }
  return {
    ...target,
    locator,
    ...(target.metadata ? {
      metadata: {
        ...target.metadata,
        ...(target.metadata.title !== undefined ? { title: '<redacted>' } : {}),
        ...(target.metadata.url !== undefined ? { url: '<redacted>' } : {})
      }
    } : {})
  }
}
