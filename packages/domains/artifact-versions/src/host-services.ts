import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type {
  HostServiceClientFactory,
  HostServiceProvider,
  HostServiceRequest
} from '@sciforge/plugin-sdk'
import {
  ARTIFACT_VERSION_COMMIT_CONTRACT,
  ARTIFACT_VERSION_READ_CONTRACT
} from './contract.js'

/** Generic Host service used by plugins that declare `dshAuthorization.ports`. */
export const ARTIFACT_VERSIONS_HOST_SERVICE_ID = 'artifact-versions' as const
/**
 * Workspace-scoped client service for plugins whose exact package/version
 * contract declares it. The explicit root is checked against the Host-bound
 * caller workspace before the domain's commit/read capabilities execute.
 */
export const ARTIFACT_HOST_SERVICE_ID = 'artifact-versions.workspace' as const

const genericOperations = Object.freeze({
  commit: Object.freeze({
    contract: ARTIFACT_VERSION_COMMIT_CONTRACT,
    port: 'artifacts.commit'
  }),
  read: Object.freeze({
    contract: ARTIFACT_VERSION_READ_CONTRACT,
    port: 'artifacts.read'
  })
})

type GenericOperationName = keyof typeof genericOperations

type InvocationAuthority = Readonly<{
  caller?: Readonly<Record<string, unknown>>
  ordinarySession?: Readonly<Record<string, unknown>>
  originalContext?: Readonly<Record<string, unknown>>
  effect?: string
}>

export type ArtifactVersionsHostServiceOptions = Readonly<{
  capabilities: {
    invoke(
      request: Readonly<{ actionId: string; input: unknown; invocationId?: string }>,
      context: Readonly<{
        caller: Readonly<Record<string, unknown>>
        ordinarySession?: Readonly<Record<string, unknown>>
        originalContext?: Readonly<Record<string, unknown>>
        signal: AbortSignal
        assertCurrent(): void
      }>
    ): Promise<unknown>
  }
  /** Host-approved port operations for one exact package/version pair. */
  portsFor?: (packageName: string, version: string) => readonly string[] | undefined
  /** Host decision for the declared caller workspace (client-backed lane). */
  authorizeWorkspace?: (
    input: Readonly<{ caller: Record<string, unknown>; workspaceId: string }>
  ) => boolean | Promise<boolean>
  /**
   * Host-owned admission: `true` only when the exact package version's contract
   * declares this service. Absent means no plugin may reach it.
   */
  authorizeHostService?: (
    input: Readonly<{ packageName: string; version: string; serviceId: string }>
  ) => boolean
  /** Absolute path of the Host-chosen module for workspace-scoped clients. */
  hostServiceClientModule?: string
}>

/** Options for consumers of the workspace-scoped client service. */
export type ArtifactHostServiceOptions = ArtifactVersionsHostServiceOptions

export type ArtifactDomainHostServiceResolver = Readonly<{
  resolve(packageName: string, version: string, generation: number): Readonly<Record<string, HostServiceProvider>> | undefined
  resolveClients(packageName: string, version: string, generation: number): readonly HostServiceClientFactory[]
  serviceIds: readonly string[]
}>

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function publicCallerOf(caller: Record<string, unknown>): Readonly<Record<string, unknown>> {
  // The Broker hands the plugin lane a parsed caller that also carries
  // Host-injected authority (`principal`, `principalContextVersion`, package
  // grants). Re-submitting the whole object is rejected by the Broker's strict
  // public schema; forward the public identity only and let the Broker
  // re-capture the Principal itself.
  return {
    audience: caller.audience,
    callerId: caller.callerId,
    ...(typeof caller.workspaceId === 'string' ? { workspaceId: caller.workspaceId } : {}),
    ...(caller.workspaceLocator !== undefined ? { workspaceLocator: caller.workspaceLocator } : {}),
    approvals: Array.isArray(caller.approvals) ? caller.approvals : []
  }
}

function createGenericProvider(
  options: ArtifactVersionsHostServiceOptions,
  packageName: string,
  version: string
): HostServiceProvider | undefined {
  const approved = new Set(options.portsFor?.(packageName, version) ?? [])
  if (approved.size === 0) return undefined
  const invoke = async (operation: GenericOperationName, request: HostServiceRequest): Promise<unknown> => {
    const entry = genericOperations[operation]
    request.assertCurrent?.()
    request.signal.throwIfAborted()
    const input = entry.contract.inputSchema.parse(request.input)
    const authority = (request.owner.authority ?? {}) as InvocationAuthority
    const caller = authority.caller
    if (!caller || typeof caller !== 'object') throw new Error('Artifact versions requires an authenticated Host caller.')
    const idempotencyKey = operation === 'commit' && input && typeof input === 'object'
      ? (input as { idempotencyKey?: unknown }).idempotencyKey
      : undefined
    const invocationId = typeof idempotencyKey === 'string'
      ? `artifact-versions:${createHash('sha256').update(idempotencyKey).digest('hex')}`
      : undefined
    const result = await options.capabilities.invoke(
      { actionId: entry.contract.actionId, input, ...(invocationId ? { invocationId } : {}) },
      {
        caller: publicCallerOf(record(caller)),
        ...(authority.ordinarySession ? { ordinarySession: authority.ordinarySession as Readonly<Record<string, unknown>> } : {}),
        ...(authority.originalContext ? { originalContext: authority.originalContext } : {}),
        signal: request.signal,
        assertCurrent: () => request.assertCurrent?.()
      }
    )
    request.assertCurrent?.()
    request.signal.throwIfAborted()
    return entry.contract.outputSchema.parse(result)
  }
  return Object.freeze({
    authorize(request: HostServiceRequest): void {
      if (request.owner.packageName !== packageName || request.owner.version !== version) {
        throw new Error(`Artifact versions host service owner mismatch for ${request.owner.packageName}@${request.owner.version}.`)
      }
      const entry = genericOperations[request.operation as GenericOperationName]
      if (!entry || !approved.has(entry.port)) {
        throw new Error(`Artifact versions port ${request.operation} is not approved for ${packageName}@${version}.`)
      }
      request.assertCurrent?.()
    },
    operations: Object.freeze({
      commit: (request: HostServiceRequest) => invoke('commit', request),
      read: (request: HostServiceRequest) => invoke('read', request)
    })
  })
}

const workspacePayloadSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(8_192),
  input: z.unknown()
}).strict()

type WorkspacePayload = z.infer<typeof workspacePayloadSchema>

const workspaceOperationEffects: Readonly<Record<string, 'read' | 'workspace-write'>> = Object.freeze({
  commit: 'workspace-write',
  read: 'read'
})

function createWorkspaceProvider(
  options: ArtifactVersionsHostServiceOptions,
  packageName: string,
  version: string
): HostServiceProvider {
  const authorize = async (request: HostServiceRequest): Promise<WorkspacePayload> => {
    if (request.owner.packageName !== packageName || request.owner.version !== version) {
      throw new Error('Artifact Host service owner does not match its resolved plugin.')
    }
    if (!request.assertCurrent) {
      throw new Error('Artifact Host service requires the live Host principal lease.')
    }
    const required = workspaceOperationEffects[request.operation]
    const effect = (request.owner.authority as InvocationAuthority).effect
    if (required === undefined || !(effect === 'workspace-write' || effect === 'destructive' || (effect === 'read' && required === 'read'))) {
      throw new Error(`Artifact operation ${request.operation} is not authorized by capability effect ${String(effect)}.`)
    }
    const payload = workspacePayloadSchema.parse(request.input)
    const caller = record(request.owner.authority.caller)
    const declaredWorkspace = typeof caller.workspaceId === 'string' ? caller.workspaceId.trim() : ''
    if (declaredWorkspace.length === 0 || declaredWorkspace !== payload.workspaceRoot) {
      throw new Error('Artifact Host service requires the caller-bound workspace root.')
    }
    if (options.authorizeWorkspace && !await options.authorizeWorkspace({ caller, workspaceId: payload.workspaceRoot })) {
      throw new Error(`Artifact Host service is not authorized for workspace ${payload.workspaceRoot}.`)
    }
    if (request.owner.authority.ordinarySession === undefined && caller.audience !== 'ui') {
      throw new Error('Artifact Host service requires an ordinary Session or an authenticated UI caller.')
    }
    request.assertCurrent()
    return payload
  }

  const invoke = async (
    contract: typeof ARTIFACT_VERSION_COMMIT_CONTRACT | typeof ARTIFACT_VERSION_READ_CONTRACT,
    request: HostServiceRequest
  ): Promise<unknown> => {
    const payload = await authorize(request)
    const input = contract.inputSchema.parse(payload.input)
    const caller = record(request.owner.authority.caller)
    const idempotencyKey = 'idempotencyKey' in input ? input.idempotencyKey : undefined
    // The Broker scopes idempotency by caller, workspace and action; the plugin's
    // key only needs to be stable for the same logical operation.
    const invocationId = typeof idempotencyKey === 'string'
      ? `plugin-artifacts:${createHash('sha256').update(`${packageName}\u0000${idempotencyKey}`).digest('hex')}`
      : undefined
    const originalContext = request.owner.authority.originalContext
    const assertCurrent = (): void => {
      request.signal.throwIfAborted()
      request.assertCurrent!()
    }
    assertCurrent()
    const result = await options.capabilities.invoke(
      { actionId: contract.actionId, input, ...(invocationId ? { invocationId } : {}) },
      {
        caller: publicCallerOf(caller),
        ...(request.owner.authority.ordinarySession === undefined
          ? {}
          : { ordinarySession: request.owner.authority.ordinarySession as Readonly<Record<string, unknown>> }),
        ...(originalContext === undefined ? {} : { originalContext: originalContext as Readonly<Record<string, unknown>> }),
        signal: request.signal,
        assertCurrent
      }
    )
    assertCurrent()
    return contract.outputSchema.parse(result)
  }

  return Object.freeze({
    authorize: async (request) => { await authorize(request) },
    operations: Object.freeze({
      commit: (request: HostServiceRequest) => invoke(ARTIFACT_VERSION_COMMIT_CONTRACT, request),
      read: (request: HostServiceRequest) => invoke(ARTIFACT_VERSION_READ_CONTRACT, request)
    })
  })
}

export function createDomainHostServiceResolver(
  rawOptions: Readonly<Record<string, unknown>>
): ArtifactDomainHostServiceResolver {
  const options = rawOptions as ArtifactVersionsHostServiceOptions
  const workspaceAdmitted = (packageName: string, version: string): boolean =>
    options.authorizeHostService?.({ packageName, version, serviceId: ARTIFACT_HOST_SERVICE_ID }) === true
  return Object.freeze({
    resolve(packageName, version) {
      const generic = createGenericProvider(options, packageName, version)
      // Fail closed: the workspace service is never advertised to a package whose
      // Host contract did not admit it.
      const workspace = workspaceAdmitted(packageName, version)
        ? createWorkspaceProvider(options, packageName, version)
        : undefined
      if (generic === undefined && workspace === undefined) return undefined
      return Object.freeze({
        ...(generic === undefined ? {} : { [ARTIFACT_VERSIONS_HOST_SERVICE_ID]: generic }),
        ...(workspace === undefined ? {} : { [ARTIFACT_HOST_SERVICE_ID]: workspace })
      })
    },
    resolveClients(packageName, version) {
      if (!workspaceAdmitted(packageName, version)) return Object.freeze([])
      const modulePath = options.hostServiceClientModule?.trim()
      if (!modulePath || !isAbsolute(modulePath)) return Object.freeze([])
      return Object.freeze([Object.freeze({
        serviceId: ARTIFACT_HOST_SERVICE_ID,
        modulePath,
        exportName: 'createHostServiceClient',
        config: Object.freeze({ serviceId: ARTIFACT_HOST_SERVICE_ID })
      })])
    },
    serviceIds: Object.freeze([ARTIFACT_VERSIONS_HOST_SERVICE_ID, ARTIFACT_HOST_SERVICE_ID])
  })
}