import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import type {
  AgentRuntimeEvent,
  AgentRuntimeThread,
  AgentRuntimeThreadPage,
  AgentRuntimeThreadStatus,
  AgentRuntimeTurn,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStatus,
  AgentRuntimeUsage
} from '../../../shared/agent-runtime-contract'
import { atomicWriteAppDataJsonAtPath } from '../../services/app-data-store'
import { logWarn } from '../../logger'
import { createExecutionReceipt } from '@sciforge/execution-governance'
import {
  filterAgentRuntimeToolSurface,
  type AgentRuntimeToolSurface
} from '../agent-runtime/agent-tool-surface'
import {
  createAgentRuntimeMcpToolLease,
  type AgentRuntimeMcpToolLease
} from '../agent-runtime/agent-runtime-mcp-tool-lease'
import { createAgentRuntimeMcpSessionEndpoint } from '../agent-runtime/agent-runtime-mcp-session-endpoint'
import { ensurePiHostExtension, writePiToolManifest } from './pi-host-extension'
import { PI_CONVERSATION_ARGS, PI_TOOL_SESSION_BASE_ARGS, PiRpcClient, type PiRpcRecord } from './pi-rpc-client'
import { withNodeShimCompat } from './pi-runtime-probe'

/**
 * Pi conversation-stage service: one RPC process per thread, text only.
 *
 * Turn semantics (verified on the wire against pi-coding-agent@1.4.0):
 * - A `prompt` response with `disposition:"started"` means PROMPT ACCEPTED —
 *   nothing about completion. Completion is only decided at `agent_settled`:
 *   `aborted:true` -> aborted; otherwise the final assistant message's
 *   `stopReason === "error"` or any `error` record -> failed; else completed.
 *   `agent_settled` alone never maps to success.
 * - `abort` answers `{success:true}` immediately, then the run still drains
 *   through message_end/turn_end/agent_end before `agent_settled{aborted:true}`.
 *   An abort response is therefore NOT proof the turn stopped.
 * - Process exit before `agent_settled` is a crash: the adapter synthesizes a
 *   failed terminal event itself, because no genuine one will arrive.
 *
 * Session persistence (verified on the wire against 1.4.0):
 * - Without `--no-session`, pi writes a JSONL session file under the directory
 *   given by `--session-dir`; `get_state` reports `sessionFile`/`sessionId`.
 * - `--session <file>` resumes with the same sessionId and the model really
 *   receives the prior context (verified: model recalled a codeword).
 * - Resume survives a force-killed process; the session file persists.
 * - `--session <missing file>` SILENTLY starts a new empty session at that
 *   path (new sessionId). We therefore always verify the resumed sessionId
 *   against the recorded one and fail loudly on mismatch.
 * - `--session <corrupt file>` exits code 1 with a stderr error; surfaced as
 *   a resume failure, never as a fresh empty thread.
 *
 * Session files live exclusively in the host-managed private storage root
 * (userData/pi-runtime); the user's own ~/.pi sessions are never read or
 * written. Model/provider config still comes from the operator's pi config.
 *
 * Tool bridge (host extension + per-turn lease), when `toolSurface` is set:
 * - Pi launches with the probe-verified tool-session arguments
 *   (PI_TOOL_SESSION_BASE_ARGS) plus `-e <host extension>` and an exact
 *   `--tools` whitelist snapshotted from the Host surface. The host extension
 *   replaces pi's built-in MCP support, so user mcp.json servers are never
 *   connected; built-in bash/edit/write, skills and context files stay off.
 * - Each turn creates one exact Host tool lease (broker -> approval -> trace
 *   all stay on the existing neutral path) and binds it to the thread's
 *   session endpoint only AFTER the Host durability ack; before that bind the
 *   endpoint answers 410 (fail-closed). Turn terminal, interrupt, dispatch
 *   failure, delete and close all revoke + unbind the lease.
 * - Pi's native approvals stay disabled (`--no-approve`): capability
 *   approvals are mediated inside the broker call path by the existing Host
 *   approval UI, so no adapter-side approval protocol is involved.
 * Without `toolSurface` the service stays text-only: tools, MCP, extensions,
 * skills and context files are all disabled (PI_CONVERSATION_ARGS).
 */

const PROMPT_TIMEOUT_MS = 30_000

type PiTurnState = {
  turnId: string
  userItemId: string
  assistantItemId: string
  startedAt: string
  status: AgentRuntimeTurnStatus
  userText: string
  assistantText: string
  stopReason?: string
  errorMessage?: string
  usage?: AgentRuntimeUsage
}

type PiThreadLease = {
  turnId: string
  lease: AgentRuntimeMcpToolLease
  controller: AbortController
  state: { revoked: boolean }
}

type PiMcpSessionEndpoint = Awaited<ReturnType<typeof createAgentRuntimeMcpSessionEndpoint>>

type PiOpenToolCall = {
  turnId: string
  name: string
  args: Record<string, unknown>
}

type PiThreadRuntime = {
  id: string
  title: string
  workspace?: string
  model?: string
  createdAt: string
  updatedAt: string
  /** Pi-native session identity, captured from get_state after first launch. */
  sessionId?: string
  sessionFile?: string
  client?: PiRpcClient
  /** Tool bridge: per-thread stable endpoint; a turn lease binds onto it. */
  endpoint?: PiMcpSessionEndpoint
  lease?: PiThreadLease
  toolNames?: readonly string[]
  /** Tool calls seen in the stream but not yet terminated (in-memory only). */
  openToolCalls: Map<string, PiOpenToolCall>
  seq: number
  log: AgentRuntimeEvent[]
  /** Whether the on-disk event journal has been replayed into `log`. */
  journalLoaded: boolean
  turns: Map<string, PiTurnState>
  turnOrder: string[]
  activeTurnId?: string
  closed: boolean
  notify: Set<() => void>
  /** Serializes record/journal writes for this thread. */
  writeQueue: Promise<void>
}

/** Durable on-disk form of a thread, stored at <storageRoot>/threads/<id>.json */
type PiPersistedThread = {
  id: string
  title: string
  workspace?: string
  model?: string
  createdAt: string
  updatedAt: string
  sessionId?: string
  sessionFile?: string
  seq: number
  turns: PiTurnState[]
  turnOrder: string[]
}

export type PiRuntimeServiceOptions = Readonly<{
  executablePath: string
  workspace?: string
  env?: NodeJS.ProcessEnv
  /**
   * Host-managed private storage root (e.g. userData/pi-runtime). When set,
   * threads, event journals and pi session files persist across restarts and
   * threads resume with `--session`. When absent, sessions are ephemeral.
   */
  storageRoot?: string
  /**
   * Canonical Host tool surface. When set (requires storageRoot), pi launches
   * with the host extension bridge and every turn runs under an exact Host
   * tool lease; when absent the service stays text-only.
   */
  toolSurface?: AgentRuntimeToolSurface
  /** Test hook: override the prompt dispatch timeout (default 30s). */
  promptTimeoutMs?: number
  /** Test hook: override the post-failure quiesce grace (default 10s). */
  quiesceTimeoutMs?: number
  /** Test hook: replace process spawning. */
  spawnClient?: (options: {
    executablePath: string
    args: readonly string[]
    cwd: string
    env: NodeJS.ProcessEnv
  }) => PiRpcClient
}>

function runtimeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** Distributive Omit: preserves the AgentRuntimeEvent discriminated union. */
type EventDraft =
  AgentRuntimeEvent extends infer E
    ? E extends AgentRuntimeEvent
      ? Omit<E, 'threadId' | 'runtimeId' | 'seq' | 'createdAt'> & { threadId?: string }
      : never
    : never

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

function mapUsage(raw: unknown): AgentRuntimeUsage | undefined {
  const usage = asRecord(raw)
  if (!usage) return undefined
  const mapped: AgentRuntimeUsage = {
    inputTokens: typeof usage.input === 'number' ? usage.input : undefined,
    outputTokens: typeof usage.output === 'number' ? usage.output : undefined,
    totalTokens: typeof usage.totalTokens === 'number' ? usage.totalTokens : undefined,
    cacheReadTokens: typeof usage.cacheRead === 'number' ? usage.cacheRead : undefined,
    cacheWriteTokens: typeof usage.cacheWrite === 'number' ? usage.cacheWrite : undefined
  }
  return Object.values(mapped).some((value) => value !== undefined) ? mapped : undefined
}

function safeSegment(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** Extract the bounded text payload of a pi tool result ({content:[{type,text}]}). */
function piToolResultText(result: unknown): string {
  const content = asRecord(result)?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      const record = asRecord(part)
      return record?.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 4 * 1_024)
}

export class PiRuntimeService {
  private readonly threads = new Map<string, PiThreadRuntime>()
  private registryLoaded = false

  constructor(private readonly options: PiRuntimeServiceOptions) {}

  private get threadsDir(): string {
    return join(this.options.storageRoot ?? '', 'threads')
  }

  private get eventsDir(): string {
    return join(this.options.storageRoot ?? '', 'events')
  }

  private get sessionsDir(): string {
    return join(this.options.storageRoot ?? '', 'sessions')
  }

  private get hostDir(): string {
    return join(this.options.storageRoot ?? '', 'host')
  }

  private get toolsEnabled(): boolean {
    return Boolean(this.options.toolSurface)
  }

  private hostExtensionPath?: string

  private launchArgs(thread: PiThreadRuntime): string[] {
    const base = this.toolsEnabled
      ? [
          ...PI_TOOL_SESSION_BASE_ARGS,
          '-e', this.hostExtensionPath!,
          // An empty whitelist would leave `--tools` dangling; an explicit
          // `--no-tools` is the fail-closed form of "no tools this session".
          ...(thread.toolNames?.length ? ['--tools', thread.toolNames.join(',')] : ['--no-tools'])
        ]
      : [...PI_CONVERSATION_ARGS]
    if (!this.options.storageRoot) return [...base, '--no-session']
    const args = [...base, '--session-dir', this.sessionsDir]
    if (thread.sessionFile) args.push('--session', thread.sessionFile)
    return args
  }

  private spawnFor(thread: PiThreadRuntime, cwd: string, extraEnv?: NodeJS.ProcessEnv): PiRpcClient {
    const args = this.launchArgs(thread)
    const env = withNodeShimCompat({ ...(this.options.env ?? process.env), ...extraEnv })
    const spawnClient = this.options.spawnClient
    if (spawnClient) return spawnClient({ executablePath: this.options.executablePath, args, cwd, env })
    return PiRpcClient.spawn({
      executablePath: this.options.executablePath,
      args,
      cwd,
      env
    })
  }

  /**
   * Prepare the tool bridge for a spawn: host extension, manifest snapshot of
   * the current surface, and the thread's stable session endpoint. Returns
   * the endpoint environment for the child, or undefined in text-only mode.
   */
  private async prepareToolBridge(thread: PiThreadRuntime): Promise<NodeJS.ProcessEnv | undefined> {
    if (!this.toolsEnabled) return undefined
    if (!this.options.storageRoot) {
      throw runtimeError('runtime_unsupported', 'Pi tool bridge requires a host-managed storage root.')
    }
    if (!this.hostExtensionPath) this.hostExtensionPath = await ensurePiHostExtension(this.hostDir)
    const surfaceTools = this.options.toolSurface!.tools()
    thread.toolNames = surfaceTools.map((tool) => tool.name)
    const manifestPath = await writePiToolManifest(this.hostDir, thread.id, surfaceTools)
    if (!thread.endpoint) thread.endpoint = await createAgentRuntimeMcpSessionEndpoint()
    const authorization = thread.endpoint.config.headers.find((header) => header.name === 'Authorization')?.value
    if (!authorization) throw runtimeError('runtime_start_failed', 'Pi tool endpoint has no authorization header.')
    return {
      SCIFORGE_PI_MCP_URL: thread.endpoint.config.url,
      SCIFORGE_PI_MCP_AUTH: authorization,
      SCIFORGE_PI_TOOL_MANIFEST: manifestPath
    }
  }

  private threadRecordPath(threadId: string): string {
    return join(this.threadsDir, `${safeSegment(threadId)}.json`)
  }

  private journalPath(threadId: string): string {
    return join(this.eventsDir, `${safeSegment(threadId)}.jsonl`)
  }

  /**
   * Return a live client for the thread, spawning (and resuming) if needed.
   * Resume verification is strict: a missing session file or a sessionId
   * mismatch is an explicit failure — never a silently fresh session.
   */
  private async ensureClient(thread: PiThreadRuntime): Promise<PiRpcClient> {
    if (thread.client && !thread.client.hasExited) return thread.client
    await thread.client?.close().catch(() => undefined)
    thread.client = undefined
    const resuming = Boolean(this.options.storageRoot && thread.sessionFile)
    if (resuming && !existsSync(thread.sessionFile!)) {
      throw runtimeError(
        'runtime_resume_failed',
        `Pi session file is missing for thread ${thread.id}: cannot resume.`
      )
    }
    const toolEnv = await this.prepareToolBridge(thread)
    const client = this.spawnFor(thread, thread.workspace ?? this.options.workspace ?? process.cwd(), toolEnv)
    try {
      if (thread.model?.trim()) {
        const [provider, ...rest] = thread.model.trim().split('/')
        const modelId = rest.join('/')
        if (!provider || !modelId) {
          throw runtimeError('runtime_model_invalid', `Pi model must be "provider/modelId": ${thread.model}`)
        }
        const modelResponse = await client.command({ type: 'set_model', provider, modelId })
        if (!modelResponse.success) {
          throw runtimeError('runtime_model_unavailable', String(modelResponse.error ?? 'set_model failed'))
        }
      }
      const state = await client.command({ type: 'get_state' })
      if (!state.success) {
        throw runtimeError('runtime_start_failed', String(state.error ?? 'get_state failed'))
      }
      const data = asRecord(state.data)
      if (resuming) {
        const resumedId = typeof data?.sessionId === 'string' ? data.sessionId : ''
        if (!resumedId || resumedId !== thread.sessionId) {
          throw runtimeError(
            'runtime_resume_failed',
            `Pi resume verification failed for thread ${thread.id}: expected session ${thread.sessionId ?? 'unknown'}, got ${resumedId || 'none'}.`
          )
        }
      } else if (this.options.storageRoot) {
        // Fresh thread: capture the pi-native session identity for later resume.
        if (typeof data?.sessionId === 'string' && data.sessionId) thread.sessionId = data.sessionId
        if (typeof data?.sessionFile === 'string' && data.sessionFile) thread.sessionFile = data.sessionFile
      }
    } catch (error) {
      await client.close().catch(() => undefined)
      throw error
    }
    thread.client = client
    return client
  }

  // ---- persistence -------------------------------------------------------

  private enqueueWrite(thread: PiThreadRuntime, write: () => Promise<void>): void {
    thread.writeQueue = thread.writeQueue.then(write, write).catch((error: unknown) => {
      // Persistence failures must not break a live turn; they are logged and
      // a later resume mismatch still fails loudly instead of faking success.
      logWarn('pi-runtime', 'Failed to persist thread state', error instanceof Error ? error.message : String(error))
    })
  }

  private persistThreadRecord(thread: PiThreadRuntime): void {
    if (!this.options.storageRoot || thread.closed) return
    const record: PiPersistedThread = {
      id: thread.id,
      title: thread.title,
      workspace: thread.workspace,
      model: thread.model,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      sessionId: thread.sessionId,
      sessionFile: thread.sessionFile,
      seq: thread.seq,
      turns: thread.turnOrder.map((turnId) => thread.turns.get(turnId)!).filter(Boolean),
      turnOrder: [...thread.turnOrder]
    }
    const path = this.threadRecordPath(thread.id)
    this.enqueueWrite(thread, async () => {
      await mkdir(this.threadsDir, { recursive: true })
      await atomicWriteAppDataJsonAtPath(path, record)
    })
  }

  private persistEvent(thread: PiThreadRuntime, event: AgentRuntimeEvent): void {
    if (!this.options.storageRoot || thread.closed) return
    const path = this.journalPath(thread.id)
    const line = JSON.stringify(event)
    this.enqueueWrite(thread, async () => {
      await mkdir(this.eventsDir, { recursive: true })
      await writeFile(path, `${line}\n`, { flag: 'a' })
    })
  }

  private async loadRegistry(): Promise<void> {
    if (this.registryLoaded || !this.options.storageRoot) {
      this.registryLoaded = true
      return
    }
    this.registryLoaded = true
    let files: string[] = []
    try {
      files = await readdir(this.threadsDir)
    } catch {
      return // No registry yet.
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await readFile(join(this.threadsDir, file), 'utf8')
        const record = JSON.parse(raw) as PiPersistedThread
        if (!record?.id || this.threads.has(record.id)) continue
        this.threads.set(record.id, this.runtimeFromRecord(record))
      } catch {
        // A damaged record is skipped here; startTurn on it fails loudly via
        // the missing-registry path rather than fabricating an empty thread.
        logWarn('pi-runtime', `Skipping damaged thread record ${file}`)
      }
    }
  }

  private runtimeFromRecord(record: PiPersistedThread): PiThreadRuntime {
    const turns = new Map<string, PiTurnState>()
    for (const turn of record.turns ?? []) turns.set(turn.turnId, turn)
    return {
      id: record.id,
      title: record.title,
      workspace: record.workspace,
      model: record.model,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      sessionId: record.sessionId,
      sessionFile: record.sessionFile,
      client: undefined,
      openToolCalls: new Map(),
      seq: record.seq ?? 0,
      log: [],
      journalLoaded: false,
      turns,
      turnOrder: [...(record.turnOrder ?? turns.keys())],
      activeTurnId: undefined,
      closed: false,
      notify: new Set(),
      writeQueue: Promise.resolve()
    }
  }

  /** Replay the on-disk event journal into memory once per attach. */
  private async ensureJournalLoaded(thread: PiThreadRuntime): Promise<void> {
    if (thread.journalLoaded || !this.options.storageRoot) return
    thread.journalLoaded = true
    let raw: string
    try {
      raw = await readFile(this.journalPath(thread.id), 'utf8')
    } catch {
      return // No journal yet.
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as AgentRuntimeEvent
        thread.log.push(event)
        if (typeof event.seq === 'number' && event.seq > thread.seq) thread.seq = event.seq
      } catch {
        // Torn tail write after a crash: stop replay at the first bad line.
        break
      }
    }
  }

  private async threadFor(threadId: string): Promise<PiThreadRuntime> {
    await this.loadRegistry()
    const thread = this.threads.get(threadId)
    if (!thread) throw runtimeError('runtime_thread_not_found', `Unknown Pi thread: ${threadId}`)
    if (thread.closed) throw runtimeError('runtime_thread_closed', `Pi thread is closed: ${threadId}`)
    return thread
  }

  // ---- thread lifecycle --------------------------------------------------

  async startThread(input: {
    threadId?: string
    title?: string
    workspace?: string
    model?: string
  }): Promise<AgentRuntimeThread> {
    await this.loadRegistry()
    const id = input.threadId?.trim() || `pi-${randomUUID()}`
    if (this.threads.has(id)) throw runtimeError('runtime_thread_exists', `Pi thread already exists: ${id}`)
    const workspace = input.workspace?.trim() || this.options.workspace || process.cwd()
    const now = new Date().toISOString()
    const thread: PiThreadRuntime = {
      id,
      title: input.title?.trim() || 'Pi 会话',
      workspace,
      model: input.model,
      createdAt: now,
      updatedAt: now,
      client: undefined,
      openToolCalls: new Map(),
      seq: 0,
      log: [],
      journalLoaded: true,
      turns: new Map(),
      turnOrder: [],
      closed: false,
      notify: new Set(),
      writeQueue: Promise.resolve()
    }
    await this.ensureClient(thread)
    this.threads.set(id, thread)
    this.append(thread, { kind: 'thread_lifecycle', state: 'created', thread: this.toThread(thread) })
    this.persistThreadRecord(thread)
    return this.toThread(thread)
  }

  private toThread(thread: PiThreadRuntime): AgentRuntimeThread {
    const latestTurnId = thread.turnOrder[thread.turnOrder.length - 1]
    const latestTurn = latestTurnId ? thread.turns.get(latestTurnId) : undefined
    return {
      id: thread.id,
      runtimeId: 'pi',
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      model: thread.model,
      workspace: thread.workspace,
      status: thread.closed ? 'closed' : thread.activeTurnId ? 'running' : 'idle',
      latestTurnId,
      latestTurnStatus: latestTurn?.status,
      hasUserMessage: thread.turnOrder.length > 0
    }
  }

  private append(thread: PiThreadRuntime, event: EventDraft): void {
    thread.seq += 1
    thread.updatedAt = new Date().toISOString()
    const full = {
      ...event,
      threadId: thread.id,
      runtimeId: 'pi',
      seq: thread.seq,
      createdAt: thread.updatedAt
    } as AgentRuntimeEvent
    thread.log.push(full)
    this.persistEvent(thread, full)
    for (const notify of [...thread.notify]) notify()
  }

  // ---- turns ---------------------------------------------------------------

  async startTurn(
    threadId: string,
    input: { text: string; displayText?: string; allowedTools?: readonly string[] },
    onTurnAccepted?: (handle: AgentRuntimeTurnHandle) => Promise<void>
  ): Promise<AgentRuntimeTurnHandle> {
    const thread = await this.threadFor(threadId)
    if (thread.activeTurnId) {
      throw runtimeError('runtime_turn_active', `Pi thread ${threadId} already has an active turn.`)
    }
    // Lazy resume: an offline thread (after app restart or a crash) respawns
    // pi with --session here. Resume failure is an explicit thrown error.
    const client = await this.ensureClient(thread)
    const turnId = randomUUID()
    const turn: PiTurnState = {
      turnId,
      userItemId: `${turnId}:user`,
      assistantItemId: `${turnId}:assistant`,
      startedAt: new Date().toISOString(),
      status: 'started',
      userText: input.text,
      assistantText: ''
    }
    thread.turns.set(turnId, turn)
    thread.turnOrder.push(turnId)
    thread.activeTurnId = turnId
    this.persistThreadRecord(thread)

    this.append(thread, {
      kind: 'user_message',
      turnId,
      itemId: turn.userItemId,
      text: input.text,
      ...(input.displayText ? { displayText: input.displayText } : {})
    })
    this.append(thread, { kind: 'turn_lifecycle', turnId, state: 'started' })

    // The turn's exact Host tool lease is created and bound only AFTER the
    // Host durability ack: the Host registers the turn's Principal binding in
    // its onTurnAccepted wrapper, and the lease's own creation-time currency
    // check verifies that binding (surface.assertPrincipalLease). Before the
    // bind, the session endpoint answers 410 to every call — fail-closed,
    // the same guarantee the DSH bridge gets by creating its lease inside
    // getAuthorizedMcpServers (which likewise runs after acceptance).
    const bindToolLease = async (): Promise<void> => {
      if (!this.toolsEnabled || !thread.endpoint) return
      const controller = new AbortController()
      const state = { revoked: false }
      const surface = filterAgentRuntimeToolSurface(this.options.toolSurface!, input.allowedTools)
      const lease = await createAgentRuntimeMcpToolLease({
        surface,
        context: {
          requestId: turnId,
          runtimeId: 'pi',
          threadId,
          turnId,
          ...(thread.workspace ? { workspaceId: thread.workspace } : {})
        },
        signal: controller.signal,
        assertCurrent: () => {
          // activeTurnId moves to the next turn only after this lease has
          // been revoked (translate() revokes at the terminal record before
          // clearing the active flag), so the pair is a complete check.
          if (state.revoked || thread.activeTurnId !== turnId) {
            throw new Error('runtime_turn_stale')
          }
        }
      })
      if (state.revoked || thread.activeTurnId !== turnId) {
        await lease.close().catch(() => undefined)
        throw runtimeError('runtime_turn_stale', 'Pi turn lost currency before tool binding.')
      }
      thread.lease = { turnId, lease, controller, state }
      thread.endpoint.bind(lease)
    }

    // Mark BEFORE sending so the pump can never consume records from an
    // earlier turn (the stale-settled failure mode).
    const mark = client.mark()
    // Start the pump BEFORE the prompt: the subscription body runs
    // synchronously, and real pi emits agent_start in the same tick as the
    // prompt response. Subscribing after the response races and can miss it,
    // which would orphan the turn (observed: turn 2 hangs with no terminal).
    const pumpControl = new AbortController()
    const pump = this.pumpTurn(thread, turn, mark, pumpControl.signal)
    // pumpTurn never throws by contract; guard anyway against unhandled rejection.
    pump.catch(() => undefined)
    const failBeforeDispatch = async (error: unknown): Promise<never> => {
      const message = error instanceof Error ? error.message : String(error)
      // Terminal-first ordering: once the turn state is terminal the pump's
      // translate() skips every late record, so the abort-driven drain below
      // can never double-emit a terminal event.
      const finished = this.finishTurn(thread, turn, 'failed', message)
      pumpControl.abort()
      // A prompt response timeout/rejection is NOT proof pi never started the
      // run: cancel it and require a genuine agent_settled; kill the process
      // when pi cannot prove quiescence. Only after this cleanup may the
      // thread accept another turn.
      await this.quiesceAfterDispatchFailure(thread, client, mark)
      await this.revokeLease(thread, turnId)
      this.append(thread, { kind: 'turn_lifecycle', turnId, state: finished.status, message })
      if (thread.activeTurnId === turnId) thread.activeTurnId = undefined
      throw (error instanceof Error ? error : runtimeError('runtime_turn_rejected', message))
    }
    const response = await client.command(
      { type: 'prompt', message: input.text },
      { timeoutMs: this.options.promptTimeoutMs ?? PROMPT_TIMEOUT_MS }
    ).catch((error: unknown) => failBeforeDispatch(error))
    if (!response.success) {
      await failBeforeDispatch(runtimeError('runtime_turn_rejected', String(response.error ?? 'prompt rejected')))
    }
    // disposition "started" = prompt accepted, NOT completed. Any other
    // success disposition is accepted as-is; only agent_settled terminates.
    const handle: AgentRuntimeTurnHandle = { threadId, turnId, userMessageItemId: turn.userItemId }
    this.append(thread, { kind: 'turn_lifecycle', turnId, state: 'in_progress' })
    // The pump is already running, so even if the Host durability ack fails,
    // events keep flowing to a genuine terminal state; the tool lease simply
    // never binds and every tool call fails closed (410) for this turn.
    try {
      await onTurnAccepted?.(handle)
    } catch (error) {
      await this.revokeLease(thread, turnId)
      throw error
    }
    // The Host Principal binding exists now (registered by the Host's ack
    // wrapper), so the lease's creation-time verification can pass. A bind
    // failure is loud: cancel the run rather than letting it continue with
    // ambiguous tool authority.
    try {
      await bindToolLease()
    } catch (error) {
      await this.revokeLease(thread, turnId)
      await client.command({ type: 'abort' }, { timeoutMs: 5_000 }).catch(() => undefined)
      throw error
    }
    return handle
  }

  /**
   * After a prompt dispatch failure the run may still be executing inside pi.
   * Cancel it and wait for a genuine agent_settled; when pi cannot prove
   * quiescence within the grace period, close the client (tree-kill) so no
   * orphaned run can leak records or tool calls into the next turn.
   */
  private async quiesceAfterDispatchFailure(thread: PiThreadRuntime, client: PiRpcClient, mark: number): Promise<void> {
    if (client.hasExited) {
      if (thread.client === client) thread.client = undefined
      return
    }
    try {
      await client.command({ type: 'abort' }, { timeoutMs: 5_000 })
    } catch {
      // The abort request failing changes nothing: we still require the
      // settled record, or the process goes down.
    }
    const settled = await client
      .waitFor((record) => record.type === 'agent_settled', {
        after: mark,
        timeoutMs: this.options.quiesceTimeoutMs ?? 10_000,
        label: 'quiesce after dispatch failure'
      })
      .then(() => true, () => false)
    if (!settled) {
      await client.close().catch(() => undefined)
      if (thread.client === client) thread.client = undefined
    }
  }

  /** Revoke + unbind the turn's Host tool lease (idempotent per turn). */
  private async revokeLease(thread: PiThreadRuntime, turnId?: string): Promise<void> {
    const entry = thread.lease
    if (!entry || (turnId && entry.turnId !== turnId)) return
    thread.lease = undefined
    entry.state.revoked = true
    thread.endpoint?.unbind(entry.lease)
    entry.controller.abort('Host tool lease revoked.')
    await entry.lease.close().catch(() => undefined)
  }

  private finishTurn(
    thread: PiThreadRuntime,
    turn: PiTurnState,
    status: AgentRuntimeTurnStatus,
    errorMessage?: string
  ): PiTurnState {
    turn.status = status
    if (errorMessage) turn.errorMessage = errorMessage
    thread.updatedAt = new Date().toISOString()
    this.persistThreadRecord(thread)
    return turn
  }

  /**
   * Translate pi records into contract events until this turn's agent_settled.
   * Only records arriving after `mark` are considered, and the pump exits at
   * the FIRST agent_settled — records for later turns belong to their own pump.
   */
  private async pumpTurn(thread: PiThreadRuntime, turn: PiTurnState, mark: number, control?: AbortSignal): Promise<void> {
    const client = thread.client
    if (!client) return
    let settled = false
    // Turns are serialized by pi (agent_start -> ... -> agent_settled). A
    // settled record that arrives before THIS turn's agent_start is a late
    // record from a previous turn and must not terminate this one.
    let sawAgentStart = false
    const unsubscribe = client.onRecord((record) => {
      if (settled || thread.closed) return
      // Once the turn state is terminal (set by startTurn's dispatch-failure
      // path BEFORE the pump is aborted), late records must not translate —
      // otherwise the abort-driven drain would double-emit a terminal event.
      if (turn.status !== 'started' && turn.status !== 'in_progress') return
      if (record.type === 'agent_start') sawAgentStart = true
      if (record.type === 'agent_settled' && !sawAgentStart) return
      this.translate(thread, turn, record)
      if (record.type === 'agent_settled') settled = true
    })
    try {
      const winner = await Promise.race([
        client.waitFor((record) => record.type === 'agent_settled' && sawAgentStart, {
          after: mark,
          timeoutMs: 24 * 60 * 60 * 1000,
          signal: control,
          label: `agent_settled for turn ${turn.turnId}`
        }).then((record) => ({ kind: 'settled' as const, record })),
        client.exit().then((exit) => ({ kind: 'exit' as const, exit }))
      ])
      if (winner.kind === 'exit') {
        if (!settled && !control?.aborted) {
          // Crash path: no genuine terminal record will arrive; the adapter
          // must synthesize failure itself rather than fabricate success.
          const stderr = client.stderrText.trim()
          const message = `Pi process exited before the turn settled (code ${winner.exit.code}).${stderr ? ` stderr: ${stderr.slice(-500)}` : ''}`
          this.finishTurn(thread, turn, 'failed', message)
          this.append(thread, { kind: 'turn_lifecycle', turnId: turn.turnId, state: 'failed', message })
        }
      }
      // The settled path's terminal event was already emitted by translate().
    } catch {
      // A control-aborted pump (prompt rejected before dispatch) already has
      // its terminal state emitted by startTurn; do not double-emit.
      if (!settled && !thread.closed && !control?.aborted) {
        // The waiter rejection usually wins the race against exit(): surface
        // the genuine cause instead of a generic watch failure.
        const stderr = client.stderrText.trim()
        const message = client.hasExited
          ? `Pi process exited before the turn settled.${stderr ? ` stderr: ${stderr.slice(-500)}` : ''}`
          : 'Pi turn watch ended before agent_settled.'
        this.finishTurn(thread, turn, 'failed', message)
        this.append(thread, { kind: 'turn_lifecycle', turnId: turn.turnId, state: 'failed', message })
      }
    } finally {
      unsubscribe()
      await this.revokeLease(thread, turn.turnId)
      if (thread.activeTurnId === turn.turnId) thread.activeTurnId = undefined
      for (const notify of [...thread.notify]) notify()
    }
  }

  private translate(thread: PiThreadRuntime, turn: PiTurnState, record: PiRpcRecord): void {
    switch (record.type) {
      case 'message_update': {
        const event = asRecord(record.assistantMessageEvent)
        if (event?.type === 'text_delta' && typeof event.delta === 'string') {
          turn.assistantText += event.delta
          this.append(thread, {
            kind: 'assistant_delta',
            turnId: turn.turnId,
            itemId: turn.assistantItemId,
            text: event.delta
          })
        } else if (event?.type === 'text_end' && typeof event.content === 'string') {
          // text_end carries the authoritative full block; prefer it over
          // accumulated deltas if they disagree.
          turn.assistantText = event.content
        }
        // thinking_* deltas are dropped: reasoning stays declared unsupported.
        return
      }
      case 'turn_end': {
        const message = asRecord(record.message)
        const stopReason = typeof message?.stopReason === 'string' ? message.stopReason : undefined
        if (stopReason) turn.stopReason = stopReason
        const usage = mapUsage(message?.usage)
        if (usage) {
          turn.usage = usage
          this.append(thread, { kind: 'usage', turnId: turn.turnId, usage })
        }
        return
      }
      case 'error': {
        turn.errorMessage = typeof record.error === 'string'
          ? record.error
          : typeof record.reason === 'string' ? record.reason : 'unknown pi error'
        this.append(thread, {
          kind: 'error',
          turnId: turn.turnId,
          recoverable: false,
          severity: 'error',
          message: turn.errorMessage
        })
        return
      }
      case 'tool_execution_start': {
        const callId = typeof record.toolCallId === 'string' ? record.toolCallId : ''
        if (!callId) return
        const toolName = typeof record.toolName === 'string' ? record.toolName : 'unknown'
        const args = asRecord(record.args) ?? {}
        thread.openToolCalls.set(callId, { turnId: turn.turnId, name: toolName, args })
        this.append(thread, {
          kind: 'tool_event',
          turnId: turn.turnId,
          itemId: callId,
          callId,
          toolName,
          status: 'running',
          toolKind: 'tool_call',
          summary: `Pi tool: ${toolName}`,
          meta: {
            name: toolName,
            callId,
            toolName,
            arguments: args,
            phase: 'requested',
            factSource: 'model_output',
            evidenceStrength: 'intent'
          }
        })
        return
      }
      case 'tool_execution_end': {
        const callId = typeof record.toolCallId === 'string' ? record.toolCallId : ''
        if (!callId) return
        const open = thread.openToolCalls.get(callId)
        thread.openToolCalls.delete(callId)
        const toolName = typeof record.toolName === 'string' ? record.toolName : open?.name ?? 'unknown'
        const isError = record.isError === true
        const text = piToolResultText(record.result)
        const base = {
          kind: 'tool_event' as const,
          turnId: turn.turnId,
          itemId: callId,
          callId,
          toolName,
          toolKind: 'tool_call' as const,
          summary: `Pi tool result: ${toolName}`,
          ...(text ? { detail: text } : {}),
          meta: {
            name: toolName,
            callId,
            toolName,
            arguments: open?.args ?? {},
            phase: isError ? 'failed' : 'succeeded',
            factSource: 'executor_result',
            evidenceStrength: 'executor_receipt',
            success: !isError,
            ...(isError
              ? { errorCode: 'pi_tool_error', error: { code: 'pi_tool_error', message: text || `Pi tool ${toolName} failed.` } }
              : {})
          }
        }
        // The tool_event union requires the receipt status literal to match
        // the event status literal exactly, so emit each branch separately.
        if (isError) {
          this.append(thread, {
            ...base,
            status: 'error',
            receipt: createExecutionReceipt({
              status: 'error',
              detail: text ? text.slice(0, 2_000) : undefined,
              metadata: { errorCode: 'pi_tool_error' }
            })
          })
        } else {
          this.append(thread, {
            ...base,
            status: 'success',
            receipt: createExecutionReceipt({
              status: 'success',
              detail: text ? text.slice(0, 2_000) : undefined
            })
          })
        }
        return
      }
      case 'agent_settled': {
        // Any tool call still open at the terminal record ended without a
        // genuine result: close it out as unresolved instead of leaving a
        // permanently "running" event in the journal.
        for (const [callId, open] of [...thread.openToolCalls]) {
          if (open.turnId !== turn.turnId) continue
          thread.openToolCalls.delete(callId)
          const message = `Pi tool ${open.name} (${callId}) ended without a matching tool_execution_end.`
          this.append(thread, {
            kind: 'tool_event',
            turnId: turn.turnId,
            itemId: callId,
            callId,
            toolName: open.name,
            status: 'error',
            toolKind: 'tool_call',
            receipt: createExecutionReceipt({
              status: 'error',
              detail: message,
              metadata: { errorCode: 'pi_tool_result_missing' }
            }),
            summary: `Pi tool unresolved: ${open.name}`,
            detail: message,
            meta: {
              name: open.name,
              callId,
              toolName: open.name,
              arguments: open.args,
              phase: 'unresolved',
              factSource: 'runtime_lifecycle',
              evidenceStrength: 'runtime_lifecycle',
              success: false,
              error: { code: 'pi_tool_result_missing', message }
            }
          })
        }
        const aborted = record.aborted === true
        const state: AgentRuntimeTurnStatus = aborted
          ? 'aborted'
          : turn.errorMessage || turn.stopReason === 'error'
            ? 'failed'
            : 'completed'
        const message = aborted
          ? 'Turn aborted.'
          : state === 'failed'
            ? turn.errorMessage ?? `Pi turn ended with stopReason ${turn.stopReason ?? 'unknown'}.`
            : undefined
        this.finishTurn(thread, turn, state, message)
        this.append(thread, {
          kind: 'item_snapshot',
          turnId: turn.turnId,
          itemId: turn.assistantItemId,
          item: {
            id: turn.assistantItemId,
            turnId: turn.turnId,
            kind: 'assistant_message',
            text: turn.assistantText,
            status: state === 'completed' ? 'success' : state === 'failed' ? 'error' : 'aborted',
            createdAt: turn.startedAt
          }
        })
        this.append(thread, { kind: 'turn_lifecycle', turnId: turn.turnId, state, ...(message ? { message } : {}) })
        // Revoke the tool lease BEFORE clearing the active flag: the pair
        // (revoked state, activeTurnId) is the lease's currency check, and a
        // new turn may only start once the old lease can no longer serve.
        // revokeLease is synchronous up to the endpoint unbind + abort.
        void this.revokeLease(thread, turn.turnId)
        // Clear the active flag WITH the terminal event: a subscriber that
        // reacts to the terminal state must already see the thread as idle.
        if (thread.activeTurnId === turn.turnId) thread.activeTurnId = undefined
        return
      }
      default:
        return
    }
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    const thread = await this.threadFor(threadId)
    if (thread.activeTurnId !== turnId || !thread.client || thread.client.hasExited) {
      throw runtimeError('runtime_turn_not_active', `Pi turn is not active: ${turnId}`)
    }
    // Revoke the tool lease BEFORE asking pi to abort (the DSH bridge uses
    // the same ordering): no new tool call can start from here on, and
    // in-flight calls receive the lease abort signal.
    await this.revokeLease(thread, turnId)
    // The abort RESPONSE only acknowledges the request; the terminal
    // agent_settled{aborted:true} record is what actually ends the turn.
    const response = await thread.client.command({ type: 'abort' }, { timeoutMs: 15_000 })
    if (!response.success) {
      throw runtimeError('runtime_interrupt_failed', String(response.error ?? 'abort rejected'))
    }
  }

  // ---- reads -----------------------------------------------------------------

  async *subscribeEvents(
    threadId: string,
    sinceSeq: number,
    signal?: AbortSignal
  ): AsyncIterable<AgentRuntimeEvent> {
    await this.loadRegistry()
    const thread = this.threads.get(threadId)
    if (!thread) throw runtimeError('runtime_thread_not_found', `Unknown Pi thread: ${threadId}`)
    await this.ensureJournalLoaded(thread)
    let index = sinceSeq
    for (;;) {
      while (index < thread.log.length) {
        if (signal?.aborted) return
        yield thread.log[index]
        index += 1
      }
      if (signal?.aborted || thread.closed) return
      await new Promise<void>((resolve) => {
        const notify = (): void => {
          thread.notify.delete(notify)
          signal?.removeEventListener('abort', notify)
          resolve()
        }
        thread.notify.add(notify)
        signal?.addEventListener('abort', notify, { once: true })
      })
    }
  }

  async readThreadStatus(threadId: string): Promise<AgentRuntimeThreadStatus> {
    const thread = await this.threadFor(threadId)
    const latestTurnId = thread.turnOrder[thread.turnOrder.length - 1]
    return {
      id: thread.id,
      runtimeId: 'pi',
      status: thread.activeTurnId ? 'running' : 'idle',
      latestSeq: thread.seq,
      latestTurnId,
      latestTurnStatus: latestTurnId ? thread.turns.get(latestTurnId)?.status : undefined,
      usage: latestTurnId ? thread.turns.get(latestTurnId)?.usage : undefined
    }
  }

  async readThreadPage(threadId: string): Promise<AgentRuntimeThreadPage> {
    const thread = await this.threadFor(threadId)
    const turns: AgentRuntimeTurn[] = thread.turnOrder.map((turnId) => {
      const turn = thread.turns.get(turnId)!
      const completed = turn.status === 'completed' || turn.status === 'failed' || turn.status === 'aborted'
      return {
        id: turn.turnId,
        threadId: thread.id,
        status: turn.status,
        startedAt: turn.startedAt,
        completedAt: completed ? thread.updatedAt : undefined,
        items: [
          {
            id: turn.userItemId,
            turnId,
            kind: 'user_message',
            text: turn.userText,
            status: 'success',
            createdAt: turn.startedAt
          },
          {
            id: turn.assistantItemId,
            turnId,
            kind: 'assistant_message',
            text: turn.assistantText,
            status: turn.status === 'completed' ? 'success' : turn.status === 'failed' ? 'error' : turn.status === 'aborted' ? 'aborted' : 'running',
            createdAt: turn.startedAt
          }
        ]
      }
    })
    return {
      runtimeId: 'pi',
      threadId: thread.id,
      latestSeq: thread.seq,
      turns,
      // In-memory single page: no older history exists beyond this page.
      nextCursor: null
    }
  }

  async listThreads(): Promise<AgentRuntimeThread[]> {
    await this.loadRegistry()
    return [...this.threads.values()].filter((thread) => !thread.closed).map((thread) => this.toThread(thread))
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    const thread = await this.threadFor(threadId)
    thread.title = title.trim() || thread.title
    this.append(thread, { kind: 'thread_lifecycle', state: 'updated', thread: this.toThread(thread) })
    this.persistThreadRecord(thread)
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.loadRegistry()
    const thread = this.threads.get(threadId)
    if (!thread) return
    thread.closed = true
    await this.revokeLease(thread)
    await thread.client?.close().catch(() => undefined)
    const endpoint = thread.endpoint
    thread.endpoint = undefined
    await endpoint?.close().catch(() => undefined)
    this.append(thread, { kind: 'thread_lifecycle', state: 'archived' })
    this.threads.delete(threadId)
    for (const notify of [...thread.notify]) notify()
    if (this.options.storageRoot) {
      // Remove every artifact we own for this thread: registry record, event
      // journal, and the pi-native session file inside our managed directory.
      await rm(this.threadRecordPath(threadId), { force: true }).catch(() => undefined)
      await rm(this.journalPath(threadId), { force: true }).catch(() => undefined)
      if (thread.sessionFile && thread.sessionFile.startsWith(this.sessionsDir)) {
        await rm(thread.sessionFile, { force: true }).catch(() => undefined)
      }
    }
  }

  /** Stop every thread process; called by adapter.close(). */
  async close(): Promise<void> {
    const closing = [...this.threads.values()]
    // Revoke all tool leases before the processes go down (adapter contract:
    // "revoke all tool leases before Host sinks drain").
    await Promise.all(closing.map((thread) => this.revokeLease(thread)))
    await Promise.all(closing.map((thread) => thread.client?.close().catch(() => undefined)))
    await Promise.all(closing.map((thread) => {
      const endpoint = thread.endpoint
      thread.endpoint = undefined
      return endpoint?.close().catch(() => undefined)
    }))
    // Persisted threads stay in the registry on disk; only the in-memory
    // live state is dropped so a new service instance rehydrates from disk.
    for (const thread of closing) {
      thread.client = undefined
      for (const notify of [...thread.notify]) notify()
    }
    await Promise.all(closing.map((thread) => thread.writeQueue))
  }
}
