import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  getAgentCapabilitySettings,
  getCodexRuntimeSettings,
  getModelAccessSettings,
  resolveModelAccessRuntimePolicy,
  type AppSettingsV1,
  type ApprovalPolicy,
  type SandboxMode
} from '../../../shared/app-settings'
import { resolveRuntimeModelRouterSettings } from '../../runtime-model-router-settings'
import {
  codexModelDeltaItemId,
  type CodexChatBlock,
  type CodexCodingPlanAccountResult,
  type CodexCodingPlanLoginCompletionResult,
  type CodexCodingPlanLoginMethod,
  type CodexCodingPlanLoginStartResult,
  type CodexCodingPlanRateLimitsResult,
  type CodexConnectResult,
  type CodexEventPayload,
  type CodexNormalizedThread,
  type CodexSessionResumeResult,
  type CodexThreadEventPayload,
  type CodexThreadDetail,
  type CodexThreadForkResult,
  type CodexThreadListResult,
  type CodexThreadListOptions,
  type CodexThreadMutationResult,
  type CodexThreadReadResult,
  type CodexThreadStartPayload,
  type CodexThreadStartResult,
  type CodexTurnInterruptOptions,
  type CodexTurnMutationResult,
  type CodexTurnStartPayload,
  type CodexTurnStartResult,
  type CodexTurnSteerPayload
} from './codex-runtime-api'
import type {
  AgentRuntimeEvent,
  AgentRuntimeThreadSidebarVisibility,
  AgentRuntimeUsage,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../../shared/agent-runtime-contract'
import {
  CODEX_MAIN_IPC_CHANNELS,
  createCodexAppServerClient,
  type CodexAppServerAccount,
  type CodexAppServerAccountLoginCompletedNotification,
  type CodexAppServerAccountRateLimitsUpdatedNotification,
  type CodexAppServerAccountUpdatedNotification,
  type CodexAppServerHookMetadata,
  type CodexAppServerInitializeResponse,
  type CodexAppServerInputItem,
  type CodexAppServerJsonRpcClient,
  type CodexAppServerJsonRpcClientOptions,
  type CodexAppServerThreadSandboxPolicy,
  type CodexAppServerTurnSandboxPolicy,
  type CodexAppServerThreadStartParams
} from '@sciforge/codex-runtime/app-server'
import {
  codexAppServerApprovalMethodInfo,
  type CodexAppServerPendingRequest,
  type CodexAppServerResolveApprovalInput,
  type CodexAppServerResolveUserInputInput
} from '@sciforge/codex-runtime/app-server'
import {
  codexAppServerThreadReasoningConfig,
  codexAppServerTurnReasoningParams
} from './app-server/reasoning-config'
import { normalizeCodexEvent, type CodexEventNormalizeContext } from './app-server/event-normalizer'
import { CodexEventStore, type CodexStoredEvent } from './codex-event-store'
import { CodexThreadStore, type CodexStoredThread, type CodexThreadStoreUpsertInput } from './codex-thread-store'
import { CodexUsageStore } from './codex-usage-store'
import {
  CODEX_PLAN_GATEWAY_PROVIDER_ID,
  prepareCodexAppServerLaunch,
  resolveCodexWorkspace,
  type CodexAppServerLaunchConfig,
  type CodexPlanGatewayLaunchConfig
} from './codex-config'
import {
  filterAgentRuntimeToolSurface,
  nativeAgentToolExecutionMetadata,
  type AgentRuntimeToolSurface
} from '../agent-runtime/agent-tool-surface'
import type {
  AgentRuntimeSubagentCancelInput,
  AgentRuntimeSubagentInspectInput,
  AgentRuntimeSubagentMessageInput,
  AgentRuntimeSubagentResult,
  AgentRuntimeSubagentSpawnInput,
  AgentRuntimeSubagentTranscriptEntry,
  AgentRuntimeSubagentUsage,
  AgentRuntimeTurnGovernanceSnapshotInput
} from '../agent-runtime/adapter'
import {
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  isComputerUseMcpConfigured
} from '@sciforge/domain-computer-use/main/mcp-config'
import {
  type RuntimeToolCallRequest,
  type RuntimeToolCallResponse,
  type RuntimeToolDefinition,
  type RuntimeToolReleaseReason
} from '../agent-runtime/runtime-tool-contract'
import { AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME } from '../agent-runtime/subagent-tool-bridge'
import {
  CODEX_PRE_TOOL_USE_GOVERNANCE_STORAGE_ROOT_ENV,
  CodexPreToolUseGovernanceBridge
} from './codex-pre-tool-use-governance'
import {
  probeCodexPreToolUseHook,
  type CodexPreToolUseHookDefinition
} from './codex-pre-tool-use-hook'
import type { ManagedGuiMcpLaunchConfig } from '../../managed-gui-mcp-config'

class CodexCodingPlanLoginInProgressError extends Error {}

export type CodexRuntimeEventSink = {
  send(channel: typeof CODEX_MAIN_IPC_CHANNELS.event, payload: CodexEventPayload): void
  send(channel: typeof CODEX_MAIN_IPC_CHANNELS.error, payload: { message: string; detail?: unknown }): void
  send(channel: typeof CODEX_MAIN_IPC_CHANNELS.closed, payload: { reason?: string }): void
}

export type CodexRuntimeServiceOptions = {
  settings: () => Promise<AppSettingsV1>
  sink: CodexRuntimeEventSink
  appVersion?: string
  storageRoot?: string
  managedCodexHome?: string
  standardCodexAuthPath?: string
  planGateway?: CodexPlanGatewayLaunchConfig
  capabilityAgentTools?: AgentRuntimeToolSurface
  preToolUseHookLaunch?: ManagedGuiMcpLaunchConfig
  createClient?: (options: CodexAppServerJsonRpcClientOptions) => CodexAppServerJsonRpcClient
}

type CodexTurnTiming = {
  startedAtMs: number
  firstActivitySeen: boolean
  firstDeltaSeen: boolean
}

type CodexModelDeltaDedupeState = {
  identities: Set<string>
}

type CodexPreparedTurnGovernance = {
  sessionId: string
  parent?: {
    threadId: string
    turnId: string
  }
}

type CodexTurnGovernanceBinding = {
  sessionId: string
  governanceThreadId: string
  governanceTurnId: string
}

type ActiveCodexSubagent = {
  childId: string
  parentThreadId: string
  parentTurnId: string
  threadId: string
  codexThreadId: string
  turnId: string
  client: CodexAppServerJsonRpcClient
  terminate(signal?: AbortSignal): Promise<void>
}

type CodexConnectedClient = {
  client: CodexAppServerJsonRpcClient
  info: CodexAppServerInitializeResponse
}

type CodexClientSession = {
  accessKey: string
  client: CodexAppServerJsonRpcClient | null
  launch: CodexAppServerLaunchConfig | null
  info: CodexAppServerInitializeResponse | null
  ready: boolean
  cancelled: boolean
  readiness: Promise<CodexConnectedClient>
  subscription: Promise<void> | null
  cleanupPromise: Promise<void> | null
}

type CodexPendingTurnRecovery = {
  threadId: string
  text: string
  workspace: string
  model?: string
  reasoningEffort?: string
  fileReferences?: CodexTurnStartPayload['fileReferences']
  ownedVisualToolsAvailable: boolean
  nativeVisualProofChainPending: boolean
  runtime: ReturnType<typeof getCodexRuntimeSettings>
  recoveryAttempted: boolean
}

type CodexCodingPlanLoginCompletion = Extract<
  CodexCodingPlanLoginCompletionResult,
  { ok: true }
>

type CodexRuntimeStatusInput = {
  threadId: string
  turnId?: string
  itemId?: string
  phase: NonNullable<CodexThreadEventPayload['runtimeStatus']>['phase']
  message?: string
  latencyMs?: number
  createdAt?: string
}

type CodexRuntimeErrorInput = {
  threadId: string
  turnId?: string
  itemId?: string
  message: string
  code?: string
  details?: unknown
  severity?: NonNullable<CodexThreadEventPayload['runtimeError']>['severity']
}

type CodexToolExecutionIdentity = {
  callId: string
  toolName: string
  summary: string
  toolKind?: NonNullable<CodexThreadEventPayload['tool']>['toolKind']
}

const EMPTY_CODEX_TURN_USAGE: AgentRuntimeUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  modelContextWindow: null
}

const FIRST_CODEX_ACTIVITY_TIMEOUT_MS = 75_000
const INTERRUPT_TIMED_OUT_TURN_MS = 5_000
const CODEX_PENDING_TOOL_COMPLETION_GRACE_MS = 5_000
const CODEX_TURN_DISCONNECTED_MESSAGE = 'Codex runtime disconnected before this turn completed. The stuck turn was closed so you can retry.'
const CODEX_TURN_STOPPED_MESSAGE = 'Codex runtime stopped before this turn completed. The stuck turn was closed so you can retry.'
const CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS = [
  'SciForge provides `delegate_task` for child-agent work without a wall-clock execution deadline.',
  'Use it when parallel investigation or independent implementation subtasks materially help the user request.',
  'When two or more independent subtasks are ready, put them in one `delegate_task` tasks array so they start concurrently; do not wait for separate delegation calls one by one.',
  'Give each child a concise label and a self-contained prompt; do not use it for trivial work or as a substitute for doing the main task.',
  '`delegate_task` returns child IDs immediately. Use `subagent_wait` to observe progress, `subagent_status` to inspect liveness, `subagent_send` to ask for progress or provide guidance, and `subagent_cancel` only for an explicit cancellation decision.',
  'A wait timeout or one missing liveness probe is not child failure. Continue monitoring; only terminal child status is final.'
].join('\n')
const CODEX_THREAD_FALLBACK_TITLE = 'Codex thread'
const MAX_CODEX_THREAD_TITLE_LENGTH = 80
const MAX_CODEX_MODEL_DELTA_IDENTITIES_PER_TURN = 4_096
const MAX_CODEX_MODEL_DELTA_TURNS = 64
const CODEX_PLACEHOLDER_THREAD_TITLES = new Set([
  'New Thread',
  'New chat',
  '\u65b0\u4f1a\u8bdd',
  CODEX_THREAD_FALLBACK_TITLE,
  'Claude Code thread',
  'Claude thread',
  'Agent Runtime thread',
  'Runtime thread'
])

type CodexRuntimeEventSubscriber = {
  threadId: string
  queue: CodexThreadEventPayload[]
  wake: (() => void) | null
  closed: boolean
}

export class CodexRuntimeService {
  private client: CodexAppServerJsonRpcClient | null = null
  private clientSession: CodexClientSession | null = null
  private readonly threadStore: CodexThreadStore | null
  private readonly eventStore: CodexEventStore | null
  private readonly usageStore: CodexUsageStore | null
  private readonly preToolUseGovernanceBridge: CodexPreToolUseGovernanceBridge | null
  private readonly activeSubagents = new Map<string, ActiveCodexSubagent>()
  private readonly allowedToolsByThread = new Map<string, ReadonlySet<string>>()
  private usageBackfillPromise: Promise<void> | null = null
  private readonly activeTurns = new Map<string, string>()
  private readonly turnTimings = new Map<string, CodexTurnTiming>()
  private readonly turnModelHints = new Map<string, string>()
  private readonly pendingTurnRecoveries = new Map<string, CodexPendingTurnRecovery>()
  private readonly turnsWithRecordedUsage = new Set<string>()
  private readonly firstActivityTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly modelDeltaDedupeByTurn = new Map<string, CodexModelDeltaDedupeState>()
  private readonly eventSubscribers = new Set<CodexRuntimeEventSubscriber>()
  private readonly pendingToolItemsByTurn = new Map<string, Set<string>>()
  private readonly terminalToolItemsByTurn = new Map<string, Set<string>>()
  private readonly toolExecutionIdentityByCall = new Map<string, CodexToolExecutionIdentity>()
  private readonly governanceBindingsByTurn =
    new Map<string, CodexTurnGovernanceBinding>()
  private readonly deferredTurnCompleteEvents = new Map<string, CodexThreadEventPayload>()
  private readonly pendingToolBarrierTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private codingPlanAccount: Extract<CodexCodingPlanAccountResult, { ok: true }> | null = null
  private codingPlanRateLimits: Extract<CodexCodingPlanRateLimitsResult, { ok: true }> | null = null
  private readonly codingPlanLoginCompletions = new Map<string, CodexCodingPlanLoginCompletion>()
  private readonly codingPlanLoginWaiters = new Map<
    string,
    Set<(completion: CodexCodingPlanLoginCompletion) => void>
  >()
  private codingPlanLoginStartsInFlight = 0
  private readonly activeCodingPlanLoginIds = new Set<string>()

  constructor(private readonly options: CodexRuntimeServiceOptions) {
    this.threadStore = options.storageRoot ? new CodexThreadStore({ rootDir: options.storageRoot }) : null
    this.eventStore = options.storageRoot ? new CodexEventStore({ rootDir: options.storageRoot }) : null
    this.usageStore = options.storageRoot ? new CodexUsageStore({ rootDir: options.storageRoot }) : null
    this.preToolUseGovernanceBridge = options.storageRoot
      ? new CodexPreToolUseGovernanceBridge({ storageRoot: options.storageRoot })
      : null
  }

  async connect(): Promise<CodexConnectResult> {
    try {
      const { info } = await this.ensureConnectedClient()
      return { ok: true, info: asRecord(info) ?? {} }
    } catch (error) {
      return failure(error)
    }
  }

  async synchronizeModelAccess(): Promise<void> {
    const settings = await this.options.settings()
    const nextKey = codexModelAccessKey(settings, this.options.planGateway)
    const session = this.clientSession
    if (session && session.accessKey !== nextKey) {
      if (this.codingPlanLoginStartsInFlight > 0 || this.activeCodingPlanLoginIds.size > 0) return
      await this.cleanupClientSession(session, {
        reason: 'service_shutdown',
        failure: false
      })
    }
  }

  async getCodingPlanAccount(
    options: { refreshToken?: boolean } = {}
  ): Promise<CodexCodingPlanAccountResult> {
    try {
      const { client } = await this.ensureCodingPlanAccountClient()
      const response = await client.readAccount({ refreshToken: options.refreshToken === true })
      const result: Extract<CodexCodingPlanAccountResult, { ok: true }> = {
        ok: true,
        account: response.account,
        planType: response.account?.type === 'chatgpt' ? response.account.planType : null,
        requiresOpenaiAuth: response.requiresOpenaiAuth
      }
      this.codingPlanAccount = result
      return result
    } catch (error) {
      return failure(error)
    }
  }

  async startCodingPlanLogin(input: {
    method: CodexCodingPlanLoginMethod
  }): Promise<CodexCodingPlanLoginStartResult> {
    this.codingPlanLoginStartsInFlight += 1
    try {
      const { client } = await this.ensureCodingPlanAccountClient()
      const response = await client.startAccountLogin(
        input.method === 'device' ? { type: 'chatgptDeviceCode' } : { type: 'chatgpt' }
      )
      this.activeCodingPlanLoginIds.add(response.loginId)
      if (response.type === 'chatgpt') {
        return {
          ok: true,
          method: 'browser',
          loginId: response.loginId,
          authUrl: response.authUrl
        }
      }
      return {
        ok: true,
        method: 'device',
        loginId: response.loginId,
        verificationUrl: response.verificationUrl,
        userCode: response.userCode
      }
    } catch (error) {
      return failure(error)
    } finally {
      this.codingPlanLoginStartsInFlight -= 1
    }
  }

  async waitForCodingPlanLogin(
    loginId: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<CodexCodingPlanLoginCompletionResult> {
    const normalizedLoginId = loginId.trim()
    if (!normalizedLoginId) return failure(new Error('Codex coding-plan login id is required.'))
    const completed = this.codingPlanLoginCompletions.get(normalizedLoginId)
    if (completed) return completed
    if (options.signal?.aborted) return failure(new Error('Codex coding-plan login wait was aborted.'))
    return new Promise<CodexCodingPlanLoginCompletionResult>((resolve) => {
      const complete = (result: CodexCodingPlanLoginCompletion): void => {
        options.signal?.removeEventListener('abort', abort)
        resolve(result)
      }
      const abort = (): void => {
        const waiters = this.codingPlanLoginWaiters.get(normalizedLoginId)
        waiters?.delete(complete)
        if (waiters?.size === 0) this.codingPlanLoginWaiters.delete(normalizedLoginId)
        resolve(failure(new Error('Codex coding-plan login wait was aborted.')))
      }
      const waiters = this.codingPlanLoginWaiters.get(normalizedLoginId) ?? new Set()
      waiters.add(complete)
      this.codingPlanLoginWaiters.set(normalizedLoginId, waiters)
      options.signal?.addEventListener('abort', abort, { once: true })
    })
  }

  async logoutCodingPlanAccount(): Promise<CodexTurnMutationResult> {
    try {
      const { client } = await this.ensureCodingPlanAccountClient()
      await client.logoutAccount()
      this.clearCodingPlanAccountState('Codex coding-plan account logged out.')
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async getCodingPlanRateLimits(): Promise<CodexCodingPlanRateLimitsResult> {
    try {
      const { client } = await this.ensureCodingPlanAccountClient()
      const response = await client.readAccountRateLimits()
      const result: Extract<CodexCodingPlanRateLimitsResult, { ok: true }> = {
        ok: true,
        ...response
      }
      this.codingPlanRateLimits = result
      return result
    } catch (error) {
      return failure(error)
    }
  }

  async listThreads(options: CodexThreadListOptions = {}): Promise<CodexThreadListResult> {
    const stored = (await this.storedThreads({
      includeArchived: options.includeArchived === true || options.archivedOnly === true
    })).filter(isMaterializedStoredThread)
    try {
      const { client } = await this.ensureConnectedClient()
      const response = await client.listThreads({
        limit: options.limit ?? 100,
        ...(options.search ? { search: options.search } : {}),
        ...(options.includeArchived === true ? { includeArchived: true } : {}),
        ...(options.archivedOnly === true ? { archivedOnly: true } : {})
      })
      const liveThreads = readThreadList(response).map(normalizeThread)
      const knownLiveThreads = liveThreads.filter((thread) => isKnownStoredThread(thread, stored))
      const persisted = await this.persistThreads(knownLiveThreads, {
        preserveArchived: true
      })
      const mappedLiveThreads = knownLiveThreads.map((thread, index) => {
        const storedThread = persisted[index]
        return storedThread
          ? {
              ...thread,
              id: storedThread.guiThreadId,
              codexThreadId: storedThread.codexThreadId,
              archived: storedThread.archived
            }
          : thread
      })
      return {
        ok: true,
        threads: filterThreadList(
          mergeThreads(mappedLiveThreads, stored.map(storedThreadToNormalizedThread)),
          options
        )
      }
    } catch (error) {
      if (this.activeTurns.size > 0) {
        return {
          ok: true,
          threads: filterThreadList(stored.map(storedThreadToNormalizedThread), options)
        }
      }
      await this.discardClientAfterFailure(error)
      if (stored.length > 0) {
        return { ok: true, threads: filterThreadList(stored.map(storedThreadToNormalizedThread), options) }
      }
      return failure(error)
    }
  }

  async startThread(
    payload: CodexThreadStartPayload,
    retryStoppedClient = true
  ): Promise<CodexThreadStartResult> {
    try {
      const startedAtMs = Date.now()
      const settings = await this.options.settings()
      const workspace = resolveCodexWorkspace(settings, payload.workspace)
      const startupStatusThreadId = `codex-thread-start-${startedAtMs}`
      const coldStart = !this.isClientWarm()
      if (coldStart) {
        await this.emitRuntimeStatus({
          threadId: startupStatusThreadId,
          phase: 'process_start',
          message: 'Starting Codex app-server'
        }, { persist: false })
        await this.emitRuntimeStatus({
          threadId: startupStatusThreadId,
          phase: 'initialize_start',
          message: 'Initializing Codex app-server'
        }, { persist: false })
      }
      const { client } = await this.ensureModelUseClient(settings)
      if (coldStart) {
        await this.emitRuntimeStatus({
          threadId: startupStatusThreadId,
          phase: 'initialize_done',
          message: 'Codex app-server initialized',
          latencyMs: elapsedMs(startedAtMs)
        }, { persist: false })
      }
      const dynamicTools = await this.codexDynamicTools(settings, payload.allowedTools)
      const response = await client.startThread({
        ...baseThreadParams(settings, workspace, {
          subagentsConfigured: this.isSubagentDelegationConfigured(settings),
          dynamicTools
        }),
        ...codexModelAccessThreadParams(settings),
        serviceName: 'SciForge',
        ephemeral: false,
        ...(payload.relation ? { relation: payload.relation } : {}),
        ...(payload.parentThreadId ? { parentThreadId: payload.parentThreadId } : {}),
        ...(payload.parentTurnId ? { parentTurnId: payload.parentTurnId } : {}),
        ...(payload.threadSource ? { threadSource: payload.threadSource } : {}),
        ...(payload.sidebarVisibility ? { sidebarVisibility: payload.sidebarVisibility } : {}),
        ...(payload.threadSource || payload.relation || payload.sidebarVisibility || payload.parentThreadId || payload.parentTurnId
          ? {
              source: {
                ...(payload.threadSource ? { type: payload.threadSource } : {}),
                ...(payload.relation ? { relation: payload.relation } : {}),
                ...(payload.sidebarVisibility ? { sidebarVisibility: payload.sidebarVisibility } : {}),
                ...(payload.parentThreadId ? { parentThreadId: payload.parentThreadId } : {}),
                ...(payload.parentTurnId ? { parentTurnId: payload.parentTurnId } : {})
              }
            }
          : {})
      })
      const thread = normalizeThread(readThread(response))
      const storedThread = await this.persistThread({
        ...thread,
        workspace: thread.workspace || workspace,
        title: payload.title || thread.title,
        relation: thread.relation ?? payload.relation,
        parentThreadId: thread.parentThreadId || payload.parentThreadId,
        parentTurnId: thread.parentTurnId || payload.parentTurnId,
        threadSource: thread.threadSource || payload.threadSource,
        sidebarVisibility: thread.sidebarVisibility || payload.sidebarVisibility
      }, {
        ...(payload.threadId ? { guiThreadId: payload.threadId } : {})
      })
      if (payload.allowedTools !== undefined) {
        const allowed = new Set(payload.allowedTools)
        for (const id of [
          payload.threadId,
          thread.id,
          storedThread?.guiThreadId,
          storedThread?.codexThreadId
        ]) {
          if (id?.trim()) this.allowedToolsByThread.set(id.trim(), allowed)
        }
      }
      await this.emitRuntimeStatus({
        threadId: storedThread?.guiThreadId ?? thread.id,
        phase: 'thread_start_done',
        message: 'Codex thread ready',
        latencyMs: elapsedMs(startedAtMs)
      })
      return {
        ok: true,
        thread: storedThread
          ? storedThreadToNormalizedThread(storedThread)
          : {
              ...thread,
              workspace: thread.workspace || workspace,
              title: payload.title || thread.title,
              relation: thread.relation ?? payload.relation,
              parentThreadId: thread.parentThreadId || payload.parentThreadId,
              parentTurnId: thread.parentTurnId || payload.parentTurnId,
              threadSource: thread.threadSource || payload.threadSource,
              sidebarVisibility: thread.sidebarVisibility || payload.sidebarVisibility
            }
      }
    } catch (error) {
      await this.discardClientAfterFailure(error)
      if (retryStoppedClient && isClientStoppedBeforeRequest(error)) {
        return this.startThread(payload, false)
      }
      return failure(error)
    }
  }

  async readThread(threadId: string): Promise<CodexThreadReadResult> {
    const storedDetail = await this.readStoredDetail(threadId)
    const storedThread = await this.findStoredThread(threadId)
    const guiThreadId = storedThread?.guiThreadId ?? threadId
    const codexThreadId = storedThread?.codexThreadId ?? threadId
    try {
      const { client } = await this.ensureConnectedClient()
      const response = await client.readThread({ threadId: codexThreadId, includeTurns: true })
      const thread = readThread(response)
      const detail = threadDetail(thread)
      const usage = await this.usageStore?.threadUsage(storedThread?.guiThreadId ?? threadId)
      const detailWithUsage = usage ? { ...detail, usage } : detail
      const storedDetailWithUsage = storedDetail && usage ? { ...storedDetail, usage } : storedDetail
      const preferredDetail = withStoredThreadWorkspace(
        preferThreadDetail(detailWithUsage, storedDetailWithUsage),
        storedThread
      )
      if (storedDetail && this.shouldRepairStaleTurnDetail(guiThreadId, preferredDetail, storedDetail)) {
        const repairedDetail = await this.readStoredDetail(guiThreadId, { repairStale: true })
        return {
          ok: true,
          detail: withStoredThreadWorkspace(repairedDetail ?? preferredDetail, storedThread)
        }
      }
      return { ok: true, detail: preferredDetail }
    } catch (error) {
      if (isMissingOrUnmaterializedThreadError(error) && isEmptyStoredThread(storedThread, storedDetail)) {
        return { ok: true, detail: emptyThreadDetail() }
      }
      if (isEmptyStoredThread(storedThread, storedDetail)) {
        if (this.activeTurns.size === 0 && isCodexRuntimeDisconnectedError(error)) {
          await this.discardClientAfterFailure(error)
        }
        return { ok: true, detail: emptyThreadDetail() }
      }
      if (this.activeTurns.size > 0) {
        if (storedDetail) return { ok: true, detail: storedDetail }
        return failure(error)
      }
      if (isCodexRuntimeDisconnectedError(error)) {
        await this.discardClientAfterFailure(error)
      }
      if (storedDetail) {
        return { ok: true, detail: await this.readStoredDetail(guiThreadId, { repairStale: true }) ?? storedDetail }
      }
      return failure(error)
    }
  }

  async readStoredEvents(threadId: string, sinceSeq = 0): Promise<CodexThreadEventPayload[]> {
    if (!this.eventStore) return []
    const events = await this.eventStore.read(threadId, { sinceSeq })
    return events.map((event) => event.event)
  }

  async publishSyntheticEvent(event: AgentRuntimeEvent): Promise<CodexThreadEventPayload> {
    if (event.kind === 'error') {
      return this.emitRuntimeError({
        threadId: event.threadId,
        turnId: event.turnId,
        itemId: event.itemId,
        message: event.message,
        code: event.code,
        details: event.detail,
        severity: event.severity
      })
    }
    if (event.kind === 'goal_event') {
      const runtimeEvent: CodexThreadEventPayload = {
        threadId: event.threadId,
        turnId: event.turnId,
        goal: {
          itemId: event.itemId,
          createdAt: event.createdAt,
          objective: event.objective,
          status: event.status,
          cleared: event.cleared
        }
      }
      const stored = await this.persistEvent(event.threadId, runtimeEvent)
      const published = stored?.event ?? runtimeEvent
      await this.noteRuntimeEvent(published)
      this.broadcastEvent(published)
      this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.event, { event: published })
      return published
    }
    if (event.kind === 'child_event') {
      return this.publishClientEvent({
        threadId: event.threadId,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        child: event.child
      })
    }
    if (event.kind !== 'runtime_status') {
      throw new Error(`Unsupported Codex synthetic event kind: ${event.kind}`)
    }
    if (!event.phase) throw new Error('Codex synthetic runtime_status requires phase.')
    return this.emitRuntimeStatus({
      threadId: event.threadId,
      turnId: event.turnId,
      itemId: event.itemId,
      phase: event.phase,
      message: event.message,
      latencyMs: event.latencyMs,
      createdAt: event.createdAt
    })
  }

  async *subscribeEvents(
    threadId: string,
    sinceSeq = 0,
    signal?: AbortSignal
  ): AsyncIterable<CodexThreadEventPayload> {
    let latestSeq = sinceSeq
    const subscriber = this.addEventSubscriber(threadId)
    const onAbort = (): void => this.closeEventSubscriber(subscriber)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      for (const event of await this.readStoredEvents(threadId, sinceSeq)) {
        latestSeq = Math.max(latestSeq, event.seq ?? latestSeq)
        yield event
      }
      while (!signal?.aborted && !subscriber.closed) {
        const event = await this.nextSubscriberEvent(subscriber)
        if (!event) break
        if (typeof event.seq === 'number' && event.seq <= latestSeq) continue
        latestSeq = Math.max(latestSeq, event.seq ?? latestSeq)
        yield event
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      this.closeEventSubscriber(subscriber)
    }
  }

  async renameThread(threadId: string, title: string): Promise<CodexThreadMutationResult> {
    try {
      const stored = await this.findStoredThread(threadId)
      const { client } = await this.ensureConnectedClient()
      await client.renameThread({ threadId: stored?.codexThreadId ?? threadId, title })
      if (stored) {
        await this.threadStore?.upsert({
          guiThreadId: stored.guiThreadId,
          codexThreadId: stored.codexThreadId,
          title,
          titleSource: 'user'
        })
      }
      return { ok: true }
    } catch (error) {
      if (this.activeTurns.size > 0) return failure(error)
      await this.discardClientAfterFailure(error)
      return failure(error)
    }
  }

  async deleteThread(threadId: string): Promise<CodexThreadMutationResult> {
    return this.archiveThread(threadId, true)
  }

  async archiveThread(threadId: string, archived: boolean): Promise<CodexThreadMutationResult> {
    try {
      const stored = await this.findStoredThread(threadId)
      if (archived) {
        try {
          const { client } = await this.ensureConnectedClient()
          await client.request('thread/archive', { threadId: stored?.codexThreadId ?? threadId })
        } catch (error) {
          if (!isMissingOrUnmaterializedThreadError(error)) throw error
        }
        if (stored) {
          await this.threadStore?.archive(stored.guiThreadId)
        } else {
          await this.threadStore?.upsert({
            guiThreadId: threadId,
            codexThreadId: threadId,
            archived: true
          })
        }
      } else if (stored) {
        await this.threadStore?.upsert({
          guiThreadId: stored.guiThreadId,
          codexThreadId: stored.codexThreadId,
          archived: false
        })
      }
      return { ok: true }
    } catch (error) {
      await this.discardClientAfterFailure(error)
      return failure(error)
    }
  }

  async startTurn(
    payload: CodexTurnStartPayload,
    retryStoppedClient = true
  ): Promise<CodexTurnStartResult> {
    let preparedGovernance: CodexPreparedTurnGovernance | null = null
    try {
      const startedAtMs = Date.now()
      const settings = await this.options.settings()
      const runtime = getCodexRuntimeSettings(settings)
      const modelAccess = codexModelAccessThreadParams(settings)
      const runtimeModel = modelAccess.model
      let storedThread = await this.findStoredThread(payload.threadId)
      const workspace = resolveCodexWorkspace(settings, payload.workspace || storedThread?.workspace)
      const modelText = payload.text
      const modelDisplayText = payload.displayText
      let codexThreadId = storedThread?.codexThreadId ?? payload.threadId
      storedThread = storedThread ?? await this.ensureGuiThreadRecord({
        guiThreadId: payload.threadId,
        codexThreadId,
        workspace
      })
      codexThreadId = storedThread?.codexThreadId ?? codexThreadId
      const coldStart = !this.isClientWarm()
      if (coldStart) {
        await this.emitRuntimeStatus({
          threadId: payload.threadId,
          phase: 'process_start',
          message: 'Starting Codex app-server'
        })
        await this.emitRuntimeStatus({
          threadId: payload.threadId,
          phase: 'initialize_start',
          message: 'Initializing Codex app-server'
        })
      }
      const { client } = await this.ensureModelUseClient(settings)
      if (coldStart) {
        await this.emitRuntimeStatus({
          threadId: payload.threadId,
          phase: 'initialize_done',
          message: 'Codex app-server initialized',
          latencyMs: elapsedMs(startedAtMs)
        })
      }
      let response: unknown
      preparedGovernance = await this.prepareCodexTurnGovernance({
        sessionId: codexThreadId,
        allowedTools: this.allowedToolsByThread.has(payload.threadId)
          ? [...this.allowedToolsByThread.get(payload.threadId)!]
          : undefined,
        ownedVisualToolsAvailable: payload.ownedVisualToolsAvailable === true,
        nativeVisualProofChainPending:
          payload.nativeVisualProofChainPending === true
      })
      try {
        response = await client.startTurn(turnStartParams({
          threadId: codexThreadId,
          guiThreadId: payload.threadId,
          text: modelText,
          workspace,
          model: runtimeModel,
          reasoningEffort: payload.reasoningEffort,
          imageUrls: payload.imageUrls,
          fileReferences: payload.fileReferences,
          runtime
        }))
      } catch (error) {
        if (!isMissingOrUnmaterializedThreadError(error)) {
          throw error
        }
        const replacement = await this.rematerializeThread({
          client,
          settings,
          guiThreadId: payload.threadId,
          storedThread,
          workspace
        })
        await this.releasePreparedCodexTurnGovernance(preparedGovernance)
        codexThreadId = replacement.codexThreadId
        preparedGovernance = await this.prepareCodexTurnGovernance({
          sessionId: codexThreadId,
          allowedTools: this.allowedToolsByThread.has(payload.threadId)
            ? [...this.allowedToolsByThread.get(payload.threadId)!]
            : undefined,
          ownedVisualToolsAvailable: payload.ownedVisualToolsAvailable === true,
          nativeVisualProofChainPending:
            payload.nativeVisualProofChainPending === true
        })
        response = await client.startTurn(turnStartParams({
          threadId: codexThreadId,
          guiThreadId: payload.threadId,
          text: modelText,
          workspace,
          model: runtimeModel,
          reasoningEffort: payload.reasoningEffort,
          imageUrls: payload.imageUrls,
          fileReferences: payload.fileReferences,
          runtime
        }))
      }
      const turn = asRecord(asRecord(response)?.turn) ?? {}
      const turnId = stringValue(turn.id) || ''
      this.recordActiveTurn(
        payload.threadId,
        turnId,
        startedAtMs,
        getModelAccessSettings(settings)?.mode !== 'api'
      )
      await this.bindCodexTurnGovernance({
        threadId: payload.threadId,
        turnId,
        prepared: preparedGovernance
      })
      preparedGovernance = null
      this.recordTurnModelHint(payload.threadId, turnId, runtimeModel)
      this.recordTurnRecovery(payload.threadId, turnId, {
        threadId: payload.threadId,
        text: modelText,
        workspace,
        model: runtimeModel,
        reasoningEffort: payload.reasoningEffort,
        fileReferences: payload.fileReferences,
        ownedVisualToolsAvailable:
          payload.ownedVisualToolsAvailable === true,
        nativeVisualProofChainPending:
          payload.nativeVisualProofChainPending === true,
        runtime,
        recoveryAttempted: false
      })
      await this.emitRuntimeStatus({
        threadId: payload.threadId,
        ...(turnId ? { turnId } : {}),
        phase: 'turn_start_sent',
        message: 'Codex turn start sent',
        latencyMs: elapsedMs(startedAtMs)
      })
      const userMessageItemId = stringValue(turn.userMessageItemId) || `codex-user-${Date.now()}`
      const userEvent = await this.persistEvent(payload.threadId, {
        threadId: payload.threadId,
        ...(turnId ? { turnId } : {}),
        userMessage: {
          itemId: userMessageItemId,
          turnId,
          createdAt: new Date().toISOString(),
          text: payload.text,
          ...(modelDisplayText?.trim() && modelDisplayText.trim() !== payload.text.trim()
            ? { displayText: modelDisplayText.trim() }
            : {})
        }
      })
      if (userEvent) this.broadcastEvent(userEvent.event)
      return {
        ok: true,
        threadId: payload.threadId,
        turnId,
        userMessageItemId
      }
    } catch (error) {
      await this.releasePreparedCodexTurnGovernance(preparedGovernance)
        .catch(() => undefined)
      await this.discardClientAfterFailure(error)
      if (retryStoppedClient && isClientStoppedBeforeRequest(error)) {
        return this.startTurn(payload, false)
      }
      return failure(error)
    }
  }

  private async prepareCodexTurnGovernance(input: {
    sessionId: string
    allowedTools?: readonly string[]
    ownedVisualToolsAvailable?: boolean
    nativeVisualProofChainPending?: boolean
    parent?: CodexPreparedTurnGovernance['parent']
  }): Promise<CodexPreparedTurnGovernance> {
    const sessionId = input.sessionId.trim()
    if (!sessionId) throw new Error('Codex turn governance requires a session id.')
    if (!this.preToolUseGovernanceBridge) {
      if (input.nativeVisualProofChainPending || input.parent || input.allowedTools !== undefined) {
        throw new Error(
          'Codex native visual execution requires the SciForge pre-tool governance bridge.'
        )
      }
      return { sessionId }
    }
    if (input.parent) {
      const parent = this.resolveParentCodexTurnGovernance(input.parent)
      await this.preToolUseGovernanceBridge.seedSessionForGovernanceTurn(
        sessionId,
        parent.governanceTurnId
      )
      return {
        sessionId,
        parent: {
          threadId: parent.governanceThreadId,
          turnId: parent.governanceTurnId
        }
      }
    }
    await this.preToolUseGovernanceBridge.seedSession(sessionId, {
      ownedVisualToolsAvailable: input.ownedVisualToolsAvailable === true,
      nativeVisualProofChainPending:
        input.nativeVisualProofChainPending === true
    }, input.allowedTools)
    return { sessionId }
  }

  private resolveParentCodexTurnGovernance(parent: {
    threadId: string
    turnId: string
  }): CodexTurnGovernanceBinding {
    const binding = this.governanceBindingsByTurn.get(
      turnTimingKey(parent.threadId, parent.turnId)
    )
    if (
      this.activeTurns.get(parent.threadId) !== parent.turnId ||
      !binding ||
      binding.governanceThreadId !== parent.threadId ||
      binding.governanceTurnId !== parent.turnId
    ) {
      throw new Error(
        'Codex child governance requires the active parent Host turn governance key.'
      )
    }
    return binding
  }

  private async bindCodexTurnGovernance(input: {
    threadId: string
    turnId: string
    prepared: CodexPreparedTurnGovernance
  }): Promise<void> {
    const turnId = input.turnId.trim()
    if (!turnId) throw new Error('Codex turn governance requires a turn id.')
    if (this.preToolUseGovernanceBridge) {
      await this.preToolUseGovernanceBridge.bindTurn({
        threadId: input.threadId,
        turnId,
        sessionId: input.prepared.sessionId,
        ...(input.prepared.parent
          ? { governanceTurnId: input.prepared.parent.turnId }
          : {})
      })
    }
    this.governanceBindingsByTurn.set(
      turnTimingKey(input.threadId, turnId),
      {
        sessionId: input.prepared.sessionId,
        governanceThreadId: input.prepared.parent?.threadId ?? input.threadId,
        governanceTurnId: input.prepared.parent?.turnId ?? turnId
      }
    )
  }

  private async releasePreparedCodexTurnGovernance(
    prepared: CodexPreparedTurnGovernance | null
  ): Promise<void> {
    if (!prepared) return
    await this.preToolUseGovernanceBridge?.deleteSessionSeed(prepared.sessionId)
  }

  async interruptTurn(
    threadId: string,
    turnId: string,
    options: CodexTurnInterruptOptions = {}
  ): Promise<CodexTurnMutationResult> {
    try {
      const invalidTarget = this.validateActiveTurn(threadId, turnId)
      if (invalidTarget) return invalidTarget
      const codexThreadId = await this.codexThreadIdFor(threadId)
      const { client } = await this.ensureConnectedClient()
      this.options.capabilityAgentTools?.abortTurn?.({ runtimeId: 'codex', threadId, turnId }, 'user_stop')
      await client.interruptTurn({ threadId: codexThreadId, turnId })
      if (options.discard) await this.stop('user_stop')
      return { ok: true }
    } catch (error) {
      await this.discardClientAfterFailure(error)
      return failure(error)
    }
  }

  async steerTurn(payload: CodexTurnSteerPayload): Promise<CodexTurnMutationResult> {
    try {
      const invalidTarget = this.validateActiveTurn(payload.threadId, payload.turnId)
      if (invalidTarget) return invalidTarget
      const codexThreadId = await this.codexThreadIdFor(payload.threadId)
      const { client } = await this.ensureConnectedClient()
      await client.steerTurn({
        threadId: codexThreadId,
        expectedTurnId: payload.turnId,
        input: [textInput(payload.text)]
      })
      return { ok: true }
    } catch (error) {
      await this.discardClientAfterFailure(error)
      return failure(error)
    }
  }

  async updateTurnGovernanceSnapshot(
    input: AgentRuntimeTurnGovernanceSnapshotInput
  ): Promise<CodexTurnMutationResult> {
    try {
      if (input.runtimeId !== 'codex') return { ok: true }
      if (this.activeTurns.get(input.threadId) !== input.turnId) return { ok: true }
      if (!this.preToolUseGovernanceBridge) {
        return unsupportedFailure(
          'Codex pre-tool governance requires a SciForge runtime storage root.'
        )
      }
      const binding = this.governanceBindingsByTurn.get(
        turnTimingKey(input.threadId, input.turnId)
      )
      if (!binding) {
        throw new Error('Codex active turn governance binding is unavailable.')
      }
      await this.preToolUseGovernanceBridge.updateSnapshot({
        ...input,
        threadId: binding.governanceThreadId,
        turnId: binding.governanceTurnId
      })
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async compactThread(threadId: string, _reason?: string): Promise<CodexThreadMutationResult> {
    if (!this.threadStore) return { ok: true }
    try {
      const settings = await this.options.settings()
      const storedThread = await this.findStoredThread(threadId)
      const guiThreadId = storedThread?.guiThreadId ?? threadId
      const workspace = resolveCodexWorkspace(settings, storedThread?.workspace)
      const { client } = await this.ensureConnectedClient(settings)
      await this.rematerializeThread({
        client,
        settings,
        guiThreadId,
        storedThread,
        workspace
      })
      return { ok: true }
    } catch (error) {
      await this.discardClientAfterFailure(error)
      return failure(error)
    }
  }

  async forkThread(
    _threadId: string,
    _options?: { relation?: 'primary' | 'fork' | 'side'; title?: string }
  ): Promise<CodexThreadForkResult> {
    return unsupportedFailure('Codex thread fork is not supported yet.')
  }

  async resumeSession(
    _sessionId: string,
    _options?: { model?: string; mode?: string }
  ): Promise<CodexSessionResumeResult> {
    return unsupportedFailure('Codex session resume is not supported yet.', 'not_implemented')
  }

  async usage(input: AgentRuntimeUsageQuery): Promise<AgentRuntimeUsageResponse> {
    if (!this.usageStore) {
      return {
        supported: false,
        reason: 'usage unsupported',
        groupBy: input.groupBy,
        buckets: [],
        totals: {}
      }
    }
    await this.backfillStoredUsageEvents()
    return this.usageStore.summary(input, { threads: await this.storedThreads({ includeArchived: true }) })
  }

  pendingServerRequests(): CodexAppServerPendingRequest[] {
    return typeof this.client?.pendingServerRequests === 'function'
      ? this.client.pendingServerRequests()
      : []
  }

  async resolveApproval(input: CodexAppServerResolveApprovalInput): Promise<CodexTurnMutationResult> {
    try {
      if (!this.client) throw new Error('No Codex app-server request is pending.')
      this.client.resolveApproval(input)
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async resolveUserInput(input: CodexAppServerResolveUserInputInput): Promise<CodexTurnMutationResult> {
    try {
      if (!this.client) throw new Error('No Codex app-server request is pending.')
      this.client.resolveUserInput(input)
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async stop(reason: RuntimeToolReleaseReason = 'service_shutdown'): Promise<void> {
    const session = this.clientSession
    if (!session) return
    await this.cleanupClientSession(session, {
      reason,
      failure: false
    })
    await session.readiness.catch(() => undefined)
  }

  private async discardClientAfterFailure(
    error?: unknown,
    session: CodexClientSession | null = this.clientSession
  ): Promise<void> {
    if (error instanceof CodexCodingPlanLoginInProgressError) return
    if (!session) return
    await this.cleanupClientSession(session, {
      reason: 'runtime_disconnected',
      failure: true
    })
  }

  private cleanupClientSession(
    session: CodexClientSession,
    input: {
      reason: RuntimeToolReleaseReason | 'runtime_disconnected'
      failure: boolean
    }
  ): Promise<void> {
    if (session.cleanupPromise) return session.cleanupPromise
    session.cancelled = true
    const current = this.clientSession === session
    const governanceTurnIds = [...this.activeTurns.values()]
    const governanceSessionIds = [...this.governanceBindingsByTurn.values()]
      .map((binding) => binding.sessionId)
    const cleanup = (async () => {
      if (current) {
        const releaseReason = input.failure ? 'runtime_disconnected' : input.reason
        for (const [threadId, turnId] of this.activeTurns) {
          this.options.capabilityAgentTools?.abortTurn?.(
            { runtimeId: 'codex', threadId, turnId },
            releaseReason
          )
        }
        await this.finalizeActiveTurnsBeforeTeardown({
          code: input.failure
            ? 'runtime_disconnected'
            : input.reason === 'user_stop'
              ? 'aborted'
              : 'runtime_stopped',
          message: input.failure
            ? CODEX_TURN_DISCONNECTED_MESSAGE
            : input.reason === 'user_stop'
              ? 'Codex turn was stopped before it completed.'
              : CODEX_TURN_STOPPED_MESSAGE,
          details: { reason: releaseReason }
        })
        if (this.clientSession === session) {
          this.activeTurns.clear()
          this.turnTimings.clear()
          this.turnModelHints.clear()
          this.governanceBindingsByTurn.clear()
          this.turnsWithRecordedUsage.clear()
          this.clearAllFirstActivityTimers()
          this.modelDeltaDedupeByTurn.clear()
          this.clearPendingToolBarrier()
          this.clearCodingPlanAccountState(
            input.failure
              ? 'Codex runtime disconnected before login completed.'
              : 'Codex runtime stopped before login completed.'
          )
          this.closeAllEventSubscribers()
        }
        await Promise.all(
          [
            ...governanceTurnIds.map((turnId) =>
              this.preToolUseGovernanceBridge?.deleteTurnState(turnId)
            ),
            ...governanceSessionIds.map((sessionId) =>
              this.preToolUseGovernanceBridge?.deleteSessionSeed(sessionId)
            )
          ]
        )
      }
      const client = session.client
      if (client) {
        try {
          await client.stop()
        } catch {
          // The request path already has the meaningful failure. Cleanup is best-effort.
        }
      }
      if (this.clientSession === session) {
        this.clientSession = null
        if (this.client === session.client) this.client = null
      }
    })()
    session.cleanupPromise = cleanup
    return cleanup
  }

  private async finalizeActiveTurnsBeforeTeardown(input: {
    code: string
    message: string
    details?: unknown
  }): Promise<void> {
    const activeTurns = [...this.activeTurns.entries()]
    for (const [threadId, turnId] of activeTurns) {
      if (this.activeTurns.get(threadId) !== turnId) continue
      try {
        await this.emitRuntimeError({
          threadId,
          turnId,
          message: input.message,
          code: input.code,
          details: input.details,
          severity: 'error'
        })
      } catch (error) {
        this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.error, {
          message: error instanceof Error ? error.message : String(error),
          detail: error
        })
      }
    }
  }

  private async ensureConnectedClient(
    settings?: AppSettingsV1,
    access: 'runtime' | 'account' = 'runtime'
  ): Promise<CodexConnectedClient> {
    const current = settings ?? await this.options.settings()
    if (access === 'runtime' && !resolveModelAccessRuntimePolicy(current).codex) {
      const modelAccess = getModelAccessSettings(current)
      if (!modelAccess) {
        throw new Error('Model access setup is required. Choose Model API or Coding Plan in Settings before connecting Codex.')
      }
      if (modelAccess.mode === 'coding-plan' && !modelAccess.planAdapterId.trim()) {
        throw new Error('Select a Coding Plan in Settings before connecting Codex.')
      }
      throw new Error('Codex must be the selected Agent runtime for the configured model access mode.')
    }
    const nextAccessKey = codexModelAccessKey(current, this.options.planGateway)
    const existing = this.clientSession
    if (existing) {
      if (existing.accessKey === nextAccessKey && !existing.cancelled) {
        return existing.readiness
      }
      if (
        (this.codingPlanLoginStartsInFlight > 0 || this.activeCodingPlanLoginIds.size > 0) &&
        access === 'runtime'
      ) {
        throw new CodexCodingPlanLoginInProgressError(
          'Codex ChatGPT sign-in is still in progress. Complete or retry sign-in before starting the runtime.'
        )
      }
      await this.cleanupClientSession(existing, {
        reason: 'service_shutdown',
        failure: false
      })
      return this.ensureConnectedClient(current, access)
    }

    const session = {
      accessKey: nextAccessKey,
      client: null,
      launch: null,
      info: null,
      ready: false,
      cancelled: false,
      readiness: Promise.resolve(null as unknown as CodexConnectedClient),
      subscription: null,
      cleanupPromise: null
    } satisfies CodexClientSession
    this.clientSession = session
    session.readiness = this.startClientSession(session, current)
    return session.readiness
  }

  private async startClientSession(
    session: CodexClientSession,
    settings: AppSettingsV1
  ): Promise<CodexConnectedClient> {
    try {
      const launch = await prepareCodexAppServerLaunch({
        settings,
        managedCodexHome: this.options.managedCodexHome,
        standardCodexAuthPath: this.options.standardCodexAuthPath,
        planGateway: this.options.planGateway,
        preToolUseHookLaunch: this.options.preToolUseHookLaunch
      })
      if (session.cancelled || this.clientSession !== session) {
        throw new Error('Codex app-server startup was superseded.')
      }
      session.launch = launch
      const createClient = this.options.createClient ?? createCodexAppServerClient
      const client = createClient({
        command: launch.command,
        args: launch.args,
        cwd: launch.cwd,
        env: {
          ...launch.env,
          ...(this.options.storageRoot
            ? {
                [CODEX_PRE_TOOL_USE_GOVERNANCE_STORAGE_ROOT_ENV]:
                  this.options.storageRoot
              }
            : {})
        },
        clientInfo: {
          name: 'sciforge',
          title: 'SciForge',
          version: this.options.appVersion ?? '0.1.0'
        },
        pendingServerRequests: {
          onPendingRequest: (request) => {
            void this.publishPendingServerRequest(request).catch((error) => {
              this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.error, {
                message: error instanceof Error ? error.message : String(error),
                detail: error
              })
            })
          },
          onToolCallRequest: (request) => this.handleDynamicToolCall(request)
        }
      })
      session.client = client
      if (session.cancelled || this.clientSession !== session) {
        await client.stop().catch(() => undefined)
        throw new Error('Codex app-server startup was superseded.')
      }
      this.client = client
      session.subscription = this.forwardEvents(client, session)
      void session.subscription.catch(() => undefined)
      const info = await client.connect()
      await this.ensureCodexPreToolUseHookTrusted(client, launch)
      if (session.cancelled || this.clientSession !== session) {
        throw new Error('Codex app-server startup was superseded.')
      }
      session.info = info
      session.ready = true
      return { client, info }
    } catch (error) {
      await this.discardClientAfterFailure(error, session)
      throw error
    }
  }

  private async ensureModelUseClient(settings: AppSettingsV1): Promise<{
    client: CodexAppServerJsonRpcClient
    info: CodexAppServerInitializeResponse
  }> {
    const connected = await this.ensureConnectedClient(settings)
    const access = getModelAccessSettings(settings)
    if (!access) throw new Error('Codex model access setup is required.')
    if (access.mode === 'api') return connected
    if (this.codingPlanAccount?.account?.type === 'chatgpt') return connected
    const response = await connected.client.readAccount()
    const planType = response.account?.type === 'chatgpt' ? response.account.planType : null
    this.codingPlanAccount = {
      ok: true,
      account: response.account,
      planType,
      requiresOpenaiAuth: response.requiresOpenaiAuth
    }
    if (response.account?.type !== 'chatgpt') {
      throw new Error(
        'Codex coding-plan mode requires a ChatGPT account authenticated in the SciForge-managed Codex home.'
      )
    }
    return connected
  }

  private async ensureCodexPreToolUseHookTrusted(
    client: CodexAppServerJsonRpcClient,
    launch: CodexAppServerLaunchConfig
  ): Promise<void> {
    if (!this.options.preToolUseHookLaunch) return
    const storageRoot = this.options.storageRoot
    if (!this.preToolUseGovernanceBridge || !storageRoot) {
      throw new Error(
        'SciForge Codex PreToolUse governance requires a runtime storage root.'
      )
    }
    const expected = launch.preToolUseHook
    if (!expected) throw new Error('SciForge Codex PreToolUse hook was not prepared.')
    const first = await this.readOwnedCodexPreToolUseHook(client, launch.cwd, expected)
    await probeCodexPreToolUseHook({
      definition: expected,
      cwd: launch.cwd,
      storageRoot
    })
    if (first.trustStatus === 'trusted') return
    if (first.trustStatus !== 'untrusted' && first.trustStatus !== 'modified') {
      throw new Error(
        `SciForge Codex PreToolUse hook has unexpected trust status ${first.trustStatus}.`
      )
    }
    const write = await client.writeConfigBatch({
      edits: [{
        keyPath: 'hooks.state',
        value: {
          [first.key]: {
            enabled: true,
            trusted_hash: first.currentHash
          }
        },
        mergeStrategy: 'upsert'
      }],
      filePath: join(launch.codexHome, 'config.toml'),
      reloadUserConfig: true
    })
    if (write.status !== 'ok' && write.status !== 'okOverridden') {
      throw new Error(`Codex rejected SciForge hook trust update: ${write.status}.`)
    }
    const verified = await this.readOwnedCodexPreToolUseHook(
      client,
      launch.cwd,
      expected
    )
    if (
      verified.key !== first.key ||
      verified.currentHash !== first.currentHash ||
      verified.trustStatus !== 'trusted'
    ) {
      throw new Error('Codex did not verify the exact SciForge PreToolUse hook after trust reload.')
    }
  }

  private async readOwnedCodexPreToolUseHook(
    client: CodexAppServerJsonRpcClient,
    cwd: string,
    expected: CodexPreToolUseHookDefinition
  ): Promise<CodexAppServerHookMetadata> {
    const [canonicalCwd, canonicalSourcePath] = await Promise.all([
      realpath(cwd),
      realpath(expected.sourcePath)
    ])
    const response = await client.listHooks([canonicalCwd])
    if (!Array.isArray(response.data) || response.data.length !== 1) {
      throw new Error('Codex hooks/list did not return exactly one workspace result.')
    }
    const result = response.data[0]
    if (
      result.cwd !== canonicalCwd ||
      result.errors.length > 0 ||
      result.warnings.length > 0
    ) {
      throw new Error('Codex hooks/list returned a workspace mismatch or hook diagnostics.')
    }
    const owned = result.hooks.filter((hook) => hook.sourcePath === canonicalSourcePath)
    if (owned.length !== 1) {
      throw new Error('Codex did not discover exactly one SciForge-owned PreToolUse hook.')
    }
    const hook = owned[0]
    const expectedCommand = process.platform === 'win32'
      ? expected.commandWindows
      : expected.command
    if (
      hook.source !== 'user' ||
      hook.isManaged ||
      hook.pluginId !== null ||
      hook.eventName !== 'preToolUse' ||
      hook.handlerType !== 'command' ||
      hook.matcher !== null ||
      hook.command !== expectedCommand ||
      hook.enabled !== true ||
      !hook.key.trim() ||
      !/^sha256:[a-f0-9]+$/u.test(hook.currentHash)
    ) {
      throw new Error('Codex discovered hook identity does not match the SciForge-owned definition.')
    }
    return hook
  }

  private async ensureCodingPlanAccountClient(): Promise<{
    client: CodexAppServerJsonRpcClient
    info: CodexAppServerInitializeResponse
  }> {
    const settings = await this.options.settings()
    return this.ensureConnectedClient({
      ...settings,
      modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
    }, 'account')
  }

  isClientWarm(): boolean {
    const session = this.clientSession
    return Boolean(
      session?.ready &&
      !session.cancelled &&
      session.client &&
      this.client === session.client
    )
  }

  isResearchMcpConfigured(): boolean {
    return Boolean(this.options.capabilityAgentTools)
  }

  isComputerUseMcpConfigured(settings?: AppSettingsV1): boolean {
    return Boolean(this.options.capabilityAgentTools && isComputerUseMcpConfigured(settings, 'codex'))
  }

  isMcpConfigured(): boolean {
    return Boolean(this.options.capabilityAgentTools)
  }

  dynamicMcpToolDiagnostics(): [] {
    return []
  }

  private async codexDynamicTools(
    _settings?: AppSettingsV1,
    allowedTools?: readonly string[]
  ): Promise<RuntimeToolDefinition[]> {
    const source = this.options.capabilityAgentTools
    const capabilityTools = source
      ? filterAgentRuntimeToolSurface(source, allowedTools).tools()
      : []
    return capabilityTools.map((tool) => ({
      type: tool.type,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }

  private async handleDynamicToolCall(
    request: RuntimeToolCallRequest
  ): Promise<RuntimeToolCallResponse> {
    const settings = await this.options.settings()
    const contextualRequest = await this.requestWithGuiThreadContext(request)
    await this.publishDynamicToolExecutionFact(contextualRequest, 'dispatched')
    let response: RuntimeToolCallResponse
    try {
      response = await this.executeDynamicToolCall(contextualRequest, settings)
    } catch (error) {
      const name = request.namespace ? `${request.namespace}.${request.tool}` : request.tool
      response = {
        contentItems: [{
          type: 'inputText',
          text: `Runtime tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`
        }],
        success: false,
        ...dynamicToolErrorMetadata(error)
      }
    }
    await this.publishDynamicToolExecutionFact(
      contextualRequest,
      response.success ? 'succeeded' : 'failed',
      response
    )
    return response
  }

  private async executeDynamicToolCall(
    contextualRequest: RuntimeToolCallRequest,
    settings: AppSettingsV1
  ): Promise<RuntimeToolCallResponse> {
    if (this.canHandleCapabilityAgentTool(contextualRequest)) {
      return this.handleCapabilityAgentToolCall(contextualRequest, settings)
    }
    return failedDynamicToolCall(`Unknown runtime tool: ${contextualRequest.tool}`)
  }

  private isSubagentDelegationConfigured(settings: AppSettingsV1): boolean {
    return getAgentCapabilitySettings(settings).subagents.enabled &&
      (this.options.capabilityAgentTools?.tools() ?? [])
        .some((tool) => tool.name === AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME)
  }

  private canHandleCapabilityAgentTool(request: RuntimeToolCallRequest): boolean {
    if (request.namespace || !this.options.capabilityAgentTools) return false
    const threadId = stringValue(request.threadId).trim()
    const allowed = threadId ? this.allowedToolsByThread.get(threadId) : undefined
    if (allowed && !allowed.has(request.tool)) return false
    return this.options.capabilityAgentTools.tools().some((tool) => tool.name === request.tool)
  }

  private async handleCapabilityAgentToolCall(
    request: RuntimeToolCallRequest,
    settings: AppSettingsV1
  ): Promise<RuntimeToolCallResponse> {
    const surface = this.options.capabilityAgentTools
    if (!surface) return failedDynamicToolCall('The SciForge capability agent surface is not configured.')
    const threadId = stringValue(request.threadId).trim()
    if (!threadId) return failedDynamicToolCall('SciForge capability tools require a thread context.')
    const storedThread = await this.findStoredThread(threadId)
    const workspaceId = resolveCodexWorkspace(settings, storedThread?.workspace)
    const result = await surface.call({
      name: request.tool,
      arguments: request.arguments,
      context: {
        requestId: request.requestId,
        runtimeId: 'codex',
        threadId,
        workspaceId,
        ...(request.turnId ? { turnId: request.turnId } : {}),
        ...(request.callId ? { callId: request.callId } : {})
      }
    })
    const execution = nativeAgentToolExecutionMetadata(
      { tool: request.tool, value: result.value },
      stringValue(request.callId).trim() || String(request.requestId)
    )
    return {
      success: true,
      contentItems: [{ type: 'inputText', text: JSON.stringify(result.value, null, 2) }],
      structuredContent: result.value,
      ...(execution.effects.length ? { effects: execution.effects } : {}),
      ...(execution.completionReceipts.length
        ? { completionReceipts: execution.completionReceipts }
        : {}),
      evidenceDelta: true,
      ...(booleanValue(asRecord(result.value)?.changed) !== undefined
        ? { stateChanged: booleanValue(asRecord(result.value)?.changed) }
        : {}),
      ...(stringValue(asRecord(result.value)?.resourceRef).trim()
        ? { resourceIdentity: stringValue(asRecord(result.value)?.resourceRef).trim() }
        : {})
    }
  }

  private async publishDynamicToolExecutionFact(
    request: RuntimeToolCallRequest,
    phase: 'dispatched' | 'succeeded' | 'failed',
    response?: RuntimeToolCallResponse
  ): Promise<void> {
    const threadId = stringValue(request.threadId).trim()
    const turnId = stringValue(request.turnId).trim()
    if (!threadId || !turnId) return
    const callId = stringValue(request.callId).trim() || String(request.requestId)
    const toolName = stringValue(request.tool).trim() || 'dynamic_tool'
    const terminal = phase !== 'dispatched'
    const event: CodexThreadEventPayload = {
      threadId,
      turnId,
      tool: {
        itemId: callId,
        summary: toolName,
        status: phase === 'dispatched' ? 'running' : phase === 'succeeded' ? 'success' : 'error',
        toolKind: 'tool_call',
        ...(response?.effects?.length ? { effects: response.effects } : {}),
        ...(response?.completionReceipts?.length
          ? { completionReceipts: response.completionReceipts }
          : {}),
        ...(terminal && response ? { detail: dynamicToolResponseSummary(response) } : {}),
        meta: {
          callId,
          toolName,
          phase,
          factSource: terminal ? 'executor_result' : 'runtime_lifecycle',
          evidenceStrength: terminal ? 'executor_receipt' : 'runtime_lifecycle',
          arguments: dynamicToolArgumentsRecord(request.arguments) ?? request.arguments,
          ...(terminal ? { success: response?.success === true } : {}),
          ...(response?.structuredContent !== undefined
            ? { structuredContent: response.structuredContent }
            : {}),
          ...(response?.errorCode ? { errorCode: response.errorCode } : {}),
          ...(response?.failureClass ? { failureClass: response.failureClass } : {}),
          ...(response?.retryable !== undefined ? { retryable: response.retryable } : {}),
          ...(response?.recoveryGuidance ? { recoveryGuidance: response.recoveryGuidance } : {}),
          ...(response?.providerStage ? { providerStage: response.providerStage } : {}),
          ...(response?.resourceIdentity ? { resourceIdentity: response.resourceIdentity } : {}),
          ...(response?.evidenceDelta !== undefined ? { evidenceDelta: response.evidenceDelta } : {}),
          ...(response?.stateChanged !== undefined ? { stateChanged: response.stateChanged } : {}),
          ...(request.namespace ? { namespace: request.namespace } : {})
        }
      }
    }
    try {
      const correlated = this.withCorrelatedToolExecutionFacts(event)
      for (const runtimeEvent of this.eventsAfterPendingToolBarrier(correlated)) {
        await this.publishClientEvent(runtimeEvent)
      }
    } catch (error) {
      this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.error, {
        message: `Failed to publish Codex dynamic tool execution fact: ${error instanceof Error ? error.message : String(error)}`,
        detail: error
      })
    }
  }

  private async requestWithGuiThreadContext(
    request: RuntimeToolCallRequest
  ): Promise<RuntimeToolCallRequest> {
    const threadId = stringValue(request.threadId).trim()
    if (!threadId) return request
    const storedThread = await this.findStoredThread(threadId)
    if (!storedThread || storedThread.guiThreadId === threadId) return request
    return { ...request, threadId: storedThread.guiThreadId }
  }

  async spawnSubagent(input: AgentRuntimeSubagentSpawnInput): Promise<AgentRuntimeSubagentResult> {
    const settings = await this.options.settings()
    const { client } = await this.ensureModelUseClient(settings)
    if (input.signal.aborted) throw new Error('Codex child turn was aborted before startup.')
    this.resolveParentCodexTurnGovernance({
      threadId: input.parentThreadId,
      turnId: input.parentTurnId
    })
    const workspace = resolveCodexWorkspace(settings, input.workspace)
    const dynamicTools = await this.codexDynamicTools(settings)
    const threadResponse = await client.startThread({
      ...baseThreadParams(settings, workspace, {
        subagentsConfigured: false,
        dynamicTools
      }),
      ...codexModelAccessThreadParams(settings),
      serviceName: 'SciForge',
      ephemeral: false,
      threadSource: 'subagent',
      relation: 'side',
      parentThreadId: input.parentThreadId,
      parentTurnId: input.parentTurnId,
      source: {
        type: 'subagent',
        parentThreadId: input.parentThreadId,
        parentTurnId: input.parentTurnId,
        ...(input.label ? { agentNickname: input.label } : {}),
        agentRole: 'subagent'
      }
    })
    if (input.signal.aborted) throw new Error('Codex child turn was aborted during thread startup.')
    const childThread = normalizeThread(readThread(threadResponse))
    if (!childThread.id) throw new Error('Codex child thread did not return a thread id.')
    const title = input.label || childThreadTitle(input.prompt)
    const storedChild = await this.persistThread({
      ...childThread,
      workspace: childThread.workspace || workspace,
      title,
      relation: childThread.relation ?? 'side',
      threadSource: childThread.threadSource || 'subagent',
      parentThreadId: childThread.parentThreadId || input.parentThreadId,
      parentTurnId: childThread.parentTurnId || input.parentTurnId,
      agentNickname: childThread.agentNickname || input.label,
      agentRole: childThread.agentRole || 'subagent'
    }, {
      workspace,
      title
    })
    const childGuiThreadId = storedChild?.guiThreadId ?? childThread.id
    const childCodexThreadId = storedChild?.codexThreadId ?? childThread.id
    const subscriber = this.addEventSubscriber(childGuiThreadId)
    const startedAtMs = Date.now()
    let childTurnId = ''
    let preparedGovernance: CodexPreparedTurnGovernance | null = null
    let terminationPromise: Promise<void> | null = null
    const terminateChildTurn = (signal?: AbortSignal): Promise<void> => {
      if (!childTurnId) return Promise.resolve()
      if (terminationPromise) return terminationPromise
      const pending = client.interruptTurn({
        threadId: childCodexThreadId,
        turnId: childTurnId
      }, signal).then(() => undefined)
      terminationPromise = pending
      void pending.catch(() => {
        if (terminationPromise === pending) terminationPromise = null
      })
      return pending
    }
    try {
      const modelAccess = codexModelAccessThreadParams(settings)
      preparedGovernance = await this.prepareCodexTurnGovernance({
        sessionId: childCodexThreadId,
        parent: {
          threadId: input.parentThreadId,
          turnId: input.parentTurnId
        }
      })
      const turnResponse = await client.startTurn(turnStartParams({
        threadId: childCodexThreadId,
        guiThreadId: childGuiThreadId,
        text: input.prompt,
        workspace,
        model: modelAccess.model,
        runtime: getCodexRuntimeSettings(settings)
      }))
      const turn = asRecord(asRecord(turnResponse)?.turn) ?? {}
      childTurnId = stringValue(turn.id) || ''
      if (!childTurnId) throw new Error('Codex child turn did not return a turn id.')
      if (input.signal.aborted) {
        await terminateChildTurn().catch(() => undefined)
        throw new Error('Codex child turn was aborted during turn startup.')
      }
      this.recordActiveTurn(
        childGuiThreadId,
        childTurnId,
        startedAtMs,
        getModelAccessSettings(settings)?.mode !== 'api'
      )
      await this.bindCodexTurnGovernance({
        threadId: childGuiThreadId,
        turnId: childTurnId,
        prepared: preparedGovernance
      })
      preparedGovernance = null
      this.recordTurnModelHint(childGuiThreadId, childTurnId, modelAccess.model)
      const activeSubagent: ActiveCodexSubagent = {
        childId: input.childId,
        parentThreadId: input.parentThreadId,
        parentTurnId: input.parentTurnId,
        threadId: childGuiThreadId,
        codexThreadId: childCodexThreadId,
        turnId: childTurnId,
        client,
        terminate: terminateChildTurn
      }
      this.activeSubagents.set(input.childId, activeSubagent)
      await input.onSpawned({
        runtime: 'codex',
        threadId: childGuiThreadId,
        turnId: childTurnId
      })
      await input.appendTranscript({
        id: `${input.childId}-thread-start`,
        kind: 'event',
        summary: 'Codex child thread started',
        text: `Thread: ${childGuiThreadId}`,
        createdAt: new Date().toISOString(),
        metadata: { threadId: childGuiThreadId, turnId: childTurnId }
      })
      const result = await this.waitForCodexChildTurn({
        subscriber,
        threadId: childGuiThreadId,
        turnId: childTurnId,
        parentThreadId: input.parentThreadId,
        parentTurnId: input.parentTurnId,
        signal: input.signal,
        terminateChildTurn
      })
      return {
        summary: result.summary || `Child agent ${childGuiThreadId} completed.`,
        usage: result.usage,
        transcript: result.transcript,
        threadRef: {
          runtime: 'codex',
          threadId: childGuiThreadId,
          turnId: childTurnId
        }
      }
    } finally {
      this.activeSubagents.delete(input.childId)
      await this.releasePreparedCodexTurnGovernance(preparedGovernance)
        .catch(() => undefined)
      if (childTurnId) {
        await this.clearTurnTracking(childGuiThreadId, childTurnId)
          .catch(() => undefined)
      }
      this.closeEventSubscriber(subscriber)
    }
  }

  async inspectSubagent(input: AgentRuntimeSubagentInspectInput) {
    const active = this.activeSubagents.get(input.childId)
    return {
      state: active && this.activeTurns.get(active.threadId) === active.turnId
        ? 'active' as const
        : 'missing' as const,
      observedAt: new Date().toISOString()
    }
  }

  async messageSubagent(input: AgentRuntimeSubagentMessageInput) {
    const active = this.activeSubagents.get(input.childId)
    if (!active || this.activeTurns.get(active.threadId) !== active.turnId) {
      return { established: false }
    }
    await active.client.steerTurn({
      threadId: active.codexThreadId,
      expectedTurnId: active.turnId,
      input: [textInput(input.message)]
    }, input.signal)
    return { established: true }
  }

  async cancelSubagent(input: AgentRuntimeSubagentCancelInput): Promise<void> {
    await this.activeSubagents.get(input.childId)?.terminate(input.signal)
  }

  private async waitForCodexChildTurn(input: {
    subscriber: CodexRuntimeEventSubscriber
    threadId: string
    turnId: string
    parentThreadId: string
    parentTurnId: string
    signal: AbortSignal
    terminateChildTurn(signal?: AbortSignal): Promise<void>
  }): Promise<{
    summary: string
    usage?: AgentRuntimeSubagentUsage
    transcript: AgentRuntimeSubagentTranscriptEntry[]
  }> {
    const transcript: AgentRuntimeSubagentTranscriptEntry[] = []
    let assistantText = ''
    let usage: AgentRuntimeSubagentUsage | undefined
    const onAbort = (): void => this.closeEventSubscriber(input.subscriber)
    input.signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!input.signal.aborted) {
        const event = await this.nextSubscriberEvent(input.subscriber)
        if (!event) break
        const turnId = event.turnId || event.userMessage?.turnId || ''
        if (turnId && turnId !== input.turnId) continue
        for (const [index, delta] of (event.deltas ?? []).entries()) {
          if (!delta.text) continue
          if (delta.kind === 'agent_message') assistantText += delta.text
          transcript.push({
            id: `codex-child-${input.turnId}-${event.seq ?? Date.now()}-${index}`,
            kind: delta.kind === 'agent_reasoning' ? 'reasoning' : 'assistant_message',
            text: delta.text,
            createdAt: new Date().toISOString()
          })
        }
        if (event.tool) {
          await this.publishCodexChildToolFactToParent(event, {
            parentThreadId: input.parentThreadId,
            parentTurnId: input.parentTurnId,
            childThreadId: input.threadId,
            childTurnId: input.turnId
          })
          transcript.push({
            id: event.tool.itemId,
            kind: 'tool',
            summary: event.tool.summary,
            text: event.tool.detail,
            status: event.tool.status,
            metadata: event.tool.meta
          })
        }
        if (event.usage) usage = subagentUsageFromCodexUsage(event.usage)
        if (isTerminalRuntimeError(event.runtimeError)) {
          throw codexChildTurnError(event.runtimeError, transcript, usage)
        }
        if (event.turnComplete) break
      }
      if (input.signal.aborted) {
        await input.terminateChildTurn().catch(() => undefined)
        const error = Object.assign(new Error('Codex child turn was aborted.'), {
          ...(assistantText.trim() ? { subagentSummary: assistantText.trim() } : {}),
          subagentTranscript: transcript,
          ...(usage ? { subagentUsage: usage } : {})
        })
        error.name = 'AbortError'
        throw error
      }
      return {
        summary: assistantText.trim(),
        ...(usage ? { usage } : {}),
        transcript
      }
    } finally {
      input.signal.removeEventListener('abort', onAbort)
    }
  }

  private async publishCodexChildToolFactToParent(
    event: CodexThreadEventPayload,
    input: {
      parentThreadId: string
      parentTurnId: string
      childThreadId: string
      childTurnId: string
    }
  ): Promise<void> {
    const tool = event.tool
    if (!tool) return
    if (this.activeTurns.get(input.parentThreadId) !== input.parentTurnId) {
      throw new Error('Codex child receipt cannot target an inactive parent turn.')
    }
    const parentBinding = this.governanceBindingsByTurn.get(
      turnTimingKey(input.parentThreadId, input.parentTurnId)
    )
    if (
      !parentBinding ||
      parentBinding.governanceThreadId !== input.parentThreadId ||
      parentBinding.governanceTurnId !== input.parentTurnId
    ) {
      throw new Error('Codex child receipt cannot resolve the parent Host proof ledger.')
    }
    const callId = stringValue(tool.meta?.callId).trim() || tool.itemId.trim()
    if (!callId) throw new Error('Codex child receipt requires a call id.')
    const parentEvent = this.withCorrelatedToolExecutionFacts({
      threadId: input.parentThreadId,
      turnId: input.parentTurnId,
      tool: {
        ...tool,
        itemId: `child-${input.childTurnId}-${tool.itemId}`,
        meta: {
          ...tool.meta,
          callId,
          childThreadId: input.childThreadId,
          childTurnId: input.childTurnId,
          governanceThreadId: parentBinding.governanceThreadId,
          governanceTurnId: parentBinding.governanceTurnId,
          receiptScope: 'parent_turn'
        }
      }
    })
    for (const runtimeEvent of this.eventsAfterPendingToolBarrier(parentEvent)) {
      await this.publishClientEvent(runtimeEvent)
    }
  }

  private async handleCodingPlanNotification(
    payload: unknown,
    client: CodexAppServerJsonRpcClient
  ): Promise<boolean> {
    const notification = asRecord(payload)
    const method = stringValue(notification?.method)
    const params = asRecord(notification?.params)
    if (method === 'account/login/completed') {
      const completed = params as CodexAppServerAccountLoginCompletedNotification | null
      const loginId = stringValue(completed?.loginId).trim()
      if (!loginId) return true
      let account: CodexAppServerAccount | null | undefined
      let planType: Extract<CodexCodingPlanAccountResult, { ok: true }>['planType'] | undefined
      if (completed?.success === true) {
        try {
          const response = await client.readAccount()
          account = response.account
          planType = response.account?.type === 'chatgpt' ? response.account.planType : null
          this.codingPlanAccount = {
            ok: true,
            account,
            planType,
            requiresOpenaiAuth: response.requiresOpenaiAuth
          }
        } catch {
          // Completion remains authoritative even when the follow-up account refresh fails.
        }
      }
      this.completeCodingPlanLogin({
        ok: true,
        loginId,
        success: completed?.success === true,
        ...(completed?.error ? { error: completed.error } : {}),
        ...(account !== undefined ? { account } : {}),
        ...(planType !== undefined ? { planType } : {})
      })
      return true
    }
    if (method === 'account/updated') {
      const updated = params as CodexAppServerAccountUpdatedNotification | null
      if (!updated?.authMode) {
        this.codingPlanAccount = {
          ok: true,
          account: null,
          planType: null,
          requiresOpenaiAuth: this.codingPlanAccount?.requiresOpenaiAuth ?? true
        }
      } else if (this.codingPlanAccount?.account?.type === 'chatgpt' && updated.planType) {
        this.codingPlanAccount = {
          ...this.codingPlanAccount,
          account: { ...this.codingPlanAccount.account, planType: updated.planType },
          planType: updated.planType
        }
      }
      return true
    }
    if (method === 'account/rateLimits/updated') {
      const updated = params as CodexAppServerAccountRateLimitsUpdatedNotification | null
      if (updated?.rateLimits && this.codingPlanRateLimits) {
        const limitId = updated.rateLimits.limitId
        this.codingPlanRateLimits = {
          ...this.codingPlanRateLimits,
          rateLimits: updated.rateLimits,
          ...(limitId && this.codingPlanRateLimits.rateLimitsByLimitId
            ? {
                rateLimitsByLimitId: {
                  ...this.codingPlanRateLimits.rateLimitsByLimitId,
                  [limitId]: updated.rateLimits
                }
              }
            : {})
        }
      }
      return true
    }
    return false
  }

  private completeCodingPlanLogin(completion: CodexCodingPlanLoginCompletion): void {
    this.activeCodingPlanLoginIds.delete(completion.loginId)
    this.codingPlanLoginCompletions.set(completion.loginId, completion)
    while (this.codingPlanLoginCompletions.size > 16) {
      const oldest = this.codingPlanLoginCompletions.keys().next().value
      if (oldest === undefined) break
      this.codingPlanLoginCompletions.delete(oldest)
    }
    const waiters = this.codingPlanLoginWaiters.get(completion.loginId)
    this.codingPlanLoginWaiters.delete(completion.loginId)
    for (const resolve of waiters ?? []) resolve(completion)
  }

  private clearCodingPlanAccountState(message: string): void {
    this.codingPlanAccount = null
    this.codingPlanRateLimits = null
    this.activeCodingPlanLoginIds.clear()
    this.codingPlanLoginCompletions.clear()
    for (const [loginId, waiters] of this.codingPlanLoginWaiters) {
      const completion: CodexCodingPlanLoginCompletion = {
        ok: true,
        loginId,
        success: false,
        error: message
      }
      for (const resolve of waiters) resolve(completion)
    }
    this.codingPlanLoginWaiters.clear()
  }

  private async forwardEvents(
    client: CodexAppServerJsonRpcClient,
    session: CodexClientSession
  ): Promise<void> {
    for await (const event of client.subscribe()) {
      if (this.clientSession !== session || session.cancelled) return
      if (event.type === 'event') {
        if (await this.handleCodingPlanNotification(event.payload, client)) continue
        const normalized = this.normalizeClientEvent(event.payload)
        const guiEvent = normalized ? await this.eventForGuiThread(normalized) : null
        const deduped = guiEvent ? this.dedupeModelDeltas(guiEvent) : null
        if (deduped) {
          const correlatedEvent = this.withCorrelatedToolExecutionFacts(deduped)
          for (const runtimeEvent of this.eventsAfterPendingToolBarrier(correlatedEvent)) {
            await this.publishClientEvent(runtimeEvent)
          }
        }
        continue
      }
      if (event.type === 'error') {
        this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.error, event.error)
        continue
      }
      await this.failActiveTurns(
        `Codex app-server event stream closed: ${event.reason || 'unknown reason'}`,
        'runtime_disconnected',
        { reason: event.reason }
      )
      if (this.clientSession !== session || session.cancelled) return
      this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.closed, { reason: event.reason })
      await this.discardClientAfterFailure(undefined, session)
      return
    }
    if (
      this.clientSession === session &&
      !session.cancelled &&
      this.activeTurns.size > 0
    ) {
      await this.failActiveTurns(
        'Codex app-server event stream ended unexpectedly.',
        'runtime_disconnected'
      )
      if (this.clientSession !== session || session.cancelled) return
      this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.closed, { reason: 'event_stream_ended' })
      await this.discardClientAfterFailure(undefined, session)
    }
  }

  private async storedThreads(options: { includeArchived?: boolean } = {}): Promise<CodexStoredThread[]> {
    return this.threadStore?.list(options) ?? []
  }

  private normalizeClientEvent(payload: unknown): CodexThreadEventPayload | null {
    return normalizeCodexEvent(payload, this.contextForClientEvent(payload))
  }

  private dedupeModelDeltas(event: CodexThreadEventPayload): CodexThreadEventPayload | null {
    const deltas = event.deltas ?? []
    if (deltas.length === 0) return event
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId || this.activeTurns.get(event.threadId) !== turnId) return event

    const nextDeltas = deltas.filter((delta, index) => {
      const sequenceIdentity = modelDeltaSequenceIdentity(event, delta, index)
      const contentIdentity = modelDeltaContentIdentity(delta, index)
      if (delta.snapshot === true) {
        const identity = sequenceIdentity ?? contentIdentity
        if (!identity) return true
        return this.rememberModelDeltaIdentity(event.threadId, turnId, identity)
      }
      if (sequenceIdentity) {
        return this.rememberModelDeltaIdentity(event.threadId, turnId, sequenceIdentity)
      }
      // Unsequenced deltas must remain visible even when their text repeats. Their
      // fixed digest only prevents an identical completion snapshot from replaying
      // the same content through a second app-server event shape.
      if (contentIdentity) this.rememberModelDeltaIdentity(event.threadId, turnId, contentIdentity)
      return true
    })
    if (nextDeltas.length === deltas.length) return event
    if (nextDeltas.length > 0) return { ...event, deltas: nextDeltas }
    const { deltas: _deltas, ...withoutDeltas } = event
    return eventHasNonDeltaPayload(withoutDeltas) ? withoutDeltas : null
  }

  private rememberModelDeltaIdentity(threadId: string, turnId: string, identity: string): boolean {
    const turnKey = turnTimingKey(threadId, turnId)
    let state = this.modelDeltaDedupeByTurn.get(turnKey)
    if (!state) {
      while (this.modelDeltaDedupeByTurn.size >= MAX_CODEX_MODEL_DELTA_TURNS) {
        const oldestTurnKey = this.modelDeltaDedupeByTurn.keys().next().value
        if (oldestTurnKey === undefined) break
        this.modelDeltaDedupeByTurn.delete(oldestTurnKey)
      }
      state = { identities: new Set<string>() }
      this.modelDeltaDedupeByTurn.set(turnKey, state)
    }
    if (state.identities.has(identity)) return false
    if (state.identities.size < MAX_CODEX_MODEL_DELTA_IDENTITIES_PER_TURN) {
      state.identities.add(identity)
    }
    return true
  }

  private contextForClientEvent(payload: unknown): CodexEventNormalizeContext {
    const event = asRecord(payload)
    if (!event) return {}
    const params = asRecord(event.params)
    const sessionPayload = asRecord(event.payload)
    const threadId = stringValue(params?.threadId) ||
      stringValue(params?.thread_id) ||
      stringValue(sessionPayload?.threadId) ||
      stringValue(sessionPayload?.thread_id)
    const turnId = stringValue(params?.turnId) ||
      stringValue(params?.turn_id) ||
      stringValue(sessionPayload?.turnId) ||
      stringValue(sessionPayload?.turn_id)
    if (threadId && turnId) return { threadId, turnId }
    if (turnId) {
      const activeThreadId = [...this.activeTurns.entries()]
        .find(([, activeTurnId]) => activeTurnId === turnId)?.[0]
      if (activeThreadId) return { threadId: threadId || activeThreadId, turnId }
    }
    if (threadId) {
      const activeTurnId = this.activeTurns.get(threadId)
      return {
        threadId,
        ...(activeTurnId ? { turnId: activeTurnId } : {})
      }
    }
    if (this.activeTurns.size === 1) {
      const [activeThreadId, activeTurnId] = [...this.activeTurns.entries()][0]
      return { threadId: activeThreadId, turnId: activeTurnId }
    }
    return {}
  }

  private async backfillStoredUsageEvents(): Promise<void> {
    if (!this.threadStore || !this.eventStore || !this.usageStore) return
    if (!this.usageBackfillPromise) {
      this.usageBackfillPromise = this.backfillStoredUsageEventsNow().catch((error) => {
        this.usageBackfillPromise = null
        throw error
      })
    }
    await this.usageBackfillPromise
  }

  private async backfillStoredUsageEventsNow(): Promise<void> {
    if (!this.eventStore) return
    const threads = await this.storedThreads({ includeArchived: true })
    for (const thread of threads) {
      const events = await this.eventStore.read(thread.guiThreadId, { includeAll: true })
      for (const stored of events) {
        await this.recordUsageEvent(stored.event, stored.createdAt)
      }
    }
  }

  private async persistThread(
    thread: CodexNormalizedThread,
    options: { guiThreadId?: string; workspace?: string; title?: string; preserveArchived?: boolean } = {}
  ): Promise<CodexStoredThread | null> {
    if (!this.threadStore || !thread.id) return null
    return this.threadStore.upsert({
      ...(options.guiThreadId !== undefined ? { guiThreadId: options.guiThreadId } : {}),
      codexThreadId: thread.codexThreadId ?? thread.id,
      workspace: options.workspace ?? thread.workspace,
      title: options.title ?? thread.title,
      archived: thread.archived,
      preserveArchived: options.preserveArchived,
      latestTurnId: thread.latestTurnId,
      updatedAt: thread.updatedAt,
      relation: thread.relation,
      parentThreadId: thread.parentThreadId,
      parentTurnId: thread.parentTurnId,
      threadSource: thread.threadSource,
      sidebarVisibility: thread.sidebarVisibility,
      titleSource: thread.titleSource,
      agentNickname: thread.agentNickname,
      agentRole: thread.agentRole
    })
  }

  private async ensureGuiThreadRecord(input: {
    guiThreadId: string
    codexThreadId: string
    workspace: string
  }): Promise<CodexStoredThread | null> {
    if (!this.threadStore) return null
    const existing = await this.threadStore.get(input.guiThreadId) ??
      await this.threadStore.getByCodexThreadId(input.codexThreadId)
    if (existing) return existing
    return this.threadStore.upsert({
      guiThreadId: input.guiThreadId,
      codexThreadId: input.codexThreadId,
      workspace: input.workspace,
      title: CODEX_THREAD_FALLBACK_TITLE
    })
  }

  private async persistThreads(
    threads: readonly CodexNormalizedThread[],
    options: { preserveArchived?: boolean } = {}
  ): Promise<Array<CodexStoredThread | null>> {
    if (!this.threadStore) return threads.map(() => null)
    const inputs: CodexThreadStoreUpsertInput[] = []
    const indexes: number[] = []
    for (const [index, thread] of threads.entries()) {
      if (!thread.id) continue
      inputs.push({
        codexThreadId: thread.codexThreadId ?? thread.id,
        workspace: thread.workspace,
        archived: thread.archived,
        preserveArchived: options.preserveArchived,
        latestTurnId: thread.latestTurnId,
        updatedAt: thread.updatedAt,
        relation: thread.relation,
        parentThreadId: thread.parentThreadId,
        parentTurnId: thread.parentTurnId,
        threadSource: thread.threadSource,
        sidebarVisibility: thread.sidebarVisibility,
        ...(thread.titleSource && thread.titleSource !== 'fallback' ? { titleSource: thread.titleSource } : {}),
        agentNickname: thread.agentNickname,
        agentRole: thread.agentRole
      })
      indexes.push(index)
    }
    const persisted = await this.threadStore.upsertMany(inputs)
    const mapped: Array<CodexStoredThread | null> = threads.map(() => null)
    for (const [resultIndex, threadIndex] of indexes.entries()) {
      mapped[threadIndex] = persisted[resultIndex] ?? null
    }
    return mapped
  }

  private async persistEvent(
    threadId: string,
    event: CodexEventPayload['event']
  ): Promise<CodexStoredEvent | null> {
    if (!this.eventStore) return null
    const storedThread = await this.threadStore?.get(threadId) ?? await this.threadStore?.getByCodexThreadId(threadId)
    if (!storedThread) {
      if ((await this.eventStore.latestSeq(threadId)) <= 0) return null
      return this.eventStore.append(threadId, { ...event, threadId })
    }
    const guiThreadId = storedThread?.guiThreadId ?? threadId
    const stored = await this.eventStore.append(guiThreadId, { ...event, threadId: guiThreadId })
    const turnId = isChildOnlyEvent(event) ? undefined : event.turnId || event.userMessage?.turnId
    await this.threadStore?.upsert({
      guiThreadId,
      codexThreadId: storedThread.codexThreadId,
      workspace: storedThread.workspace,
      title: storedThread.title,
      latestSeq: stored.seq,
      ...(turnId ? { latestTurnId: turnId } : {}),
      ...(event.userMessage?.itemId ? { latestUserMessageId: event.userMessage.itemId } : {})
    })
    return stored
  }

  private async publishClientEvent(event: CodexThreadEventPayload): Promise<CodexThreadEventPayload> {
    if (await this.recoverModelRouterAliasFailure(event)) return event
    const stored = await this.persistEvent(event.threadId, event)
    const runtimeEvent = stored?.event ?? event
    await this.recordUsageEvent(runtimeEvent, stored?.createdAt)
    this.noteFirstActivity(runtimeEvent)
    this.broadcastEvent(runtimeEvent)
    this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.event, { event: runtimeEvent })
    await this.emitFirstDeltaIfNeeded(runtimeEvent)
    await this.emitTurnDoneIfNeeded(runtimeEvent)
    await this.noteRuntimeEvent(runtimeEvent)
    return runtimeEvent
  }

  private async recoverModelRouterAliasFailure(event: CodexThreadEventPayload): Promise<boolean> {
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId || !isModelRouterAliasRuntimeError(event.runtimeError)) return false
    const key = turnTimingKey(event.threadId, turnId)
    const recovery = this.pendingTurnRecoveries.get(key)
    if (!recovery || recovery.recoveryAttempted) return false

    const settings = await this.options.settings()
    if (getModelAccessSettings(settings)?.mode !== 'api') return false
    const storedThread = await this.findStoredThread(event.threadId)
    this.pendingTurnRecoveries.set(key, { ...recovery, recoveryAttempted: true })
    await this.clearTurnTracking(event.threadId, turnId)

    await this.emitRuntimeStatus({
      threadId: event.threadId,
      turnId,
      phase: 'reconnecting',
      message: 'Codex thread used a stale Model Router alias; rebuilding the thread and retrying this turn.'
    })

    let preparedGovernance: CodexPreparedTurnGovernance | null = null
    try {
      const { client } = await this.ensureConnectedClient(settings)
      const replacement = await this.rematerializeThread({
        client,
        settings,
        guiThreadId: event.threadId,
        storedThread,
        workspace: recovery.workspace
      })
      preparedGovernance = await this.prepareCodexTurnGovernance({
        sessionId: replacement.codexThreadId,
        ownedVisualToolsAvailable: recovery.ownedVisualToolsAvailable,
        nativeVisualProofChainPending:
          recovery.nativeVisualProofChainPending
      })
      const response = await client.startTurn(turnStartParams({
        threadId: replacement.codexThreadId,
        guiThreadId: event.threadId,
        text: recovery.text,
        workspace: recovery.workspace,
        model: recovery.model,
        reasoningEffort: recovery.reasoningEffort,
        fileReferences: recovery.fileReferences,
        runtime: recovery.runtime
      }))
      const turn = asRecord(asRecord(response)?.turn) ?? {}
      const retryTurnId = stringValue(turn.id) || ''
      this.recordActiveTurn(event.threadId, retryTurnId, Date.now(), false)
      await this.bindCodexTurnGovernance({
        threadId: event.threadId,
        turnId: retryTurnId,
        prepared: preparedGovernance
      })
      preparedGovernance = null
      this.recordTurnModelHint(event.threadId, retryTurnId, recovery.model)
      this.recordTurnRecovery(event.threadId, retryTurnId, {
        ...recovery,
        threadId: event.threadId,
        recoveryAttempted: true
      })
      await this.emitRuntimeStatus({
        threadId: event.threadId,
        ...(retryTurnId ? { turnId: retryTurnId } : {}),
        phase: 'turn_start_sent',
        message: 'Codex turn retried with the managed Model Router alias.'
      })
      return true
    } catch (error) {
      await this.releasePreparedCodexTurnGovernance(preparedGovernance)
        .catch(() => undefined)
      await this.emitRuntimeError({
        threadId: event.threadId,
        turnId,
        message: error instanceof Error ? error.message : String(error),
        code: 'model_router_alias_recovery_failed',
        severity: 'error'
      }, { forceTurnDone: true })
      return true
    }
  }

  private eventsAfterPendingToolBarrier(event: CodexThreadEventPayload): CodexThreadEventPayload[] {
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId) return [event]
    const key = turnTimingKey(event.threadId, turnId)

    if (isTerminalRuntimeError(event.runtimeError)) {
      this.clearPendingToolBarrierForTurn(key)
      return [event]
    }

    this.trackPendingToolEvent(event, key)

    if (event.turnComplete && this.turnHasPendingToolItems(key)) {
      this.deferredTurnCompleteEvents.set(key, {
        threadId: event.threadId,
        turnId,
        turnComplete: true
      })
      this.schedulePendingToolBarrierGrace(key)
      const immediateEvent = eventWithoutTurnComplete(event)
      return immediateEvent ? [immediateEvent] : []
    }

    const events = [event]
    const deferred = !event.turnComplete ? this.takeDeferredTurnCompleteIfReady(key) : null
    if (deferred) events.push(deferred)
    if (event.turnComplete) this.clearPendingToolBarrierForTurn(key)
    return events
  }

  private withCorrelatedToolExecutionFacts(event: CodexThreadEventPayload): CodexThreadEventPayload {
    const tool = event.tool
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!tool || !turnId) return event
    const meta = tool.meta ?? {}
    const callId = stringValue(meta.callId).trim() || tool.itemId.trim()
    if (!callId) return event
    const key = codexToolExecutionKey(event.threadId, turnId, callId)
    const previous = this.toolExecutionIdentityByCall.get(key)
    const explicitToolName = stringValue(meta.toolName).trim()
    const toolName = explicitToolName || previous?.toolName || inferredCodexToolName(tool)
    const terminal = tool.status !== 'running'
    const phase = stringValue(meta.phase).trim() || (
      terminal ? (tool.status === 'success' ? 'succeeded' : 'failed') : 'dispatched'
    )
    const nextTool: NonNullable<CodexThreadEventPayload['tool']> = {
      ...tool,
      summary: tool.summary === 'Tool output' && previous ? previous.summary : tool.summary,
      ...(tool.toolKind ? {} : previous?.toolKind ? { toolKind: previous.toolKind } : {}),
      meta: {
        ...meta,
        callId,
        toolName,
        phase,
        factSource: stringValue(meta.factSource).trim() || (terminal ? 'executor_result' : 'runtime_lifecycle'),
        evidenceStrength: stringValue(meta.evidenceStrength).trim() || (
          terminal ? 'executor_receipt' : 'runtime_lifecycle'
        ),
        ...(terminal && typeof meta.success !== 'boolean' ? { success: tool.status === 'success' } : {})
      }
    }
    // Keep the identity until the turn closes so a later duplicate/terminal-only
    // app-server event cannot overwrite an executor receipt with "unknown_tool".
    this.toolExecutionIdentityByCall.set(key, {
      callId,
      toolName,
      summary: tool.summary === 'Tool output' && previous ? previous.summary : tool.summary,
      toolKind: tool.toolKind ?? previous?.toolKind
    })
    return { ...event, tool: nextTool }
  }

  private trackPendingToolEvent(event: CodexThreadEventPayload, key: string): void {
    const tool = event.tool
    const itemId = tool?.itemId.trim()
    if (!tool || !itemId) return

    if (tool.status === 'running') {
      if (this.terminalToolItemsByTurn.get(key)?.has(itemId)) return
      const pending = this.pendingToolItemsByTurn.get(key) ?? new Set<string>()
      pending.add(itemId)
      this.pendingToolItemsByTurn.set(key, pending)
      return
    }

    const pending = this.pendingToolItemsByTurn.get(key)
    pending?.delete(itemId)
    if (pending?.size === 0) this.pendingToolItemsByTurn.delete(key)
    const terminal = this.terminalToolItemsByTurn.get(key) ?? new Set<string>()
    terminal.add(itemId)
    this.terminalToolItemsByTurn.set(key, terminal)
  }

  private turnHasPendingToolItems(key: string): boolean {
    return (this.pendingToolItemsByTurn.get(key)?.size ?? 0) > 0
  }

  private takeDeferredTurnCompleteIfReady(key: string): CodexThreadEventPayload | null {
    if (this.turnHasPendingToolItems(key)) return null
    const deferred = this.deferredTurnCompleteEvents.get(key)
    if (!deferred) return null
    this.deferredTurnCompleteEvents.delete(key)
    this.clearPendingToolBarrierTimer(key)
    return deferred
  }

  private clearPendingToolBarrierForTurn(key: string): void {
    this.pendingToolItemsByTurn.delete(key)
    this.terminalToolItemsByTurn.delete(key)
    this.deferredTurnCompleteEvents.delete(key)
    this.clearPendingToolBarrierTimer(key)
    this.clearToolExecutionIdentitiesForTurn(key)
  }

  private clearPendingToolBarrier(): void {
    this.pendingToolItemsByTurn.clear()
    this.terminalToolItemsByTurn.clear()
    this.deferredTurnCompleteEvents.clear()
    for (const timer of this.pendingToolBarrierTimers.values()) clearTimeout(timer)
    this.pendingToolBarrierTimers.clear()
    this.toolExecutionIdentityByCall.clear()
  }

  private clearToolExecutionIdentitiesForTurn(turnKey: string): void {
    const prefix = `${turnKey}\u0000`
    for (const key of this.toolExecutionIdentityByCall.keys()) {
      if (key.startsWith(prefix)) this.toolExecutionIdentityByCall.delete(key)
    }
  }

  private schedulePendingToolBarrierGrace(key: string): void {
    this.clearPendingToolBarrierTimer(key)
    const timer = setTimeout(() => {
      this.pendingToolBarrierTimers.delete(key)
      void this.releaseDeferredTurnCompleteAfterGrace(key).catch((error) => {
        this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.error, {
          message: error instanceof Error ? error.message : String(error),
          detail: error
        })
      })
    }, CODEX_PENDING_TOOL_COMPLETION_GRACE_MS)
    this.pendingToolBarrierTimers.set(key, timer)
  }

  private clearPendingToolBarrierTimer(key: string): void {
    const timer = this.pendingToolBarrierTimers.get(key)
    if (!timer) return
    clearTimeout(timer)
    this.pendingToolBarrierTimers.delete(key)
  }

  private async releaseDeferredTurnCompleteAfterGrace(key: string): Promise<void> {
    const deferred = this.deferredTurnCompleteEvents.get(key)
    if (!deferred) return
    const pendingCallIds = [...(this.pendingToolItemsByTurn.get(key) ?? [])]
    this.pendingToolItemsByTurn.delete(key)
    this.terminalToolItemsByTurn.delete(key)
    this.deferredTurnCompleteEvents.delete(key)
    this.clearToolExecutionIdentitiesForTurn(key)
    await this.emitRuntimeError({
      threadId: deferred.threadId,
      turnId: deferred.turnId,
      message: `Codex reported turn completion before ${pendingCallIds.length || 'one or more'} tool execution result${pendingCallIds.length === 1 ? '' : 's'} arrived. The turn is unresolved and was not marked completed.`,
      code: 'tool_execution_unresolved',
      details: {
        pendingCallIds,
        timeoutMs: CODEX_PENDING_TOOL_COMPLETION_GRACE_MS
      },
      severity: 'error'
    }, { forceTurnDone: true })
  }

  private addEventSubscriber(threadId: string): CodexRuntimeEventSubscriber {
    const subscriber: CodexRuntimeEventSubscriber = {
      threadId,
      queue: [],
      wake: null,
      closed: false
    }
    this.eventSubscribers.add(subscriber)
    return subscriber
  }

  private closeEventSubscriber(subscriber: CodexRuntimeEventSubscriber): void {
    subscriber.closed = true
    this.eventSubscribers.delete(subscriber)
    const wake = subscriber.wake
    subscriber.wake = null
    wake?.()
  }

  private closeAllEventSubscribers(): void {
    for (const subscriber of [...this.eventSubscribers]) {
      this.closeEventSubscriber(subscriber)
    }
  }

  private broadcastEvent(event: CodexThreadEventPayload): void {
    for (const subscriber of this.eventSubscribers) {
      if (subscriber.threadId !== event.threadId || subscriber.closed) continue
      subscriber.queue.push(event)
      const wake = subscriber.wake
      subscriber.wake = null
      wake?.()
    }
  }

  private async nextSubscriberEvent(
    subscriber: CodexRuntimeEventSubscriber
  ): Promise<CodexThreadEventPayload | null> {
    while (!subscriber.closed) {
      const event = subscriber.queue.shift()
      if (event) return event
      await new Promise<void>((resolve) => {
        subscriber.wake = resolve
      })
    }
    return null
  }

  private async readStoredDetail(
    threadId: string,
    options: { repairStale?: boolean } = {}
  ): Promise<CodexThreadDetail | null> {
    if (!this.eventStore) return null
    let events = await this.eventStore.read(threadId, { includeAll: true })
    if (events.length === 0) return null
    let latest = events.at(-1)
    let latestTurnId = latestStoredTurnId(events)
    let terminalStatus = latestTurnId ? storedTerminalTurnStatus(events, latestTurnId) : undefined
    const staleRunningTurn = latestTurnId &&
      !this.activeTurns.has(threadId) &&
      !terminalStatus &&
      !storedTurnHasAssistantResponse(events, latestTurnId) &&
      storedTurnAgeExceeds(events, latestTurnId, FIRST_CODEX_ACTIVITY_TIMEOUT_MS)
    if (staleRunningTurn && latestTurnId && options.repairStale === true) {
      await this.emitRuntimeError({
        threadId,
        turnId: latestTurnId,
        message: CODEX_TURN_DISCONNECTED_MESSAGE,
        code: 'runtime_disconnected',
        details: { reason: 'stale_stored_turn' },
        severity: 'error'
      }, { forceTurnDone: true })
      events = await this.eventStore.read(threadId, { includeAll: true })
      latest = events.at(-1)
      latestTurnId = latestStoredTurnId(events)
      terminalStatus = latestTurnId ? storedTerminalTurnStatus(events, latestTurnId) : undefined
    }
    return {
      blocks: storedEventsToBlocks(events),
      latestSeq: latest?.seq ?? 0,
      latestTurnId,
      ...(terminalStatus ? { threadStatus: terminalStatus } : {})
    }
  }

  private shouldRepairStaleTurnDetail(
    threadId: string,
    detail: CodexThreadDetail,
    storedDetail?: CodexThreadDetail | null
  ): boolean {
    const turnId = detail.latestTurnId?.trim()
    return Boolean(
      turnId &&
      !this.activeTurns.has(threadId) &&
      !isTerminalThreadStatus(detail.threadStatus) &&
      detailTurnAgeExceeds([detail, storedDetail ?? null], turnId, FIRST_CODEX_ACTIVITY_TIMEOUT_MS) &&
      !detail.blocks.some((block) =>
        block.kind === 'assistant' &&
        block.turnId === turnId &&
        block.text.trim()
      )
    )
  }

  private async findStoredThread(threadId: string): Promise<CodexStoredThread | null> {
    return await this.threadStore?.get(threadId) ?? await this.threadStore?.getByCodexThreadId(threadId) ?? null
  }

  private async codexThreadIdFor(threadId: string): Promise<string> {
    const storedThread = await this.findStoredThread(threadId)
    return storedThread?.codexThreadId ?? threadId
  }

  private async rematerializeThread(input: {
    client: CodexAppServerJsonRpcClient
    settings: AppSettingsV1
    guiThreadId: string
    storedThread: CodexStoredThread | null
    workspace: string
  }): Promise<CodexStoredThread> {
    const allowedTools = this.allowedToolsByThread.get(input.guiThreadId)
    const dynamicTools = await this.codexDynamicTools(
      input.settings,
      allowedTools ? [...allowedTools] : undefined
    )
    const response = await input.client.startThread({
      ...baseThreadParams(input.settings, input.workspace, {
        subagentsConfigured: this.isSubagentDelegationConfigured(input.settings),
        dynamicTools
      }),
      ...codexModelAccessThreadParams(input.settings),
      serviceName: 'SciForge',
      ephemeral: false
    })
    const thread = normalizeThread(readThread(response))
    if (!thread.id) throw new Error('Codex app-server did not return a replacement thread id.')
    const stored = await this.persistThread(thread, {
      guiThreadId: input.storedThread?.guiThreadId ?? input.guiThreadId,
      workspace: thread.workspace || input.storedThread?.workspace || input.workspace,
      title: input.storedThread?.title || thread.title
    })
    if (!stored) throw new Error('Codex thread store is unavailable.')
    if (allowedTools) {
      this.allowedToolsByThread.set(stored.guiThreadId, allowedTools)
      this.allowedToolsByThread.set(stored.codexThreadId, allowedTools)
    }
    return stored
  }

  private recordActiveTurn(
    threadId: string,
    turnId: string,
    startedAtMs = Date.now(),
    guardFirstActivity = true
  ): void {
    const normalizedThreadId = threadId.trim()
    const normalizedTurnId = turnId.trim()
    if (!normalizedThreadId || !normalizedTurnId) return
    const previousTurnId = this.activeTurns.get(normalizedThreadId)
    if (previousTurnId && previousTurnId !== normalizedTurnId) {
      this.modelDeltaDedupeByTurn.delete(turnTimingKey(normalizedThreadId, previousTurnId))
    }
    this.modelDeltaDedupeByTurn.delete(turnTimingKey(normalizedThreadId, normalizedTurnId))
    this.activeTurns.set(normalizedThreadId, normalizedTurnId)
    this.turnTimings.set(turnTimingKey(normalizedThreadId, normalizedTurnId), {
      startedAtMs,
      firstActivitySeen: false,
      firstDeltaSeen: false
    })
    if (guardFirstActivity) {
      this.scheduleFirstActivityTimeout(normalizedThreadId, normalizedTurnId)
    }
  }

  private recordTurnModelHint(threadId: string, turnId: string, model?: string): void {
    const normalizedThreadId = threadId.trim()
    const normalizedTurnId = turnId.trim()
    const normalizedModel = model?.trim()
    if (!normalizedThreadId || !normalizedTurnId || !normalizedModel) return
    this.turnModelHints.set(turnTimingKey(normalizedThreadId, normalizedTurnId), normalizedModel)
  }

  private recordTurnRecovery(threadId: string, turnId: string, recovery: CodexPendingTurnRecovery): void {
    const normalizedThreadId = threadId.trim()
    const normalizedTurnId = turnId.trim()
    if (!normalizedThreadId || !normalizedTurnId) return
    this.pendingTurnRecoveries.set(turnTimingKey(normalizedThreadId, normalizedTurnId), recovery)
  }

  private validateActiveTurn(threadId: string, turnId: string): CodexTurnMutationResult | null {
    const activeTurnId = this.activeTurns.get(threadId)
    if (!activeTurnId) {
      return controlTargetFailure(`No active Codex turn is running for thread ${threadId}.`)
    }
    if (activeTurnId !== turnId) {
      return controlTargetFailure(`Codex turn ${turnId} is not the active turn for thread ${threadId}.`)
    }
    return null
  }

  private async noteRuntimeEvent(event: CodexThreadEventPayload): Promise<void> {
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId || this.activeTurns.get(event.threadId) !== turnId) return
    if (event.turnComplete || isTerminalRuntimeError(event.runtimeError)) {
      await this.clearTurnTracking(event.threadId, turnId)
    }
  }

  private async clearTurnTracking(threadId: string, turnId: string): Promise<void> {
    const key = turnTimingKey(threadId, turnId)
    const governanceBinding = this.governanceBindingsByTurn.get(key)
    if (this.activeTurns.get(threadId) === turnId) this.activeTurns.delete(threadId)
    this.turnTimings.delete(key)
    this.turnModelHints.delete(key)
    this.pendingTurnRecoveries.delete(key)
    this.governanceBindingsByTurn.delete(key)
    this.modelDeltaDedupeByTurn.delete(key)
    this.clearFirstActivityTimer(key)
    this.clearPendingToolBarrierForTurn(key)
    await Promise.all([
      this.preToolUseGovernanceBridge?.deleteTurnState(turnId),
      governanceBinding
        ? this.preToolUseGovernanceBridge?.deleteSessionSeed(
            governanceBinding.sessionId
          )
        : undefined
    ])
  }

  private noteFirstActivity(event: CodexThreadEventPayload): void {
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId || this.activeTurns.get(event.threadId) !== turnId) return
    if (!eventHasModelActivity(event)) return
    const key = turnTimingKey(event.threadId, turnId)
    const timing = this.turnTimings.get(key)
    if (timing) timing.firstActivitySeen = true
    this.clearFirstActivityTimer(key)
  }

  private async emitFirstDeltaIfNeeded(event: CodexThreadEventPayload): Promise<void> {
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId || !event.deltas?.length || this.activeTurns.get(event.threadId) !== turnId) return
    const timing = this.turnTimings.get(turnTimingKey(event.threadId, turnId))
    if (!timing || timing.firstDeltaSeen) return
    timing.firstDeltaSeen = true
    await this.emitRuntimeStatus({
      threadId: event.threadId,
      turnId,
      phase: 'first_delta',
      message: 'First Codex delta received',
      latencyMs: elapsedMs(timing.startedAtMs)
    })
  }

  private async emitTurnDoneIfNeeded(
    event: CodexThreadEventPayload,
    options: { force?: boolean } = {}
  ): Promise<void> {
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId) return
    if (!options.force && this.activeTurns.get(event.threadId) !== turnId) return
    if (!event.turnComplete && !isTerminalRuntimeError(event.runtimeError)) return
    const timing = this.turnTimings.get(turnTimingKey(event.threadId, turnId))
    const errorMessage = event.runtimeError?.message?.trim()
    await this.emitRuntimeStatus({
      threadId: event.threadId,
      turnId,
      phase: 'turn_done',
      message: event.turnComplete ? 'Codex turn completed' : errorMessage || 'Codex turn ended with an error',
      ...(timing ? { latencyMs: elapsedMs(timing.startedAtMs) } : {})
    })
  }

  private async emitRuntimeStatus(
    event: CodexRuntimeStatusInput,
    options: { persist?: boolean } = {}
  ): Promise<CodexThreadEventPayload> {
    const runtimeEvent: CodexThreadEventPayload = {
      threadId: event.threadId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      runtimeStatus: {
        itemId: event.itemId ?? runtimeStatusItemId(event.threadId, event.turnId, event.phase),
        phase: event.phase,
        message: event.message,
        latencyMs: event.latencyMs,
        createdAt: event.createdAt ?? new Date().toISOString()
      }
    }
    const shouldPersist = options.persist !== false
    const stored = shouldPersist ? await this.persistEvent(event.threadId, runtimeEvent) : null
    const published = stored?.event ?? runtimeEvent
    this.broadcastEvent(published)
    this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.event, { event: published })
    return published
  }

  private async emitRuntimeError(
    event: CodexRuntimeErrorInput,
    options: { forceTurnDone?: boolean } = {}
  ): Promise<CodexThreadEventPayload> {
    const runtimeEvent: CodexThreadEventPayload = {
      threadId: event.threadId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      runtimeError: {
        itemId: event.itemId ?? runtimeErrorItemId(event.threadId, event.turnId),
        createdAt: new Date().toISOString(),
        message: event.message,
        ...(event.code ? { code: event.code } : {}),
        ...(event.details !== undefined ? { details: event.details } : {}),
        severity: event.severity ?? 'error'
      }
    }
    const stored = await this.persistEvent(event.threadId, runtimeEvent)
    const published = stored?.event ?? runtimeEvent
    await this.emitTurnDoneIfNeeded(published, { force: options.forceTurnDone === true })
    await this.noteRuntimeEvent(published)
    this.broadcastEvent(published)
    this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.event, { event: published })
    return published
  }

  private async failActiveTurns(message: string, code: string, details?: unknown): Promise<void> {
    const activeTurns = [...this.activeTurns.entries()]
    for (const [threadId, turnId] of activeTurns) {
      await this.emitRuntimeError({
        threadId,
        turnId,
        message,
        code,
        details,
        severity: 'error'
      })
    }
  }

  private scheduleFirstActivityTimeout(threadId: string, turnId: string): void {
    const key = turnTimingKey(threadId, turnId)
    this.clearFirstActivityTimer(key)
    const timer = setTimeout(() => {
      this.firstActivityTimers.delete(key)
      void this.failTurnWithoutFirstActivity(threadId, turnId).catch((error) => {
        this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.error, {
          message: error instanceof Error ? error.message : String(error),
          detail: error
        })
      })
    }, FIRST_CODEX_ACTIVITY_TIMEOUT_MS)
    this.firstActivityTimers.set(key, timer)
  }

  private clearFirstActivityTimer(key: string): void {
    const timer = this.firstActivityTimers.get(key)
    if (!timer) return
    clearTimeout(timer)
    this.firstActivityTimers.delete(key)
  }

  private clearAllFirstActivityTimers(): void {
    for (const timer of this.firstActivityTimers.values()) clearTimeout(timer)
    this.firstActivityTimers.clear()
  }

  private async failTurnWithoutFirstActivity(threadId: string, turnId: string): Promise<void> {
    if (this.activeTurns.get(threadId) !== turnId) return
    const timing = this.turnTimings.get(turnTimingKey(threadId, turnId))
    if (timing?.firstActivitySeen) return

    await this.emitRuntimeError({
      threadId,
      turnId,
      message: `Codex did not produce model activity within ${Math.round(FIRST_CODEX_ACTIVITY_TIMEOUT_MS / 1000)} seconds. The stuck turn was stopped so you can retry.`,
      code: 'first_activity_timeout',
      details: { timeoutMs: FIRST_CODEX_ACTIVITY_TIMEOUT_MS },
      severity: 'error'
    })
    await this.interruptTimedOutTurn(threadId, turnId)
    if (this.activeTurns.size === 0) await this.discardClientAfterFailure()
  }

  private async interruptTimedOutTurn(threadId: string, turnId: string): Promise<void> {
    const client = this.client
    if (!client) return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), INTERRUPT_TIMED_OUT_TURN_MS)
    try {
      const codexThreadId = await this.codexThreadIdFor(threadId)
      await client.interruptTurn({ threadId: codexThreadId, turnId }, controller.signal)
    } catch {
      /* The timeout error already gives the user a recovery path. */
    } finally {
      clearTimeout(timer)
    }
  }

  private async recordUsageEvent(event: CodexThreadEventPayload, createdAt?: string): Promise<void> {
    if (!this.usageStore) return
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId) return
    const key = turnTimingKey(event.threadId, turnId)
    if (!event.usage && event.turnComplete && this.turnsWithRecordedUsage.has(key)) {
      this.turnsWithRecordedUsage.delete(key)
      return
    }
    const usage = event.usage ?? (event.turnComplete ? EMPTY_CODEX_TURN_USAGE : null)
    if (!usage) return
    const record = await this.usageStore.record({
      threadId: event.threadId,
      turnId,
      createdAt,
      model: this.turnModelHints.get(turnTimingKey(event.threadId, turnId)),
      usage
    })
    if (record && usageHasTokens(usage)) {
      this.turnsWithRecordedUsage.add(key)
    }
    if (event.turnComplete) {
      this.turnsWithRecordedUsage.delete(key)
    }
  }

  private async publishPendingServerRequest(request: CodexAppServerPendingRequest): Promise<void> {
    const event = pendingServerRequestEvent(request)
    if (!event) {
      this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.error, {
        message: 'Codex requested user interaction but did not include a thread context.'
      })
      return
    }
    const runtimeEvent = await this.eventForGuiThread(event)
    await this.publishClientEvent(runtimeEvent)
  }

  private async eventForGuiThread(event: CodexThreadEventPayload): Promise<CodexThreadEventPayload> {
    const storedThread = await this.findStoredThread(event.threadId)
    const guiThreadId = storedThread?.guiThreadId ?? event.threadId
    return guiThreadId === event.threadId ? event : { ...event, threadId: guiThreadId }
  }
}

function mergeThreads(
  liveThreads: CodexNormalizedThread[],
  storedThreads: CodexNormalizedThread[]
): CodexNormalizedThread[] {
  const byId = new Map<string, CodexNormalizedThread>()
  for (const thread of storedThreads) byId.set(thread.id, thread)
  for (const thread of liveThreads) {
    const stored = byId.get(thread.id)
    const storedTitle = shouldPreferStoredThreadTitle(stored, thread)
      ? { title: stored.title, titleSource: stored.titleSource }
      : {}
    byId.set(thread.id, {
      ...stored,
      ...thread,
      ...(stored ? { archived: stored.archived } : {}),
      ...storedTitle
    })
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

function shouldPreferStoredThreadTitle(
  stored: CodexNormalizedThread | undefined,
  live: CodexNormalizedThread
): stored is CodexNormalizedThread {
  if (!stored) return false
  const storedTitle = normalizeThreadTitleCandidate(stored.title)
  if (!storedTitle) return false
  return live.titleSource === 'fallback' || !normalizeThreadTitleCandidate(live.title)
}

function isKnownStoredThread(
  thread: CodexNormalizedThread,
  storedThreads: readonly CodexStoredThread[]
): boolean {
  const ids = new Set<string>()
  for (const stored of storedThreads) {
    if (stored.guiThreadId.trim()) ids.add(stored.guiThreadId.trim())
    if (stored.codexThreadId.trim()) ids.add(stored.codexThreadId.trim())
  }
  return ids.has(thread.id.trim()) || Boolean(thread.codexThreadId?.trim() && ids.has(thread.codexThreadId.trim()))
}

function isMaterializedStoredThread(thread: CodexStoredThread): boolean {
  return thread.latestSeq > 0 ||
    Boolean(thread.latestTurnId?.trim()) ||
    Boolean(thread.latestUserMessageId?.trim()) ||
    thread.guiThreadId !== thread.codexThreadId ||
    Boolean(thread.relation) ||
    Boolean(thread.parentThreadId?.trim()) ||
    Boolean(thread.threadSource?.trim()) ||
    Boolean(thread.sidebarVisibility)
}

function filterThreadList(
  threads: CodexNormalizedThread[],
  options: CodexThreadListOptions
): CodexNormalizedThread[] {
  const includeArchived = options.includeArchived === true
  const archivedOnly = options.archivedOnly === true
  const includeSide = options.includeSide === true
  const search = options.search?.trim().toLowerCase() ?? ''
  let output = threads.filter((thread) => !isEmptyPlaceholderThread(thread))
  if (!includeSide) {
    output = output.filter((thread) => !isSideOrChildThread(thread))
  }
  if (archivedOnly) {
    output = output.filter((thread) => thread.archived === true)
  } else if (!includeArchived) {
    output = output.filter((thread) => thread.archived !== true)
  }
  if (search) {
    output = output.filter((thread) =>
      [thread.title, thread.preview, thread.workspace, thread.model]
        .some((value) => value?.toLowerCase().includes(search))
    )
  }
  if (typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    output = output.slice(0, Math.floor(options.limit))
  }
  return output
}

function isSideOrChildThread(thread: CodexNormalizedThread): boolean {
  if (thread.sidebarVisibility === 'main') return false
  if (thread.sidebarVisibility === 'side' || thread.sidebarVisibility === 'hidden') return true
  return thread.relation === 'side' ||
    isCodexChildThreadSource(thread.threadSource) ||
    Boolean(thread.parentThreadId?.trim())
}

const EMPTY_PLACEHOLDER_THREAD_TITLES = new Set([
  'Codex thread',
  'New Thread',
  'New chat',
  '新会话'
])

function isEmptyPlaceholderThread(thread: CodexNormalizedThread): boolean {
  const title = thread.title.trim()
  if (thread.latestTurnId?.trim()) return false
  if (thread.preview?.trim()) return false
  if (EMPTY_PLACEHOLDER_THREAD_TITLES.has(title)) return true
  return title === thread.id.slice(0, 8)
}

function storedThreadToNormalizedThread(thread: CodexStoredThread): CodexNormalizedThread {
  return {
    id: thread.guiThreadId,
    codexThreadId: thread.codexThreadId,
    title: thread.title,
    updatedAt: thread.updatedAt,
    model: '',
    mode: 'agent',
    workspace: thread.workspace,
    archived: thread.archived,
    latestTurnId: thread.latestTurnId,
    relation: thread.relation ?? (isCodexChildThreadSource(thread.threadSource) || thread.parentThreadId ? 'side' : undefined),
    parentThreadId: thread.parentThreadId,
    parentTurnId: thread.parentTurnId,
    threadSource: thread.threadSource,
    sidebarVisibility: thread.sidebarVisibility,
    titleSource: thread.titleSource,
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole
  }
}

function storedEventsToBlocks(events: CodexStoredEvent[]): CodexChatBlock[] {
  const blocks: CodexChatBlock[] = []
  for (const item of events) {
    const event = item.event
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (event.userMessage) {
      blocks.push({
        kind: 'user',
        id: event.userMessage.itemId || `user-${item.seq}`,
        createdAt: event.userMessage.createdAt ?? item.createdAt,
        ...(turnId ? { turnId } : {}),
        text: event.userMessage.text,
        ...(event.userMessage.displayText ? { displayText: event.userMessage.displayText } : {})
      })
    }
    if (event.deltas) {
      for (const [index, delta] of event.deltas.entries()) {
        appendStoredModelDelta(blocks, item, turnId, delta, index)
      }
    }
    if (event.tool) {
      blocks.push({
        kind: 'tool',
        id: event.tool.itemId || `tool-${item.seq}`,
        createdAt: item.createdAt,
        ...(turnId ? { turnId } : {}),
        summary: event.tool.summary,
        status: event.tool.status,
        toolKind: event.tool.toolKind,
        detail: event.tool.detail,
        filePath: event.tool.filePath,
        meta: event.tool.meta
      })
    }
    if (event.runtimeError) {
      const transientPhase = transientRuntimeErrorPhase(event.runtimeError)
      blocks.push({
        kind: 'system',
        id: transientPhase
          ? runtimeStatusItemId(event.threadId, turnId, transientPhase)
          : event.runtimeError.itemId || `error-${item.seq}`,
        createdAt: event.runtimeError.createdAt ?? item.createdAt,
        ...(turnId ? { turnId } : {}),
        text: event.runtimeError.message,
        code: event.runtimeError.code,
        severity: transientPhase
          ? 'warning'
          : event.runtimeError.severity
      })
    }
  }
  return dedupeThreadBlocks(blocks)
}

function appendStoredModelDelta(
  blocks: CodexChatBlock[],
  item: CodexStoredEvent,
  turnId: string,
  delta: NonNullable<CodexThreadEventPayload['deltas']>[number],
  index: number
): void {
  if (!delta.text) return
  const previous = blocks.at(-1)
  const sameTurn = previous?.turnId === (turnId || undefined)

  if (delta.kind === 'agent_reasoning') {
    if (previous?.kind === 'reasoning' && sameTurn) {
      blocks[blocks.length - 1] = { ...previous, text: previous.text + delta.text }
      return
    }
    blocks.push({
      kind: 'reasoning',
      id: codexModelDeltaItemId({ seq: item.seq, turnId }, delta, index),
      createdAt: item.createdAt,
      ...(turnId ? { turnId } : {}),
      text: delta.text,
      meta: { reasoning: { visibility: 'summary', source: 'runtime_summary' } }
    })
    return
  }

  if (previous?.kind === 'assistant' && sameTurn) {
    if (delta.snapshot) {
      if (previous.snapshot && canonicalModelText(previous.text) === canonicalModelText(delta.text)) return
      blocks[blocks.length - 1] = { ...previous, text: delta.text, snapshot: true }
      return
    }
    if (!previous.snapshot) {
      blocks[blocks.length - 1] = { ...previous, text: previous.text + delta.text }
      return
    }
  }

  blocks.push({
    kind: 'assistant',
    id: codexModelDeltaItemId({ seq: item.seq, turnId }, delta, index),
    createdAt: item.createdAt,
    ...(turnId ? { turnId } : {}),
    text: delta.text,
    ...(delta.snapshot ? { snapshot: true } : {})
  })
}

function dedupeThreadBlocks(blocks: CodexChatBlock[]): CodexChatBlock[] {
  return dedupeAssistantBlocks(dedupeToolBlocks(dedupeSystemBlocks(blocks)))
}

function dedupeSystemBlocks(blocks: CodexChatBlock[]): CodexChatBlock[] {
  const indexByKey = new Map<string, number>()
  let changed = false
  const next: CodexChatBlock[] = []
  for (const block of blocks) {
    if (block.kind !== 'system') {
      next.push(block)
      continue
    }
    const key = `${block.turnId ?? ''}\u0000${block.id}`
    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      indexByKey.set(key, next.length)
      next.push(block)
      continue
    }
    const previous = next[existingIndex]
    if (previous.kind !== 'system') {
      next.push(block)
      continue
    }
    changed = true
    next[existingIndex] = {
      ...previous,
      ...block,
      createdAt: previous.createdAt ?? block.createdAt,
      text: block.text || previous.text,
      code: block.code ?? previous.code,
      detail: block.detail ?? previous.detail,
      severity: block.severity ?? previous.severity
    }
  }
  return changed ? next : blocks
}

function dedupeToolBlocks(blocks: CodexChatBlock[]): CodexChatBlock[] {
  const indexByKey = new Map<string, number>()
  let changed = false
  const next: CodexChatBlock[] = []
  for (const block of blocks) {
    if (block.kind !== 'tool') {
      next.push(block)
      continue
    }
    const key = `${block.turnId ?? ''}\u0000${block.id}`
    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      indexByKey.set(key, next.length)
      next.push(block)
      continue
    }
    const previous = next[existingIndex]
    if (previous.kind !== 'tool') {
      next.push(block)
      continue
    }
    changed = true
    next[existingIndex] = {
      ...previous,
      ...block,
      createdAt: previous.createdAt ?? block.createdAt,
      summary: block.summary || previous.summary,
      toolKind: block.toolKind ?? previous.toolKind,
      detail: block.detail ?? previous.detail,
      filePath: block.filePath ?? previous.filePath,
      meta: block.meta ?? previous.meta
    }
  }
  return changed ? next : blocks
}

function dedupeAssistantBlocks(blocks: CodexChatBlock[]): CodexChatBlock[] {
  const seen = new Set<string>()
  let userSegment = 0
  let changed = false
  const next: CodexChatBlock[] = []
  for (const block of blocks) {
    if (block.kind === 'user') {
      userSegment += 1
      next.push(block)
      continue
    }
    if (block.kind !== 'assistant') {
      next.push(block)
      continue
    }
    const text = canonicalModelText(block.text)
    if (!text || (!block.snapshot && text.length < 16)) {
      next.push(block)
      continue
    }
    const scope = block.turnId ? `turn:${block.turnId}` : `segment:${userSegment}`
    const key = `${scope}\u0000${text}`
    if (seen.has(key)) {
      changed = true
      continue
    }
    seen.add(key)
    next.push(block)
  }
  return changed ? next : blocks
}

function preferThreadDetail(
  liveDetail: CodexThreadDetail,
  storedDetail: CodexThreadDetail | null
): CodexThreadDetail {
  if (!storedDetail) return liveDetail
  if (liveDetail.blocks.length === 0) return storedDetail
  if (
    storedDetail.blocks.length > liveDetail.blocks.length &&
    (!storedDetail.latestTurnId || !liveDetail.latestTurnId || storedDetail.latestTurnId === liveDetail.latestTurnId)
  ) {
    return {
      ...storedDetail,
      usage: liveDetail.usage ?? storedDetail.usage,
      latestSeq: Math.max(liveDetail.latestSeq, storedDetail.latestSeq)
    }
  }
  if (
    storedDetail.latestTurnId &&
    storedDetail.latestTurnId === liveDetail.latestTurnId &&
    isTerminalThreadStatus(storedDetail.threadStatus) &&
    !isTerminalThreadStatus(liveDetail.threadStatus)
  ) {
    return storedDetail
  }
  return {
    ...liveDetail,
    latestSeq: Math.max(liveDetail.latestSeq, storedDetail.latestSeq)
  }
}

function withStoredThreadWorkspace(
  detail: CodexThreadDetail,
  storedThread: CodexStoredThread | null
): CodexThreadDetail {
  const workspace = detail.workspace?.trim() || storedThread?.workspace.trim()
  return workspace && workspace !== detail.workspace
    ? { ...detail, workspace }
    : detail
}

function latestStoredTurnId(events: CodexStoredEvent[]): string | undefined {
  for (const item of [...events].reverse()) {
    if (isChildOnlyEvent(item.event)) continue
    const turnId = item.event.turnId || item.event.userMessage?.turnId
    if (turnId) return turnId
  }
  return undefined
}

function storedTerminalTurnStatus(
  events: CodexStoredEvent[],
  turnId: string
): 'completed' | 'failed' | 'aborted' | undefined {
  for (const item of [...events].reverse()) {
    const eventTurnId = item.event.turnId || item.event.userMessage?.turnId
    if (eventTurnId !== turnId) continue
    if (item.event.runtimeError && isTerminalRuntimeError(item.event.runtimeError)) {
      const code = item.event.runtimeError.code
      return code === 'cancelled' || code === 'canceled' || code === 'aborted'
        ? 'aborted'
        : 'failed'
    }
    if (item.event.turnComplete === true) return 'completed'
  }
  return undefined
}

function storedTurnHasAssistantResponse(events: CodexStoredEvent[], turnId: string): boolean {
  for (const item of events) {
    const eventTurnId = item.event.turnId || item.event.userMessage?.turnId
    if (eventTurnId !== turnId) continue
    if (item.event.deltas?.some((delta) => delta.kind === 'agent_message' && delta.text.trim())) {
      return true
    }
  }
  return false
}

function storedTurnAgeExceeds(events: CodexStoredEvent[], turnId: string, minAgeMs: number): boolean {
  const timestamps = events
    .filter((item) => !isChildOnlyEvent(item.event))
    .filter((item) => (item.event.turnId || item.event.userMessage?.turnId) === turnId)
    .map((item) => Date.parse(item.createdAt))
    .filter((value) => Number.isFinite(value))
  if (timestamps.length === 0) return false
  return Date.now() - Math.max(...timestamps) >= minAgeMs
}

function isChildOnlyEvent(event: CodexThreadEventPayload): boolean {
  return Boolean(
    event.child &&
    !event.userMessage &&
    !event.deltas?.length &&
    !event.tool &&
    !event.runtimeError &&
    !event.runtimeStatus &&
    !event.goal &&
    !event.usage &&
    event.turnComplete !== true
  )
}

function detailTurnAgeExceeds(
  details: Array<CodexThreadDetail | null>,
  turnId: string,
  minAgeMs: number
): boolean {
  const timestamps = details
    .flatMap((detail) => detail?.blocks ?? [])
    .filter((block) => block.turnId === turnId)
    .map((block) => Date.parse(block.createdAt ?? ''))
    .filter((value) => Number.isFinite(value))
  if (timestamps.length === 0) return false
  return Date.now() - Math.max(...timestamps) >= minAgeMs
}

function isTerminalThreadStatus(status: string | undefined): boolean {
  return status === 'completed' ||
    status === 'success' ||
    status === 'failed' ||
    status === 'error' ||
    status === 'aborted' ||
    status === 'cancelled' ||
    status === 'canceled' ||
    status === 'interrupted'
}

function baseThreadParams(
  settings: AppSettingsV1,
  workspace?: string,
  dynamicMcp: {
    subagentsConfigured?: boolean
    dynamicTools?: RuntimeToolDefinition[]
  } = {}
): CodexAppServerThreadStartParams {
  const runtime = getCodexRuntimeSettings(settings)
  const cwd = resolveCodexWorkspace(settings, workspace)
  const dynamicTools = dynamicMcp.dynamicTools?.length ? dynamicMcp.dynamicTools : undefined
  return {
    cwd,
    approvalPolicy: mapApprovalPolicy(runtime.approvalPolicy, runtime.sandboxMode),
    sandbox: mapThreadSandboxMode(runtime.sandboxMode),
    config: codexAppServerThreadReasoningConfig(),
    ...(dynamicDeveloperInstructions(dynamicMcp)
      ? { developerInstructions: dynamicDeveloperInstructions(dynamicMcp) }
      : {}),
    ...(dynamicTools ? { dynamicTools } : {})
  }
}

function dynamicDeveloperInstructions(input: {
  subagentsConfigured?: boolean
}): string {
  return [
    input.subagentsConfigured ? CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS : ''
  ].filter(Boolean).join('\n\n')
}

function failedDynamicToolCall(
  message: string,
  metadata: Partial<Pick<
    RuntimeToolCallResponse,
    | 'structuredContent'
    | 'errorCode'
    | 'failureClass'
    | 'retryable'
    | 'recoveryGuidance'
    | 'providerStage'
    | 'resourceIdentity'
    | 'evidenceDelta'
    | 'stateChanged'
  >> = {}
): RuntimeToolCallResponse {
  return {
    success: false,
    contentItems: [{ type: 'inputText', text: message }],
    ...metadata
  }
}

function codexModelAccessThreadParams(
  settings: AppSettingsV1
): { model?: string; modelProvider: string } {
  const access = getModelAccessSettings(settings)
  if (!access) throw new Error('Codex model access setup is required.')
  if (access.mode === 'coding-plan') {
    if (access.planAdapterId !== 'codex') {
      throw new Error(`Codex runtime does not support coding plan adapter: ${access.planAdapterId || '(missing)'}.`)
    }
    return { modelProvider: CODEX_PLAN_GATEWAY_PROVIDER_ID }
  }
  return {
    model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
    modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
  }
}

function codexModelAccessKey(
  settings: AppSettingsV1,
  planGateway: CodexPlanGatewayLaunchConfig | undefined
): string {
  const access = getModelAccessSettings(settings)
  if (!access) return 'setup-required'
  if (access.mode === 'coding-plan') {
    return `coding-plan\u0000${access.planAdapterId}\u0000${planGateway?.baseUrl.trim() ?? ''}`
  }
  const router = resolveRuntimeModelRouterSettings(settings)
  const credentialHash = createHash('sha256').update(router.apiKey).digest('hex')
  return `api\u0000${router.baseUrl}\u0000${router.model}\u0000${credentialHash}`
}

function turnStartParams(input: {
  threadId: string
  guiThreadId: string
  text: string
  workspace: string
  model?: string
  reasoningEffort?: string
  imageUrls?: CodexTurnStartPayload['imageUrls']
  fileReferences?: CodexTurnStartPayload['fileReferences']
  runtime: ReturnType<typeof getCodexRuntimeSettings>
}): Parameters<CodexAppServerJsonRpcClient['startTurn']>[0] {
  return {
    threadId: input.threadId,
    responsesapiClientMetadata: {
      runtime_id: 'codex',
      gui_thread_id: input.guiThreadId
    },
    input: [
      textInput(input.text),
      ...imageUrlInputs(input.imageUrls),
      ...fileReferenceInputs(input.fileReferences)
    ],
    cwd: input.workspace,
    ...(input.model ? { model: input.model } : {}),
    approvalPolicy: mapApprovalPolicy(input.runtime.approvalPolicy, input.runtime.sandboxMode),
    sandboxPolicy: mapTurnSandboxMode(input.runtime.sandboxMode, input.workspace),
    ...codexAppServerTurnReasoningParams({ reasoningEffort: input.reasoningEffort })
  }
}

function mapApprovalPolicy(
  policy: ApprovalPolicy,
  sandboxMode: SandboxMode
): 'never' | 'on-request' | 'untrusted' {
  if (sandboxMode === 'danger-full-access') return 'never'
  if (policy === 'never' || policy === 'untrusted') return policy
  return 'on-request'
}

function mapThreadSandboxMode(mode: SandboxMode): CodexAppServerThreadSandboxPolicy {
  if (mode === 'read-only' || mode === 'workspace-write' || mode === 'danger-full-access') return mode
  return 'workspace-write'
}

function mapTurnSandboxMode(mode: SandboxMode, cwd: string): CodexAppServerTurnSandboxPolicy {
  if (mode === 'read-only') return { type: 'readOnly', networkAccess: false }
  if (mode === 'danger-full-access') return { type: 'dangerFullAccess' }
  return { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: true }
}

function fileReferenceInputs(fileReferences: CodexTurnStartPayload['fileReferences']): CodexAppServerInputItem[] {
  return (fileReferences ?? [])
    .filter((reference) => reference.modelRouterObject === true && reference.relativePath.trim().length > 0)
    .map((reference) => {
      const referencePath = reference.relativePath.trim()
      if (reference.kind === 'image') {
        return { type: 'localImage', path: referencePath }
      }
      return { type: 'mention', name: reference.name, path: referencePath }
    })
}

function textInput(text: string): CodexAppServerInputItem {
  return {
    type: 'text',
    text,
    text_elements: []
  }
}

function pendingServerRequestEvent(request: CodexAppServerPendingRequest): CodexThreadEventPayload | null {
  if (!request.threadId) return null
  return {
    threadId: request.threadId,
    ...(request.turnId ? { turnId: request.turnId } : {}),
    tool: {
      itemId: request.itemId || String(request.requestId),
      summary: request.summary,
      status: 'running',
      toolKind: pendingToolKind(request),
      meta: {
        codexRequestId: request.requestId,
        codexRequestKind: request.kind,
        codexRequestMethod: request.method,
        ...(request.kind === 'user_input' ? { questions: safeQuestions(request.params.questions) } : {})
      }
    }
  }
}

function pendingToolKind(
  request: CodexAppServerPendingRequest
): NonNullable<CodexThreadEventPayload['tool']>['toolKind'] {
  const approvalInfo = codexAppServerApprovalMethodInfo(request.method)
  if (approvalInfo) return approvalInfo.toolKind
  return 'tool_call'
}

function safeQuestions(value: unknown): Array<Record<string, unknown>> {
  return arrayValue(value).map(asRecord).filter(Boolean).map((question) => ({
    id: stringValue(question?.id),
    header: stringValue(question?.header),
    question: stringValue(question?.question),
    options: arrayValue(question?.options).map(asRecord).filter(Boolean).map((option) => ({
      label: stringValue(option?.label),
      description: stringValue(option?.description)
    }))
  }))
}

function normalizeThreadTitle(name: string): string {
  return normalizeThreadTitleCandidate(name) || CODEX_THREAD_FALLBACK_TITLE
}

function normalizeThreadTitleSource(source: string, title: string): string {
  if (!title || title === CODEX_THREAD_FALLBACK_TITLE) return 'fallback'
  return source || 'name'
}

function normalizeThreadTitleCandidate(value: string): string {
  const raw = value.trim()
  if (!raw || CODEX_PLACEHOLDER_THREAD_TITLES.has(raw)) return ''
  const lines = raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*(```|~~~)/.test(line))
    .map((line) => normalizeThreadTitleLine(line))
    .filter(Boolean)
  const firstLine = lines[0] ?? ''
  if (!firstLine || CODEX_PLACEHOLDER_THREAD_TITLES.has(firstLine)) return ''
  const sentenceBreak = firstLine.search(/[.!?。！？]/)
  const core = sentenceBreak >= 8 ? firstLine.slice(0, sentenceBreak) : firstLine
  const title = stripTrailingThreadTitlePunctuation(shortenThreadTitle(core))
  return title
}

function normalizeThreadTitleLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/`+/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function shortenThreadTitle(value: string): string {
  if (value.length <= MAX_CODEX_THREAD_TITLE_LENGTH) return value
  const sliced = value.slice(0, MAX_CODEX_THREAD_TITLE_LENGTH)
  const lastSpace = sliced.lastIndexOf(' ')
  const compact = lastSpace >= 24 ? sliced.slice(0, lastSpace) : sliced
  return `${compact.trim()}...`
}

function stripTrailingThreadTitlePunctuation(value: string): string {
  return value.replace(/[\s,.;:!?"'`()[\]{}]+$/g, '').trim()
}

function normalizeThread(thread: Record<string, unknown>): CodexNormalizedThread {
  const id = stringValue(thread.id)
  const source = asRecord(thread.source) ?? asRecord(thread.threadSource)
  const threadSource = stringValue(thread.threadSource) || stringValue(source?.type) || stringValue(source?.kind)
  const relation = normalizeThreadRelation(thread.relation) || normalizeThreadRelation(source?.relation)
  const sidebarVisibility = normalizeThreadSidebarVisibility(thread.sidebarVisibility) ||
    normalizeThreadSidebarVisibility(thread.sidebar_visibility) ||
    normalizeThreadSidebarVisibility(source?.sidebarVisibility) ||
    normalizeThreadSidebarVisibility(source?.sidebar_visibility)
  const explicitTitleSource =
    stringValue(thread.titleSource) ||
    stringValue(thread.title_source) ||
    stringValue(source?.titleSource) ||
    stringValue(source?.title_source)
  const parentThreadId =
    stringValue(thread.parentThreadId) ||
    stringValue(thread.parent_thread_id) ||
    stringValue(source?.parentThreadId) ||
    stringValue(source?.parent_thread_id)
  const parentTurnId =
    stringValue(thread.parentTurnId) ||
    stringValue(thread.parent_turn_id) ||
    stringValue(source?.parentTurnId) ||
    stringValue(source?.parent_turn_id) ||
    stringValue(source?.turnId) ||
    stringValue(source?.turn_id)
  const agentNickname =
    stringValue(thread.agentNickname) ||
    stringValue(thread.agent_nickname) ||
    stringValue(source?.agentNickname) ||
    stringValue(source?.agent_nickname)
  const agentRole =
    stringValue(thread.agentRole) ||
    stringValue(thread.agent_role) ||
    stringValue(source?.agentRole) ||
    stringValue(source?.agent_role)
  const updatedAtSeconds = numberValue(thread.updatedAt) ?? numberValue(thread.createdAt)
  const updatedAt = updatedAtSeconds
    ? new Date(updatedAtSeconds * 1000).toISOString()
    : new Date().toISOString()
  const name = stringValue(thread.title) || stringValue(thread.name)
  const preview = stringValue(thread.preview)
  const title = normalizeThreadTitle(name)
  const titleSource = normalizeThreadTitleSource(explicitTitleSource, title)
  const turns = arrayValue(thread.turns)
  const latestTurn = latestTurnRecord(thread, turns)
  return {
    id,
    codexThreadId: id,
    title,
    updatedAt,
    model: stringValue(thread.model) || '',
    mode: 'agent',
    workspace: stringValue(thread.cwd),
    status: stringValue(thread.status),
    archived: stringValue(thread.status) === 'archived',
    preview,
    latestTurnId: stringValue(latestTurn?.id),
    latestTurnStatus: stringValue(latestTurn?.status),
    ...(threadSource ? { threadSource } : {}),
    ...(sidebarVisibility ? { sidebarVisibility } : {}),
    ...(titleSource ? { titleSource } : {}),
    ...(relation || isCodexChildThreadSource(threadSource) || parentThreadId ? { relation: relation ?? 'side' as const } : {}),
    ...(parentThreadId ? { parentThreadId } : {}),
    ...(parentTurnId ? { parentTurnId } : {}),
    ...(agentNickname ? { agentNickname } : {}),
    ...(agentRole ? { agentRole } : {})
  }
}

function isCodexChildThreadSource(source: string | undefined): boolean {
  const normalized = source?.trim().toLowerCase()
  return normalized === 'subagent' || normalized === 'workflow' || normalized === 'local_workflow'
}

function normalizeThreadRelation(value: unknown): 'primary' | 'fork' | 'side' | undefined {
  const relation = stringValue(value)
  return relation === 'primary' || relation === 'fork' || relation === 'side' ? relation : undefined
}

function normalizeThreadSidebarVisibility(value: unknown): AgentRuntimeThreadSidebarVisibility | undefined {
  const visibility = stringValue(value).trim().toLowerCase()
  if (visibility === 'main' || visibility === 'sidebar' || visibility === 'visible') return 'main'
  if (visibility === 'side' || visibility === 'auxiliary') return 'side'
  if (visibility === 'hidden' || visibility === 'hide' || visibility === 'internal' || visibility === 'none') return 'hidden'
  return undefined
}

function threadDetail(thread: Record<string, unknown>): CodexThreadDetail {
  const turns = arrayValue(thread.turns).map(asRecord).filter(Boolean) as Record<string, unknown>[]
  const blocks = dedupeThreadBlocks(turns.flatMap((turn) => turnBlocks(turn)))
  const latestTurn = latestTurnRecord(thread, turns)
  const latestUserMessageId = [...blocks].reverse().find((block) => block.kind === 'user')?.id
  const workspace = stringValue(thread.cwd)
  return {
    blocks,
    latestSeq: blocks.length,
    ...(workspace ? { workspace } : {}),
    threadStatus: stringValue(thread.status) || stringValue(latestTurn?.status),
    latestTurnId: stringValue(latestTurn?.id),
    latestUserMessageId
  }
}

function latestTurnRecord(
  thread: Record<string, unknown>,
  turns: unknown[]
): Record<string, unknown> | undefined {
  const latestTurnId =
    stringValue(thread.latestTurnId) ||
    stringValue(thread.latest_turn_id) ||
    stringValue(asRecord(thread.latestTurn)?.id) ||
    stringValue(asRecord(thread.latest_turn)?.id)
  if (latestTurnId) {
    const matched = turns
      .map(asRecord)
      .find((turn): turn is Record<string, unknown> => Boolean(turn && stringValue(turn.id) === latestTurnId))
    if (matched) return matched
  }
  return asRecord(turns.at(-1)) ?? undefined
}

function turnBlocks(turn: Record<string, unknown>): CodexChatBlock[] {
  const createdAt = secondsToIso(numberValue(turn.startedAt))
  return arrayValue(turn.items)
    .map(asRecord)
    .filter(Boolean)
    .flatMap((item) => itemBlock(item as Record<string, unknown>, stringValue(turn.id), createdAt))
}

function itemBlock(item: Record<string, unknown>, turnId: string, createdAt?: string): CodexChatBlock[] {
  const type = stringValue(item.type)
  const id = stringValue(item.id) || `${turnId}-${type || 'item'}`
  const turnMeta = turnId ? { turnId } : {}
  if (type === 'userMessage') {
    const meta = asRecord(item.meta)
    const displayText =
      stringValue(item.displayText) ||
      stringValue(item.display_text) ||
      stringValue(meta?.displayText)
    return [{
      kind: 'user',
      id,
      createdAt,
      ...turnMeta,
      text: userInputText(arrayValue(item.content)),
      ...(displayText ? { displayText } : {})
    }]
  }
  if (type === 'agentMessage') {
    return [{ kind: 'assistant', id, createdAt, ...turnMeta, text: stringValue(item.text), snapshot: true }]
  }
  if (type === 'reasoning') {
    const text = [...arrayValue(item.summary), ...arrayValue(item.content)]
      .map((entry) => {
        if (typeof entry === 'string') return entry
        const record = asRecord(entry)
        return stringValue(record?.text) ||
          stringValue(record?.summary) ||
          stringValue(record?.content)
      })
      .filter(Boolean)
      .join('\n')
    return text
      ? [{ kind: 'reasoning', id, createdAt, ...turnMeta, text, meta: { reasoning: { visibility: 'summary', source: 'runtime_summary' } } }]
      : []
  }
  if (type === 'plan') {
    return [{
      kind: 'reasoning',
      id,
      createdAt,
      ...turnMeta,
      text: stringValue(item.text),
      meta: { reasoning: { visibility: 'summary', source: 'runtime_summary' } }
    }]
  }
  if (type === 'commandExecution') {
    const status = mapToolStatus(stringValue(item.status))
    const command = stringValue(item.command)
    return [{
      kind: 'tool',
      id,
      createdAt,
      ...turnMeta,
      summary: command || 'Command',
      status,
      toolKind: 'command_execution',
      detail: stringValue(item.aggregatedOutput),
      meta: {
        command,
        cwd: stringValue(item.cwd),
        exitCode: numberValue(item.exitCode)
      }
    }]
  }
  if (type === 'fileChange') {
    return [{
      kind: 'tool',
      id,
      createdAt,
      ...turnMeta,
      summary: 'File changes',
      status: mapToolStatus(stringValue(item.status)),
      toolKind: 'file_change',
      detail: JSON.stringify(item.changes ?? [], null, 2)
    }]
  }
  return []
}

function readThreadList(response: unknown): Record<string, unknown>[] {
  const record = asRecord(response)
  const data = arrayValue(record?.data)
  if (data.length) return data.map(asRecord).filter(Boolean) as Record<string, unknown>[]
  return arrayValue(record?.threads).map(asRecord).filter(Boolean) as Record<string, unknown>[]
}

function readThread(response: unknown): Record<string, unknown> {
  const record = asRecord(response)
  return asRecord(record?.thread) ?? record ?? {}
}

function userInputText(content: unknown[]): string {
  return content
    .map((entry) => {
      const item = asRecord(entry)
      if (!item) return ''
      if (stringValue(item.type) === 'text') return stringValue(item.text)
      if (stringValue(item.type) === 'input_text') return stringValue(item.text)
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function mapToolStatus(status: string): 'running' | 'success' | 'error' {
  if (status === 'completed' || status === 'success') return 'success'
  if (status === 'failed' || status === 'error') return 'error'
  return 'running'
}

function unsupportedFailure(
  message: string,
  code = 'capability_unavailable'
): { ok: false; message: string; code: string; recoverable: true } {
  return { ok: false, code, message, recoverable: true }
}

function controlTargetFailure(message: string): { ok: false; message: string; code: string; recoverable: true } {
  return { ok: false, code: 'turn_not_running', message, recoverable: true }
}

function emptyThreadDetail(): CodexThreadDetail {
  return { blocks: [], latestSeq: 0 }
}

function isEmptyStoredThread(
  storedThread: CodexStoredThread | null,
  detail: CodexThreadDetail | null = null
): storedThread is CodexStoredThread {
  if (!storedThread) return false
  if (detail) return detail.blocks.length === 0
  return storedThread.latestSeq <= 0
}

function eventHasNonDeltaPayload(event: CodexEventPayload['event']): boolean {
  return Boolean(
    event.userMessage ||
    event.tool ||
    event.child ||
    event.turnComplete ||
    event.runtimeError ||
    event.runtimeStatus ||
    event.usage
  )
}

function eventWithoutTurnComplete(event: CodexThreadEventPayload): CodexThreadEventPayload | null {
  const { turnComplete: _turnComplete, ...withoutTurnComplete } = event
  return eventHasNonDeltaPayload(withoutTurnComplete) ? withoutTurnComplete : null
}

function usageHasTokens(usage: AgentRuntimeUsage): boolean {
  return safeUsageInteger(usage.inputTokens) +
    safeUsageInteger(usage.outputTokens) +
    safeUsageInteger(usage.reasoningTokens) +
    safeUsageInteger(usage.totalTokens) +
    safeUsageInteger(usage.cacheReadTokens) +
    safeUsageInteger(usage.cacheWriteTokens) > 0
}

function subagentUsageFromCodexUsage(usage: AgentRuntimeUsage): AgentRuntimeSubagentUsage {
  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedTokens: usage.cacheReadTokens,
    cacheHitTokens: usage.cacheReadTokens,
    cacheMissTokens: usage.cacheWriteTokens
  }
}

function childThreadTitle(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'Child agent'
  return `Child agent: ${normalized.slice(0, 72)}${normalized.length > 72 ? '...' : ''}`
}

function safeUsageInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function isMissingOrUnmaterializedThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /thread\s+.*not found|thread not found|no rollout found|not materialized yet|includeTurns is unavailable/i.test(message)
}

function isCodexRuntimeDisconnectedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /app-server client stopped|event stream (?:closed|ended)|runtime disconnected|socket hang up|ECONNRESET|EPIPE/i.test(message)
}

function imageUrlInputs(imageUrls: CodexTurnStartPayload['imageUrls']): CodexAppServerInputItem[] {
  const values = imageUrls ?? []
  if (values.length > 4) throw new Error('Codex turn accepts at most four in-memory images.')
  if (values.some((value) => value.length > 12_000_000)) {
    throw new Error('Codex turn in-memory images must not exceed 12 MB each.')
  }
  if (values.reduce((total, value) => total + value.length, 0) > 24_000_000) {
    throw new Error('Codex turn in-memory images exceed the 24 MB aggregate limit.')
  }
  return values.map((url) => {
    if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) {
      throw new Error('Codex turn in-memory images must be base64 PNG, JPEG, or WebP data URLs.')
    }
    return { type: 'image', url }
  })
}

function isClientStoppedBeforeRequest(error: unknown): boolean {
  return error instanceof Error && error.message.trim() === 'Codex app-server client stopped.'
}

function isTerminalRuntimeError(
  error: CodexThreadEventPayload['runtimeError']
): error is NonNullable<CodexThreadEventPayload['runtimeError']> {
  if (!error) return false
  if (isTransientRuntimeError(error)) return false
  return error.severity === 'error' || error.code === 'cancelled' || error.code === 'aborted'
}

function codexChildTurnError(
  error: NonNullable<CodexThreadEventPayload['runtimeError']>,
  transcript: readonly AgentRuntimeSubagentTranscriptEntry[],
  usage: AgentRuntimeSubagentUsage | undefined
): Error {
  const thrown = Object.assign(new Error(error.message || 'Codex child turn failed.'), {
    subagentTranscript: transcript,
    ...(usage ? { subagentUsage: usage } : {})
  })
  if (isAbortRuntimeError(error)) thrown.name = 'AbortError'
  return thrown
}

function isAbortRuntimeError(error: NonNullable<CodexThreadEventPayload['runtimeError']>): boolean {
  const code = stringValue(error.code).toLowerCase()
  const message = stringValue(error.message).toLowerCase()
  return /\b(abort|aborted|cancel|cancelled|interrupted|user_stop)\b/.test(code) ||
    /\b(abort|aborted|cancelled|interrupted)\b/.test(message)
}

function isModelRouterAliasRuntimeError(error: CodexThreadEventPayload['runtimeError']): boolean {
  if (!error) return false
  const message = stringValue(error.message).toLowerCase()
  return message.includes('model router requests must use the public router model alias') ||
    (message.includes('public router model alias') && message.includes('model router'))
}

function isTransientRuntimeError(error: NonNullable<CodexThreadEventPayload['runtimeError']>): boolean {
  const code = stringValue(error.code).toLowerCase()
  return code === 'reconnecting' ||
    code === 'tool_waiting' ||
    code === 'stream_recovering' ||
    isReconnectRuntimeErrorMessage(error.message)
}

function transientRuntimeErrorPhase(
  error: NonNullable<CodexThreadEventPayload['runtimeError']>
): NonNullable<CodexThreadEventPayload['runtimeStatus']>['phase'] | null {
  const code = stringValue(error.code).toLowerCase()
  if (code === 'reconnecting') return 'reconnecting'
  if (code === 'tool_waiting') return 'tool_waiting'
  if (code === 'stream_recovering') return 'stream_recovering'
  if (isReconnectRuntimeErrorMessage(error.message)) return 'reconnecting'
  return null
}

function isReconnectRuntimeErrorMessage(message: string | undefined): boolean {
  return /^Reconnecting\.\.\.\s+\d+\s*\/\s*\d+$/iu.test(message?.trim() ?? '')
}

function eventHasModelActivity(event: CodexThreadEventPayload): boolean {
  return Boolean(
    event.deltas?.length ||
    event.tool ||
    event.child ||
    event.runtimeStatus ||
    event.runtimeError ||
    event.turnComplete
  )
}

function turnTimingKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}

function codexToolExecutionKey(threadId: string, turnId: string, callId: string): string {
  return `${turnTimingKey(threadId, turnId)}\u0000${callId}`
}

function inferredCodexToolName(tool: NonNullable<CodexThreadEventPayload['tool']>): string {
  if (tool.toolKind === 'command_execution') return 'exec_command'
  if (tool.toolKind === 'file_change') return 'apply_patch'
  const summary = tool.summary.trim()
  return summary && summary !== 'Tool output' ? summary : 'unknown_tool'
}

function runtimeStatusItemId(
  threadId: string,
  turnId: string | undefined,
  phase: NonNullable<CodexThreadEventPayload['runtimeStatus']>['phase']
): string {
  return `codex-runtime-status-${turnId || threadId}-${phase}`
}

function runtimeErrorItemId(threadId: string, turnId: string | undefined): string {
  return `codex-runtime-error-${turnId || threadId}`
}

function elapsedMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs)
}

function failure(error: unknown): { ok: false; message: string; recoverable: true } {
  return { ok: false, message: error instanceof Error ? error.message : String(error), recoverable: true }
}

function secondsToIso(value: number | undefined): string | undefined {
  return typeof value === 'number' ? new Date(value * 1000).toISOString() : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function dynamicToolArgumentsRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value)
  if (record) return record
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return asRecord(JSON.parse(value) as unknown)
  } catch {
    return null
  }
}

function dynamicToolResponseSummary(response: RuntimeToolCallResponse): string {
  const text = response.contentItems
    .map((item) => item.type === 'inputText' ? item.text : '[image result]')
    .filter(Boolean)
    .join('\n')
    .trim()
  if (!text) return response.success ? 'Dynamic tool completed successfully.' : 'Dynamic tool failed.'
  return text.length <= 2_000 ? text : `${text.slice(0, 2_000)}…`
}

function dynamicToolErrorMetadata(error: unknown): Pick<
  RuntimeToolCallResponse,
  | 'errorCode'
  | 'failureClass'
  | 'retryable'
  | 'recoveryGuidance'
  | 'providerStage'
  | 'resourceIdentity'
  | 'evidenceDelta'
  | 'stateChanged'
> {
  const record = asRecord(error)
  const code = stringValue(record?.code).trim()
  const failureClass = stringValue(record?.failureClass).trim()
  const retryable = booleanValue(record?.retryable)
  const recoveryGuidance = stringValue(asRecord(record?.recovery)?.instruction).trim() ||
    stringValue(record?.recoveryGuidance).trim()
  const providerStage = stringValue(record?.providerStage).trim()
  const resourceIdentity = stringValue(record?.resourceIdentity).trim()
  const evidenceDelta = booleanValue(record?.evidenceDelta)
  const stateChanged = booleanValue(record?.stateChanged)
  return {
    ...(code ? { errorCode: code } : {}),
    ...(failureClass ? { failureClass } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    ...(recoveryGuidance ? { recoveryGuidance } : {}),
    ...(providerStage ? { providerStage } : {}),
    ...(resourceIdentity ? { resourceIdentity } : {}),
    ...(evidenceDelta !== undefined ? { evidenceDelta } : {}),
    ...(stateChanged !== undefined ? { stateChanged } : {})
  }
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function canonicalModelText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function modelDeltaSequenceIdentity(
  event: Pick<CodexThreadEventPayload, 'seq' | 'turnId'>,
  delta: NonNullable<CodexThreadEventPayload['deltas']>[number],
  index: number
): string | null {
  const sequence = event.seq ?? delta.seq
  if (typeof sequence === 'number' && Number.isFinite(sequence)) {
    return `sequence:${codexModelDeltaItemId(event, delta, index)}`
  }
  return null
}

function modelDeltaContentIdentity(
  delta: NonNullable<CodexThreadEventPayload['deltas']>[number],
  index: number
): string | null {
  const text = canonicalModelText(delta.text)
  if (!text) return null
  const digest = createHash('sha256').update(text, 'utf8').digest('hex')
  return `content:${delta.kind}:${Math.max(0, Math.floor(index))}:${digest}`
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
