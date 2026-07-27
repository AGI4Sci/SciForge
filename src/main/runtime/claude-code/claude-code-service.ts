import { randomUUID } from 'node:crypto'
import {
  ExecutionGovernorCore,
  createExecutionReceipt
} from '@sciforge/execution-governance'
import type {
  HookCallback,
  Options as ClaudeAgentSdkOptions,
  Query as ClaudeAgentSdkQuery,
  SDKMessage,
  SDKUserMessage,
  SessionStoreEntry
} from '@anthropic-ai/claude-agent-sdk'
import { query as claudeAgentSdkQuery } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentRuntimeChild,
  AgentRuntimeChildStatus,
  AgentRuntimeChildTranscriptEntry,
  AgentRuntimeExecutionReceipt,
  AgentRuntimeListThreadChildrenResponse,
  AgentRuntimeReadChildTranscriptResponse,
  AgentRuntimeEvent,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeTurn,
  AgentRuntimeUsage,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../../shared/agent-runtime-contract'
import {
  filterAgentRuntimeThreadChildren
} from '../../../shared/agent-runtime-contract'
import {
  resolveModelAccessRuntimePolicy,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  prepareClaudeCodeSdkLaunch,
  resolveClaudeWorkspace
} from './claude-code-config'
import {
  isComputerUseMcpConfigured,
} from '../../computer-use-mcp-config'
import {
  nativeAgentToolExecutionMetadata,
  type AgentRuntimeToolSurface
} from '../agent-runtime/agent-tool-surface'
import type {
  AgentRuntimeTurnGovernanceSnapshot,
  AgentRuntimeTurnGovernanceSnapshotInput
} from '../agent-runtime/adapter'
import { createClaudeCodeAgentToolTransport } from './claude-code-agent-tool-transport'
import { ClaudeCodeSessionStore } from './claude-code-session-store'
import {
  ClaudeCodeEventStore,
  ClaudeCodeThreadStore,
  storedThreadDetail,
  storedThreadToRuntimeThread,
  type ClaudeCodeStoredEvent
} from './claude-code-store'

export type ClaudeAgentSdk = {
  query(params: {
    prompt: string | AsyncIterable<SDKUserMessage>
    options?: ClaudeAgentSdkOptions
  }): ClaudeAgentSdkQuery
}

export type ClaudeCodeRuntimeServiceOptions = {
  settings: () => Promise<AppSettingsV1>
  storageRoot: string
  managedConfigDir?: string
  agentTools?: AgentRuntimeToolSurface
  claudeAgentSdk?: ClaudeAgentSdk
}

export type ClaudeCodeRuntimeFailure = {
  ok: false
  message: string
  code?: string
  recoverable?: boolean
}

export type ClaudeCodeRuntimeOk<T extends Record<string, unknown> = Record<string, unknown>> = {
  ok: true
} & T

export type ClaudeCodeConnectResult =
  | ClaudeCodeRuntimeOk<{ info: Record<string, unknown> }>
  | ClaudeCodeRuntimeFailure

export type ClaudeCodeThreadListResult =
  | ClaudeCodeRuntimeOk<{ threads: AgentRuntimeThread[] }>
  | ClaudeCodeRuntimeFailure

export type ClaudeCodeThreadStartResult =
  | ClaudeCodeRuntimeOk<{ thread: AgentRuntimeThread }>
  | ClaudeCodeRuntimeFailure

export type ClaudeCodeThreadReadResult =
  | ClaudeCodeRuntimeOk<{ detail: AgentRuntimeThreadDetail }>
  | ClaudeCodeRuntimeFailure

export type ClaudeCodeTurnStartResult =
  | ClaudeCodeRuntimeOk<{ threadId: string; turnId: string; userMessageItemId: string }>
  | ClaudeCodeRuntimeFailure

export type ClaudeCodeTurnMutationResult =
  | ClaudeCodeRuntimeOk
  | ClaudeCodeRuntimeFailure

type ActiveClaudeTurn = {
  threadId: string
  turnId: string
  abortController: AbortController
  query: ClaudeAgentSdkQuery
  assistantItemId: string
}

type ClaudeRuntimeEventSubscriber = {
  threadId: string
  queue: AgentRuntimeEvent[]
  wake: (() => void) | null
  closed: boolean
}

type ClaudeSdkTurnState = {
  assistantTextSeen: boolean
  reasoningDeltaSeen: boolean
  firstDeltaEmitted: boolean
  terminalState: Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }>['state']
  terminalMessage?: string
  partialContentTypes: Map<number, string>
  toolUses: Map<string, { name: string; input: Record<string, unknown> }>
  pendingToolResults: Map<string, ClaudeToolResult>
  toolResultFingerprints: Map<string, string>
  toolConflicts: Map<string, string>
}

type ClaudeToolResult = {
  content: unknown
  detail: string
  isError: boolean
  payload?: Record<string, unknown>
  sessionId?: string
  fingerprint: string
}

function terminalExecutionReceipt<Status extends 'success' | 'error'>(
  status: Status,
  output: unknown,
  detail: string,
  metadata?: Record<string, unknown>
): AgentRuntimeExecutionReceipt & { status: Status } {
  return createExecutionReceipt({ status, output, detail, metadata })
}

function appendClaudePreToolUseHook(
  hooks: ClaudeAgentSdkOptions['hooks'],
  hook: HookCallback
): NonNullable<ClaudeAgentSdkOptions['hooks']> {
  return {
    ...hooks,
    PreToolUse: [
      ...(hooks?.PreToolUse ?? []),
      {
        hooks: [hook]
      }
    ]
  }
}

function turnGovernanceKey(threadId: string, turnId: string): string {
  return `${threadId.trim()}\u0000${turnId.trim()}`
}

export class ClaudeCodeRuntimeService {
  private readonly sdk: ClaudeAgentSdk
  private readonly threadStore: ClaudeCodeThreadStore
  private readonly eventStore: ClaudeCodeEventStore
  private readonly sessionStore: ClaudeCodeSessionStore
  private readonly activeTurns = new Map<string, ActiveClaudeTurn>()
  private readonly turnGovernanceSnapshots = new Map<string, AgentRuntimeTurnGovernanceSnapshot>()
  private readonly eventSubscribers = new Set<ClaudeRuntimeEventSubscriber>()
  private readonly childState = new Map<string, AgentRuntimeChild>()

  constructor(private readonly options: ClaudeCodeRuntimeServiceOptions) {
    this.sdk = options.claudeAgentSdk ?? { query: claudeAgentSdkQuery }
    this.threadStore = new ClaudeCodeThreadStore({ rootDir: options.storageRoot })
    this.eventStore = new ClaudeCodeEventStore({ rootDir: options.storageRoot })
    this.sessionStore = new ClaudeCodeSessionStore({ rootDir: options.storageRoot })
  }

  isComputerUseMcpConfigured(settings?: AppSettingsV1): boolean {
    return isComputerUseMcpConfigured(settings, 'claude')
  }

  async connect(): Promise<ClaudeCodeConnectResult> {
    try {
      const settings = await this.options.settings()
      requireClaudeRuntimeSelected(settings)
      const runtime = settings.agents.claude
      const command = runtime?.command?.trim() || 'claude'
      return { ok: true, info: { command, sdk: '@anthropic-ai/claude-agent-sdk' } }
    } catch (error) {
      return failure(error, 'claude_sdk_unavailable')
    }
  }

  async listThreads(options: {
    limit?: number
    search?: string
    includeArchived?: boolean
    archivedOnly?: boolean
  } = {}): Promise<ClaudeCodeThreadListResult> {
    try {
      const stored = await this.threadStore.list({
        includeArchived: options.includeArchived === true || options.archivedOnly === true
      })
      const search = options.search?.trim().toLowerCase() ?? ''
      const threads = stored
        .filter((thread) => options.archivedOnly === true ? thread.archived : true)
        .filter((thread) => search ? thread.title.toLowerCase().includes(search) : true)
        .slice(0, options.limit ?? 100)
        .map(storedThreadToRuntimeThread)
      return { ok: true, threads }
    } catch (error) {
      return failure(error)
    }
  }

  async startThread(payload: {
    threadId?: string
    workspace?: string
    title?: string
  }): Promise<ClaudeCodeThreadStartResult> {
    try {
      const settings = await this.options.settings()
      requireClaudeRuntimeSelected(settings)
      const workspace = resolveClaudeWorkspace(settings, payload.workspace)
      const model = resolveRuntimeModelRouterSettings(settings).model
      const thread = await this.threadStore.upsert({
        guiThreadId: payload.threadId?.trim() || `claude-thread-${randomUUID()}`,
        workspace,
        title: payload.title || 'Claude Code thread',
        model,
        latestTurnStatus: 'queued'
      })
      await this.emit({
        threadId: thread.guiThreadId,
        kind: 'thread_lifecycle',
        state: 'created',
        thread: storedThreadToRuntimeThread(thread)
      })
      return { ok: true, thread: storedThreadToRuntimeThread(thread) }
    } catch (error) {
      return failure(error)
    }
  }

  async readThread(threadId: string): Promise<ClaudeCodeThreadReadResult> {
    try {
      const thread = await this.threadStore.get(threadId)
      if (!thread) {
        return {
          ok: true,
          detail: {
            id: threadId,
            runtimeId: 'claude',
            title: 'Claude Code thread',
            updatedAt: new Date().toISOString(),
            latestSeq: 0,
            turns: [],
            items: []
          }
        }
      }
      return { ok: true, detail: await storedThreadDetail(thread, this.eventStore) }
    } catch (error) {
      return failure(error)
    }
  }

  async publishSyntheticEvent(event: AgentRuntimeEvent): Promise<AgentRuntimeEvent> {
    const stored = await this.emit(event)
    return stored.event
  }

  async startTurn(payload: {
    threadId: string
    text: string
    displayText?: string
    workspace?: string
    reasoningEffort?: string
    ownedVisualToolsAvailable?: boolean
    nativeVisualProofChainPending?: boolean
  }): Promise<ClaudeCodeTurnStartResult> {
    try {
      const settings = await this.options.settings()
      requireClaudeRuntimeSelected(settings)
      const existingThread = await this.threadStore.get(payload.threadId)
      const workspace = resolveClaudeWorkspace(settings, payload.workspace || existingThread?.workspace)
      const turnId = `claude-turn-${randomUUID()}`
      const userMessageItemId = `claude-user-${randomUUID()}`
      const assistantItemId = `claude-assistant-${randomUUID()}`
      const launch = await prepareClaudeCodeSdkLaunch({
        settings,
        text: payload.text,
        threadId: payload.threadId,
        turnId,
        workspace,
        sessionId: existingThread?.claudeSessionId,
        reasoningEffort: payload.reasoningEffort,
        managedConfigDir: this.options.managedConfigDir
      })
      const storedThread = await this.threadStore.upsert({
        guiThreadId: payload.threadId,
        workspace,
        title: existingThread?.title || firstLineTitle(payload.displayText || payload.text),
        model: launch.model,
        latestTurnId: turnId,
        latestUserMessageId: userMessageItemId,
        latestTurnStatus: 'running'
      })
      await this.emit({
        threadId: payload.threadId,
        turnId,
        kind: 'user_message',
        itemId: userMessageItemId,
        text: payload.text,
        displayText: payload.displayText
      })
      await this.emit({
        threadId: payload.threadId,
        turnId,
        kind: 'turn_lifecycle',
        state: 'started'
      })
      await this.emit({
        threadId: payload.threadId,
        turnId,
        kind: 'runtime_status',
        phase: 'process_start',
        message: 'Starting Claude Agent SDK',
        metadata: {
          model: launch.model,
          permissionMode: launch.permissionMode,
          configDir: launch.configDir,
          pathToClaudeCodeExecutable: launch.pathToClaudeCodeExecutable
        }
      })
      const abortController = new AbortController()
      const agentToolServer = this.options.agentTools
        ? createClaudeCodeAgentToolTransport({
            surface: this.options.agentTools,
            context: {
              runtimeId: 'claude',
              threadId: payload.threadId,
              turnId,
              workspaceId: workspace,
              requestId: turnId
            }
          })
        : undefined
      const governanceKey = turnGovernanceKey(payload.threadId, turnId)
      this.turnGovernanceSnapshots.set(governanceKey, Object.freeze({
        ownedVisualToolsAvailable: payload.ownedVisualToolsAvailable === true,
        nativeVisualProofChainPending: payload.nativeVisualProofChainPending === true
      }))
      let query: ClaudeAgentSdkQuery
      try {
        query = this.sdk.query({
          prompt: launch.prompt,
          options: {
            ...launch.sdkOptions,
            hooks: appendClaudePreToolUseHook(
              launch.sdkOptions.hooks,
              this.createPreToolUseGovernanceHook({
                threadId: payload.threadId,
                turnId,
                workspace
              })
            ),
            ...(agentToolServer
              ? { mcpServers: { sciforge_runtime_tools: agentToolServer } }
              : {}),
            abortController,
            forwardSubagentText: true,
            agentProgressSummaries: true,
            sessionStore: this.sessionStore,
            sessionStoreFlush: 'eager'
          }
        })
      } catch (error) {
        this.turnGovernanceSnapshots.delete(governanceKey)
        throw error
      }
      this.activeTurns.set(payload.threadId, {
        threadId: payload.threadId,
        turnId,
        abortController,
        query,
        assistantItemId
      })
      void this.runClaudeTurn({
        query,
        threadId: payload.threadId,
        turnId,
        assistantItemId,
        startedAtMs: Date.now(),
        fallbackThread: storedThread.guiThreadId
      })
      return { ok: true, threadId: payload.threadId, turnId, userMessageItemId }
    } catch (error) {
      return failure(error)
    }
  }

  async interruptTurn(
    threadId: string,
    turnId: string
  ): Promise<ClaudeCodeTurnMutationResult> {
    try {
      const active = this.activeTurns.get(threadId)
      if (!active || active.turnId !== turnId) return { ok: true }
      this.options.agentTools?.abortTurn?.({ runtimeId: 'claude', threadId, turnId }, 'user_stop')
      active.abortController.abort()
      active.query.close?.()
      await this.completeTurn(threadId, turnId, 'aborted', 'Claude Code turn interrupted.')
      this.activeTurns.delete(threadId)
      this.turnGovernanceSnapshots.delete(turnGovernanceKey(threadId, turnId))
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async steerTurn(): Promise<ClaudeCodeTurnMutationResult> {
    return {
      ok: false,
      message: 'Claude Code CLI runtime does not support steering an active turn.',
      code: 'capability_unavailable',
      recoverable: true
    }
  }

  updateTurnGovernanceSnapshot(input: AgentRuntimeTurnGovernanceSnapshotInput): void {
    if (input.runtimeId !== 'claude') return
    const active = this.activeTurns.get(input.threadId)
    if (!active || active.turnId !== input.turnId) return
    this.turnGovernanceSnapshots.set(
      turnGovernanceKey(input.threadId, input.turnId),
      Object.freeze({ ...input.snapshot })
    )
  }

  async renameThread(threadId: string, title: string): Promise<ClaudeCodeTurnMutationResult> {
    try {
      const thread = await this.threadStore.get(threadId)
      if (!thread) return { ok: true }
      const next = await this.threadStore.upsert({ guiThreadId: threadId, title })
      await this.emit({
        threadId,
        kind: 'thread_lifecycle',
        state: 'updated',
        thread: storedThreadToRuntimeThread(next)
      })
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async deleteThread(threadId: string): Promise<ClaudeCodeTurnMutationResult> {
    try {
      const active = this.activeTurns.get(threadId)
      if (active) {
        active.abortController.abort()
        active.query.close?.()
      }
      this.activeTurns.delete(threadId)
      this.deleteThreadGovernanceSnapshots(threadId)
      await this.threadStore.delete(threadId)
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async archiveThread(threadId: string, archived: boolean): Promise<ClaudeCodeTurnMutationResult> {
    try {
      const thread = await this.threadStore.get(threadId)
      if (!thread) return { ok: true }
      const next = await this.threadStore.upsert({ guiThreadId: threadId, archived })
      await this.emit({
        threadId,
        kind: 'thread_lifecycle',
        state: 'archived',
        thread: storedThreadToRuntimeThread(next)
      })
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async usage(input: AgentRuntimeUsageQuery): Promise<AgentRuntimeUsageResponse> {
    return {
      supported: false,
      reason: 'Claude Code SDK token usage is only available per turn when emitted by the SDK stream.',
      groupBy: input.groupBy,
      buckets: [],
      totals: {}
    }
  }

  async listThreadChildren(input: {
    threadId: string
    parentTurnId?: string
    activeOnly?: boolean
    cursor?: string
    limit?: number
  }): Promise<AgentRuntimeListThreadChildrenResponse> {
    const children = await this.childrenForThread(input.threadId)
    const filtered = filterAgentRuntimeThreadChildren(children, {
      runtimeId: 'claude',
      parentThreadId: input.threadId,
      ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
      ...(input.activeOnly ? { activeOnly: true } : {})
    })
      .slice(0, Math.max(0, Math.floor(input.limit ?? 100)))
    return {
      runtimeId: 'claude',
      threadId: input.threadId,
      ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
      children: filtered
    }
  }

  async readChildTranscript(input: {
    parentThreadId: string
    parentTurnId?: string
    childId: string
    transcriptRef?: unknown
    cursor?: string
    limit?: number
  }): Promise<AgentRuntimeReadChildTranscriptResponse> {
    const children = await this.childrenForThread(input.parentThreadId)
    const child = children.find((candidate) =>
      candidate.id === input.childId &&
      (input.parentTurnId ? candidate.parentTurnId === input.parentTurnId : true)
    )
    const ref = optionalRecord(input.transcriptRef) ?? optionalRecord(child?.transcriptRef) ?? {}
    const metadata = recordValue(ref.metadata)
    const childMetadata = recordValue(child?.metadata)
    const sessionId = firstString(
      metadata.sessionId,
      metadata.session_id,
      ref.sessionId,
      ref.session_id,
      childMetadata.sessionId,
      childMetadata.session_id
    )
    const subpath = firstString(
      metadata.subpath,
      metadata.transcriptSubpath,
      metadata.transcript_subpath,
      ref.subpath,
      ref.transcriptId,
      ref.transcript_id,
      childMetadata.transcriptSubpath,
      childMetadata.transcript_subpath
    ) || transcriptSubpathForAgent(input.childId)
    const transcript = sessionId
      ? await this.sessionStore.readTranscript({ sessionId, subpath })
      : null
    if (!transcript) {
      const childKindLabel = child?.kind === 'workflow' ? 'workflow' : 'subagent'
      return {
        transcript: {
          runtimeId: 'claude',
          parentThreadId: input.parentThreadId,
          ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
          childId: input.childId,
          ...(child ? { child } : {}),
          ...(child?.transcriptRef || Object.keys(ref).length > 0 ? { transcriptRef: child?.transcriptRef ?? ref } : {}),
          entries: degradedChildTranscriptEntries(input.childId, child ?? null),
          summary: child?.summary,
          usage: child?.usage,
          degraded: true,
          reason: sessionId
            ? `Claude ${childKindLabel} transcript ${subpath}.jsonl has not been mirrored yet.`
            : 'Claude child transcript is not available without an SDK session id.'
        }
      }
    }
    const entries = transcript.entries
      .map((entry, index) => transcriptEntryFromSessionStore(entry, index))
      .slice(0, Math.max(0, Math.floor(input.limit ?? 500)))
    return {
      transcript: {
        runtimeId: 'claude',
        parentThreadId: input.parentThreadId,
        ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
        childId: input.childId,
        ...(child ? { child } : {}),
        transcriptRef: child?.transcriptRef ?? transcriptRef({
          childId: input.childId,
          sessionId: transcript.key.sessionId,
          projectKey: transcript.key.projectKey,
          subpath: transcript.key.subpath,
          path: transcript.path
        }),
        entries,
        summary: child?.summary,
        usage: child?.usage,
        metadata: {
          source: 'claude-agent-sdk.sessionStore',
          path: transcript.path,
          projectKey: transcript.key.projectKey,
          sessionId: transcript.key.sessionId,
          subpath: transcript.key.subpath
        }
      }
    }
  }

  async readStoredEvents(threadId: string, sinceSeq = 0): Promise<AgentRuntimeEvent[]> {
    const events = await this.eventStore.read(threadId, { sinceSeq })
    return events.map((event) => event.event)
  }

  async *subscribeEvents(
    threadId: string,
    sinceSeq = 0,
    signal?: AbortSignal
  ): AsyncIterable<AgentRuntimeEvent> {
    let latestSeq = sinceSeq
    const subscriber: ClaudeRuntimeEventSubscriber = {
      threadId,
      queue: [],
      wake: null,
      closed: false
    }
    const onAbort = (): void => {
      subscriber.closed = true
      subscriber.wake?.()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    this.eventSubscribers.add(subscriber)
    try {
      const stored = await this.eventStore.read(threadId, { sinceSeq })
      for (const event of stored) {
        if (signal?.aborted || subscriber.closed) return
        latestSeq = Math.max(latestSeq, event.seq)
        yield event.event
      }
      while (!subscriber.closed && !signal?.aborted) {
        if (subscriber.queue.length === 0) {
          await new Promise<void>((resolve) => {
            subscriber.wake = resolve
          })
          subscriber.wake = null
          continue
        }
        const event = subscriber.queue.shift()
        if (!event) continue
        if (typeof event.seq === 'number' && event.seq <= latestSeq) continue
        if (typeof event.seq === 'number') latestSeq = event.seq
        yield event
      }
    } finally {
      subscriber.closed = true
      signal?.removeEventListener('abort', onAbort)
      this.eventSubscribers.delete(subscriber)
    }
  }

  async runtimeInfo(): Promise<Record<string, unknown>> {
    const settings = await this.options.settings()
    const runtime = settings.agents.claude
    const router = resolveRuntimeModelRouterSettings(settings)
    return {
      host: 'claude-code',
      command: runtime?.command || 'claude',
      configDir: this.options.managedConfigDir || runtime?.configDir || '',
      model: router.model,
      baseUrl: router.baseUrl,
      activeTurns: this.activeTurns.size
    }
  }

  async stop(): Promise<void> {
    for (const active of this.activeTurns.values()) {
      active.abortController.abort()
      active.query.close?.()
    }
    this.activeTurns.clear()
    this.turnGovernanceSnapshots.clear()
    for (const subscriber of this.eventSubscribers) {
      subscriber.closed = true
      subscriber.wake?.()
    }
    this.eventSubscribers.clear()
  }

  private createPreToolUseGovernanceHook(input: {
    threadId: string
    turnId: string
    workspace: string
  }): HookCallback {
    const governor = new ExecutionGovernorCore({ workspace: input.workspace })
    return async (hookInput, toolUseId) => {
      if (hookInput.hook_event_name !== 'PreToolUse') return {}
      const snapshot = this.turnGovernanceSnapshots.get(
        turnGovernanceKey(input.threadId, input.turnId)
      )
      if (!snapshot) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: [
              'native_visual_governance_unavailable:',
              'The Host-owned turn governance snapshot is unavailable, so Claude tool dispatch is denied.'
            ].join(' ')
          }
        }
      }
      const decision = governor.inspectAttempt({
        callId: toolUseId?.trim() || hookInput.tool_use_id.trim(),
        toolName: hookInput.tool_name,
        arguments: recordValue(hookInput.tool_input)
      }, {
        workspace: input.workspace,
        ownedVisualToolsAvailable: snapshot.ownedVisualToolsAvailable,
        nativeVisualProofChainPending: snapshot.nativeVisualProofChainPending
      })
      if (decision.action !== 'deny') return {}
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: [
            `${decision.code ?? 'execution_policy_denied'}: ` +
              `${decision.reason ?? 'Execution governance rejected this tool call.'}`,
            decision.guidance
          ].filter(Boolean).join(' ')
        }
      }
    }
  }

  private deleteThreadGovernanceSnapshots(threadId: string): void {
    const prefix = `${threadId.trim()}\u0000`
    for (const key of this.turnGovernanceSnapshots.keys()) {
      if (key.startsWith(prefix)) this.turnGovernanceSnapshots.delete(key)
    }
  }

  private async runClaudeTurn(options: {
    query: ClaudeAgentSdkQuery
    threadId: string
    turnId: string
    assistantItemId: string
    startedAtMs: number
    fallbackThread: string
  }): Promise<void> {
    const state: ClaudeSdkTurnState = {
      assistantTextSeen: false,
      reasoningDeltaSeen: false,
      firstDeltaEmitted: false,
      terminalState: 'completed',
      partialContentTypes: new Map(),
      toolUses: new Map(),
      pendingToolResults: new Map(),
      toolResultFingerprints: new Map(),
      toolConflicts: new Map()
    }
    try {
      for await (const message of options.query) {
        await this.handleSdkMessage(message, options, state)
      }
      if (this.activeTurns.get(options.threadId)?.turnId !== options.turnId) return
      await this.finalizeToolExecutions(options.threadId, options.turnId, state)
      this.activeTurns.delete(options.threadId)
      this.turnGovernanceSnapshots.delete(turnGovernanceKey(options.threadId, options.turnId))
      await this.completeTurn(options.threadId, options.turnId, state.terminalState, state.terminalMessage)
    } catch (error) {
      if (this.activeTurns.get(options.threadId)?.turnId !== options.turnId) return
      await this.failTurn(options.threadId, options.turnId, error)
    }
  }

  private async handleSdkMessage(
    message: SDKMessage,
    options: {
      threadId: string
      turnId: string
      assistantItemId: string
      startedAtMs: number
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    const record = recordValue(message)
    const sessionId = stringField(record.session_id)
    if (sessionId) {
      await this.threadStore.upsert({
        guiThreadId: options.threadId,
        claudeSessionId: sessionId
      })
    }

    if (message.type === 'assistant') {
      await this.handleAssistantMessage(message, options, state)
      return
    }
    if (message.type === 'user') {
      await this.handleUserMessage(message, options, state)
      return
    }
    if (message.type === 'result') {
      await this.handleResultMessage(message, options, state)
      return
    }
    if (message.type === 'system') {
      await this.handleSystemMessage(message, options, state)
      return
    }
    if (message.type === 'stream_event') {
      await this.handleStreamEvent(message, options, state)
    }
  }

  private async handleAssistantMessage(
    message: Extract<SDKMessage, { type: 'assistant' }>,
    options: {
      threadId: string
      turnId: string
      assistantItemId: string
      startedAtMs: number
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    const messageRecord = recordValue(message.message)
    const usage = extractUsage(messageRecord)
    if (usage) {
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'usage',
        usage
      })
    }

    for (const part of contentParts(messageRecord.content)) {
      if (part.type !== 'tool_use') continue
      const name = stringField(part.name) || 'tool'
      const itemId = stringField(part.id) || `claude-tool-${randomUUID()}`
      const input = recordValue(part.input)
      const existing = state.toolUses.get(itemId)
      if (existing) {
        if (existing.name !== name || stringifyUnknown(existing.input) !== stringifyUnknown(input)) {
          await this.recordToolConflict({
            threadId: options.threadId,
            turnId: options.turnId,
            callId: itemId,
            toolName: existing.name,
            arguments: existing.input,
            message: `Claude reused tool_use_id ${itemId} for a different tool request.`,
            state
          })
        }
        continue
      }
      state.toolUses.set(itemId, {
        name,
        input
      })
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'tool_event',
        itemId,
        status: 'running',
        toolKind: toolKindFromName(name),
        summary: `Claude Code tool: ${name}`,
        detail: stringifyUnknown(part.input),
        meta: {
          name,
          callId: itemId,
          toolName: name,
          arguments: input,
          phase: 'requested',
          factSource: 'model_output',
          evidenceStrength: 'intent'
        }
      })
      const pendingResult = state.pendingToolResults.get(itemId)
      if (pendingResult) {
        state.pendingToolResults.delete(itemId)
        await this.emitToolResult({
          threadId: options.threadId,
          turnId: options.turnId,
          callId: itemId,
          toolUse: { name, input },
          result: pendingResult,
          state
        })
      }
    }

    const reasoningText = reasoningTextFromContent(messageRecord.content)
    if (reasoningText && !state.reasoningDeltaSeen) {
      await this.emitReasoningText(reasoningText, options, state)
    }

    const text = assistantTextFromContent(messageRecord.content)
    if (text) {
      await this.emitAssistantText(text, options, state)
    }
  }

  private async handleStreamEvent(
    message: Extract<SDKMessage, { type: 'stream_event' }>,
    options: {
      threadId: string
      turnId: string
      assistantItemId: string
      startedAtMs: number
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    const record = recordValue(message)
    const event = recordValue(record.event)
    const eventType = stringField(event.type)
    if (eventType === 'content_block_start') {
      const index = numberField(event.index)
      const contentBlock = recordValue(event.content_block)
      const contentType = stringField(contentBlock.type)
      if (typeof index === 'number' && contentType) {
        state.partialContentTypes.set(index, contentType)
      }
      const text = reasoningTextFromPart(contentBlock)
      if (text) await this.emitReasoningText(text, options, state)
      return
    }
    if (eventType !== 'content_block_delta') return
    const index = numberField(event.index)
    const contentType = typeof index === 'number' ? state.partialContentTypes.get(index) : undefined
    const delta = recordValue(event.delta)
    const deltaType = stringField(delta.type)
    if (!isReasoningContentType(deltaType) && !isReasoningContentType(contentType)) return
    const text = reasoningTextFromPart(delta)
    if (text) await this.emitReasoningText(text, options, state)
  }

  private async handleUserMessage(
    message: Extract<SDKMessage, { type: 'user' }>,
    options: {
      threadId: string
      turnId: string
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    const messageRecord = recordValue(message.message)
    for (const part of contentParts(messageRecord.content)) {
      if (part.type !== 'tool_result') continue
      const itemId = stringField(part.tool_use_id) || `claude-tool-${randomUUID()}`
      const toolUse = state.toolUses.get(itemId)
      const payload = firstRecord(
        parseToolResultPayload(part.content),
        recordValue(message.tool_use_result)
      )
      const detail = textFromContent(part.content) || stringifyUnknown(part.content) || ''
      const result: ClaudeToolResult = {
        content: part.content,
        detail,
        isError: part.is_error === true,
        ...(payload ? { payload } : {}),
        ...(stringField(recordValue(message).session_id)
          ? { sessionId: stringField(recordValue(message).session_id) }
          : {}),
        fingerprint: toolResultFingerprint(part.is_error === true, part.content, payload)
      }
      const priorFingerprint = state.toolResultFingerprints.get(itemId) ??
        state.pendingToolResults.get(itemId)?.fingerprint
      if (priorFingerprint) {
        if (priorFingerprint !== result.fingerprint) {
          await this.recordToolConflict({
            threadId: options.threadId,
            turnId: options.turnId,
            callId: itemId,
            toolName: toolUse?.name ?? 'tool',
            arguments: toolUse?.input ?? {},
            message: `Claude emitted conflicting tool results for tool_use_id ${itemId}.`,
            state
          })
        }
        continue
      }
      if (!toolUse) {
        state.pendingToolResults.set(itemId, result)
        continue
      }
      await this.emitToolResult({
        threadId: options.threadId,
        turnId: options.turnId,
        callId: itemId,
        toolUse,
        result,
        state
      })
    }
  }

  private async emitToolResult(input: {
    threadId: string
    turnId: string
    callId: string
    toolUse: { name: string; input: Record<string, unknown> }
    result: ClaudeToolResult
    state: ClaudeSdkTurnState
  }): Promise<void> {
    input.state.toolResultFingerprints.set(input.callId, input.result.fingerprint)
    const nativeExecution = input.result.isError
      ? { effects: [], completionReceipts: [] }
      : nativeAgentToolExecutionMetadata({
          tool: input.toolUse.name,
          value: nativeAgentToolResultValue(input.result.payload, input.toolUse.name)
        }, input.callId)
    const error = input.result.isError
      ? {
          code: 'claude_tool_error',
          message: input.result.detail || `Claude tool ${input.toolUse.name} failed.`
        }
      : null
    const event = {
      threadId: input.threadId,
      turnId: input.turnId,
      kind: 'tool_event' as const,
      itemId: input.callId,
      toolKind: toolKindFromName(input.toolUse.name),
      ...(nativeExecution.effects.length ? { effects: nativeExecution.effects } : {}),
      ...(nativeExecution.completionReceipts.length
        ? { completionReceipts: nativeExecution.completionReceipts }
        : {}),
      summary: `Claude Code tool result: ${input.toolUse.name}`,
      detail: input.result.detail,
      meta: {
        name: input.toolUse.name,
        callId: input.callId,
        toolName: input.toolUse.name,
        arguments: input.toolUse.input,
        phase: input.result.isError ? 'failed' : 'succeeded',
        factSource: 'executor_result',
        evidenceStrength: 'executor_receipt',
        success: !input.result.isError,
        error,
        ...(input.result.payload ? { output: input.result.payload } : {})
      }
    }
    const output = input.result.payload ?? input.result.content
    if (input.result.isError) {
      await this.emit({
        ...event,
        status: 'error',
        receipt: terminalExecutionReceipt('error', output, input.result.detail, {
          errorCode: error?.code
        })
      })
    } else {
      await this.emit({
        ...event,
        status: 'success',
        receipt: terminalExecutionReceipt('success', output, input.result.detail)
      })
    }
    if (input.result.payload) {
      await this.emitChildFromToolResult({
        threadId: input.threadId,
        turnId: input.turnId,
        toolUseId: input.callId,
        toolName: input.toolUse.name,
        toolInput: input.toolUse.input,
        payload: input.result.payload,
        isError: input.result.isError,
        sessionId: input.result.sessionId ?? ''
      })
    }
  }

  private async recordToolConflict(input: {
    threadId: string
    turnId: string
    callId: string
    toolName: string
    arguments: Record<string, unknown>
    message: string
    state: ClaudeSdkTurnState
  }): Promise<void> {
    if (input.state.toolConflicts.has(input.callId)) return
    input.state.toolConflicts.set(input.callId, input.message)
    await this.emit({
      threadId: input.threadId,
      turnId: input.turnId,
      kind: 'tool_event',
      itemId: input.callId,
      status: 'error',
      receipt: terminalExecutionReceipt('error', undefined, input.message, {
        errorCode: 'claude_tool_result_conflict'
      }),
      toolKind: toolKindFromName(input.toolName),
      summary: `Claude Code tool unresolved: ${input.toolName}`,
      detail: input.message,
      meta: {
        callId: input.callId,
        toolName: input.toolName,
        arguments: input.arguments,
        phase: 'unresolved',
        factSource: 'runtime_lifecycle',
        evidenceStrength: 'runtime_lifecycle',
        success: false,
        error: {
          code: 'claude_tool_result_conflict',
          message: input.message
        }
      }
    })
  }

  private async finalizeToolExecutions(
    threadId: string,
    turnId: string,
    state: ClaudeSdkTurnState
  ): Promise<void> {
    const unresolvedMessages: string[] = []
    for (const [callId, toolUse] of state.toolUses) {
      if (state.toolResultFingerprints.has(callId) || state.toolConflicts.has(callId)) continue
      const message = `Claude tool ${toolUse.name} (${callId}) ended without a matching tool_result.`
      unresolvedMessages.push(message)
      await this.emit({
        threadId,
        turnId,
        kind: 'tool_event',
        itemId: callId,
        status: 'error',
        receipt: terminalExecutionReceipt('error', undefined, message, {
          errorCode: 'claude_tool_result_missing'
        }),
        toolKind: toolKindFromName(toolUse.name),
        summary: `Claude Code tool unresolved: ${toolUse.name}`,
        detail: message,
        meta: {
          callId,
          toolName: toolUse.name,
          arguments: toolUse.input,
          phase: 'unresolved',
          factSource: 'runtime_lifecycle',
          evidenceStrength: 'runtime_lifecycle',
          success: false,
          error: {
            code: 'claude_tool_result_missing',
            message
          }
        }
      })
    }
    for (const [callId, result] of state.pendingToolResults) {
      const message = `Claude emitted tool_result ${callId} without a matching tool_use.`
      unresolvedMessages.push(message)
      await this.emit({
        threadId,
        turnId,
        kind: 'tool_event',
        itemId: callId,
        status: 'error',
        receipt: terminalExecutionReceipt(
          'error',
          result.payload ?? result.content,
          result.detail || message,
          { errorCode: 'claude_tool_use_missing' }
        ),
        toolKind: 'tool_call',
        summary: 'Claude Code tool result unresolved',
        detail: result.detail || message,
        meta: {
          callId,
          toolName: 'tool',
          arguments: {},
          phase: 'unresolved',
          factSource: 'executor_result',
          evidenceStrength: 'executor_receipt',
          success: false,
          error: {
            code: 'claude_tool_use_missing',
            message
          },
          ...(result.payload ? { output: result.payload } : {})
        }
      })
    }
    unresolvedMessages.push(...state.toolConflicts.values())
    if (unresolvedMessages.length === 0) return

    const message = `Claude tool execution could not be verified: ${unresolvedMessages.join(' ')}`
    state.terminalState = 'failed'
    state.terminalMessage = state.terminalMessage
      ? `${state.terminalMessage} ${message}`
      : message
    await this.emit({
      threadId,
      turnId,
      kind: 'error',
      itemId: `claude-error-${randomUUID()}`,
      recoverable: false,
      severity: 'error',
      message,
      code: 'claude_tool_execution_unresolved'
    })
  }

  private async handleResultMessage(
    message: Extract<SDKMessage, { type: 'result' }>,
    options: {
      threadId: string
      turnId: string
      assistantItemId: string
      startedAtMs: number
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    const record = recordValue(message)
    const usage = extractUsage(record)
    if (usage) {
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'usage',
        usage
      })
    }
    if (record.is_error === true) {
      const messageText = arrayValue(record.errors).map((entry) => String(entry)).join('; ') ||
        stringField(record.result) ||
        'Claude Code SDK returned an error result.'
      state.terminalState = 'failed'
      state.terminalMessage = messageText
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'error',
        itemId: `claude-error-${randomUUID()}`,
        recoverable: false,
        severity: 'error',
        message: messageText,
        code: stringField(record.subtype) || undefined,
        detail: stringifyUnknown(record)
      })
      return
    }
    const text = stringField(record.result)
    if (text && !state.assistantTextSeen) {
      await this.emitAssistantText(text, options, state)
    }
  }

  private async handleSystemMessage(
    message: Extract<SDKMessage, { type: 'system' }>,
    options: {
      threadId: string
      turnId: string
    },
    _state: ClaudeSdkTurnState
  ): Promise<void> {
    const record = recordValue(message)
    const subtype = stringField(record.subtype)
    if (subtype === 'init') {
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'runtime_status',
        phase: 'initialize_done',
        metadata: {
          sessionId: stringField(record.session_id),
          claudeCodeVersion: stringField(record.claude_code_version),
          model: stringField(record.model),
          permissionMode: stringField(record.permissionMode),
          cwd: stringField(record.cwd),
          tools: arrayValue(record.tools).filter((tool): tool is string => typeof tool === 'string')
        }
      })
      return
    }
    if (
      subtype === 'task_started' ||
      subtype === 'task_progress' ||
      subtype === 'task_updated' ||
      subtype === 'task_notification'
    ) {
      const child = await this.childFromTaskMessage(record, options.threadId, options.turnId)
      if (child) await this.emitChild(child)
      return
    }
    if (subtype === 'mirror_error') {
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'runtime_status',
        phase: 'tool_running',
        message: stringField(record.error) || 'Claude transcript mirror failed.',
        metadata: {
          severity: 'warning',
          key: record.key
        }
      })
    }
  }

  private async emitAssistantText(
    text: string,
    options: {
      threadId: string
      turnId: string
      assistantItemId: string
      startedAtMs: number
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    state.assistantTextSeen = true
    await this.emit({
      threadId: options.threadId,
      turnId: options.turnId,
      kind: 'assistant_delta',
      itemId: options.assistantItemId,
      text
    })
    if (!state.firstDeltaEmitted) {
      state.firstDeltaEmitted = true
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'runtime_status',
        phase: 'first_delta',
        latencyMs: Date.now() - options.startedAtMs
      })
    }
  }

  private async emitReasoningText(
    text: string,
    options: {
      threadId: string
      turnId: string
      assistantItemId: string
      startedAtMs: number
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    state.reasoningDeltaSeen = true
    await this.emit({
      threadId: options.threadId,
      turnId: options.turnId,
      kind: 'reasoning_delta',
      itemId: `${options.assistantItemId}-reasoning`,
      text,
      visibility: 'summary',
      source: 'model'
    })
    if (!state.firstDeltaEmitted) {
      state.firstDeltaEmitted = true
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'runtime_status',
        phase: 'first_delta',
        latencyMs: Date.now() - options.startedAtMs
      })
    }
  }

  private async emitChildFromToolResult(input: {
    threadId: string
    turnId: string
    toolUseId: string
    toolName: string
    toolInput: Record<string, unknown>
    payload: Record<string, unknown>
    isError: boolean
    sessionId: string
  }): Promise<void> {
    if (isClaudeAgentToolName(input.toolName)) {
      await this.emitChild(await this.childFromAgentToolResult(input))
      return
    }
    if (isClaudeWorkflowToolName(input.toolName)) {
      await this.emitChild(await this.childFromWorkflowToolResult(input))
    }
  }

  private async childFromAgentToolResult(input: {
    threadId: string
    turnId: string
    toolUseId: string
    toolInput: Record<string, unknown>
    payload: Record<string, unknown>
    isError: boolean
    sessionId: string
  }): Promise<AgentRuntimeChild> {
    const agentId = firstString(
      input.payload.agentId,
      input.payload.agent_id,
      input.payload.taskId,
      input.payload.task_id,
      input.payload.id,
      input.toolInput.agentId,
      input.toolInput.agent_id,
      input.toolInput.taskId,
      input.toolInput.task_id
    ) || input.toolUseId
    const agentType = firstString(
      input.payload.agentType,
      input.payload.agent_type,
      input.payload.subagentType,
      input.payload.subagent_type,
      input.payload.name,
      input.toolInput.agentType,
      input.toolInput.agent_type,
      input.toolInput.subagentType,
      input.toolInput.subagent_type,
      input.toolInput.name
    )
    const prompt = firstString(
      input.payload.prompt,
      input.payload.instructions,
      input.payload.description,
      input.toolInput.prompt,
      input.toolInput.instructions,
      input.toolInput.description
    )
    const status = childStatus(input.payload.status, input.isError ? 'failed' : 'completed')
    const totalTokens = numberField(input.payload.totalTokens) ||
      numberField(input.payload.total_tokens)
    const usage = usageFromRecord(input.payload.usage, totalTokens)
    const outputFile = stringField(input.payload.outputFile) ||
      stringField(input.payload.output_file)
    const summary = firstString(
      input.payload.summary,
      input.payload.output,
      input.payload.text,
      input.payload.message
    ) || outputFile
    const subpath = firstString(
      input.payload.transcriptSubpath,
      input.payload.transcript_subpath,
      input.payload.subpath,
      input.toolInput.transcriptSubpath,
      input.toolInput.transcript_subpath,
      input.toolInput.subpath
    ) || transcriptSubpathForAgent(agentId)
    return {
      id: agentId,
      runtimeId: 'claude',
      parentThreadId: input.threadId,
      parentTurnId: input.turnId,
      kind: 'agent',
      status,
      ...(agentType ? { name: agentType, label: agentType } : {}),
      ...(prompt ? { prompt } : {}),
      ...(usage ? { usage } : {}),
      ...(summary ? { summary } : {}),
      transcriptRef: transcriptRef({
        childId: agentId,
        sessionId: input.sessionId,
        subpath
      }),
      updatedAt: new Date().toISOString(),
      ...(status === 'completed' || status === 'failed' || status === 'aborted'
        ? { completedAt: new Date().toISOString() }
        : {}),
      metadata: {
        source: 'claude.Agent',
        toolUseId: input.toolUseId,
        agentId,
        ...(agentType ? { agentType } : {}),
        ...(outputFile ? { outputFile } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId, transcriptSubpath: subpath } : {})
      }
    }
  }

  private async childFromWorkflowToolResult(input: {
    threadId: string
    turnId: string
    toolUseId: string
    toolInput: Record<string, unknown>
    payload: Record<string, unknown>
    isError: boolean
    sessionId: string
  }): Promise<AgentRuntimeChild> {
    const taskId = firstString(input.payload.taskId, input.payload.task_id, input.toolInput.taskId, input.toolInput.task_id)
    const runId = firstString(input.payload.runId, input.payload.run_id, input.toolInput.runId, input.toolInput.run_id)
    const workflowName = firstString(
      input.payload.workflowName,
      input.payload.workflow_name,
      input.payload.name,
      input.toolInput.workflowName,
      input.toolInput.workflow_name,
      input.toolInput.name
    )
    const prompt = firstString(input.payload.prompt, input.payload.instructions, input.toolInput.prompt, input.toolInput.instructions)
    const summary = firstString(input.payload.summary, input.payload.output, input.payload.text, input.payload.message)
    const transcriptDir = firstString(
      input.payload.transcriptDir,
      input.payload.transcript_dir,
      input.payload.transcriptPath,
      input.payload.transcript_path,
      input.payload.path
    )
    const scriptPath = firstString(input.payload.scriptPath, input.payload.script_path)
    const status = childStatus(input.payload.status, input.isError ? 'failed' : 'completed')
    const usage = usageFromRecord(input.payload.usage, numberField(input.payload.totalTokens) || numberField(input.payload.total_tokens))
    return {
      id: runId || taskId || input.toolUseId,
      runtimeId: 'claude',
      parentThreadId: input.threadId,
      parentTurnId: input.turnId,
      kind: 'workflow',
      status,
      ...(workflowName ? { name: workflowName, label: workflowName } : {}),
      ...(prompt ? { prompt } : {}),
      ...(summary ? { summary } : {}),
      ...(usage ? { usage } : {}),
      ...(transcriptDir ? {
        transcriptRef: transcriptRef({
          childId: runId || taskId || input.toolUseId,
          sessionId: input.sessionId,
          source: 'claude.Workflow',
          path: transcriptDir,
          kind: 'directory'
        })
      } : {}),
      updatedAt: new Date().toISOString(),
      ...(status === 'completed' || status === 'failed' || status === 'aborted'
        ? { completedAt: new Date().toISOString() }
        : {}),
      metadata: {
        source: 'claude.Workflow',
        toolUseId: input.toolUseId,
        ...(taskId ? { taskId } : {}),
        ...(runId ? { runId } : {}),
        ...(workflowName ? { workflowName } : {}),
        ...(transcriptDir ? { transcriptDir } : {}),
        ...(scriptPath ? { scriptPath } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {})
      }
    }
  }

  private async childFromTaskMessage(
    record: Record<string, unknown>,
    threadId: string,
    turnId: string
  ): Promise<AgentRuntimeChild | null> {
    const subtype = stringField(record.subtype)
    const taskId = firstString(record.taskId, record.task_id, record.id)
    if (!taskId) return null
    const sessionId = firstString(record.sessionId, record.session_id)
    const workflowName = firstString(record.workflowName, record.workflow_name)
    const subagentType = firstString(record.subagentType, record.subagent_type, record.agentType, record.agent_type)
    const taskType = firstString(record.taskType, record.task_type)
    const isWorkflow = taskType === 'local_workflow' || taskType === 'workflow' || Boolean(workflowName)
    const status = subtype === 'task_notification'
      ? childStatus(record.status, 'completed')
      : subtype === 'task_updated'
        ? childStatus(recordValue(record.patch).status ?? recordValue(record.patch).state, 'running')
        : 'running'
    const usageRecord = recordValue(record.usage)
    const transcriptPath = firstString(record.transcriptPath, record.transcript_path)
    const transcriptDir = firstString(record.transcriptDir, record.transcript_dir)
    const subpath = firstString(record.transcriptSubpath, record.transcript_subpath, record.subpath) ||
      (!isWorkflow ? transcriptSubpathForAgent(taskId) : '')
    const prompt = firstString(record.prompt, record.description, record.instructions)
    const summary = firstString(record.summary, record.output, record.message, record.text)
    const usage = usageFromRecord(usageRecord, numberField(usageRecord.total_tokens) || numberField(usageRecord.totalTokens))
    return {
      id: taskId,
      runtimeId: 'claude',
      parentThreadId: threadId,
      parentTurnId: turnId,
      kind: isWorkflow ? 'workflow' : 'agent',
      status,
      ...(workflowName || subagentType ? {
        name: workflowName || subagentType,
        label: workflowName || subagentType
      } : {}),
      ...(prompt ? { prompt } : {}),
      ...(summary ? { summary } : {}),
      ...(usage ? { usage } : {}),
      ...(!isWorkflow && sessionId ? {
        transcriptRef: transcriptRef({
          childId: taskId,
          sessionId,
          subpath
        })
      } : {}),
      ...(isWorkflow && (transcriptDir || transcriptPath) ? {
        transcriptRef: transcriptRef({
          childId: taskId,
          sessionId,
          source: 'claude.Workflow',
          path: transcriptDir || transcriptPath,
          kind: transcriptDir ? 'directory' : 'file'
        })
      } : {}),
      updatedAt: new Date().toISOString(),
      ...(status === 'completed' || status === 'failed' || status === 'aborted'
        ? { completedAt: new Date().toISOString() }
        : {}),
      metadata: {
        source: `claude-agent-sdk.${subtype}`,
        taskId,
        ...(firstString(record.toolUseId, record.tool_use_id) ? { toolUseId: firstString(record.toolUseId, record.tool_use_id) } : {}),
        ...(taskType ? { taskType } : {}),
        ...(subagentType ? { agentType: subagentType } : {}),
        ...(workflowName ? { workflowName } : {}),
        ...(firstString(record.outputFile, record.output_file) ? { outputFile: firstString(record.outputFile, record.output_file) } : {}),
        ...(transcriptDir ? { transcriptDir } : {}),
        ...(transcriptPath ? { transcriptPath } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(!isWorkflow && subpath ? { transcriptSubpath: subpath } : {})
      }
    }
  }

  private async emitChild(child: AgentRuntimeChild): Promise<void> {
    const normalized = normalizeClaudeChild(child, child.parentThreadId)
    if (!normalized) return
    const key = childStateKey(normalized.parentThreadId, normalized.id)
    const existing = this.childState.get(key) ?? await this.latestStoredChild(normalized.parentThreadId, normalized.id)
    const next = mergeChild(existing, normalized)
    this.childState.set(key, next)
    await this.emit({
      threadId: next.parentThreadId,
      turnId: next.parentTurnId,
      kind: 'child_event',
      child: next
    })
  }

  private async latestStoredChild(threadId: string, childId: string): Promise<AgentRuntimeChild | null> {
    return (await this.childrenForThread(threadId)).find((child) => child.id === childId) ?? null
  }

  private async childrenForThread(threadId: string): Promise<AgentRuntimeChild[]> {
    const storedEvents = await this.eventStore.read(threadId, { includeAll: true })
    const children = new Map<string, AgentRuntimeChild>()
    for (const stored of storedEvents) {
      const event = stored.event
      if (event.kind !== 'child_event') continue
      const child = normalizeClaudeChild(event.child, threadId)
      if (!child) continue
      children.set(child.id, mergeChild(children.get(child.id), child))
    }
    return [...children.values()]
      .filter((child) => child.parentThreadId === threadId)
      .sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt ?? '') - Date.parse(a.updatedAt ?? a.createdAt ?? ''))
  }

  private async completeTurn(
    threadId: string,
    turnId: string,
    state: Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }>['state'],
    message?: string
  ): Promise<void> {
    const status = turnStatusFromLifecycle(state)
    const latestSeq = await this.eventStore.latestSeq(threadId)
    await this.threadStore.upsert({
      guiThreadId: threadId,
      latestSeq,
      latestTurnId: turnId,
      latestTurnStatus: status
    })
    await this.emit({
      threadId,
      turnId,
      kind: 'runtime_status',
      phase: 'turn_done',
      message
    })
    await this.emit({
      threadId,
      turnId,
      kind: 'turn_lifecycle',
      state,
      message
    })
  }

  private async failTurn(threadId: string, turnId: string, error: unknown): Promise<void> {
    if (this.activeTurns.get(threadId)?.turnId === turnId) {
      this.activeTurns.delete(threadId)
    }
    this.turnGovernanceSnapshots.delete(turnGovernanceKey(threadId, turnId))
    const message = error instanceof Error ? error.message : String(error)
    await this.emit({
      threadId,
      turnId,
      kind: 'error',
      itemId: `claude-error-${randomUUID()}`,
      recoverable: false,
      severity: 'error',
      message,
      code: (error as NodeJS.ErrnoException)?.code
    })
    await this.completeTurn(threadId, turnId, 'failed', message)
  }

  private async emit(event: AgentRuntimeEvent): Promise<ClaudeCodeStoredEvent> {
    const stored = await this.eventStore.append(event.threadId, event)
    const latestSeq = stored.seq
    const thread = await this.threadStore.get(stored.threadId)
    if (thread) {
      await this.threadStore.upsert({
        guiThreadId: stored.threadId,
        latestSeq
      })
    }
    for (const subscriber of this.eventSubscribers) {
      if (subscriber.closed || subscriber.threadId !== stored.threadId) continue
      subscriber.queue.push(stored.event)
      subscriber.wake?.()
    }
    return stored
  }
}

function requireClaudeRuntimeSelected(settings: AppSettingsV1): void {
  if (!resolveModelAccessRuntimePolicy(settings).claude) {
    throw new Error(
      'Claude Code requires API model access and must be the selected Agent runtime.'
    )
  }
}

function extractUsage(record: Record<string, unknown>): AgentRuntimeUsage | null {
  const message = recordValue(record.message)
  return usageFromRecord(record.usage, 0) ?? usageFromRecord(message.usage, 0) ?? null
}

function usageFromRecord(value: unknown, fallbackTotalTokens: number): AgentRuntimeUsage | undefined {
  const source = optionalRecord(value)
  const inputTokens = source
    ? numberField(source.inputTokens) || numberField(source.input_tokens)
    : 0
  const outputTokens = source
    ? numberField(source.outputTokens) || numberField(source.output_tokens)
    : 0
  const cacheReadTokens = source
    ? numberField(source.cacheReadTokens) || numberField(source.cache_read_input_tokens)
    : 0
  const cacheWriteTokens = source
    ? numberField(source.cacheWriteTokens) || numberField(source.cache_creation_input_tokens)
    : 0
  const totalTokens = source
    ? numberField(source.totalTokens) || numberField(source.total_tokens)
    : 0
  const computedTotal = totalTokens || fallbackTotalTokens ||
    inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  if (computedTotal <= 0) return undefined
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: computedTotal
  }
}

function contentParts(content: unknown): Record<string, unknown>[] {
  if (!Array.isArray(content)) return []
  return content.filter(isRecord)
}

function parseToolResultPayload(content: unknown): Record<string, unknown> {
  if (isRecord(content)) return content
  const text = textFromContent(content).trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    return recordValue(parsed)
  } catch {
    return {}
  }
}

function nativeAgentToolResultValue(
  payload: Record<string, unknown> | undefined,
  toolName: string
): unknown {
  if (!payload) return undefined
  return payload.tool === toolName && Object.prototype.hasOwnProperty.call(payload, 'value')
    ? payload.value
    : payload
}

function firstRecord(...records: Record<string, unknown>[]): Record<string, unknown> | null {
  return records.find((record) => Object.keys(record).length > 0) ?? null
}

function isClaudeAgentToolName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return normalized === 'agent' || normalized === 'task' || normalized === 'subagent'
}

function isClaudeWorkflowToolName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return normalized === 'workflow' || normalized === 'local_workflow'
}

function childStatus(value: unknown, fallback: AgentRuntimeChildStatus): AgentRuntimeChildStatus {
  const normalized = stringField(value).toLowerCase()
  if (
    normalized === 'queued' ||
    normalized === 'running' ||
    normalized === 'completed' ||
    normalized === 'failed' ||
    normalized === 'aborted' ||
    normalized === 'unknown'
  ) {
    return normalized
  }
  if (normalized === 'pending') return 'queued'
  if (normalized === 'started' || normalized === 'in_progress' || normalized === 'inprogress') return 'running'
  if (normalized === 'success' || normalized === 'succeeded' || normalized === 'complete' || normalized === 'done') {
    return 'completed'
  }
  if (normalized === 'error' || normalized === 'declined') return 'failed'
  if (normalized === 'killed' || normalized === 'stopped' || normalized === 'cancelled' || normalized === 'canceled') return 'aborted'
  return fallback
}

function transcriptSubpathForAgent(agentId: string): string {
  const normalized = agentId.trim()
  return `subagents/agent-${normalized || 'unknown'}`
}

function degradedChildTranscriptEntries(
  childId: string,
  child: AgentRuntimeChild | null
): AgentRuntimeChildTranscriptEntry[] {
  if (!child) return []
  const entries: AgentRuntimeChildTranscriptEntry[] = []
  if (child.prompt) {
    entries.push({
      id: `${childId}-prompt`,
      kind: 'user_message',
      text: child.prompt
    })
  }
  if (child.summary) {
    entries.push({
      id: `${childId}-summary`,
      kind: 'assistant_message',
      text: child.summary
    })
  }
  return entries
}

function transcriptRef(input: {
  childId: string
  sessionId?: string
  projectKey?: string
  subpath?: string
  source?: string
  path?: string
  kind?: 'file' | 'directory'
}): NonNullable<AgentRuntimeChild['transcriptRef']> {
  const kind = input.kind ?? 'file'
  const subpath = input.subpath?.trim()
  const path = input.path || (subpath ? `${subpath}.jsonl` : undefined)
  return {
    id: subpath || input.childId,
    kind,
    label: kind === 'directory' ? 'Claude workflow transcript' : 'Claude subagent transcript',
    ...(path ? { path } : {}),
    mimeType: kind === 'file' ? 'application/jsonl' : undefined,
    runtimeId: 'claude',
    childId: input.childId,
    transcriptId: subpath || input.childId,
    source: input.source ?? 'claude-agent-sdk.sessionStore',
    metadata: {
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.projectKey ? { projectKey: input.projectKey } : {}),
      ...(subpath ? { subpath } : {}),
      ...(path ? { path } : {})
    }
  } as NonNullable<AgentRuntimeChild['transcriptRef']>
}

function transcriptEntryFromSessionStore(
  entry: SessionStoreEntry,
  index: number
): AgentRuntimeChildTranscriptEntry {
  const message = recordValue(entry.message)
  const text = textFromContent(message.content) ||
    stringField(entry.content) ||
    stringField(entry.text) ||
    stringField(entry.summary)
  return {
    id: stringField(entry.uuid) || `entry-${index + 1}`,
    kind: transcriptEntryKind(entry.type),
    ...(text ? { text } : {}),
    ...(stringField(entry.summary) ? { summary: stringField(entry.summary) } : {}),
    createdAt: stringField(entry.timestamp) || undefined,
    metadata: entry
  }
}

function transcriptEntryKind(type: unknown): AgentRuntimeChildTranscriptEntry['kind'] {
  const normalized = stringField(type).toLowerCase()
  if (normalized === 'user') return 'user_message'
  if (normalized === 'assistant') return 'assistant_message'
  if (normalized.includes('tool')) return 'tool'
  if (normalized.includes('reasoning') || normalized.includes('thinking')) return 'reasoning'
  if (normalized === 'system') return 'system'
  return 'event'
}

function normalizeClaudeChild(value: unknown, fallbackParentThreadId: string): AgentRuntimeChild | null {
  const record = recordValue(value)
  const id = firstString(record.id, record.childId, record.child_id, record.taskId, record.task_id)
  const parentThreadId = firstString(record.parentThreadId, record.parent_thread_id, fallbackParentThreadId)
  if (!id || !parentThreadId) return null
  const parentTurnId = firstString(record.parentTurnId, record.parent_turn_id, record.turnId, record.turn_id)
  return {
    ...(value && typeof value === 'object' && !Array.isArray(value) ? value as AgentRuntimeChild : {}),
    id,
    runtimeId: 'claude',
    parentThreadId,
    ...(parentTurnId ? { parentTurnId } : {}),
    kind: claudeChildKind(record.kind),
    status: childStatus(record.status, 'unknown')
  }
}

function claudeChildKind(value: unknown): AgentRuntimeChild['kind'] {
  if (value === 'workflow' || value === 'thread' || value === 'remote') return value
  return 'agent'
}

function childStateKey(threadId: string, childId: string): string {
  return `${threadId}\n${childId}`
}

function mergeChild(
  previous: AgentRuntimeChild | null | undefined,
  next: AgentRuntimeChild
): AgentRuntimeChild {
  return {
    ...previous,
    ...next,
    usage: next.usage ?? previous?.usage,
    transcriptRef: next.transcriptRef ?? previous?.transcriptRef,
    openAsThreadRef: next.openAsThreadRef ?? previous?.openAsThreadRef,
    metadata: {
      ...(previous?.metadata ?? {}),
      ...(next.metadata ?? {})
    }
  }
}

function firstLineTitle(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.trim().slice(0, 80) || 'Claude Code thread'
}

function turnStatusFromLifecycle(
  state: Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }>['state']
): AgentRuntimeTurn['status'] {
  if (state === 'completed') return 'completed'
  if (state === 'failed') return 'failed'
  if (state === 'aborted') return 'aborted'
  if (state === 'steered') return 'steered'
  return 'running'
}

function toolKindFromName(name: string): 'tool_call' | 'command_execution' | 'file_change' {
  const normalized = name.toLowerCase()
  if (normalized.includes('bash') || normalized.includes('command')) return 'command_execution'
  if (normalized.includes('edit') || normalized.includes('write') || normalized.includes('file')) return 'file_change'
  return 'tool_call'
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part)) return ''
      return stringField(part.text) ||
        stringField(part.content) ||
        stringField(recordValue(part.input).prompt) ||
        stringField(recordValue(part.input).description)
    })
    .filter(Boolean)
    .join('\n')
}

function assistantTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part) || isReasoningContentType(stringField(part.type))) return ''
      return stringField(part.text) ||
        stringField(part.content) ||
        stringField(recordValue(part.input).prompt) ||
        stringField(recordValue(part.input).description)
    })
    .filter(Boolean)
    .join('\n')
}

function reasoningTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => isRecord(part) ? reasoningTextFromPart(part) : '')
    .filter(Boolean)
    .join('\n')
}

function reasoningTextFromPart(part: Record<string, unknown>): string {
  if (!isReasoningContentType(stringField(part.type))) return ''
  return stringField(part.thinking) ||
    stringField(part.reasoning) ||
    stringField(part.summary) ||
    stringField(part.text) ||
    stringField(part.content)
}

function isReasoningContentType(type: string | undefined): boolean {
  const normalized = type?.trim().toLowerCase()
  if (!normalized) return false
  if (normalized.includes('redacted')) return false
  return normalized.includes('thinking') || normalized.includes('reasoning')
}

function failure(error: unknown, defaultCode = 'claude_runtime_error'): ClaudeCodeRuntimeFailure {
  const message = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    message,
    code: (error as NodeJS.ErrnoException)?.code || defaultCode,
    recoverable: true
  }
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function toolResultFingerprint(
  isError: boolean,
  content: unknown,
  payload?: Record<string, unknown> | null
): string {
  return [
    isError ? 'error' : 'success',
    stringifyUnknown(content) ?? '',
    stringifyUnknown(payload) ?? ''
  ].join('\n')
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringField(value)
    if (text) return text
  }
  return ''
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function recordValue(value: unknown): Record<string, unknown> {
  return optionalRecord(value) ?? {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
