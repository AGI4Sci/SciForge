import {
  capabilityInvocationResultSchema,
  capabilityObservationSchema,
  capabilityResourceHandleSchema,
  type CapabilityDescriptor,
  type CapabilityInvocationRequest,
  type CapabilityInvocationResult,
  type CapabilityObservation,
  type CapabilityResourceContentAccess,
  type CapabilityResourceHandle
} from '../shared/capability-broker'
import type { SciForgeApi } from '../shared/sciforge-api'

export const PRELOAD_CAPABILITY_IDS = Object.freeze({
  workspacePreviewList: 'workspace-preview.list',
  workspacePreviewOpen: 'workspace-preview.open',
  workspacePreviewDescribeAsset: 'workspace-preview.describe-asset',
  workspacePreviewReadRange: 'workspace-preview.read-range',
  workspacePreviewPrepareArtifact: 'workspace-preview.prepare-artifact',
  workspacePreviewReadArtifactRange: 'workspace-preview.read-artifact-range',
  workspacePreviewApplyEdit: 'workspace-preview.apply-edit',
  workspacePreviewExport: 'workspace-preview.export',
  workspacePreviewInvokeAction: 'workspace-preview.invoke-action',
  workspacePreviewRelease: 'workspace-preview.release',
  biologyRoomCreate: 'biology-room.create',
  biologyRoomOpenOrCreate: 'biology-room.open-or-create',
  biologyRoomLoad: 'biology-room.load',
  biologyRoomList: 'biology-room.list',
  biologyRoomOpen: 'biology-room.open',
  biologyRoomApply: 'biology-room.apply',
  biologyRoomRefresh: 'biology-room.refresh',
  biologyRoomHistory: 'biology-room.history'
} as const)

export type PreloadIpcInvoke = (channel: string, payload?: unknown) => Promise<unknown>

export type CapabilityFacadeOptions = Readonly<{
  invoke: PreloadIpcInvoke
  createInvocationId?: () => string
  createResourceContentUrl?: (access: CapabilityResourceContentAccess) => string | null
}>

type WorkspacePreviewFacade = Omit<
  SciForgeApi['workspacePreview'],
  'onChanged'
>
type BiologyRoomFacade = Omit<NonNullable<SciForgeApi['biologyRoom']>, 'pickFile'>

export type CapabilityFacades = Readonly<{
  workspacePreview: WorkspacePreviewFacade
  biologyRoom: BiologyRoomFacade
}>

type ResourceBinding = {
  resource: CapabilityResourceHandle
  workspaceId: string
  operations: CapabilityDescriptor[]
  resourceRef?: string
  observeSignature?: string
  lastObservation?: CapabilityObservation
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

export function createCapabilityFacades(options: CapabilityFacadeOptions): CapabilityFacades {
  const createInvocationId = options.createInvocationId ?? defaultInvocationId
  const previewResources = new Map<string, ResourceBinding>()
  const roomResources = new Map<string, ResourceBinding>()

  const invokeCapability = async (input: InvocationOptions): Promise<CapabilityInvocationResult> => {
    const request: CapabilityInvocationRequest = {
      actionId: input.actionId,
      input: jsonInput(input.input),
      ...(input.binding ? { resource: input.binding.resource } : {}),
      ...(input.invocationId ? { invocationId: input.invocationId } : {}),
      ...(input.expectedRevision && input.binding
        ? { expectedRevision: input.binding.resource.semanticRevision }
        : {})
    }
    return capabilityInvocationResultSchema.parse(await options.invoke('capability:invoke', {
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      request,
      ...(input.approval ? { approval: input.approval } : {})
    }))
  }

  const observeResource = async (binding: ResourceBinding) => {
    const observation = capabilityObservationSchema.parse(await options.invoke('capability:observe', {
      workspaceId: binding.workspaceId,
      request: { resource: binding.resource }
    }))
    binding.resource = observation.resource
    binding.resourceRef = observation.resourceRef
    binding.operations = observation.operations
    binding.lastObservation = observation
    return observation
  }

  const invokePreview = async <Output>(
    sessionId: string,
    input: Omit<InvocationOptions, 'binding' | 'workspaceId'>
  ): Promise<Output> => {
    const binding = requireBinding(previewResources, sessionId, 'Workspace Preview session')
    const result = await invokeCapability({ ...input, binding, workspaceId: binding.workspaceId })
    updateBinding(binding, result)
    return result.output as Output
  }

  const acquireRoom = async (
    workspaceId: string,
    roomId: string,
    observeInput: Record<string, unknown> = {}
  ): Promise<ResourceBinding> => {
    const observeSignature = stableSignature(observeInput)
    const current = roomResources.get(roomId)
    if (current && current.workspaceId === workspaceId && current.observeSignature === observeSignature) return current
    const result = await invokeCapability({
      actionId: PRELOAD_CAPABILITY_IDS.biologyRoomOpen,
      workspaceId,
      input: { roomId, ...observeInput }
    })
    const output = requireRecord(result.output, PRELOAD_CAPABILITY_IDS.biologyRoomOpen)
    const resource = capabilityResourceHandleSchema.parse(output.resource)
    const binding: ResourceBinding = { resource, workspaceId, operations: [], observeSignature }
    roomResources.set(roomId, binding)
    await observeResource(binding)
    return binding
  }

  const invokeRoom = async <Output>(
    workspaceId: string,
    roomId: string,
    input: Omit<InvocationOptions, 'binding' | 'workspaceId'>
  ): Promise<Output> => {
    const binding = roomResources.get(roomId) ?? await acquireRoom(workspaceId, roomId)
    if (binding.workspaceId !== workspaceId) {
      throw new Error(`Biology Room ${roomId} is bound to a different workspace.`)
    }
    const result = await invokeCapability({ ...input, binding, workspaceId })
    updateBinding(binding, result)
    return result.output as Output
  }

  const workspacePreview: WorkspacePreviewFacade = {
    listPlugins: async () => (
      await invokeCapability({ actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewList, input: {} })
    ).output as Awaited<ReturnType<WorkspacePreviewFacade['listPlugins']>>,
    open: async (input) => {
      const result = await invokeCapability({
        actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewOpen,
        workspaceId: input.workspaceRoot,
        input
      })
      if (!isSuccessfulResult(result.output)) return result.output as Awaited<ReturnType<WorkspacePreviewFacade['open']>>
      const { value, resource } = takeResource(result.output, PRELOAD_CAPABILITY_IDS.workspacePreviewOpen)
      const sessionId = requireNestedString(value, ['session', 'id'], PRELOAD_CAPABILITY_IDS.workspacePreviewOpen)
      const binding: ResourceBinding = { resource, workspaceId: input.workspaceRoot, operations: [] }
      previewResources.set(sessionId, binding)
      return {
        ...value,
        capability: capabilityBinding(binding)
      } as Awaited<ReturnType<WorkspacePreviewFacade['open']>>
    },
    observe: async (sessionId) => {
      const binding = requireBinding(previewResources, sessionId, 'Workspace Preview session')
      const observation = await observeResource(binding)
      const state = requireRecord(observation.state, PRELOAD_CAPABILITY_IDS.workspacePreviewOpen)
      return {
        ok: true,
        observation: state.observation,
        capability: capabilityBinding(binding)
      } as Awaited<ReturnType<WorkspacePreviewFacade['observe']>>
    },
    describeAsset: (sessionId) => invokePreview(sessionId, {
      actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewDescribeAsset,
      input: {}
    }),
    readRange: (sessionId, range) => invokePreview(sessionId, {
      actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewReadRange,
      input: { range }
    }),
    prepareArtifact: (sessionId, request) => invokePreview(sessionId, {
      actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewPrepareArtifact,
      invocationId: createInvocationId(),
      input: { request }
    }),
    readArtifactRange: (sessionId, request) => invokePreview(sessionId, {
      actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewReadArtifactRange,
      input: { request }
    }),
    applyEdit: async (sessionId, operation) => {
      const result = await invokePreview<Record<string, unknown>>(sessionId, {
        actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewApplyEdit,
        invocationId: createInvocationId(),
        expectedRevision: true,
        input: { operation }
      })
      return attachCapabilityToSuccess(
        result,
        requireBinding(previewResources, sessionId, 'Workspace Preview session')
      ) as Awaited<ReturnType<WorkspacePreviewFacade['applyEdit']>>
    },
    export: (sessionId, target) => invokePreview(sessionId, {
      actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewExport,
      invocationId: createInvocationId(),
      approval: { mode: 'confirmation' },
      input: { target }
    }),
    invokeAction: async (sessionId, action) => {
      const result = await invokePreview<Record<string, unknown>>(sessionId, {
        actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewInvokeAction,
        invocationId: createInvocationId(),
        expectedRevision: true,
        input: { action }
      })
      return attachCapabilityToSuccess(
        result,
        requireBinding(previewResources, sessionId, 'Workspace Preview session')
      ) as Awaited<ReturnType<WorkspacePreviewFacade['invokeAction']>>
    },
    releaseSession: async (sessionId) => {
      const released = await invokePreview<boolean>(sessionId, {
        actionId: PRELOAD_CAPABILITY_IDS.workspacePreviewRelease,
        invocationId: createInvocationId(),
        input: {}
      })
      if (released) previewResources.delete(sessionId)
      return released
    },
    getAssetSourceUrl: (sessionId) => {
      const binding = previewResources.get(sessionId)
      if (!binding || !options.createResourceContentUrl) return null
      return options.createResourceContentUrl({
        workspaceId: binding.workspaceId,
        resource: binding.resource
      })
    },
    watch: (payload) => options.invoke('file:watch-workspace', payload) as ReturnType<WorkspacePreviewFacade['watch']>,
    unwatch: (watchId) => options.invoke('file:unwatch-workspace', watchId) as ReturnType<WorkspacePreviewFacade['unwatch']>
  }

  const biologyRoom: BiologyRoomFacade = {
    create: async (input) => {
      const { workspaceRoot, ...actionInput } = input
      const result = await invokeCapability({
        actionId: PRELOAD_CAPABILITY_IDS.biologyRoomCreate,
        workspaceId: workspaceRoot,
        invocationId: createInvocationId(),
        input: actionInput
      })
      const { value, resource } = takeResource(result.output, PRELOAD_CAPABILITY_IDS.biologyRoomCreate)
      const manifest = requireRecord(value.manifest, PRELOAD_CAPABILITY_IDS.biologyRoomCreate)
      const roomId = requireString(manifest.roomId, 'Biology Room manifest roomId')
      const binding: ResourceBinding = {
        resource,
        workspaceId: workspaceRoot,
        operations: [],
        observeSignature: stableSignature({})
      }
      roomResources.set(roomId, binding)
      await observeResource(binding)
      return attachCapability(manifest, binding) as Awaited<ReturnType<BiologyRoomFacade['create']>>
    },
    openOrCreate: async (input) => {
      const { workspaceRoot, ...actionInput } = input
      const result = await invokeCapability({
        actionId: PRELOAD_CAPABILITY_IDS.biologyRoomOpenOrCreate,
        workspaceId: workspaceRoot,
        invocationId: createInvocationId(),
        input: actionInput
      })
      const { value, resource } = takeResource(result.output, PRELOAD_CAPABILITY_IDS.biologyRoomOpenOrCreate)
      const manifest = requireRecord(value.manifest, PRELOAD_CAPABILITY_IDS.biologyRoomOpenOrCreate)
      const roomId = requireString(manifest.roomId, 'Biology Room manifest roomId')
      const binding: ResourceBinding = {
        resource,
        workspaceId: workspaceRoot,
        operations: [],
        observeSignature: stableSignature({})
      }
      roomResources.set(roomId, binding)
      await observeResource(binding)
      return {
        ...value,
        manifest: attachCapability(manifest, binding)
      } as Awaited<ReturnType<BiologyRoomFacade['openOrCreate']>>
    },
    load: async (input) => {
      const { workspaceRoot, ...actionInput } = input
      const result = await invokeCapability({
        actionId: PRELOAD_CAPABILITY_IDS.biologyRoomLoad,
        workspaceId: workspaceRoot,
        input: actionInput
      })
      const { value, resource } = takeResource(result.output, PRELOAD_CAPABILITY_IDS.biologyRoomLoad)
      const manifest = requireRecord(value.manifest, PRELOAD_CAPABILITY_IDS.biologyRoomLoad)
      const roomId = requireString(manifest.roomId, 'Biology Room manifest roomId')
      const binding: ResourceBinding = {
        resource,
        workspaceId: workspaceRoot,
        operations: [],
        observeSignature: stableSignature({})
      }
      roomResources.set(roomId, binding)
      await observeResource(binding)
      return attachCapability(manifest, binding) as Awaited<ReturnType<BiologyRoomFacade['load']>>
    },
    list: async (input) => {
      const { workspaceRoot, ...actionInput } = input
      return (
        await invokeCapability({
          actionId: PRELOAD_CAPABILITY_IDS.biologyRoomList,
          workspaceId: workspaceRoot,
          input: actionInput
        })
      ).output as Awaited<ReturnType<BiologyRoomFacade['list']>>
    },
    observe: async (input) => {
      const { workspaceRoot, roomId, ...observeInput } = input
      const signature = stableSignature(observeInput)
      const existing = roomResources.get(roomId)
      const reuseExisting = existing?.workspaceId === workspaceRoot && existing.observeSignature === signature
      const binding = await acquireRoom(workspaceRoot, roomId, observeInput)
      const observation = reuseExisting
        ? await observeResource(binding)
        : binding.lastObservation ?? await observeResource(binding)
      return observation.state as Awaited<ReturnType<BiologyRoomFacade['observe']>>
    },
    apply: async (input) => {
      const { workspaceRoot, roomId, baseRevision: _baseRevision, ...actionInput } = input
      const result = await invokeRoom<Record<string, unknown>>(workspaceRoot, roomId, {
        actionId: PRELOAD_CAPABILITY_IDS.biologyRoomApply,
        invocationId: createInvocationId(),
        expectedRevision: true,
        input: actionInput
      })
      const binding = requireBinding(roomResources, roomId, 'Biology Room')
      return attachCapabilityToApplyResult(result, binding) as Awaited<ReturnType<BiologyRoomFacade['apply']>>
    },
    refresh: async (input) => {
      const { workspaceRoot, roomId, ...actionInput } = input
      const result = await invokeRoom<Record<string, unknown>>(workspaceRoot, roomId, {
        actionId: PRELOAD_CAPABILITY_IDS.biologyRoomRefresh,
        invocationId: createInvocationId(),
        expectedRevision: true,
        input: actionInput
      })
      const binding = requireBinding(roomResources, roomId, 'Biology Room')
      return attachCapabilityToApplyResult(result, binding) as Awaited<ReturnType<BiologyRoomFacade['refresh']>>
    },
    history: async (input) => {
      const { workspaceRoot, roomId, ...actionInput } = input
      return invokeRoom(workspaceRoot, roomId, {
        actionId: PRELOAD_CAPABILITY_IDS.biologyRoomHistory,
        input: actionInput
      })
    }
  }

  return { workspacePreview, biologyRoom }
}

function requireBinding(
  bindings: Map<string, ResourceBinding>,
  id: string,
  label: string
): ResourceBinding {
  const binding = bindings.get(id)
  if (!binding) throw new Error(`${label} ${id} has no capability resource handle.`)
  return binding
}

function updateBinding(binding: ResourceBinding, result: CapabilityInvocationResult): void {
  if (result.resource) binding.resource = result.resource
}

function capabilityBinding(binding: ResourceBinding) {
  return {
    resource: binding.resource,
    ...(binding.resourceRef ? { resourceRef: binding.resourceRef } : {}),
    operations: binding.operations
  }
}

function attachCapability(
  value: Record<string, unknown>,
  binding: ResourceBinding
): Record<string, unknown> {
  return { ...value, capability: capabilityBinding(binding) }
}

function attachCapabilityToSuccess(
  value: Record<string, unknown>,
  binding: ResourceBinding
): Record<string, unknown> {
  return value.ok === true ? attachCapability(value, binding) : value
}

function attachCapabilityToApplyResult(
  value: Record<string, unknown>,
  binding: ResourceBinding
): Record<string, unknown> {
  const manifest = requireRecord(value.manifest, 'Biology Room mutation manifest')
  return { ...value, manifest: attachCapability(manifest, binding) }
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

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is missing.`)
  return value
}

function requireNestedString(value: Record<string, unknown>, path: string[], label: string): string {
  let current: unknown = value
  for (const segment of path) current = requireRecord(current, label)[segment]
  return requireString(current, `${label} ${path.join('.')}`)
}

function jsonInput(value: unknown): CapabilityInvocationRequest['input'] {
  return value as CapabilityInvocationRequest['input']
}

function stableSignature(value: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
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
