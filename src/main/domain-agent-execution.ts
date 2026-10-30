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
import { normalizeAgentRuntimeTurnState } from '../shared/agent-runtime-contract'
import type {
  AgentRuntimeId,
  AgentRuntimeItem,
  AgentRuntimeTurn
} from '../shared/agent-runtime-contract'
import type { AgentRuntimeHost } from './runtime/agent-runtime/host'

type ExecutionRuntimeHost = Pick<
  AgentRuntimeHost,
  | 'readAdmission'
  | 'acquireSubmission'
  | 'releaseSubmission'
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
  const runtimeAllowed = policy[runtimeId] ?? false
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
      ...(request.workspaceDisplayName ? { workspaceDisplayName: request.workspaceDisplayName } : {}),
      ...(request.title ? { title: request.title } : {}),
      mode: request.mode,
      ...(request.model ? { model: request.model } : {}),
      relation: 'side',
      threadSource: 'domain-runtime',
      sidebarVisibility: request.interaction === 'reviewable' ? 'main' : 'hidden',
      ...(request.allowedTools !== undefined ? { allowedTools: request.allowedTools } : {})
    })
    return { runtimeId, thread }
  }
  return Object.freeze({
    readAdmission: (session) => input.runtime.readAdmission(session),
    acquireSubmission: (request) => input.runtime.acquireSubmission(request),
    releaseSubmission: (request) => input.runtime.releaseSubmission(request),
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
            ...(request.workspaceDisplayName ? { workspaceDisplayName: request.workspaceDisplayName } : {}),
            ...(request.title ? { title: request.title } : {}),
            ...(request.model ? { model: request.model } : {}),
            ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
            ...(request.allowedTools !== undefined ? { allowedTools: request.allowedTools } : {}),
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
      let terminalState: 'completed' | 'failed' | 'cancelled' | 'aborted' | null = null
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
        // Preparation and snapshot reads can outlive the caller's deadline.
        // Check synchronously at dispatch; a later interrupt cannot undo tools.
        if (request.signal?.aborted) {
          throw request.signal.reason ?? new Error('Agent execution aborted.')
        }
        const starting = input.runtime.startTurn({
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
          ...(request.allowedTools !== undefined ? { allowedTools: request.allowedTools } : {})
        }).then((handle) => {
          turnId = handle.turnId
          // A start acknowledgement may arrive after the caller's deadline.
          // Stop that exact turn too; never leave a timed-out dispatch running.
          if (request.signal?.aborted) abort()
          return handle
        })
        await withExecutionAbort(starting, request.signal)
        for (const event of pendingTerminalEvents) acceptTerminalEvent(event)
        if (request.signal?.aborted) abort()
        while (!terminalState) {
          await withExecutionAbort(Promise.race([
            terminal,
            new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs))
          ]), request.signal)
          if (terminalState) break
          const detail = await withExecutionAbort(input.runtime.readThreadStatus({
            runtimeId,
            threadId: thread.id
          }), request.signal)
          const polledStatus = normalizeAgentRuntimeTurnState(detail.latestTurnId === turnId
            ? (detail.latestTurnStatus ?? detail.status)
            : (await readExactExecutionTurn(input.runtime, runtimeId, thread.id, turnId, request.signal))?.status)
          if (polledStatus === 'completed') {
            terminalState = 'completed'
            consecutivePolledTerminalFailures = 0
          } else if (polledStatus === 'failed' || polledStatus === 'cancelled' || polledStatus === 'aborted') {
            consecutivePolledTerminalFailures += 1
            if (consecutivePolledTerminalFailures >= 3) terminalState = polledStatus
          } else {
            consecutivePolledTerminalFailures = 0
          }
        }
        const completedTurn = await readExactExecutionTurn(
          input.runtime, runtimeId, thread.id, turnId, request.signal
        )
        const items = completedTurn?.items ?? []
        const finalAssistant = [...items].reverse().find((item) =>
          item.kind === 'assistant_message' && Boolean(item.text?.trim() || item.summary?.trim())
        )
        // The SDK has one cancellation terminal for runtime aborts and explicit stops.
        // Preserve the observed cause in the failure envelope at this boundary.
        const state = terminalState === 'aborted' ? 'cancelled' : terminalState ?? 'failed'
        const failure = domainAgentExecutionFailure(terminalState ?? 'failed', items)
        return Object.freeze({
          runtimeId,
          threadId: thread.id,
          turnId,
          state,
          text: finalAssistant?.text?.trim() || finalAssistant?.summary?.trim() || '',
          ...(failure ? { failure } : {})
        })
      } finally {
        request.signal?.removeEventListener('abort', abort)
        unsubscribe()
      }
    }
  })
}

export function domainAgentExecutionFailure(
  state: 'completed' | 'failed' | 'cancelled' | 'aborted',
  items: readonly AgentRuntimeItem[]
): Readonly<{ code: string; message: string; retryable: boolean }> | null {
  if (state === 'completed') return null
  if (state === 'cancelled' || state === 'aborted') {
    return {
      code: state === 'aborted' ? 'runtime_interrupted' : 'runtime_cancelled',
      message: state === 'aborted' ? '本轮执行已中断。' : '本轮执行已取消。',
      retryable: false
    }
  }
  const failedItems = [...items].reverse().filter((candidate) => (
    (candidate.status === 'error' || candidate.status === 'failed') &&
    Boolean(candidate.text?.trim() || candidate.summary?.trim())
  ))
  const item = failedItems.find((candidate) => {
    const code = typeof candidate.meta?.code === 'string'
      ? candidate.meta.code.trim().toLowerCase()
      : ''
    return ['model_capacity', 'runtime_connection_interrupted', 'upstream_unavailable', 'response_schema_incompatible'].includes(code)
  }) ?? failedItems[0]
  const message = (
    item?.text?.trim() || item?.summary?.trim() ||
    'Agent turn failed.'
  ).slice(0, 1_000)
  const rawCode = typeof item?.meta?.code === 'string' ? item.meta.code : ''
  const normalizedCode = rawCode.trim().toLowerCase().replace(/[^a-z0-9_.-]+/gu, '_')
  const canonicalCapacityFailure = normalizedCode === 'model_capacity'
  const canonicalConnectionFailure = normalizedCode === 'runtime_connection_interrupted'
  // An upstream HTTP status outranks transport wording such as "stream disconnected" that wraps it.
  const upstreamStatus = /(?:upstream returned |HTTP[ :]+)(\d{3})\b/iu.exec(message)?.[1]
  const capacityFailure = canonicalCapacityFailure || upstreamStatus === '429' || (
    /(?:selected\s+)?model.{0,80}(?:at capacity|capacity (?:exceeded|unavailable))|(?<![a-z])rate[ _-]?limit/iu
  ).test(message)
  const connectionFailure = canonicalConnectionFailure || (!upstreamStatus && (
    /(?:stream|connection|transport|socket).{0,80}(?:closed|disconnect(?:ed)?|lost|reset|interrupted|ended unexpectedly)/iu
  ).test(message))
  const unavailable = normalizedCode === 'upstream_unavailable' || ['502', '503', '504'].includes(upstreamStatus ?? '')
  const incompatible = normalizedCode === 'response_schema_incompatible' || /incompatible response schema/iu.test(message)
  return {
    code: unavailable ? 'upstream_unavailable' : incompatible ? 'response_schema_incompatible' : capacityFailure
      ? 'model_capacity'
      : connectionFailure
        ? 'runtime_connection_interrupted'
        : /^[a-z][a-z0-9_.-]{0,63}$/u.test(normalizedCode)
          ? normalizedCode
          : 'runtime_failed',
    message,
    retryable: state === 'failed' && (capacityFailure || connectionFailure || unavailable || incompatible)
  }
}

async function readExactExecutionTurn(
  runtime: ExecutionRuntimeHost,
  runtimeId: AgentRuntimeId,
  threadId: string,
  turnId: string,
  signal?: AbortSignal
): Promise<AgentRuntimeTurn | undefined> {
  let cursor: string | undefined
  const seenCursors = new Set<string>()
  for (let pageCount = 0; pageCount < 100; pageCount += 1) {
    const page = await withExecutionAbort(runtime.readThreadPage({
      runtimeId,
      threadId,
      ...(cursor ? { cursor } : {}),
      limit: 20
    }), signal)
    if (page.runtimeId !== runtimeId || page.threadId !== threadId) {
      throw new Error('Agent execution history belongs to a different Session.')
    }
    const turn = page.turns.find((candidate) => candidate.id === turnId)
    if (turn) return turn
    cursor = page.nextCursor ?? undefined
    if (!cursor) return undefined
    if (seenCursors.has(cursor)) throw new Error('Agent execution history repeated a cursor.')
    seenCursors.add(cursor)
  }
  throw new Error('Agent execution exceeded the history page limit.')
}

async function withExecutionAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  let rejectAborted!: (reason: unknown) => void
  const aborted = new Promise<never>((_, reject) => { rejectAborted = reject })
  const abort = () => rejectAborted(signal.reason ?? new Error('Agent execution aborted.'))
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try {
    return await Promise.race([promise, aborted])
  } finally {
    signal.removeEventListener('abort', abort)
  }
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
