import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeThreadListInput,
  AgentRuntimeThreadReadInput,
  AgentRuntimeThreadSidebarProbe,
  AgentRuntimeThreadStartInput,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput,
  AgentRuntimeTurnSteerInput,
  AgentRuntimeTurnTargetInput
} from '@shared/agent-runtime-contract'
import type {
  AgentRuntimeApprovalResolveInput,
  AgentRuntimeSessionResumeHandle,
  AgentRuntimeSessionResumeInput,
  AgentRuntimeThreadCompactInput,
  AgentRuntimeThreadDeleteInput,
  AgentRuntimeThreadForkInput,
  AgentRuntimeThreadRelationInput,
  AgentRuntimeThreadRenameInput,
  AgentRuntimeUserInputResolveInput
} from '@shared/sciforge-api'
import { runtimeErrorToError } from '@shared/runtime-error'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'

type AgentRuntimePreloadBridge = Window['sciforge']['agentRuntime']

function unavailable(method: keyof AgentRuntimePreloadBridge): Error {
  return runtimeErrorToError({
    code: 'provider_unavailable',
    message: `Agent runtime IPC is not available: ${String(method)}`
  })
}

function streamId(): string {
  return `agent-runtime-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function isAgentRuntimeEvent(value: unknown): value is AgentRuntimeEvent {
  return Boolean(value && typeof value === 'object' && typeof (value as { kind?: unknown }).kind === 'string')
}

class AgentRuntimeClient {
  connect(runtimeId?: AgentRuntimeId): Promise<void> {
    return this.invoke('connect', (bridge) => bridge.connect(runtimeId))
  }

  capabilities(runtimeId?: AgentRuntimeId): Promise<AgentRuntimeCapabilities> {
    return this.invoke('capabilities', (bridge) => bridge.capabilities(runtimeId))
  }

  listThreads(input: AgentRuntimeThreadListInput = {}): Promise<AgentRuntimeThread[]> {
    return this.invoke('listThreads', (bridge) => bridge.listThreads(input))
  }

  startThread(input: AgentRuntimeThreadStartInput): Promise<AgentRuntimeThread> {
    return this.invoke('startThread', (bridge) => bridge.startThread(input))
  }

  readThread(input: AgentRuntimeThreadReadInput): Promise<AgentRuntimeThreadDetail> {
    return this.invoke('readThread', (bridge) => bridge.readThread(input))
  }

  readThreadSidebarProbe(input: AgentRuntimeThreadReadInput): Promise<AgentRuntimeThreadSidebarProbe> {
    return this.invoke('readThreadSidebarProbe', (bridge) => bridge.readThreadSidebarProbe(input))
  }

  startTurn(input: AgentRuntimeTurnStartInput): Promise<AgentRuntimeTurnHandle> {
    return this.invoke('startTurn', (bridge) => bridge.startTurn(input))
  }

  interruptTurn(input: AgentRuntimeTurnTargetInput): Promise<void> {
    return this.invoke('interruptTurn', (bridge) => bridge.interruptTurn(input))
  }

  steerTurn(input: AgentRuntimeTurnSteerInput): Promise<void> {
    return this.invoke('steerTurn', (bridge) => bridge.steerTurn(input))
  }

  renameThread(input: AgentRuntimeThreadRenameInput): Promise<void> {
    return this.invoke('renameThread', (bridge) => bridge.renameThread(input))
  }

  deleteThread(input: AgentRuntimeThreadDeleteInput): Promise<void> {
    return this.invoke('deleteThread', (bridge) => bridge.deleteThread(input))
  }

  compactThread(input: AgentRuntimeThreadCompactInput): Promise<void> {
    return this.invoke('compactThread', (bridge) => bridge.compactThread(input))
  }

  forkThread(input: AgentRuntimeThreadForkInput): Promise<AgentRuntimeThread> {
    return this.invoke('forkThread', (bridge) => bridge.forkThread(input))
  }

  resumeSession(input: AgentRuntimeSessionResumeInput): Promise<AgentRuntimeSessionResumeHandle> {
    return this.invoke('resumeSession', (bridge) => bridge.resumeSession(input))
  }

  updateThreadRelation(input: AgentRuntimeThreadRelationInput): Promise<void> {
    return this.invoke('updateThreadRelation', (bridge) => bridge.updateThreadRelation(input))
  }

  usage(input: AgentRuntimeUsageQuery): Promise<AgentRuntimeUsageResponse> {
    return this.invoke('usage', (bridge) => bridge.usage(input))
  }

  resolveApproval(input: AgentRuntimeApprovalResolveInput): Promise<void> {
    return this.invoke('resolveApproval', (bridge) => bridge.resolveApproval(input))
  }

  resolveUserInput(input: AgentRuntimeUserInputResolveInput): Promise<void> {
    return this.invoke('resolveUserInput', (bridge) => bridge.resolveUserInput(input))
  }

  auxiliary<T = unknown>(input: AgentRuntimeAuxiliaryInput): Promise<T> {
    return this.invoke('auxiliary', (bridge) => bridge.auxiliary(input) as Promise<T>)
  }

  async subscribeEvents(
    threadId: string,
    sinceSeq: number,
    onEvent: (event: AgentRuntimeEvent) => void,
    signal: AbortSignal,
    runtimeId: AgentRuntimeId,
    workspaceLocator?: WorkspaceLocator
  ): Promise<void> {
    if (signal.aborted) return
    const requestedStreamId = streamId()
    let activeStreamId = requestedStreamId
    let settled = false
    let offEvent = (): void => undefined
    let offEnd = (): void => undefined
    let offError = (): void => undefined

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        offEvent()
        offEnd()
        offError()
        signal.removeEventListener('abort', onAbort)
      }
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve()
      }
      const onAbort = (): void => {
        void window.sciforge.agentRuntime?.stopEvents(activeStreamId)
        finish()
      }

      const bridge = window.sciforge.agentRuntime
      if (!bridge) {
        finish(unavailable('subscribeEvents'))
        return
      }
      offEvent = bridge.onEvent(({ streamId: sid, event }) => {
        if (sid !== activeStreamId || !isAgentRuntimeEvent(event)) return
        onEvent(event)
      })
      offEnd = bridge.onEnd(({ streamId: sid }) => {
        if (sid !== activeStreamId) return
        finish()
      })
      offError = bridge.onError(({ streamId: sid, message }) => {
        if (sid !== activeStreamId) return
        finish(new Error(message ?? 'agent runtime event stream failed'))
      })
      signal.addEventListener('abort', onAbort, { once: true })

      const subscribeInput = {
        runtimeId,
        threadId,
        ...(workspaceLocator ? { workspaceLocator } : {}),
        sinceSeq,
        streamId: requestedStreamId
      }
      bridge.subscribeEvents(subscribeInput).then(({ streamId: sid }) => {
        activeStreamId = sid
        if (signal.aborted) onAbort()
      }).catch((error: unknown) => {
        finish(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  private async invoke<T>(
    method: keyof AgentRuntimePreloadBridge,
    call: (bridge: AgentRuntimePreloadBridge) => Promise<T>
  ): Promise<T> {
    const bridge = window.sciforge.agentRuntime
    if (!bridge || typeof bridge[method] !== 'function') throw unavailable(method)
    return call(bridge)
  }
}

export const agentRuntimeClient = new AgentRuntimeClient()
