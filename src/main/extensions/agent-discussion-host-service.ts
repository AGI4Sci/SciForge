import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { HostServiceProvider, HostServiceRequest } from '@sciforge/plugin-sdk'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/agent-execution'
import { canonicalWorkspacePath, type WorkspaceAuthority } from './workspace-authority'

const requestSchema = z.object({ prompt: z.string().min(1).max(32_000) }).strict()
type Identity = Readonly<{ packageName: string; version: string; generation: number }>

/** Generic text-only discussion. Runtime choice and tool denial remain Host-owned. */
export function createAgentDiscussionHostServiceResolver(options: Readonly<{
  execution: () => DomainMainAgentExecutionHost
  authorizeWorkspace: WorkspaceAuthority
  readGrantedPorts: (identity: Identity) => readonly string[] | undefined
  hostServiceClientModule: string
}>) {
  if (!isAbsolute(options.hostServiceClientModule)) throw new TypeError('Host service client module must be absolute.')
  const serviceId = 'agentDiscussion'
  const port = 'agent-discussion.run'
  const admitted = (identity: Identity) => options.readGrantedPorts(identity)?.includes(port) === true
  const provider = (identity: Identity): HostServiceProvider => {
    const authorize = async (request: HostServiceRequest) => {
      const assertCurrent = () => {
        if (!request.assertCurrent) throw new Error('Discussion requires a live Host authority lease.')
        request.assertCurrent()
        request.signal.throwIfAborted()
        if (request.owner.packageName !== identity.packageName || request.owner.version !== identity.version
          || request.owner.generation !== identity.generation || !admitted(identity)) {
          throw new Error('Discussion port is not authorized.')
        }
      }
      assertCurrent()
      if (request.serviceId !== serviceId || request.operation !== 'run') throw new Error('Unknown discussion operation.')
      const authority = request.owner.authority
      const caller = authority.caller as Record<string, unknown> | undefined
      if (!caller || !['ui', 'agent'].includes(String(caller.audience)) || typeof caller.callerId !== 'string'
        || !caller.callerId.trim() || authority.effect !== 'workspace-write') {
        throw new Error('Discussion requires an authenticated workspace write invocation.')
      }
      const workspaceId = typeof caller.workspaceId === 'string' ? caller.workspaceId : ''
      const workspaceRoot = canonicalWorkspacePath(workspaceId)
      if (!workspaceRoot || !await options.authorizeWorkspace({ caller: { ...caller }, workspaceId })) {
        throw new Error('Discussion workspace is not authorized.')
      }
      assertCurrent()
      return { workspaceRoot, input: requestSchema.parse(request.input), assertCurrent }
    }
    return {
      authorize: async (request) => { await authorize(request) },
      operations: {
        run: async (request) => {
          const scope = await authorize(request)
          const execution = options.execution()
          const readiness = await execution.runtimeReadiness?.()
          scope.assertCurrent()
          if (!readiness || readiness.state !== 'ready') throw new Error(readiness?.reason ?? 'Selected runtime is unavailable.')
          const result = await execution.run({ runtimeId: readiness.runtimeId, workspaceRoot: scope.workspaceRoot,
            prompt: scope.input.prompt, allowedTools: [], interaction: 'background', mode: 'agent',
            contextProfile: 'minimal',
            signal: request.signal, metadata: { source: 'plugin-discussion' } })
          scope.assertCurrent()
          return { state: result.state, text: result.text, runtimeId: result.runtimeId,
            ...(result.failure ? { failure: result.failure } : {}) }
        }
      }
    }
  }
  return Object.freeze({
    serviceIds: Object.freeze([serviceId]),
    resolve(packageName: string, version: string, generation: number) {
      const identity = { packageName, version, generation }
      return admitted(identity) ? { [serviceId]: provider(identity) } : undefined
    },
    resolveClients(packageName: string, version: string, generation: number) {
      return admitted({ packageName, version, generation }) ? [{ serviceId,
        modulePath: options.hostServiceClientModule, exportName: 'createHostServiceClient', config: { serviceId } }] : []
    }
  })
}
