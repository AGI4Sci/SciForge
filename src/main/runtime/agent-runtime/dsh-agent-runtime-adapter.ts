import { join } from 'node:path'
import { withDurableAgentRuntimeHistory } from './durable-runtime-history'
import { createDshDeploymentTargetResolver } from './dsh-executable-discovery'
import { createDshRuntimeAdapter, type DshRuntimeOptions, type DshMcpServer, type DshThread } from '@sciforge/dsh-runtime'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'
import type { AgentRuntimeToolSurface } from './agent-tool-surface'
import { createAgentRuntimeMcpToolLease, type AgentRuntimeMcpToolLease } from './agent-runtime-mcp-tool-lease'
import { createAgentRuntimeMcpSessionEndpoint } from './agent-runtime-mcp-session-endpoint'
import { createDefaultAgentRuntimeCapabilities, type AgentRuntimeEvent, type AgentRuntimeThread, type AgentRuntimeTurnHandle } from '../../../shared/agent-runtime-contract'
import { getModelRouterSettings, isModelRouterTextReasonerConfigured, resolveRuntimeModelRouterSettings } from '../../../shared/app-settings-model-router'
import { isDshCommandExecutionEnabled } from '../../../shared/app-settings-dsh'
import { resolveModelAccessRuntimePolicy } from '../../../shared/model-access-runtime-policy'
import { isModelRouterServiceHealthy } from '../../model-router-health'
import { DshRuntimeError } from '@sciforge/dsh-runtime'

export type DshHostRuntimeOptions = Omit<DshRuntimeOptions, 'getAuthorizedMcpServers'> & {
  toolSurface: AgentRuntimeToolSurface
}

export function createProductionDshHostRuntimeAdapter(options: {
  userDataDirectory: string
  resourcesDirectory: string
  toolSurface: AgentRuntimeToolSurface
}): AgentRuntimeAdapter & { close(): Promise<void>; invalidateModelAccess(): Promise<void> } {
  return createDshHostRuntimeAdapter({
    stateDirectory: join(options.userDataDirectory, 'agent-runtime', 'dsh'),
    // Lifecycle/cancel remain short; a real turn may include multiple model,
    // approval and tool round trips. This is a finite aggregate turn budget,
    // not a copy of a router's per-attempt timeout.
    requestTimeoutMs: 15_000,
    promptTimeoutMs: 600_000,
    cancelTimeoutMs: 15_000,
    resolveDeploymentTarget: createDshDeploymentTargetResolver({ resourcesDirectory: options.resourcesDirectory }),
    getModelRouter: async context => {
      const policy = resolveModelAccessRuntimePolicy(context.settings as AgentRuntimeAdapterContext['settings'])
      if (!policy.dsh) throw new DshRuntimeError('runtime_model_route_policy')
      const settings = context.settings as AgentRuntimeAdapterContext['settings']
      const router = getModelRouterSettings(settings)
      // The shared normalizer has defaults for absent fields. An explicitly
      // blank user selection is not consent to replace that selection.
      if (settings.modelRouter?.publicModelAlias !== undefined && !settings.modelRouter.publicModelAlias.trim()) throw new DshRuntimeError('runtime_model_route_missing')
      if (!router.enabled || !isModelRouterTextReasonerConfigured(router)) throw new DshRuntimeError('runtime_model_route_missing')
      let route
      try { route = resolveRuntimeModelRouterSettings(settings) } catch { throw new DshRuntimeError('runtime_model_route_invalid') }
      if (!route.apiKey || !route.model) throw new DshRuntimeError('runtime_model_route_missing')
      if (!await isModelRouterServiceHealthy(settings)) throw new DshRuntimeError('runtime_model_route_unavailable')
      return route
    },
    toolSurface: options.toolSurface
  })
}

/** ACP implementation stays package-owned; this bridge owns Host attribution only. */
export function createDshHostRuntimeAdapter(options: DshHostRuntimeOptions): AgentRuntimeAdapter & { close(): Promise<void>; invalidateModelAccess(): Promise<void> } {
  type Active = { context: AgentRuntimeAdapterContext; workspace: string; allowedTools?: readonly string[]; handle?: AgentRuntimeTurnHandle; lease?: AgentRuntimeMcpToolLease; revoked: boolean }
  let active: Active | undefined
  const endpoints = new Map<string, Awaited<ReturnType<typeof createAgentRuntimeMcpSessionEndpoint>>>()
  const revoke = async (turn = active): Promise<void> => {
    if (!turn) return
    turn.revoked = true
    if (active === turn) active = undefined
    if (turn.handle) endpoints.get(turn.handle.threadId)?.unbind(turn.lease)
    await turn.lease?.close()
  }
  const accept = async (turn: Active, handle: AgentRuntimeTurnHandle): Promise<void> => {
    if (turn.revoked || active !== turn) throw new Error('runtime_turn_stale')
    if (turn.handle) {
      if (turn.handle.threadId !== handle.threadId || turn.handle.turnId !== handle.turnId) throw new Error('runtime_turn_mismatch')
      return
    }
    turn.handle = Object.freeze({ ...handle })
    await turn.context.onTurnAccepted?.(handle)
  }
  const core = createDshRuntimeAdapter({ ...options,
    getAuthorizedMcpServers: async (identity): Promise<readonly DshMcpServer[]> => {
      const turn = active
      if (!turn || turn.revoked || identity.workspace !== turn.workspace) throw new Error('runtime_turn_stale')
      // Host durability and Principal acknowledgement must precede any tool endpoint.
      await accept(turn, identity)
      identity.signal.addEventListener('abort', () => { void revoke(turn) }, { once: true })
      const assertCurrent = (): void => {
        if (active !== turn || turn.revoked) throw new Error('runtime_turn_stale')
        identity.signal.throwIfAborted()
      }
      const filtered: AgentRuntimeToolSurface = {
        ...options.toolSurface,
        tools: () => options.toolSurface.tools().filter(tool => !turn.allowedTools || turn.allowedTools.includes(tool.name))
      }
      const lease = await createAgentRuntimeMcpToolLease({ surface: filtered,
        context: { requestId: identity.turnId, runtimeId: 'dsh', threadId: identity.threadId, turnId: identity.turnId, workspaceId: turn.workspace },
        signal: identity.signal, assertCurrent })
      turn.lease = lease
      if (turn.revoked || identity.signal.aborted) { await lease.close(); throw new Error('runtime_turn_stale') }
      let endpoint = endpoints.get(identity.threadId)
      if (!endpoint) {
        endpoint = await createAgentRuntimeMcpSessionEndpoint()
        endpoints.set(identity.threadId, endpoint)
      }
      assertCurrent()
      endpoint.bind(lease)
      return [endpoint.config]
    }
  })
  const threads = new Map<string, AgentRuntimeThread>()
  const project = (thread: DshThread): AgentRuntimeThread => {
    const previous = threads.get(thread.id)
    const result: AgentRuntimeThread = { ...previous, id: thread.id, runtimeId: 'dsh', title: thread.title ?? previous?.title ?? 'DSH', updatedAt: new Date().toISOString(), workspace: thread.workspace, status: thread.state }
    threads.set(result.id, result)
    return result
  }
  const unsupported = async (): Promise<never> => { throw new Error('runtime_unsupported') }
  return withDurableAgentRuntimeHistory({
    id: 'dsh', transport: 'jsonrpc_stdio',
    invalidateModelAccess: async () => {
      await revoke()
      await core.invalidateModelAccess()
    },
    probe: (context, input) => core.probe(context, input),
    connect: context => core.connect(context),
    capabilities: async context => {
      const native = await core.capabilities(context)
      const result = createDefaultAgentRuntimeCapabilities({ runtimeId: 'dsh', transport: 'jsonrpc_stdio' })
      result.events = native.events
      result.reasoning = native.reasoning
      result.model = native.model
      result.tools.toolCalling = native.model.supportsToolCalling
      result.tools.mcp = { available: native.model.supportsToolCalling }
      // The switch and the launched composition are the same decision: while it
      // is off the default (unsupported) state stands unchanged, and while it is
      // on the matrix reports the shell the deployment actually enables.
      if (isDshCommandExecutionEnabled(context.settings)) {
        result.tools.commandExecution = { available: true }
      }
      result.controls.interrupt = true
      result.controls.approval = 'async'
      result.controls.resumeSession = native.controls.resumeSession
      return result
    },
    listThreads: async (context, input) => {
      const listed = await core.listThreads(context, { runtimeId: input.runtimeId })
      return listed.map(project)
    },
    startThread: async (context, input) => {
      if (input.workspaceLocator && !options.resolveWorkspace) throw new Error('runtime_workspace_host_unsupported')
      const thread = project(await core.startThread(context, input))
      if (input.title) thread.title = input.title
      return thread
    },
    readThreadStatus: (context, input) => core.readThreadStatus(context, input),
    readThreadPage: unsupported, readToolArtifact: unsupported,
    startTurn: async (context, input) => {
      if (active) throw new Error('runtime_busy')
      const workspace = threads.get(input.threadId ?? '')?.workspace
      if (!workspace) throw new Error('runtime_workspace_required')
      const turn: Active = { context: { ...context }, workspace, allowedTools: input.allowedTools ? [...input.allowedTools] : undefined, revoked: false }
      active = turn
      try {
        return await core.startTurn({ ...context, onTurnAccepted: handle => accept(turn, handle) }, input)
      } catch (error) { await revoke(turn); throw error }
    },
    interruptTurn: async (context, input) => {
      if (active?.handle && active.handle.threadId === input.threadId && (!input.turnId || active.handle.turnId === input.turnId)) await revoke()
      await core.interruptTurn(context, input)
    },
    steerTurn: unsupported, renameThread: unsupported,
    deleteThread: async (_context, input) => {
      if (active?.handle?.threadId === input.threadId) await revoke()
      // ACP has no supported delete operation; do not pretend local eviction deletes it.
      return unsupported()
    },
    subscribeEvents: (context, input) => {
      // Subscribe eagerly: ACP is live-only and may emit before iteration begins.
      const stream = core.subscribeEvents(context, input)
      return { async *[Symbol.asyncIterator]() {
        for await (const event of stream) {
          yield event as AgentRuntimeEvent
        }
      } }
    },
    resolveApproval: async (context, input) => { await core.resolveApproval(context, input) },
    resumeSession: async (context, input) => {
      const workspace = threads.get(input.sessionId)?.workspace
      if (!workspace) throw new Error('runtime_workspace_required')
      return core.resumeSession(context, { ...input, workspace })
    },
    usage: (context, input) => core.usage(context, input),
    close: async () => { await revoke(); await core.close(); await Promise.all([...endpoints.values()].map(endpoint => endpoint.close())); endpoints.clear() }
  }, join(options.stateDirectory, 'host-history'))
}
