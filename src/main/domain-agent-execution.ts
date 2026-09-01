import type {
  DomainMainAgentExecutionHost,
  DomainMainAgentExecutionRequest,
  DomainMainAgentRuntimeReadiness
} from '@sciforge/domain-sdk/agent-execution'
import {
  domainMainAgentExecutionRequestSchema,
  domainMainAgentExecutionSessionRequestSchema,
  domainMainAgentExecutionSessionSchema,
  domainMainAgentRuntimeReadinessSchema
} from '@sciforge/domain-sdk/agent-execution'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'

import {
  getActiveAgentRuntime,
  getModelRouterSettings,
  isModelRouterTextReasonerConfigured,
  resolveModelAccessRuntimePolicy,
  type AppSettingsV1
} from '../shared/app-settings'
import type { AgentRuntimeId } from '../shared/agent-runtime-contract'
import type { AgentRuntimeHost } from './runtime/agent-runtime/host'

type ExecutionRuntimeHost = Pick<
  AgentRuntimeHost,
  | 'interruptTurn'
  | 'readThreadPage'
  | 'readThreadSnapshot'
  | 'readThreadStatus'
  | 'startThread'
  | 'startTurn'
  | 'subscribeTurnLifecycle'
>

export function resolveDomainAgentRuntimeReadiness(
  settings: AppSettingsV1
): DomainMainAgentRuntimeReadiness {
  const runtimeId = getActiveAgentRuntime(settings)
  const policy = resolveModelAccessRuntimePolicy(settings)
  const runtimeAllowed = runtimeId === 'codex' ? policy.codex : policy.claude
  const router = getModelRouterSettings(settings)
  const apiConfigured = policy.mode !== 'api' || (
    router.enabled &&
    Boolean(router.baseUrl.trim()) &&
    Boolean(router.runtimeApiKey.trim()) &&
    Boolean(router.publicModelAlias.trim()) &&
    isModelRouterTextReasonerConfigured(router)
  )
  if (!runtimeAllowed || !apiConfigured || policy.mode === null) {
    return {
      state: 'not_configured',
      reason: 'The selected AgentRuntime has no executable canonical model-access configuration.'
    }
  }
  return {
    state: 'ready',
    runtimeId,
    capabilityTags: [
      `agent-runtime.${runtimeId}`,
      `model-access.${policy.mode}`
    ]
  }
}

export function createDomainAgentExecutionHost(input: Readonly<{
  runtime: ExecutionRuntimeHost
  defaultRuntimeId: () => AgentRuntimeId | Promise<AgentRuntimeId>
  runtimeReadiness: () => DomainMainAgentRuntimeReadiness | Promise<DomainMainAgentRuntimeReadiness>
  pollIntervalMs?: number
}>): DomainMainAgentExecutionHost {
  const pollIntervalMs = Math.max(10, input.pollIntervalMs ?? 1_000)
  const prepareRuntimeSession = async (
    rawRequest: Parameters<NonNullable<DomainMainAgentExecutionHost['prepareSession']>>[0]
  ) => {
    const request = domainMainAgentExecutionSessionRequestSchema.parse(rawRequest)
    const runtimeId = requireSupportedRuntimeId(
      request.runtimeId?.trim() || await input.defaultRuntimeId()
    )
    const thread = await input.runtime.startThread({
      runtimeId,
      ...(request.workspaceRoot ? { workspace: request.workspaceRoot } : {}),
      ...(request.title ? { title: request.title } : {}),
      mode: request.mode,
      ...(request.model ? { model: request.model } : {}),
      relation: 'side',
      threadSource: 'domain-runtime',
      sidebarVisibility: request.interaction === 'reviewable' ? 'main' : 'hidden',
      ...(request.allowedTools ? { allowedTools: request.allowedTools } : {})
    })
    return { runtimeId, thread }
  }
  return Object.freeze({
    runtimeReadiness: async () => domainMainAgentRuntimeReadinessSchema.parse(
      await input.runtimeReadiness()
    ),
    prepareSession: async (request) => {
      const prepared = await prepareRuntimeSession(request)
      return domainMainAgentExecutionSessionSchema.parse({
        runtimeId: prepared.runtimeId,
        threadId: prepared.thread.id
      })
    },
    run: async (rawRequest) => {
      const request = domainMainAgentExecutionRequestSchema.parse(rawRequest)
      if (request.signal?.aborted) {
        throw request.signal.reason ?? new Error('Agent execution aborted.')
      }
      if (request.threadId && !request.runtimeId?.trim()) {
        throw new Error('An existing Agent Session requires an explicit runtime ID.')
      }
      const prepared = request.threadId
        ? null
        : await prepareRuntimeSession({
            ...(request.runtimeId ? { runtimeId: request.runtimeId } : {}),
            ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {}),
            ...(request.title ? { title: request.title } : {}),
            ...(request.model ? { model: request.model } : {}),
            ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
            ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
            interaction: request.interaction,
            mode: request.mode
          })
      const runtimeId = prepared?.runtimeId ?? requireSupportedRuntimeId(request.runtimeId!)
      const thread = prepared?.thread ?? await input.runtime.readThreadSnapshot({
        runtimeId,
        threadId: request.threadId!.trim()
      })
      if (
        request.threadId &&
        request.workspaceRoot &&
        thread.workspace?.trim() !== request.workspaceRoot.trim()
      ) {
        throw new Error('The existing Agent Session does not match the expected workspace binding.')
      }

      let turnId = ''
      let terminalState: 'completed' | 'failed' | 'cancelled' | null = null
      let consecutivePolledTerminalFailures = 0
      let resolveTerminal!: () => void
      const terminal = new Promise<void>((resolve) => {
        resolveTerminal = resolve
      })
      const pendingTerminalEvents: Array<Readonly<{
        turnId: string
        state: 'completed' | 'failed' | 'cancelled'
      }>> = []
      const acceptTerminalEvent = (event: Readonly<{
        turnId: string
        state: 'completed' | 'failed' | 'cancelled'
      }>): void => {
        if (!turnId) {
          pendingTerminalEvents.push(event)
          return
        }
        if (event.turnId !== turnId || terminalState) return
        terminalState = event.state
        resolveTerminal()
      }
      const unsubscribe = input.runtime.subscribeTurnLifecycle((event) => {
        if (
          event.kind !== 'after-turn' ||
          event.state === 'rejected' ||
          event.runtimeId !== runtimeId ||
          event.threadId !== thread.id
        ) return
        acceptTerminalEvent({ turnId: event.turnId, state: event.state })
      })
      const abort = (): void => {
        if (!turnId) return
        void input.runtime.interruptTurn({
          runtimeId,
          threadId: thread.id,
          turnId,
          discard: false
        }).catch(() => undefined)
      }
      request.signal?.addEventListener('abort', abort, { once: true })
      try {
        const handle = await input.runtime.startTurn({
          runtimeId,
          threadId: thread.id,
          text: request.prompt,
          ...(request.outputSchema ? { outputSchema: request.outputSchema } : {}),
          ...(request.workspaceRoot ? { workspace: request.workspaceRoot } : {}),
          mode: request.mode,
          ...(request.clientDirectiveId ? { clientDirectiveId: request.clientDirectiveId } : {}),
          ...(request.metadata === undefined
            ? {}
            : { metadata: runtimeMetadata(request.metadata) }),
          ...(request.model ? { model: request.model } : {}),
          ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
          ...(request.allowedTools ? { allowedTools: request.allowedTools } : {})
        })
        turnId = handle.turnId
        for (const event of pendingTerminalEvents) acceptTerminalEvent(event)
        if (request.signal?.aborted) abort()
        while (!terminalState) {
          await Promise.race([
            terminal,
            new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs))
          ])
          if (terminalState) break
          const detail = await input.runtime.readThreadStatus({
            runtimeId,
            threadId: thread.id
          })
          const polledStatus = detail.latestTurnId === turnId
            ? (detail.latestTurnStatus ?? detail.status)
            : detail.status
          if (polledStatus === 'completed') {
            terminalState = 'completed'
            consecutivePolledTerminalFailures = 0
          } else if (polledStatus === 'failed' || polledStatus === 'cancelled') {
            consecutivePolledTerminalFailures += 1
            if (consecutivePolledTerminalFailures >= 3) terminalState = polledStatus
          } else {
            consecutivePolledTerminalFailures = 0
          }
        }
        const page = await input.runtime.readThreadPage({
          runtimeId,
          threadId: thread.id,
          limit: 20
        })
        const items = page.turns.find((turn) => turn.id === turnId)?.items ?? []
        const finalAssistant = [...items].reverse().find((item) =>
          item.kind === 'assistant_message' && Boolean(item.text?.trim() || item.summary?.trim())
        )
        return Object.freeze({
          runtimeId,
          threadId: thread.id,
          turnId,
          state: terminalState ?? 'failed',
          text: finalAssistant?.text?.trim() || finalAssistant?.summary?.trim() || ''
        })
      } finally {
        request.signal?.removeEventListener('abort', abort)
        unsubscribe()
      }
    }
  })
}

function requireSupportedRuntimeId(value: string): AgentRuntimeId {
  if (value !== 'codex' && value !== 'claude') {
    throw new Error(`Unsupported agent runtime: ${value}`)
  }
  return value
}

function runtimeMetadata(value: DomainMainAgentExecutionRequest['metadata']): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { value: value as DomainPackageJsonValue }
}
