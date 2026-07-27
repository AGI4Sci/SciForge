import {
  CAPABILITY_BROKER_CONTRACT_VERSION,
  capabilityInvocationResultSchema,
  capabilityObservationSchema,
  capabilityReadinessSchema,
  capabilityResourceHandleSchema,
  type CapabilityDescriptor,
  type CapabilityInvocationRequest,
  type CapabilityInvocationResult,
  type CapabilityResourceHandle
} from '@shared/capability-broker'
import type {
  SciForgeApi,
  WorkspacePreviewAnnotationImportResult,
  WorkspacePreviewAnnotationListResult,
  WorkspacePreviewAnnotationReviewGenerateResult,
  WorkspacePreviewAnnotationReviewImproveResult,
  WorkspacePreviewApplyEditResult,
  WorkspacePreviewDescribeAssetResult,
  WorkspacePreviewExportResult,
  WorkspacePreviewInvokeActionResult,
  WorkspacePreviewObserveResult,
  WorkspacePreviewOpenInput,
  WorkspacePreviewOpenResult,
  WorkspacePreviewPrepareArtifactResult,
  WorkspacePreviewReadArtifactRangeResult,
  WorkspacePreviewReadRangeResult
} from '@shared/sciforge-api'
import type {
  WorkspacePreviewAnnotationDeleteInput,
  WorkspacePreviewAnnotationResolveInput,
  WorkspacePreviewAnnotationSidecarImportActionInput,
  WorkspacePreviewAnnotationUpdateInput,
  WorkspacePreviewByteRange,
  WorkspacePreviewEditOperation,
  WorkspacePreviewExportTarget,
  WorkspacePreviewPluginActionInput,
  WorkspacePreviewPluginManifest,
  WorkspacePreviewPrepareArtifactRequest,
  WorkspacePreviewReadArtifactRangeRequest
} from '@shared/workspace-preview'
import type {
  PdfReviewGenerateActionInput,
  PdfReviewImproveAnnotationActionInput
} from '@shared/pdf-review'

const WORKSPACE_PREVIEW_CAPABILITY_IDS = Object.freeze({
  list: 'workspace-preview.list',
  open: 'workspace-preview.open',
  describeAsset: 'workspace-preview.describe-asset',
  readRange: 'workspace-preview.read-range',
  prepareArtifact: 'workspace-preview.prepare-artifact',
  readArtifactRange: 'workspace-preview.read-artifact-range',
  applyEdit: 'workspace-preview.apply-edit',
  annotationsList: 'workspace-preview.annotations.list',
  annotationsUpdate: 'workspace-preview.annotations.update',
  annotationsResolve: 'workspace-preview.annotations.resolve',
  annotationsDelete: 'workspace-preview.annotations.delete',
  annotationsImport: 'workspace-preview.annotations.import',
  annotationsReviewGenerate: 'workspace-preview.annotations.review.generate',
  annotationsReviewImprove: 'workspace-preview.annotations.review.improve',
  export: 'workspace-preview.export',
  invokeAction: 'workspace-preview.invoke-action',
  release: 'workspace-preview.release'
} as const)

type CapabilityTransport = Pick<SciForgeApi['capabilities'], 'readiness' | 'invoke' | 'observe' | 'bind'>

type ResourceBinding = {
  resource: CapabilityResourceHandle
  workspaceId: string
  operations: CapabilityDescriptor[]
  resourceRef?: string
  operationQueue: Promise<void>
}

type InvocationOptions = {
  actionId: string
  workspaceId?: string
  input: unknown
  binding?: ResourceBinding
  invocationId?: string
  expectedRevision?: boolean
  approval?: { mode: 'confirmation' }
}

export type WorkspacePreviewCapabilityAdapter = {
  listPlugins: () => Promise<WorkspacePreviewPluginManifest[]>
  open: (input: WorkspacePreviewOpenInput) => Promise<WorkspacePreviewOpenResult>
  observe: (sessionId: string) => Promise<WorkspacePreviewObserveResult>
  describeAsset: (sessionId: string) => Promise<WorkspacePreviewDescribeAssetResult>
  readRange: (sessionId: string, range: WorkspacePreviewByteRange) => Promise<WorkspacePreviewReadRangeResult>
  prepareArtifact: (
    sessionId: string,
    request: WorkspacePreviewPrepareArtifactRequest
  ) => Promise<WorkspacePreviewPrepareArtifactResult>
  readArtifactRange: (
    sessionId: string,
    request: WorkspacePreviewReadArtifactRangeRequest
  ) => Promise<WorkspacePreviewReadArtifactRangeResult>
  applyEdit: (sessionId: string, operation: WorkspacePreviewEditOperation) => Promise<WorkspacePreviewApplyEditResult>
  listAnnotations: (sessionId: string) => Promise<WorkspacePreviewAnnotationListResult>
  updateAnnotation: (
    sessionId: string,
    input: WorkspacePreviewAnnotationUpdateInput
  ) => Promise<WorkspacePreviewApplyEditResult>
  resolveAnnotation: (
    sessionId: string,
    input: WorkspacePreviewAnnotationResolveInput
  ) => Promise<WorkspacePreviewApplyEditResult>
  deleteAnnotation: (
    sessionId: string,
    input: WorkspacePreviewAnnotationDeleteInput
  ) => Promise<WorkspacePreviewApplyEditResult>
  importAnnotations: (
    sessionId: string,
    input: WorkspacePreviewAnnotationSidecarImportActionInput
  ) => Promise<WorkspacePreviewAnnotationImportResult>
  generateAnnotationReview: (
    sessionId: string,
    input: PdfReviewGenerateActionInput
  ) => Promise<WorkspacePreviewAnnotationReviewGenerateResult>
  improveAnnotationReview: (
    sessionId: string,
    input: PdfReviewImproveAnnotationActionInput
  ) => Promise<WorkspacePreviewAnnotationReviewImproveResult>
  export: (sessionId: string, target: WorkspacePreviewExportTarget) => Promise<WorkspacePreviewExportResult>
  invokeAction: (
    sessionId: string,
    action: WorkspacePreviewPluginActionInput
  ) => Promise<WorkspacePreviewInvokeActionResult>
  releaseSession: (sessionId: string) => Promise<boolean>
}

type WorkspacePreviewCapabilityAdapterOptions = {
  transport?: CapabilityTransport
  getTransport?: () => CapabilityTransport | null | undefined
  createInvocationId?: () => string
  now?: () => number
}

const RESOURCE_HANDLE_RENEWAL_WINDOW_MS = 60_000

export function createWorkspacePreviewCapabilityAdapter(
  options: WorkspacePreviewCapabilityAdapterOptions = {}
): WorkspacePreviewCapabilityAdapter {
  const getTransport = options.transport
    ? () => options.transport
    : options.getTransport ?? defaultTransport
  const createInvocationId = options.createInvocationId ?? defaultInvocationId
  const now = options.now ?? Date.now
  const resources = new Map<string, ResourceBinding>()
  const readinessCache = new Map<string, Awaited<ReturnType<CapabilityTransport['readiness']>>>()

  const requireTransport = (): CapabilityTransport => {
    const transport = getTransport()
    if (!transport) throw new Error('Capability transport is unavailable.')
    return transport
  }

  const requireReadiness = async (actionId: string, workspaceId?: string): Promise<void> => {
    const cacheKey = `${workspaceId ?? ''}\u0000${actionId}`
    const cached = readinessCache.get(cacheKey)
    if (cached?.status === 'ready') return
    const readiness = capabilityReadinessSchema.parse(await requireTransport().readiness({
      ...(workspaceId ? { workspaceId } : {}),
      expectedContractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
      requiredCapabilityIds: [actionId]
    }))
    if (readiness.status !== 'ready') throw new Error(readiness.message)
    readinessCache.set(cacheKey, readiness)
  }

  const invokeCapability = async (input: InvocationOptions): Promise<CapabilityInvocationResult> => {
    const workspaceId = input.workspaceId ?? input.binding?.workspaceId
    await requireReadiness(input.actionId, workspaceId)
    const requestResource = input.binding?.resource
    const request: CapabilityInvocationRequest = {
      actionId: input.actionId,
      input: input.input as CapabilityInvocationRequest['input'],
      ...(requestResource ? { resource: requestResource } : {}),
      ...(input.invocationId ? { invocationId: input.invocationId } : {}),
      ...(input.expectedRevision && requestResource
        ? { expectedRevision: requestResource.semanticRevision }
        : {})
    }
    const result = capabilityInvocationResultSchema.parse(await requireTransport().invoke({
      ...(workspaceId ? { workspaceId } : {}),
      request,
      ...(input.approval ? { approval: input.approval } : {})
    }))
    if (result.actionId !== input.actionId) {
      throw new Error(`Capability result action mismatch: expected "${input.actionId}", received "${result.actionId}".`)
    }
    updateBinding(input.binding, requestResource, result)
    return result
  }

  const invokeSession = async <Output>(
    sessionId: string,
    input: Omit<InvocationOptions, 'binding' | 'workspaceId'>
  ): Promise<Output> => {
    const binding = requireBinding(resources, sessionId)
    return enqueueBindingOperation(binding, async () => {
      await renewBindingResourceIfNeeded(binding)
      return (await invokeCapability({ ...input, binding })).output as Output
    })
  }

  return {
    listPlugins: async () => (
      await invokeCapability({ actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.list, input: {} })
    ).output as WorkspacePreviewPluginManifest[],
    open: async (input) => {
      const result = await invokeCapability({
        actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.open,
        workspaceId: input.workspaceRoot,
        input
      })
      if (!isSuccessfulResult(result.output)) return result.output as WorkspacePreviewOpenResult
      const { value, resource } = takeResource(result.output, WORKSPACE_PREVIEW_CAPABILITY_IDS.open)
      const sessionId = requireNestedString(value, ['session', 'id'], WORKSPACE_PREVIEW_CAPABILITY_IDS.open)
      const binding: ResourceBinding = {
        resource,
        workspaceId: input.workspaceRoot,
        operations: [],
        operationQueue: Promise.resolve()
      }
      resources.set(sessionId, binding)
      return { ...value, capability: capabilityBinding(binding) } as WorkspacePreviewOpenResult
    },
    observe: async (sessionId) => {
      const binding = requireBinding(resources, sessionId)
      return enqueueBindingOperation(binding, async () => {
        await renewBindingResourceIfNeeded(binding)
        const observation = capabilityObservationSchema.parse(await requireTransport().observe({
          workspaceId: binding.workspaceId,
          request: { resource: binding.resource }
        }))
        binding.resource = observation.resource
        binding.resourceRef = observation.resourceRef
        binding.operations = observation.operations
        const state = requireRecord(observation.state, WORKSPACE_PREVIEW_CAPABILITY_IDS.open)
        return {
          ok: true,
          observation: state.observation,
          capability: capabilityBinding(binding)
        } as WorkspacePreviewObserveResult
      })
    },
    describeAsset: (sessionId) => invokeSession(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.describeAsset,
      input: {}
    }),
    readRange: (sessionId, range) => invokeSession(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.readRange,
      input: { range }
    }),
    prepareArtifact: (sessionId, request) => invokeSession(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.prepareArtifact,
      invocationId: createInvocationId(),
      input: { request }
    }),
    readArtifactRange: (sessionId, request) => invokeSession(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.readArtifactRange,
      input: { request }
    }),
    applyEdit: (sessionId, operation) => invokeAndAttach<WorkspacePreviewApplyEditResult>(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.applyEdit,
      invocationId: createInvocationId(),
      expectedRevision: true,
      input: { operation }
    }),
    listAnnotations: (sessionId) => invokeSession(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.annotationsList,
      input: {}
    }),
    updateAnnotation: (sessionId, input) => invokeAndAttach<WorkspacePreviewApplyEditResult>(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.annotationsUpdate,
      invocationId: createInvocationId(),
      expectedRevision: true,
      input
    }),
    resolveAnnotation: (sessionId, input) => invokeAndAttach<WorkspacePreviewApplyEditResult>(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.annotationsResolve,
      invocationId: createInvocationId(),
      expectedRevision: true,
      input
    }),
    deleteAnnotation: (sessionId, input) => invokeAndAttach<WorkspacePreviewApplyEditResult>(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.annotationsDelete,
      invocationId: createInvocationId(),
      expectedRevision: true,
      input
    }),
    importAnnotations: (sessionId, input) => invokeSession(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.annotationsImport,
      invocationId: createInvocationId(),
      expectedRevision: true,
      input
    }),
    generateAnnotationReview: (sessionId, input) => invokeSession(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.annotationsReviewGenerate,
      invocationId: createInvocationId(),
      expectedRevision: true,
      approval: { mode: 'confirmation' },
      input
    }),
    improveAnnotationReview: (sessionId, input) => invokeSession(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.annotationsReviewImprove,
      invocationId: createInvocationId(),
      expectedRevision: true,
      approval: { mode: 'confirmation' },
      input
    }),
    export: (sessionId, target) => invokeSession(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.export,
      invocationId: createInvocationId(),
      approval: { mode: 'confirmation' },
      input: { target }
    }),
    invokeAction: (sessionId, action) => invokeAndAttach<WorkspacePreviewInvokeActionResult>(sessionId, {
      actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.invokeAction,
      invocationId: createInvocationId(),
      expectedRevision: true,
      input: { action }
    }),
    releaseSession: async (sessionId) => {
      const released = await invokeSession<boolean>(sessionId, {
        actionId: WORKSPACE_PREVIEW_CAPABILITY_IDS.release,
        invocationId: createInvocationId(),
        input: {}
      })
      if (released) resources.delete(sessionId)
      return released
    }
  }

  async function renewBindingResourceIfNeeded(binding: ResourceBinding): Promise<void> {
    if (!binding.resourceRef) return
    const expiresAt = Date.parse(binding.resource.expiresAt)
    if (Number.isFinite(expiresAt) && expiresAt - now() > RESOURCE_HANDLE_RENEWAL_WINDOW_MS) return
    binding.resource = capabilityResourceHandleSchema.parse(await requireTransport().bind({
      workspaceId: binding.workspaceId,
      request: { resourceRef: binding.resourceRef }
    }))
  }

  async function invokeAndAttach<Output>(
    sessionId: string,
    input: Omit<InvocationOptions, 'binding' | 'workspaceId'>
  ): Promise<Output> {
    const result = await invokeSession<Record<string, unknown>>(sessionId, input)
    return attachCapabilityToSuccess(result, requireBinding(resources, sessionId)) as Output
  }
}

function defaultTransport(): CapabilityTransport | null {
  if (typeof window === 'undefined') return null
  return window.sciforge?.capabilities ?? null
}

function requireBinding(bindings: Map<string, ResourceBinding>, sessionId: string): ResourceBinding {
  const binding = bindings.get(sessionId)
  if (!binding) throw new Error(`Workspace Preview session ${sessionId} has no capability resource handle.`)
  return binding
}

function enqueueBindingOperation<Output>(
  binding: ResourceBinding,
  operation: () => Promise<Output>
): Promise<Output> {
  const result = binding.operationQueue.then(operation, operation)
  binding.operationQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function updateBinding(
  binding: ResourceBinding | undefined,
  requestResource: CapabilityResourceHandle | undefined,
  result: CapabilityInvocationResult
): void {
  if (!binding || !result.resource) return
  if (requestResource && binding.resource !== requestResource) return
  binding.resource = result.resource
}

function capabilityBinding(binding: ResourceBinding) {
  return {
    resource: binding.resource,
    ...(binding.resourceRef ? { resourceRef: binding.resourceRef } : {}),
    operations: binding.operations
  }
}

function attachCapabilityToSuccess(value: Record<string, unknown>, binding: ResourceBinding): Record<string, unknown> {
  return value.ok === true ? { ...value, capability: capabilityBinding(binding) } : value
}

function takeResource(output: unknown, actionId: string): {
  value: Record<string, unknown>
  resource: CapabilityResourceHandle
} {
  const record = requireRecord(output, actionId)
  const resource = capabilityResourceHandleSchema.parse(record.resource)
  const { resource: _resource, ...value } = record
  return { value, resource }
}

function isSuccessfulResult(value: unknown): value is Record<string, unknown> & { ok: true } {
  return isRecord(value) && value.ok === true
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} returned a non-object result.`)
  return value
}

function requireNestedString(value: Record<string, unknown>, path: string[], label: string): string {
  let current: unknown = value
  for (const segment of path) current = requireRecord(current, label)[segment]
  if (typeof current !== 'string' || !current.trim()) {
    throw new Error(`${label} ${path.join('.')} is missing.`)
  }
  return current
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function defaultInvocationId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Secure UUID generation is unavailable for capability invocation.')
  }
  return globalThis.crypto.randomUUID()
}
