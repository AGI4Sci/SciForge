import { realpath } from 'node:fs/promises'
import { type HostServiceClientFactory, type HostServiceRequest, type PluginAdapterContract } from '@sciforge/plugin-sdk'
import type { CapabilityAgentToolRequestContext } from '../capabilities/agent-tools'
import type { AgentRuntimeHost } from '../runtime/agent-runtime/host'
import type { InstalledDomainHostServiceResolution } from '../modules/installed-domain-main'
import type { WorkspaceAuthority } from './workspace-authority'
import { createNativeExecutionHostService } from './native-execution-host-service'
import { mergeHostServiceResolutions } from './host-service-resolution'

export type ApprovedPluginContracts = { get(key: string): PluginAdapterContract | undefined }

/** Only an explicit, approved declaration for this exact package version grants a client. */
export function approvesHostService(contracts: ApprovedPluginContracts, input: Readonly<{ packageName: string; version: string; serviceId: string }>): boolean {
  const contract = contracts.get(`${input.packageName}@${input.version}`)
  const authorization = contract?.dshAuthorization
  return contract?.approved === true && authorization?.packageName === input.packageName && authorization.packageVersion === input.version
    && Array.isArray(authorization.hostServices) && authorization.hostServices.includes(input.serviceId)
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Authenticated native execution context is unavailable.')
  return value as Readonly<Record<string, unknown>>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Authenticated native execution context is incomplete.')
  return value
}

/** Composes the native provider with all domain providers through the same trusted service lane. */
export function composeNativeExecutionHostServices(input: Readonly<{
  domains: InstalledDomainHostServiceResolution
  contracts: ApprovedPluginContracts
  clientModulePath: string
  authorizeWorkspace: WorkspaceAuthority
  runtimeHost: () => AgentRuntimeHost | null | undefined
}>): InstalledDomainHostServiceResolution {
  const authenticated = async (request: HostServiceRequest) => {
    request.assertCurrent?.()
    request.signal.throwIfAborted()
    if (!approvesHostService(input.contracts, { ...request.owner, serviceId: 'nativeExecution' })) throw new Error('Native execution is not approved for this package version.')
    const authority = record(request.owner.authority)
    const caller = record(authority.caller)
    const session = record(authority.ordinarySession)
    const workspaceId = text(caller.workspaceId)
    if (!await input.authorizeWorkspace({ caller: { ...caller }, workspaceId })) throw new Error('Native execution workspace is not trusted.')
    const workspaceRoot = await realpath(workspaceId)
    const runtimeId = text(session.runtimeId)
    const threadId = text(session.threadId)
    const original = authority.originalContext === undefined ? undefined : record(authority.originalContext)
    if (original && (original.runtimeId !== runtimeId || original.threadId !== threadId)) throw new Error('Native execution session provenance does not match its agent context.')
    const host = input.runtimeHost()
    if (!host) throw new Error('Agent runtime Host is unavailable.')
    const context: CapabilityAgentToolRequestContext = {
      ...(original ?? {}),
      requestId: typeof original?.requestId === 'string' || typeof original?.requestId === 'number' ? original.requestId : request.owner.invocationId,
      runtimeId,
      threadId,
      workspaceId: workspaceRoot
    }
    const uiBound = runtimeId === 'sciforge-ui' && original === undefined && caller.audience === 'ui'
    if (runtimeId === 'sciforge-ui' && !uiBound) throw new Error('Native execution UI session requires authenticated UI authority.')
    if (!uiBound) {
      const snapshot = await host.readThreadSnapshot({ runtimeId: runtimeId as Parameters<AgentRuntimeHost['readThreadSnapshot']>[0]['runtimeId'], threadId })
      if (!snapshot.workspace || await realpath(snapshot.workspace) !== workspaceRoot) throw new Error('Native execution workspace does not match the live runtime thread.')
    }
    request.assertCurrent?.()
    request.signal.throwIfAborted()
    return { authority, host, context, workspaceRoot, uiBound, hasAgentContext: original !== undefined }
  }
  const provider = createNativeExecutionHostService({
    // The runner uses this same Host executable with ELECTRON_RUN_AS_NODE=1.
    nodeExecutable: process.execPath,
    resolveContext: async request => {
      const resolved = await authenticated(request)
      const mode = resolved.uiBound ? 'workspace-write' : await resolved.host.resolveCapabilitySandboxMode(resolved.context)
      return {
        workspaceRoot: resolved.workspaceRoot,
        policy: { mode, workspaceRoot: resolved.workspaceRoot, ...(typeof resolved.authority.sessionId === 'string' ? { sessionId: resolved.authority.sessionId } : {}) }
      }
    },
    requestApproval: async (request, approval) => {
      const resolved = await authenticated(request)
      if (!resolved.hasAgentContext || !resolved.context.turnId || !resolved.context.callId) return 'unavailable'
      const decision = await resolved.host.requestCapabilityApproval({
        context: resolved.context,
        actionId: text(resolved.authority.capabilityId),
        invocationId: request.owner.invocationId,
        mode: 'confirmation',
        title: 'Approve native execution',
        description: approval.reason,
        effect: 'workspace-write',
        input: { reason: approval.reason, ...(approval.toolName ? { toolName: approval.toolName } : {}), ...(approval.callId ? { callId: approval.callId } : {}) }
      }, { signal: request.signal, forceHuman: true })
      return decision === 'allowed' ? 'allowed-once' : decision === 'denied' ? 'rejected' : 'cancelled'
    }
  })
  const clients: readonly HostServiceClientFactory[] = Object.freeze([Object.freeze({
    serviceId: 'nativeExecution',
    provides: Object.freeze(['workingDirectory', 'sandboxPolicy', 'sandbox', 'subprocess', 'approval', 'commands']),
    modulePath: input.clientModulePath,
    exportName: 'createNativeExecutionClients',
    config: Object.freeze({})
  })])
  const approved = (packageName: string, version: string) => approvesHostService(input.contracts, { packageName, version, serviceId: 'nativeExecution' })
  return mergeHostServiceResolutions(input.domains, {
    hostServiceIds: Object.freeze(['nativeExecution']),
    resolveHostServiceProviders: (packageName, version) => approved(packageName, version) ? { nativeExecution: provider } : undefined,
    resolveHostServiceClients: (packageName, version) => approved(packageName, version) ? clients : []
  })
}
