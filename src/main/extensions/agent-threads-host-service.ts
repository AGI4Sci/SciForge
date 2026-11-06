import { isAbsolute } from 'node:path'
import type { HostServiceClientFactory, HostServiceProvider, HostServiceRequest } from '@sciforge/plugin-sdk'
import type { AgentRuntimeThreadSnapshot, AgentRuntimeToolArtifact, AgentRuntimeToolArtifactRef } from '../../shared/agent-runtime-contract'
import { projectAgentRuntimeThreadSnapshot } from '../runtime/agent-runtime/thread-wire-projection'
import { canonicalWorkspacePath, type WorkspaceAuthority } from './workspace-authority'

export const AGENT_THREADS_HOST_SERVICE_ID = 'agentThreads' as const
export const AGENT_THREADS_READ_PORT = 'agent-threads.read' as const

/** Selectors only: workspace and Session authority are never child input. */
export type AgentThreadsReadRequest = Readonly<{ sessionId?: string; runtimeId?: string }>
type ProjectedItem = ReturnType<typeof projectAgentRuntimeThreadSnapshot>['trace'][number]
export type AgentThreadsReadResult = Readonly<{
  /** The canonical Host thread id, not the runner's synthetic DSH session id. */
  sessionId: string
  runtimeId: string
  workspaceRoot: string
  watermark: string
  artifacts: readonly ProjectedItem[]
  turns: readonly Readonly<{ id: string; artifacts: readonly ProjectedItem[] }>[]
}>

type PluginIdentity = Readonly<{ packageName: string; version: string; generation: number }>
export type AgentThreadsHostServiceOptions = Readonly<{
  /** Reads the real Host aggregate, never a plugin-supplied session projection. */
  readSnapshot: (input: Readonly<{ runtimeId: string; threadId: string; signal: AbortSignal }>) => Promise<AgentRuntimeThreadSnapshot>
  /** Reads canonical tool content only for artifact refs from the authorized snapshot. */
  readArtifact?: (input: AgentRuntimeToolArtifactRef & Readonly<{ signal: AbortSignal }>) => Promise<AgentRuntimeToolArtifact>
  authorizeWorkspace: WorkspaceAuthority
  /** Live Host-approved ports for this exact identity; no package special cases. */
  readGrantedPorts: (identity: PluginIdentity) => readonly string[] | undefined
  /** Source/dev and packaged paths are chosen by application composition. */
  hostServiceClientModule: string
}>

export type AgentThreadsHostServiceResolver = Readonly<{
  resolve(packageName: string, version: string, generation: number): Readonly<Record<string, HostServiceProvider>> | undefined
  resolveClients(packageName: string, version: string, generation: number): readonly HostServiceClientFactory[]
  serviceIds: readonly string[]
}>

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Readonly<Record<string, unknown>>
}

function readInput(value: unknown): AgentThreadsReadRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError('Agent threads read requires a plain data request.')
  }
  const input: { sessionId?: string; runtimeId?: string } = {}
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if ((key !== 'sessionId' && key !== 'runtimeId') || !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' ||
        descriptor.value !== descriptor.value.trim() || (key === 'runtimeId' && !descriptor.value)) {
      throw new TypeError('Agent threads read accepts only sessionId and runtimeId string selectors.')
    }
    input[key] = descriptor.value
  }
  return input
}

function createProvider(options: AgentThreadsHostServiceOptions, identity: PluginIdentity): HostServiceProvider {
  const assertCurrent = (request: HostServiceRequest): void => {
    if (!request.assertCurrent) throw new Error('Agent threads requires the live Host authority lease.')
    request.assertCurrent()
    request.signal.throwIfAborted()
    if (request.owner.packageName !== identity.packageName || request.owner.version !== identity.version ||
        request.owner.generation !== identity.generation ||
        !options.readGrantedPorts(identity)?.includes(AGENT_THREADS_READ_PORT)) {
      throw new Error('Agent threads read is not authorized for this Host service owner.')
    }
  }
  const authorize = async (request: HostServiceRequest) => {
    assertCurrent(request)
    if (request.serviceId !== AGENT_THREADS_HOST_SERVICE_ID || request.operation !== 'read') {
      throw new Error('Agent threads service or operation is unavailable.')
    }
    const input = readInput(request.input)
    const caller = { ...record(request.owner.authority.caller) }
    const session = record(request.owner.authority.ordinarySession)
    const runtimeId = typeof session.runtimeId === 'string' ? session.runtimeId : ''
    const threadId = typeof session.threadId === 'string' ? session.threadId : ''
    if (caller.audience !== 'agent' || typeof caller.callerId !== 'string' || !caller.callerId.trim() ||
        request.owner.authority.effect !== 'read' ||
        !runtimeId.trim() || !threadId.trim() || runtimeId !== runtimeId.trim() || threadId !== threadId.trim()) {
      throw new Error('Agent threads requires an authenticated agent read and ordinary Session.')
    }
    // An empty session selector means this Host Session, not arbitrary discovery.
    if ((input.sessionId && input.sessionId !== threadId) ||
        (input.runtimeId !== undefined && input.runtimeId !== runtimeId)) {
      throw new Error('Agent threads cannot read another session or runtime.')
    }
    const declaredRoot = typeof caller.workspaceId === 'string' ? caller.workspaceId : ''
    const workspaceRoot = canonicalWorkspacePath(declaredRoot)
    const assertWorkspaceCurrent = async (): Promise<void> => {
      assertCurrent(request)
      const authorized = workspaceRoot && await options.authorizeWorkspace({ caller: { ...caller }, workspaceId: declaredRoot })
      // The asynchronous authorizer can itself outlive or invalidate the lease.
      assertCurrent(request)
      if (!authorized) throw new Error('Agent threads caller workspace is not authorized by the Host.')
    }
    await assertWorkspaceCurrent()
    return { runtimeId, threadId, workspaceRoot: workspaceRoot!, assertWorkspaceCurrent }
  }
  return Object.freeze({
    authorize: async (request: HostServiceRequest) => { await authorize(request) },
    operations: Object.freeze({
      read: async (request: HostServiceRequest): Promise<AgentThreadsReadResult> => {
        const { assertWorkspaceCurrent, ...scope } = await authorize(request)
        assertCurrent(request)
        const snapshot = await options.readSnapshot({ runtimeId: scope.runtimeId, threadId: scope.threadId, signal: request.signal })
        await assertWorkspaceCurrent()
        assertCurrent(request)
        if (!snapshot.workspace || canonicalWorkspacePath(snapshot.workspace) !== scope.workspaceRoot) {
          throw new Error('Agent threads snapshot workspace does not match the Host-authorized root.')
        }
        if (snapshot.runtimeId !== scope.runtimeId || snapshot.id !== scope.threadId) {
          throw new Error('Canonical thread projection scope mismatch.')
        }
        // Page delivery externalizes canonical tool data. Rehydrate only references
        // issued by this authorized aggregate; child input never selects artifacts.
        const turnsWithDetails: AgentRuntimeThreadSnapshot['turns'] = []
        for (const turn of snapshot.turns) {
          const items = [] as NonNullable<typeof turn.items>
          for (const item of turn.items ?? []) {
            const ref = item.kind === 'tool' ? item.detailArtifact : undefined
            if (!ref) { items.push(item); continue }
            assertCurrent(request)
            if (ref.runtimeId !== scope.runtimeId || ref.threadId !== scope.threadId) {
              throw new Error('Agent threads artifact scope mismatch.')
            }
            if (!options.readArtifact) throw new Error('Agent threads canonical artifact reader is unavailable.')
            const artifact = await options.readArtifact({ ...ref, signal: request.signal })
            await assertWorkspaceCurrent()
            assertCurrent(request)
            if (artifact.runtimeId !== scope.runtimeId || artifact.threadId !== scope.threadId || artifact.ref !== ref.ref ||
                typeof artifact.content !== 'string') {
              throw new Error('Agent threads artifact response scope mismatch.')
            }
            let structured: { structuredContent?: unknown } = {}
            try { structured = { structuredContent: JSON.parse(artifact.content) } } catch { /* Plain text artifacts remain complete detail. */ }
            items.push({ ...item, detail: artifact.content,
              ...(Object.hasOwn(structured, 'structuredContent') ? { meta: { ...item.meta, ...structured } } : {}) })
          }
          turnsWithDetails.push({ ...turn, ...(turn.items ? { items } : {}) })
        }
        // Reuse the canonical lossless JSON encoder, including item metadata and
        // tool receipts. No domain-specific diff or business projection is made.
        const projected = projectAgentRuntimeThreadSnapshot({ ...snapshot, turns: turnsWithDetails }, { ...scope, workspaceRoot: snapshot.workspace })
        let offset = 0
        const turns = snapshot.turns.map(turn => {
          const count = turn.items?.length ?? 0
          const artifacts = Object.freeze(projected.trace.slice(offset, offset + count))
          offset += count
          return Object.freeze({ id: turn.id, artifacts })
        })
        await assertWorkspaceCurrent()
        assertCurrent(request)
        return Object.freeze({
          sessionId: scope.threadId, runtimeId: scope.runtimeId, workspaceRoot: scope.workspaceRoot,
          watermark: projected.watermark, artifacts: Object.freeze(projected.trace), turns: Object.freeze(turns)
        })
      }
    })
  })
}

/** Generic Host composition; intentionally not a generated domain registration. */
export function createAgentThreadsHostServiceResolver(options: AgentThreadsHostServiceOptions): AgentThreadsHostServiceResolver {
  const modulePath = options.hostServiceClientModule
  if (!modulePath || modulePath !== modulePath.trim() || !isAbsolute(modulePath)) {
    throw new TypeError('Agent threads requires an absolute Host service client module path.')
  }
  const admitted = (identity: PluginIdentity): boolean => options.readGrantedPorts(identity)?.includes(AGENT_THREADS_READ_PORT) === true
  return Object.freeze({
    resolve(packageName: string, version: string, generation: number) {
      const identity = Object.freeze({ packageName, version, generation })
      return admitted(identity) ? Object.freeze({ [AGENT_THREADS_HOST_SERVICE_ID]: createProvider(options, identity) }) : undefined
    },
    resolveClients(packageName: string, version: string, generation: number) {
      if (!admitted({ packageName, version, generation })) return Object.freeze([])
      return Object.freeze([Object.freeze({
        serviceId: AGENT_THREADS_HOST_SERVICE_ID, modulePath, exportName: 'createHostServiceClient',
        config: Object.freeze({ serviceId: AGENT_THREADS_HOST_SERVICE_ID })
      })])
    },
    serviceIds: Object.freeze([AGENT_THREADS_HOST_SERVICE_ID])
  })
}
