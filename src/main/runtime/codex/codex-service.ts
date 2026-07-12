import { join } from 'node:path'
import {
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  getAgentCapabilitySettings,
  getCodexRuntimeSettings,
  type AppSettingsV1,
  type ApprovalPolicy,
  type SandboxMode
} from '../../../shared/app-settings'
import type {
  CodexChatBlock,
  CodexConnectResult,
  CodexEventPayload,
  CodexNormalizedThread,
  CodexSessionResumeResult,
  CodexThreadEventPayload,
  CodexThreadDetail,
  CodexThreadForkResult,
  CodexThreadListResult,
  CodexThreadListOptions,
  CodexThreadMutationResult,
  CodexThreadReadResult,
  CodexThreadStartPayload,
  CodexThreadStartResult,
  CodexTurnInterruptOptions,
  CodexTurnMutationResult,
  CodexTurnStartPayload,
  CodexTurnStartResult,
  CodexTurnSteerPayload
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
  type CodexAppServerInputItem,
  type CodexAppServerJsonRpcClient,
  type CodexAppServerJsonRpcClientOptions,
  type CodexAppServerThreadSandboxPolicy,
  type CodexAppServerTurnSandboxPolicy,
  type CodexAppServerThreadStartParams
} from './app-server/json-rpc-client'
import {
  codexAppServerApprovalMethodInfo,
  type CodexAppServerPendingRequest,
  type CodexAppServerResolveApprovalInput,
  type CodexAppServerResolveUserInputInput
} from './app-server/request-registry'
import {
  codexAppServerThreadReasoningConfig,
  codexAppServerTurnReasoningParams
} from './app-server/reasoning-config'
import { normalizeCodexEvent, type CodexEventNormalizeContext } from './app-server/event-normalizer'
import { CodexEventStore, type CodexStoredEvent } from './codex-event-store'
import { CodexThreadStore, type CodexStoredThread, type CodexThreadStoreUpsertInput } from './codex-thread-store'
import { CodexUsageStore } from './codex-usage-store'
import { prepareCodexAppServerLaunch, resolveCodexWorkspace } from './codex-config'
import {
  GUI_RESEARCH_MCP_SERVER_NAME,
  type ResearchSearchMcpLaunchConfig
} from '../../research-search-mcp-config'
import type { ScheduleMcpLaunchConfig } from '../../schedule-mcp-config'
import type { WorkflowMcpLaunchConfig } from '../../workflow-mcp-config'
import type { WorkspaceIntelMcpLaunchConfig } from '../../workspace-intel-mcp-config'
import type { PaperRadarMcpLaunchConfig } from '../../paper-radar-mcp-config'
import type { WriteAssistMcpLaunchConfig } from '../../write-assist-mcp-config'
import type { RuntimeInspectorMcpLaunchConfig } from '../../runtime-inspector-mcp-config'
import type { ScientificSkillsMcpLaunchConfig } from '../../scientific-skills-mcp-config'
import type { ScientificPlottingMcpLaunchConfig } from '../../scientific-plotting-mcp-config'
import type { BgcDiscoveryMcpLaunchConfig } from '../../bgc-discovery-mcp-config'
import type { ImageGenerationMcpLaunchConfig } from '../../image-generation-mcp-config'
import type { PptMasterMcpLaunchConfig } from '../../ppt-master-mcp-config'
import type { VisualDocumentMcpLaunchConfig } from '../../visual-document-mcp-config'
import {
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  isComputerUseMcpConfigured,
  type ComputerUseMcpLaunchConfig
} from '../../computer-use-mcp-config'
import { buildCodexManagedGuiMcpServers } from '../../gui-mcp-registry'
import {
  WorkspaceIntelToolNames,
  type WorkspaceIntelToolName
} from '../../../../packages/workers/workspace-intel/src/contract'
import {
  createCodexDynamicMcpToolBridge,
  type CodexAppServerDynamicToolCallRequest,
  type CodexAppServerDynamicToolCallResponse,
  type CodexAppServerDynamicToolSpec,
  type CodexDynamicMcpClient,
  type CodexDynamicMcpReleaseReason,
  type CodexDynamicMcpServerConfig,
  type CodexDynamicMcpToolBridge
} from './codex-dynamic-mcp-tools'
import {
  codexChildFromMultiAgentRecord,
  createCodexMultiAgentToolBridge,
  type CodexMultiAgentToolBridge
} from './codex-multi-agent-tools'
import type {
  MultiAgentExecutorInput,
  MultiAgentExecutorResult,
  MultiAgentChildEvent,
  MultiAgentTranscriptEntry,
  MultiAgentUsage
} from '../../../../packages/workers/multi-agent/src'
import { SCIENTIFIC_VISUAL_RUNTIME_POLICY } from '../scientific-visual-policy'

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
  scheduleMcpLaunch?: ScheduleMcpLaunchConfig
  researchMcpLaunch?: ResearchSearchMcpLaunchConfig
  workflowMcpLaunch?: WorkflowMcpLaunchConfig
  workspaceIntelMcpLaunch?: WorkspaceIntelMcpLaunchConfig
  paperRadarMcpLaunch?: PaperRadarMcpLaunchConfig
  writeAssistMcpLaunch?: WriteAssistMcpLaunchConfig
  runtimeInspectorMcpLaunch?: RuntimeInspectorMcpLaunchConfig
  scientificSkillsMcpLaunch?: ScientificSkillsMcpLaunchConfig
  scientificPlottingMcpLaunch?: ScientificPlottingMcpLaunchConfig
  bgcDiscoveryMcpLaunch?: BgcDiscoveryMcpLaunchConfig
  imageGenerationMcpLaunch?: ImageGenerationMcpLaunchConfig
  pptMasterMcpLaunch?: PptMasterMcpLaunchConfig
  visualDocumentMcpLaunch?: VisualDocumentMcpLaunchConfig
  computerUseMcpLaunch?: ComputerUseMcpLaunchConfig
  managedMcpServers?: readonly CodexDynamicMcpServerConfig[]
  mcpClientFactory?: (server: CodexDynamicMcpServerConfig) => Promise<CodexDynamicMcpClient>
  createClient?: (options: CodexAppServerJsonRpcClientOptions) => CodexAppServerJsonRpcClient
}

type CodexTurnTiming = {
  startedAtMs: number
  firstActivitySeen: boolean
  firstDeltaSeen: boolean
}

type CodexPendingTurnRecovery = {
  threadId: string
  text: string
  displayText?: string
  workspace: string
  model: string
  reasoningEffort?: string
  metadata?: Record<string, unknown>
  fileReferences?: CodexTurnStartPayload['fileReferences']
  runtime: ReturnType<typeof getCodexRuntimeSettings>
  recoveryAttempted: boolean
}

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
const CODEX_COMMAND_DOWNLOAD_INSTRUCTION_LINES = [
  'For bulk file downloads or long network transfers through command execution, make progress observable and bounded: stream to a `.part` file, print per-file progress/status, use connect/overall/low-speed timeouts and retries, validate expected file type/size, then atomically rename into place.',
  'When the user explicitly asks to use the system proxy for command-based network work, inspect the current system proxy settings first, such as `scutil --proxy` on macOS, and pass the appropriate `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` values only to those network commands.',
  'Do not use ad hoc download scripts that buffer an entire response before writing the destination file, such as Python urllib `response.read()` followed by one write; this can leave 0-byte files and an apparently running command with no progress.'
]
const CODEX_SPECIALIZED_MCP_DEVELOPER_INSTRUCTIONS = [
  'SciForge may configure specialized MCP tools for this runtime.',
  'When an advertised specialized MCP tool directly matches the user request, use that tool before falling back to generic shell, curl, wget, ad hoc scripts, or direct scraping.',
  SCIENTIFIC_VISUAL_RUNTIME_POLICY,
  'For requests about the current GUI, visible panes, right sidebar, previews, PDF annotations, selected text, or component state, first use `gui_visible_context` to discover the visible component/resource index, then follow the returned access hints.',
  'When visual inspection is needed, call `gui_visual_capture` for the whole window or for a componentId/targetId returned by `gui_visible_context`, then inspect the returned local PNG path with the available image tool. Do not substitute OS-level screenshots.',
  'Use command execution instead only when no advertised specialized tool fits, the specialized tool fails, or the user explicitly asks for a command-based check.',
  'For explicit computer_use, mouse, keyboard, browser, or GUI-control requests, continue through the computer_use tool actions instead of shell/open/osascript/screencapture/pbpaste fallbacks unless the user explicitly permits that fallback.',
  ...CODEX_COMMAND_DOWNLOAD_INSTRUCTION_LINES
].join('\n')
const CODEX_MULTI_AGENT_DEVELOPER_INSTRUCTIONS = [
  'SciForge provides `delegate_task` for bounded child-agent work.',
  'Use it when parallel investigation or independent implementation subtasks materially help the user request.',
  'Give each child a concise label and a self-contained prompt; do not use it for trivial work or as a substitute for doing the main task.',
  'Treat the tool result as the child agent answer, the same way you would read an assistant response.'
].join('\n')
const CODEX_THREAD_FALLBACK_TITLE = 'Codex thread'
const MAX_CODEX_THREAD_TITLE_LENGTH = 80
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
  private clientPromise: Promise<CodexAppServerJsonRpcClient> | null = null
  private clientConnected = false
  private clientInfo: unknown = null
  private subscription: Promise<void> | null = null
  private readonly threadStore: CodexThreadStore | null
  private readonly eventStore: CodexEventStore | null
  private readonly usageStore: CodexUsageStore | null
  private dynamicMcpBridge: CodexDynamicMcpToolBridge | null = null
  private multiAgentBridge: CodexMultiAgentToolBridge | null = null
  private readonly multiAgentChildThreadIds = new Set<string>()
  private usageBackfillPromise: Promise<void> | null = null
  private readonly activeTurns = new Map<string, string>()
  private readonly turnTimings = new Map<string, CodexTurnTiming>()
  private readonly turnModelHints = new Map<string, string>()
  private readonly pendingTurnRecoveries = new Map<string, CodexPendingTurnRecovery>()
  private readonly turnsWithRecordedUsage = new Set<string>()
  private readonly firstActivityTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly seenModelDeltaKeys = new Set<string>()
  private readonly eventSubscribers = new Set<CodexRuntimeEventSubscriber>()
  private readonly pendingToolItemsByTurn = new Map<string, Set<string>>()
  private readonly deferredTurnCompleteEvents = new Map<string, CodexThreadEventPayload>()
  private readonly pendingToolBarrierTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly options: CodexRuntimeServiceOptions) {
    this.threadStore = options.storageRoot ? new CodexThreadStore({ rootDir: options.storageRoot }) : null
    this.eventStore = options.storageRoot ? new CodexEventStore({ rootDir: options.storageRoot }) : null
    this.usageStore = options.storageRoot ? new CodexUsageStore({ rootDir: options.storageRoot }) : null
  }

  async connect(): Promise<CodexConnectResult> {
    try {
      const { info } = await this.ensureConnectedClient()
      return { ok: true, info: asRecord(info) ?? {} }
    } catch (error) {
      await this.discardClientAfterFailure()
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
      await this.discardClientAfterFailure()
      if (stored.length > 0) {
        return { ok: true, threads: filterThreadList(stored.map(storedThreadToNormalizedThread), options) }
      }
      return failure(error)
    }
  }

  async startThread(payload: CodexThreadStartPayload): Promise<CodexThreadStartResult> {
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
      const { client } = await this.ensureConnectedClient(settings)
      if (coldStart) {
        await this.emitRuntimeStatus({
          threadId: startupStatusThreadId,
          phase: 'initialize_done',
          message: 'Codex app-server initialized',
          latencyMs: elapsedMs(startedAtMs)
        }, { persist: false })
      }
      const dynamicTools = await this.codexDynamicTools(settings)
      const response = await client.startThread({
        ...baseThreadParams(settings, workspace, {
          specializedMcpConfigured: this.hasDynamicMcpServersConfigured(),
          multiAgentConfigured: Boolean(this.ensureCodexMultiAgentBridge(settings)),
          dynamicTools
        }),
        ...codexModelRouterThreadParams(settings),
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
      await this.discardClientAfterFailure()
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
      const preferredDetail = preferThreadDetail(detailWithUsage, storedDetailWithUsage)
      if (storedDetail && this.shouldRepairStaleTurnDetail(guiThreadId, preferredDetail, storedDetail)) {
        const repairedDetail = await this.readStoredDetail(guiThreadId, { repairStale: true })
        return { ok: true, detail: repairedDetail ?? preferredDetail }
      }
      return { ok: true, detail: preferredDetail }
    } catch (error) {
      if (isMissingOrUnmaterializedThreadError(error) && isEmptyStoredThread(storedThread, storedDetail)) {
        return { ok: true, detail: emptyThreadDetail() }
      }
      if (isEmptyStoredThread(storedThread, storedDetail)) {
        if (this.activeTurns.size === 0) await this.discardClientAfterFailure()
        return { ok: true, detail: emptyThreadDetail() }
      }
      if (this.activeTurns.size > 0) {
        if (storedDetail) return { ok: true, detail: storedDetail }
        return failure(error)
      }
      await this.discardClientAfterFailure()
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
      this.noteRuntimeEvent(published)
      this.broadcastEvent(published)
      this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.event, { event: published })
      return published
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
      await this.discardClientAfterFailure()
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
      await this.discardClientAfterFailure()
      return failure(error)
    }
  }

  async startTurn(payload: CodexTurnStartPayload): Promise<CodexTurnStartResult> {
    try {
      const startedAtMs = Date.now()
      const settings = await this.options.settings()
      const runtime = getCodexRuntimeSettings(settings)
      const routerModel = codexModelRouterModel(settings)
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
      const { client } = await this.ensureConnectedClient(settings)
      if (coldStart) {
        await this.emitRuntimeStatus({
          threadId: payload.threadId,
          phase: 'initialize_done',
          message: 'Codex app-server initialized',
          latencyMs: elapsedMs(startedAtMs)
        })
      }
      let response: unknown
      try {
        response = await client.startTurn(turnStartParams({
          threadId: codexThreadId,
          text: modelText,
          displayText: modelDisplayText,
          workspace,
          model: routerModel,
          reasoningEffort: payload.reasoningEffort,
          metadata: payload.metadata,
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
        codexThreadId = replacement.codexThreadId
        response = await client.startTurn(turnStartParams({
          threadId: codexThreadId,
          text: modelText,
          displayText: modelDisplayText,
          workspace,
          model: routerModel,
          reasoningEffort: payload.reasoningEffort,
          metadata: payload.metadata,
          fileReferences: payload.fileReferences,
          runtime
        }))
      }
      const turn = asRecord(asRecord(response)?.turn) ?? {}
      const turnId = stringValue(turn.id) || ''
      this.recordActiveTurn(payload.threadId, turnId, startedAtMs)
      this.recordTurnModelHint(payload.threadId, turnId, routerModel)
      this.recordTurnRecovery(payload.threadId, turnId, {
        threadId: payload.threadId,
        text: modelText,
        displayText: modelDisplayText,
        workspace,
        model: routerModel,
        reasoningEffort: payload.reasoningEffort,
        metadata: payload.metadata,
        fileReferences: payload.fileReferences,
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
      await this.discardClientAfterFailure()
      return failure(error)
    }
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
      this.dynamicMcpBridge?.abortRequestsForTurn(threadId, turnId, 'user_stop')
      this.multiAgentBridge?.abortRequestsForTurn(threadId, turnId)
      await client.interruptTurn({ threadId: codexThreadId, turnId })
      if (options.discard) await this.stop('user_stop')
      return { ok: true }
    } catch (error) {
      await this.discardClientAfterFailure()
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
      await this.discardClientAfterFailure()
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
      await this.discardClientAfterFailure()
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
    return this.client?.pendingServerRequests() ?? []
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

  async stop(reason: CodexDynamicMcpReleaseReason = 'service_shutdown'): Promise<void> {
    const client = this.client
    const dynamicMcpBridge = this.dynamicMcpBridge
    await this.finalizeActiveTurnsBeforeTeardown({
      code: reason === 'user_stop' ? 'aborted' : 'runtime_stopped',
      message: reason === 'user_stop'
        ? 'Codex turn was stopped before it completed.'
        : CODEX_TURN_STOPPED_MESSAGE,
      details: { reason }
    })
    this.client = null
    this.dynamicMcpBridge = null
    this.clientPromise = null
    this.clientConnected = false
    this.clientInfo = null
    this.subscription = null
    this.activeTurns.clear()
    this.turnTimings.clear()
    this.turnModelHints.clear()
    this.turnsWithRecordedUsage.clear()
    this.clearAllFirstActivityTimers()
    this.seenModelDeltaKeys.clear()
    this.clearPendingToolBarrier()
    this.closeAllEventSubscribers()
    await dynamicMcpBridge?.close(reason)
    if (client) await client.stop()
  }

  private async discardClientAfterFailure(): Promise<void> {
    const client = this.client
    const dynamicMcpBridge = this.dynamicMcpBridge
    await this.finalizeActiveTurnsBeforeTeardown({
      code: 'runtime_disconnected',
      message: CODEX_TURN_DISCONNECTED_MESSAGE,
      details: { reason: 'runtime_disconnected' }
    })
    this.client = null
    this.dynamicMcpBridge = null
    this.clientPromise = null
    this.clientConnected = false
    this.clientInfo = null
    this.subscription = null
    this.activeTurns.clear()
    this.turnTimings.clear()
    this.turnModelHints.clear()
    this.turnsWithRecordedUsage.clear()
    this.clearAllFirstActivityTimers()
    this.seenModelDeltaKeys.clear()
    this.clearPendingToolBarrier()
    this.closeAllEventSubscribers()
    await dynamicMcpBridge?.close('runtime_disconnected').catch(() => undefined)
    if (!client) return
    try {
      await client.stop()
    } catch {
      // The request path already has the meaningful failure. Cleanup is best-effort.
    }
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

  private async ensureClient(settings?: AppSettingsV1): Promise<CodexAppServerJsonRpcClient> {
    if (this.client) return this.client
    if (this.clientPromise) return this.clientPromise
    const promise = (async () => {
      const current = settings ?? await this.options.settings()
      const launch = await prepareCodexAppServerLaunch({
        settings: current,
        managedCodexHome: this.options.managedCodexHome,
        scheduleMcpLaunch: this.options.scheduleMcpLaunch,
        researchMcpLaunch: this.options.researchMcpLaunch,
        workflowMcpLaunch: this.options.workflowMcpLaunch,
        workspaceIntelMcpLaunch: this.options.workspaceIntelMcpLaunch,
        paperRadarMcpLaunch: this.options.paperRadarMcpLaunch,
        writeAssistMcpLaunch: this.options.writeAssistMcpLaunch,
        runtimeInspectorMcpLaunch: this.options.runtimeInspectorMcpLaunch,
        scientificSkillsMcpLaunch: this.options.scientificSkillsMcpLaunch,
        scientificPlottingMcpLaunch: this.options.scientificPlottingMcpLaunch,
        bgcDiscoveryMcpLaunch: this.options.bgcDiscoveryMcpLaunch,
        imageGenerationMcpLaunch: this.options.imageGenerationMcpLaunch,
        pptMasterMcpLaunch: this.options.pptMasterMcpLaunch,
        visualDocumentMcpLaunch: this.options.visualDocumentMcpLaunch
      })
      this.dynamicMcpBridge = createCodexDynamicMcpToolBridge({
        servers: codexDynamicMcpServers(this.options, current),
        ...(this.options.mcpClientFactory ? { clientFactory: this.options.mcpClientFactory } : {})
      })
      this.ensureCodexMultiAgentBridge(current)
      const createClient = this.options.createClient ?? createCodexAppServerClient
      const client = createClient({
        command: launch.command,
        args: launch.args,
        cwd: launch.cwd,
        env: launch.env,
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
      this.client = client
      this.subscription = this.forwardEvents(client)
      void this.subscription.catch(() => undefined)
      return client
    })()
    this.clientPromise = promise
    try {
      return await promise
    } finally {
      if (this.clientPromise === promise) this.clientPromise = null
    }
  }

  private async ensureConnectedClient(settings?: AppSettingsV1): Promise<{
    client: CodexAppServerJsonRpcClient
    info: unknown
  }> {
    const client = await this.ensureClient(settings)
    if (this.clientConnected) return { client, info: this.clientInfo ?? {} }
    const info = await client.connect()
    this.clientConnected = true
    this.clientInfo = info
    return { client, info }
  }

  isClientWarm(): boolean {
    return this.client !== null && this.clientConnected
  }

  isResearchMcpConfigured(): boolean {
    return Boolean(
      this.options.researchMcpLaunch ||
      this.options.scientificSkillsMcpLaunch ||
      this.options.scientificPlottingMcpLaunch ||
      this.options.bgcDiscoveryMcpLaunch ||
      this.options.imageGenerationMcpLaunch ||
      this.options.pptMasterMcpLaunch ||
      this.options.visualDocumentMcpLaunch ||
      (this.options.managedMcpServers ?? []).some((server) => server.id === GUI_RESEARCH_MCP_SERVER_NAME)
    )
  }

  isComputerUseMcpConfigured(settings?: AppSettingsV1): boolean {
    return Boolean(
      (settings && this.options.computerUseMcpLaunch && isComputerUseMcpConfigured(settings, 'codex')) ||
      (this.options.managedMcpServers ?? []).some((server) => server.id === GUI_COMPUTER_USE_MCP_SERVER_NAME)
    )
  }

  isMcpConfigured(): boolean {
    return this.hasDynamicMcpServersConfigured()
  }

  private hasDynamicMcpServersConfigured(): boolean {
    return this.dynamicMcpBridge?.hasConfiguredServers() ?? codexDynamicMcpServers(this.options).length > 0
  }

  private async codexDynamicTools(
    settings?: AppSettingsV1,
    options: { includeMultiAgent?: boolean } = {}
  ): Promise<CodexAppServerDynamicToolSpec[]> {
    const current = settings ?? await this.options.settings()
    const includeMultiAgent = options.includeMultiAgent !== false
    return [
      ...(includeMultiAgent ? this.ensureCodexMultiAgentBridge(current)?.dynamicTools() ?? [] : []),
      ...(await this.dynamicMcpBridge?.dynamicTools() ?? [])
    ]
  }

  private async handleDynamicToolCall(
    request: CodexAppServerDynamicToolCallRequest
  ): Promise<CodexAppServerDynamicToolCallResponse> {
    const settings = await this.options.settings()
    const multiAgentBridge = this.ensureCodexMultiAgentBridge(settings)
    if (multiAgentBridge?.canHandle(request)) {
      if (await this.isMultiAgentChildThread(request.threadId)) {
        return {
          contentItems: [{ type: 'inputText', text: 'delegate_task is disabled inside child agents.' }],
          success: false
        }
      }
      return multiAgentBridge.callTool(await this.requestWithGuiThreadContext(request))
    }
    const bridge = this.dynamicMcpBridge
    if (!bridge) {
      return {
        contentItems: [{ type: 'inputText', text: 'No MCP dynamic tool bridge is configured.' }],
        success: false
      }
    }
    try {
      return await bridge.callTool(await this.requestWithThreadWorkspace(request))
    } catch (error) {
      const name = request.namespace ? `${request.namespace}.${request.tool}` : request.tool
      return {
        contentItems: [{
          type: 'inputText',
          text: `MCP dynamic tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`
        }],
        success: false
      }
    }
  }

  private async requestWithThreadWorkspace(
    request: CodexAppServerDynamicToolCallRequest
  ): Promise<CodexAppServerDynamicToolCallRequest> {
    const toolName = workspaceIntelToolNameForRequest(request)
    if (!toolName || !WORKSPACE_INTEL_THREAD_WORKSPACE_TOOLS.has(toolName)) return request
    const args = dynamicToolArgumentsRecord(request.arguments)
    if (!args || stringValue(args.workspaceRoot).trim()) return request

    const threadId = stringValue(request.threadId).trim()
    if (!threadId) return request
    const storedThread = await this.findStoredThread(threadId)
    const workspaceRoot = storedThread?.workspace?.trim()
    if (!workspaceRoot) return request

    return {
      ...request,
      arguments: {
        ...args,
        workspaceRoot
      }
    }
  }

  private async requestWithGuiThreadContext(
    request: CodexAppServerDynamicToolCallRequest
  ): Promise<CodexAppServerDynamicToolCallRequest> {
    const threadId = stringValue(request.threadId).trim()
    if (!threadId) return request
    const storedThread = await this.findStoredThread(threadId)
    if (!storedThread || storedThread.guiThreadId === threadId) return request
    return { ...request, threadId: storedThread.guiThreadId }
  }

  private ensureCodexMultiAgentBridge(settings: AppSettingsV1): CodexMultiAgentToolBridge | null {
    const subagents = getAgentCapabilitySettings(settings).subagents
    if (!subagents.enabled) {
      this.multiAgentBridge = null
      return null
    }
    if (!this.multiAgentBridge) {
      this.multiAgentBridge = createCodexMultiAgentToolBridge({
        enabled: true,
        maxParallel: subagents.maxParallel,
        maxChildren: subagents.maxChildRuns,
        ...(this.options.storageRoot ? { storeRoot: join(this.options.storageRoot, 'multi-agent-child-runs') } : {}),
        executor: (input) => this.runCodexMultiAgentChild(input),
        onChildEvent: (event) => this.publishCodexMultiAgentChildEvent(event)
      })
    }
    return this.multiAgentBridge
  }

  private async publishCodexMultiAgentChildEvent(event: MultiAgentChildEvent): Promise<void> {
    const record = await this.multiAgentBridge?.child(event.parentThreadId, event.childId)
    if (!record) return
    await this.publishClientEvent({
      threadId: event.parentThreadId,
      turnId: record.parentTurnId,
      child: codexChildFromMultiAgentRecord(record, event)
    })
  }

  private async runCodexMultiAgentChild(input: MultiAgentExecutorInput): Promise<MultiAgentExecutorResult> {
    const settings = await this.options.settings()
    const { client } = await this.ensureConnectedClient(settings)
    const workspace = resolveCodexWorkspace(settings, input.workspace)
    const dynamicTools = await this.codexDynamicTools(settings, { includeMultiAgent: false })
    const threadResponse = await client.startThread({
      ...baseThreadParams(settings, workspace, {
        specializedMcpConfigured: this.hasDynamicMcpServersConfigured(),
        multiAgentConfigured: false,
        dynamicTools
      }),
      ...codexModelRouterThreadParams(settings),
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
    this.multiAgentChildThreadIds.add(childGuiThreadId)
    this.multiAgentChildThreadIds.add(childCodexThreadId)
    const subscriber = this.addEventSubscriber(childGuiThreadId)
    const startedAtMs = Date.now()
    try {
      const turnResponse = await client.startTurn(turnStartParams({
        threadId: childCodexThreadId,
        text: input.prompt,
        workspace,
        model: codexModelRouterModel(settings),
        runtime: getCodexRuntimeSettings(settings)
      }))
      const turn = asRecord(asRecord(turnResponse)?.turn) ?? {}
      const childTurnId = stringValue(turn.id) || ''
      if (!childTurnId) throw new Error('Codex child turn did not return a turn id.')
      this.recordActiveTurn(childGuiThreadId, childTurnId, startedAtMs)
      this.recordTurnModelHint(childGuiThreadId, childTurnId, codexModelRouterModel(settings))
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
        codexThreadId: childCodexThreadId,
        turnId: childTurnId,
        signal: input.signal
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
      this.closeEventSubscriber(subscriber)
    }
  }

  private async waitForCodexChildTurn(input: {
    subscriber: CodexRuntimeEventSubscriber
    threadId: string
    codexThreadId: string
    turnId: string
    signal: AbortSignal
  }): Promise<{
    summary: string
    usage?: Partial<MultiAgentUsage>
    transcript: MultiAgentTranscriptEntry[]
  }> {
    const transcript: MultiAgentTranscriptEntry[] = []
    let assistantText = ''
    let usage: Partial<MultiAgentUsage> | undefined
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
          transcript.push({
            id: event.tool.itemId,
            kind: 'tool',
            summary: event.tool.summary,
            text: event.tool.detail,
            status: event.tool.status,
            metadata: event.tool.meta
          })
        }
        if (event.usage) usage = multiAgentUsageFromCodexUsage(event.usage)
        if (isTerminalRuntimeError(event.runtimeError)) {
          throw codexChildTurnError(event.runtimeError, transcript, usage)
        }
        if (event.turnComplete) break
      }
      if (input.signal.aborted) {
        await this.client?.interruptTurn({ threadId: input.codexThreadId, turnId: input.turnId }).catch(() => undefined)
        throw new Error('Codex child turn was aborted.')
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

  private async isMultiAgentChildThread(threadId: string | undefined): Promise<boolean> {
    const normalized = threadId?.trim()
    if (!normalized) return false
    if (this.multiAgentChildThreadIds.has(normalized)) return true
    const storedThread = await this.findStoredThread(normalized)
    return isCodexChildThreadSource(storedThread?.threadSource)
  }

  private async forwardEvents(client: CodexAppServerJsonRpcClient): Promise<void> {
    for await (const event of client.subscribe()) {
      if (event.type === 'event') {
        const normalized = this.normalizeClientEvent(event.payload)
        const deduped = normalized ? this.dedupeModelDeltas(normalized) : null
        if (deduped) {
          const guiEvent = await this.eventForGuiThread(deduped)
          for (const runtimeEvent of this.eventsAfterPendingToolBarrier(guiEvent)) {
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
      this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.closed, { reason: event.reason })
      if (this.client === client) {
        await this.discardClientAfterFailure()
      }
      return
    }
    if (this.activeTurns.size > 0) {
      await this.failActiveTurns(
        'Codex app-server event stream ended unexpectedly.',
        'runtime_disconnected'
      )
      this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.closed, { reason: 'event_stream_ended' })
      if (this.client === client) {
        await this.discardClientAfterFailure()
      }
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
    if (!turnId) return event

    const nextDeltas = deltas.filter((delta) => {
      const text = canonicalModelText(delta.text)
      const shouldTrack = Boolean(text)
      if (!shouldTrack) return true
      const key = `${event.threadId}\u0000${turnId}\u0000${delta.kind}\u0000${text}`
      const duplicated = this.seenModelDeltaKeys.has(key)
      this.seenModelDeltaKeys.add(key)
      const shouldFilterDuplicate = delta.snapshot === true || event.turnComplete === true || text.length >= 16
      if (duplicated && shouldFilterDuplicate) return false
      return true
    })
    if (nextDeltas.length === deltas.length) return event
    if (nextDeltas.length > 0) return { ...event, deltas: nextDeltas }
    const { deltas: _deltas, ...withoutDeltas } = event
    return eventHasNonDeltaPayload(withoutDeltas) ? withoutDeltas : null
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
    const turnId = event.turnId || event.userMessage?.turnId
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

  private async publishClientEvent(event: CodexThreadEventPayload): Promise<void> {
    if (await this.recoverModelRouterAliasFailure(event)) return
    const stored = await this.persistEvent(event.threadId, event)
    const runtimeEvent = stored?.event ?? event
    await this.recordUsageEvent(runtimeEvent, stored?.createdAt)
    this.noteFirstActivity(runtimeEvent)
    this.broadcastEvent(runtimeEvent)
    this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.event, { event: runtimeEvent })
    await this.emitFirstDeltaIfNeeded(runtimeEvent)
    await this.emitTurnDoneIfNeeded(runtimeEvent)
    this.noteRuntimeEvent(runtimeEvent)
  }

  private async recoverModelRouterAliasFailure(event: CodexThreadEventPayload): Promise<boolean> {
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId || !isModelRouterAliasRuntimeError(event.runtimeError)) return false
    const key = turnTimingKey(event.threadId, turnId)
    const recovery = this.pendingTurnRecoveries.get(key)
    if (!recovery || recovery.recoveryAttempted) return false

    const settings = await this.options.settings()
    const storedThread = await this.findStoredThread(event.threadId)
    this.pendingTurnRecoveries.set(key, { ...recovery, recoveryAttempted: true })
    this.clearTurnTracking(event.threadId, turnId)

    await this.emitRuntimeStatus({
      threadId: event.threadId,
      turnId,
      phase: 'reconnecting',
      message: 'Codex thread used a stale Model Router alias; rebuilding the thread and retrying this turn.'
    })

    try {
      const { client } = await this.ensureConnectedClient(settings)
      const replacement = await this.rematerializeThread({
        client,
        settings,
        guiThreadId: event.threadId,
        storedThread,
        workspace: recovery.workspace
      })
      const response = await client.startTurn(turnStartParams({
        threadId: replacement.codexThreadId,
        text: recovery.text,
        displayText: recovery.displayText,
        workspace: recovery.workspace,
        model: recovery.model,
        reasoningEffort: recovery.reasoningEffort,
        metadata: recovery.metadata,
        fileReferences: recovery.fileReferences,
        runtime: recovery.runtime
      }))
      const turn = asRecord(asRecord(response)?.turn) ?? {}
      const retryTurnId = stringValue(turn.id) || ''
      this.recordActiveTurn(event.threadId, retryTurnId)
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

  private trackPendingToolEvent(event: CodexThreadEventPayload, key: string): void {
    const tool = event.tool
    const itemId = tool?.itemId.trim()
    if (!tool || !itemId) return

    if (tool.status === 'running') {
      const pending = this.pendingToolItemsByTurn.get(key) ?? new Set<string>()
      pending.add(itemId)
      this.pendingToolItemsByTurn.set(key, pending)
      return
    }

    const pending = this.pendingToolItemsByTurn.get(key)
    if (!pending) return
    pending.delete(itemId)
    if (pending.size === 0) this.pendingToolItemsByTurn.delete(key)
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
    this.deferredTurnCompleteEvents.delete(key)
    this.clearPendingToolBarrierTimer(key)
  }

  private clearPendingToolBarrier(): void {
    this.pendingToolItemsByTurn.clear()
    this.deferredTurnCompleteEvents.clear()
    for (const timer of this.pendingToolBarrierTimers.values()) clearTimeout(timer)
    this.pendingToolBarrierTimers.clear()
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
    this.pendingToolItemsByTurn.delete(key)
    this.deferredTurnCompleteEvents.delete(key)
    await this.publishClientEvent(deferred)
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
    const dynamicTools = await this.codexDynamicTools(input.settings)
    const response = await input.client.startThread({
      ...baseThreadParams(input.settings, input.workspace, {
        specializedMcpConfigured: this.hasDynamicMcpServersConfigured(),
        multiAgentConfigured: Boolean(this.ensureCodexMultiAgentBridge(input.settings)),
        dynamicTools
      }),
      ...codexModelRouterThreadParams(input.settings),
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
    return stored
  }

  private recordActiveTurn(threadId: string, turnId: string, startedAtMs = Date.now()): void {
    const normalizedThreadId = threadId.trim()
    const normalizedTurnId = turnId.trim()
    if (!normalizedThreadId || !normalizedTurnId) return
    this.activeTurns.set(normalizedThreadId, normalizedTurnId)
    this.turnTimings.set(turnTimingKey(normalizedThreadId, normalizedTurnId), {
      startedAtMs,
      firstActivitySeen: false,
      firstDeltaSeen: false
    })
    this.scheduleFirstActivityTimeout(normalizedThreadId, normalizedTurnId)
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

  private noteRuntimeEvent(event: CodexThreadEventPayload): void {
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId || this.activeTurns.get(event.threadId) !== turnId) return
    if (event.turnComplete || isTerminalRuntimeError(event.runtimeError)) {
      this.clearTurnTracking(event.threadId, turnId)
    }
  }

  private clearTurnTracking(threadId: string, turnId: string): void {
    const key = turnTimingKey(threadId, turnId)
    if (this.activeTurns.get(threadId) === turnId) this.activeTurns.delete(threadId)
    this.turnTimings.delete(key)
    this.turnModelHints.delete(key)
    this.pendingTurnRecoveries.delete(key)
    this.clearFirstActivityTimer(key)
    this.clearPendingToolBarrierForTurn(key)
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
    this.noteRuntimeEvent(published)
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
    await this.discardClientAfterFailure()
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
        blocks.push({
          kind: delta.kind === 'agent_reasoning' ? 'reasoning' : 'assistant',
          id: `${delta.kind}-${item.seq}-${index}`,
          createdAt: item.createdAt,
          ...(turnId ? { turnId } : {}),
          text: delta.text,
          ...(delta.kind === 'agent_reasoning'
            ? { meta: { reasoning: { visibility: 'summary', source: 'runtime_summary' } } }
            : {}),
          ...(delta.kind === 'agent_message' && delta.snapshot ? { snapshot: true } : {})
        })
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

function latestStoredTurnId(events: CodexStoredEvent[]): string | undefined {
  for (const item of [...events].reverse()) {
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
    .filter((item) => (item.event.turnId || item.event.userMessage?.turnId) === turnId)
    .map((item) => Date.parse(item.createdAt))
    .filter((value) => Number.isFinite(value))
  if (timestamps.length === 0) return false
  return Date.now() - Math.max(...timestamps) >= minAgeMs
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

function codexDynamicMcpServers(
  options: CodexRuntimeServiceOptions,
  settings?: AppSettingsV1
): CodexDynamicMcpServerConfig[] {
  return buildCodexManagedGuiMcpServers({
    settings,
    scheduleMcp: options.scheduleMcpLaunch && settings
      ? { settings, launch: options.scheduleMcpLaunch }
      : undefined,
    researchMcp: options.researchMcpLaunch
      ? { launch: options.researchMcpLaunch }
      : undefined,
    workflowMcp: options.workflowMcpLaunch && settings
      ? { settings, launch: options.workflowMcpLaunch }
      : undefined,
    workspaceIntelMcp: options.workspaceIntelMcpLaunch && settings
      ? { settings, launch: options.workspaceIntelMcpLaunch }
      : undefined,
    paperRadarMcp: options.paperRadarMcpLaunch
      ? { launch: options.paperRadarMcpLaunch }
      : undefined,
    writeAssistMcp: options.writeAssistMcpLaunch && settings
      ? { settings, launch: options.writeAssistMcpLaunch }
      : undefined,
    runtimeInspectorMcp: options.runtimeInspectorMcpLaunch && settings
      ? { settings, launch: options.runtimeInspectorMcpLaunch }
      : undefined,
    scientificSkillsMcp: options.scientificSkillsMcpLaunch && settings
      ? { settings, launch: options.scientificSkillsMcpLaunch }
      : undefined,
    scientificPlottingMcp: options.scientificPlottingMcpLaunch && settings
      ? { settings, launch: options.scientificPlottingMcpLaunch }
      : undefined,
    bgcDiscoveryMcp: options.bgcDiscoveryMcpLaunch && settings
      ? { settings, launch: options.bgcDiscoveryMcpLaunch }
      : undefined,
    imageGenerationMcp: options.imageGenerationMcpLaunch && settings
      ? { settings, launch: options.imageGenerationMcpLaunch }
      : undefined,
    pptMasterMcp: options.pptMasterMcpLaunch && settings
      ? { settings, launch: options.pptMasterMcpLaunch }
      : undefined,
    visualDocumentMcp: options.visualDocumentMcpLaunch && settings
      ? { settings, launch: options.visualDocumentMcpLaunch }
      : undefined,
    computerUseMcp: options.computerUseMcpLaunch && settings
      ? { settings, launch: options.computerUseMcpLaunch }
      : undefined
  }, options.managedMcpServers)
}

function baseThreadParams(
  settings: AppSettingsV1,
  workspace?: string,
  dynamicMcp: {
    specializedMcpConfigured?: boolean
    multiAgentConfigured?: boolean
    dynamicTools?: CodexAppServerDynamicToolSpec[]
  } = {}
): CodexAppServerThreadStartParams {
  const runtime = getCodexRuntimeSettings(settings)
  const cwd = resolveCodexWorkspace(settings, workspace)
  const dynamicTools = dynamicMcp.dynamicTools?.length ? dynamicMcp.dynamicTools : undefined
  return {
    cwd,
    approvalPolicy: mapApprovalPolicy(runtime.approvalPolicy),
    sandbox: mapThreadSandboxMode(runtime.sandboxMode),
    config: codexAppServerThreadReasoningConfig(),
    ...(dynamicDeveloperInstructions(dynamicMcp) ? { developerInstructions: dynamicDeveloperInstructions(dynamicMcp) } : {}),
    ...(dynamicTools ? { dynamicTools } : {})
  }
}

function dynamicDeveloperInstructions(input: {
  specializedMcpConfigured?: boolean
  multiAgentConfigured?: boolean
}): string {
  return [
    input.specializedMcpConfigured ? CODEX_SPECIALIZED_MCP_DEVELOPER_INSTRUCTIONS : '',
    input.multiAgentConfigured ? CODEX_MULTI_AGENT_DEVELOPER_INSTRUCTIONS : ''
  ].filter(Boolean).join('\n\n')
}

function codexModelRouterThreadParams(
  settings: AppSettingsV1
): Pick<CodexAppServerThreadStartParams, 'model' | 'modelProvider'> {
  return {
    model: codexModelRouterModel(settings),
    modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
  }
}

function codexModelRouterModel(settings: AppSettingsV1): string {
  void settings
  return DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
}

function turnStartParams(input: {
  threadId: string
  text: string
  displayText?: string
  workspace: string
  model?: string
  reasoningEffort?: string
  metadata?: Record<string, unknown>
  fileReferences?: CodexTurnStartPayload['fileReferences']
  runtime: ReturnType<typeof getCodexRuntimeSettings>
}): Parameters<CodexAppServerJsonRpcClient['startTurn']>[0] {
  return {
    threadId: input.threadId,
    input: [textInput(input.text), ...modelObjectInputs(input.fileReferences)],
    cwd: input.workspace,
    ...(input.displayText?.trim() && input.displayText.trim() !== input.text.trim()
      ? { displayText: input.displayText.trim() }
      : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID,
    approvalPolicy: mapApprovalPolicy(input.runtime.approvalPolicy),
    sandboxPolicy: mapTurnSandboxMode(input.runtime.sandboxMode, input.workspace),
    ...codexAppServerTurnReasoningParams({ reasoningEffort: input.reasoningEffort })
  }
}

function mapApprovalPolicy(policy: ApprovalPolicy): 'never' | 'on-request' | 'untrusted' {
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

function modelObjectInputs(fileReferences: CodexTurnStartPayload['fileReferences']): CodexAppServerInputItem[] {
  return (fileReferences ?? [])
    .filter((reference) => reference.modelRouterObject === true && reference.relativePath.trim().length > 0)
    .map((reference) => ({
      type: 'input_object',
      ref: reference.relativePath.trim(),
      path: reference.relativePath.trim(),
      title: reference.name,
      ...(reference.mimeType ? { mimeType: reference.mimeType } : {})
    }))
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
  return {
    blocks,
    latestSeq: blocks.length,
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

function multiAgentUsageFromCodexUsage(usage: AgentRuntimeUsage): Partial<MultiAgentUsage> {
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

function isTerminalRuntimeError(
  error: CodexThreadEventPayload['runtimeError']
): error is NonNullable<CodexThreadEventPayload['runtimeError']> {
  if (!error) return false
  if (isTransientRuntimeError(error)) return false
  return error.severity === 'error' || error.code === 'cancelled' || error.code === 'aborted'
}

function codexChildTurnError(
  error: NonNullable<CodexThreadEventPayload['runtimeError']>,
  transcript: readonly MultiAgentTranscriptEntry[],
  usage: Partial<MultiAgentUsage> | undefined
): Error {
  const thrown = Object.assign(new Error(error.message || 'Codex child turn failed.'), {
    multiAgentTranscript: transcript,
    ...(usage ? { multiAgentUsage: usage } : {})
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

function workspaceIntelToolNameForRequest(
  request: CodexAppServerDynamicToolCallRequest
): WorkspaceIntelToolName | null {
  const tool = request.tool.trim()
  if (!tool) return null
  return WorkspaceIntelToolNames.find((name) => tool === name || tool.endsWith(`_${name}`)) ?? null
}

const WORKSPACE_INTEL_THREAD_WORKSPACE_TOOLS = new Set<WorkspaceIntelToolName>(
  WorkspaceIntelToolNames.filter((name) => (
    name !== 'gui_visible_context' && name !== 'gui_visual_capture'
  ))
)

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function canonicalModelText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
