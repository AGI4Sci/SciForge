import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { AcpTransport, DshRuntimeError, type Wire } from './transport.js'
import { prepareDeployment } from './deployment.js'
import type { DshRuntimeOptions, DshDeploymentTarget, DshContext, DshTurnInput, DshTurnHandle, DshIdentity, DshThread, DshThreadInput, DshEvent, DshApprovalResponse, DshMcpServer, DshToolItem } from './types.js'
export * from './types.js'
export { DSH_MODEL_ROUTER_PATCH, type DshModelRouter } from './model-router.js'
export { createPinnedDshDeployment, type DshDeploymentPin } from './trusted-deployment.js'
export { DSH_RELEASE_PINS } from './release-pins.js'
export { DshRuntimeError, resolveDshLaunchInvocation } from './transport.js'
export { DSH_DEFAULT_ACP_ROUTE, DSH_COMMAND_EXECUTION_ENTRY_IDS, DSH_COMMAND_EXECUTION_PLUGIN_NAMES, DSH_DISABLED_ENTRY_IDS, DSH_DISABLED_PLUGIN_NAME_PATTERNS, DSH_SAFETY_PATCH, createDiscoveredDshDeployment, createDshDerivedSafetyPatch, createDshEnvironment, createDshSafetyPatch, dshDisabledEntryIds, validateDshComposedConfig, validateDshDerivedComposedConfig } from './deployment.js'

const DSH_PROBE_FAILURE_CODES: ReadonlySet<string> = new Set(['runtime_not_found', 'runtime_path_invalid', 'runtime_not_executable', 'runtime_version_unsupported', 'runtime_architecture_incompatible'])

/** How the effective safety closure is proven: a pinned artifact's static patch,
 * or an overlay derived from a discovered install's own composed config. */
function deploymentIntegrityOf(safetyPatch: 'static' | 'derived' | undefined): 'pinned' | 'derived' {
  return safetyPatch === 'derived' ? 'derived' : 'pinned'
}

/** Model-facing result text from an ACP tool_call_update content block list. */
function acpToolDetail(update: Record<string, unknown>, previous?: string): string | undefined {
  const blocks = Array.isArray(update.content) ? update.content : []
  const text = blocks
    .map((block) => (
      block && typeof block === 'object' && !Array.isArray(block)
      && typeof (block as Record<string, unknown>).content === 'object'
      && (block as { content: Record<string, unknown> }).content !== null
        ? stringField((block as { content: Record<string, unknown> }).content.text)
        : ''
    ))
    .filter((part) => part.length > 0)
    .join('\n')
  if (!text) return previous
  // Preserve exact results for durable history. The Host projects bounded UI
  // events with detailArtifact references after persistence; truncating here
  // would destroy the only recoverable copy before that canonical boundary.
  return text
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

type Turn = { identity: DshIdentity; generation: number; controller: AbortController; finished: boolean; cancelling?: boolean; cancellation?: Promise<void>; transport?: AcpTransport; prompt?: Promise<void>; startup: Promise<void>; startupDone: () => void; items: Map<string, DshToolItem>; toolKinds: Map<string, string>; abortCleanup?: () => void }
type Approval = { id: string | number; turn: Turn; options: { optionId: string; kind: string; name: string }[]; timer: NodeJS.Timeout }
type Listener = { threadId: string; push: (e: DshEvent) => void; stop: () => void }
export function createDshRuntimeAdapter(options: DshRuntimeOptions) { return new DshRuntimeAdapter(options) }
export class DshRuntimeAdapter {
  readonly runtimeId = 'dsh' as const
  readonly id = 'dsh' as const
  readonly transport = 'jsonrpc_stdio' as const
  private connection?: AcpTransport
  private generation = 0
  private seq = 0
  private closed = false
  private connecting?: Promise<void>
  private retiring?: Promise<void>
  // Retain fenced cleanup ownership even when its single attempt rejects.
  private retirementOwner?: { transport?: AcpTransport; cleanup?: () => Promise<void> }
  private modelRouterIdentity?: string
  private deploymentCleanup?: () => Promise<void>
  private deployedVersion?: string
  private threads = new Map<string, DshThread>()
  private mounted = new Map<string, string>()
  private active?: Turn
  private approvals = new Map<string, Approval>()
  private listeners = new Set<Listener>()
  private serverCapabilities: any = {}
  constructor(private options: DshRuntimeOptions) {
    for (const value of [options.requestTimeoutMs, options.promptTimeoutMs, options.cancelTimeoutMs, options.approvalTimeoutMs]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 1 || value > 2_147_483_647)) throw new DshRuntimeError('runtime_timeout_invalid')
    }
  }
  private resolveTarget(input?: { command?: string; settings?: unknown; refresh?: boolean }): Promise<DshDeploymentTarget> {
    if (this.options.resolveDeploymentTarget) return this.options.resolveDeploymentTarget(input)
    const { executable, artifactRoot, executableArgs, verifyExecutable, verifyDeployment } = this.options
    if (!executable || typeof verifyDeployment !== 'function') throw new DshRuntimeError('runtime_deployment_unapproved')
    return Promise.resolve({ executable, artifactRoot, executableArgs, verifyExecutable, verifyDeployment, source: 'user-configured' })
  }
  async probe(context: DshContext, input?: { command?: string }) {
    let executablePath: string | null = null
    let source: DshDeploymentTarget['source'] | null = null
    // A target may leave safetyPatch unset and inherit the option, so the
    // effective patch decides how this deployment's closure is proven.
    let safetyPatch = this.options.safetyPatch
    try {
      // An explicit probe is the Host's re-check: bypass its discovery cache so
      // the reported executable, source and version always reflect the disk.
      const target = await this.resolveTarget({ command: input?.command, settings: context.settings, refresh: true })
      executablePath = target.executable
      source = target.source ?? null
      safetyPatch = target.safetyPatch ?? safetyPatch
      await this.connect(context)
      return { runtimeId: this.runtimeId, available: true, executablePath, source, version: this.deployedVersion ?? null, protocol: { id: 'acp', supported: true }, deploymentIntegrity: deploymentIntegrityOf(safetyPatch) }
    } catch (error) {
      const technicalDetail = error instanceof DshRuntimeError ? error.message : 'runtime_probe_failed'
      const code = (DSH_PROBE_FAILURE_CODES.has(technicalDetail) ? technicalDetail : 'runtime_probe_failed') as 'runtime_not_found' | 'runtime_path_invalid' | 'runtime_not_executable' | 'runtime_version_unsupported' | 'runtime_architecture_incompatible' | 'runtime_probe_failed'
      return { runtimeId: this.runtimeId, available: false, executablePath, source, version: null, protocol: null, deploymentIntegrity: deploymentIntegrityOf(safetyPatch), failure: { code, technicalDetail } }
    }
  }
  async connect(context: DshContext): Promise<void> {
    await this.retiring
    if (this.closed) throw new DshRuntimeError('runtime_closed')
    if (this.connecting) { await this.connecting; return this.connect(context) }
    const task = (async () => {
      let modelRouter = this.options.modelRouter
      try { modelRouter = this.options.getModelRouter ? await this.options.getModelRouter(context) : modelRouter }
      catch (error) {
        if (this.active && this.active.generation !== -1) this.finish(this.active, 'failed', 'runtime_model_route_changed')
        await this.retire(); this.modelRouterIdentity = undefined
        throw error
      }
      const identity = JSON.stringify(modelRouter)
      if (this.connection && identity === this.modelRouterIdentity) return
      if (this.connection) {
        if (this.active && this.active.generation !== -1) this.finish(this.active, 'failed', 'runtime_model_route_changed')
        await this.retire()
      }
      const generation = ++this.generation
      const target = await this.resolveTarget({ settings: context.settings })
      const deployment = await prepareDeployment({ ...this.options, ...target, modelRouter })
      if (this.closed || generation !== this.generation) { await deployment.cleanup(); throw new DshRuntimeError('runtime_stale_generation') }
      this.deploymentCleanup = deployment.cleanup
      this.deployedVersion = deployment.version
      const transport = new AcpTransport(target.executable, deployment.args, deployment.env, this.options.stateDirectory,
        this.options.requestTimeoutMs ?? 15_000,
        message => { if (generation === this.generation && !this.closed) this.receive(message, generation) },
        () => {
          if (generation !== this.generation) return
          const turn = this.active
          // retire retains the rejected promise and owner for public observers.
          void this.retire().catch(() => {})
          if (turn && !turn.cancelling) this.finish(turn, 'failed', 'runtime_disconnected')
        })
      this.connection = transport
      this.modelRouterIdentity = identity
      try {
        const initialized = await transport.request('initialize', { protocolVersion: 1,
          clientInfo: { name: 'sciforge-dsh-runtime', version: '0.1.0' },
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
        if (initialized?.protocolVersion !== 1 || initialized?.agentInfo?.name !== 'deepseek-harness-acp') throw new DshRuntimeError('runtime_protocol_unsupported')
        if (generation !== this.generation || this.closed) throw new DshRuntimeError('runtime_stale_generation')
        this.serverCapabilities = initialized.agentCapabilities ?? {}
      } catch (error) { if (generation === this.generation) await this.retire(); else await transport.close(); throw error }
    })()
    this.connecting = task
    try { await task } finally { if (this.connecting === task) this.connecting = undefined }
  }
  private assertRuntime(input: { runtimeId?: string }) {
    if (input.runtimeId && input.runtimeId !== 'dsh') throw new DshRuntimeError('runtime_mismatch')
    if (this.closed) throw new DshRuntimeError('runtime_closed')
  }
  private workspace(input?: string | null): string {
    if (!input || !isAbsolute(input)) throw new DshRuntimeError('runtime_workspace_required')
    return input
  }
  async startThread(context: DshContext, input: DshThreadInput): Promise<DshThread> {
    this.assertRuntime(input)
    const cwd = this.workspace(this.options.resolveWorkspace ? await this.options.resolveWorkspace(context, input) : input.workspace)
    if (this.active) throw new DshRuntimeError('runtime_busy')
    await this.connect(context)
    const result = await this.connection!.request('session/new', { cwd, mcpServers: [] })
    if (typeof result?.sessionId !== 'string' || !result.sessionId) throw new DshRuntimeError('runtime_protocol_invalid')
    const thread: DshThread = { id: result.sessionId, runtimeId: 'dsh', workspace: cwd, title: '', updatedAt: new Date().toISOString(), state: 'idle' }
    this.threads.set(thread.id, thread)
    this.mounted.set(thread.id, '[]')
    return { ...thread }
  }
  async listThreads(context: DshContext, input: { runtimeId?: string; workspace?: string | null } = {}): Promise<DshThread[]> {
    this.assertRuntime(input); await this.connect(context)
    if (!this.serverCapabilities.sessionCapabilities?.list) throw new DshRuntimeError('runtime_unsupported')
    const result = await this.connection!.request('session/list', input.workspace ? { cwd: input.workspace } : {})
    if (!Array.isArray(result?.sessions)) throw new DshRuntimeError('runtime_protocol_invalid')
    return result.sessions.map((s: any) => {
      if (typeof s.sessionId !== 'string') throw new DshRuntimeError('runtime_protocol_invalid')
      return { id: s.sessionId, runtimeId: 'dsh' as const, workspace: typeof s.cwd === 'string' ? s.cwd : undefined, title: typeof s.title === 'string' ? s.title : '', updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : new Date().toISOString() }
    })
  }
  async resumeSession(context: DshContext, input: { runtimeId: string; sessionId: string; workspace?: string | null; workspaceLocator?: unknown }) {
    this.assertRuntime(input)
    if (this.active) throw new DshRuntimeError('runtime_busy')
    const cwd = this.workspace(this.options.resolveWorkspace ? await this.options.resolveWorkspace(context, input) : input.workspace)
    await this.connect(context)
    if (!this.serverCapabilities.sessionCapabilities?.resume) throw new DshRuntimeError('runtime_unsupported')
    await this.connection!.request('session/resume', { sessionId: input.sessionId, cwd, mcpServers: [] })
    this.mounted.set(input.sessionId, '[]')
    this.threads.set(input.sessionId, { id: input.sessionId, runtimeId: 'dsh', workspace: cwd, title: '', updatedAt: new Date().toISOString(), state: 'idle' })
    return { runtimeId: this.runtimeId, sessionId: input.sessionId, threadId: input.sessionId }
  }
  async startTurn(context: DshContext, input: DshTurnInput): Promise<DshTurnHandle> {
    this.assertRuntime(input)
    if (this.active) throw new DshRuntimeError('runtime_busy')
    const thread = input.threadId ? this.threads.get(input.threadId) : undefined
    if (!thread) throw new DshRuntimeError('runtime_thread_not_found')
    if (input.outputSchema || input.attachmentIds?.length || input.fileReferences?.length || input.model || input.mode || input.reasoningEffort || input.serviceTier) throw new DshRuntimeError('runtime_unsupported')
    if (typeof input.text !== 'string' || !input.text.trim() || input.input?.length || input.attachments?.length) throw new DshRuntimeError('runtime_text_only')
    const identity: DshIdentity = structuredClone({ runtimeId: 'dsh', threadId: thread.id, turnId: randomUUID(), principal: context.principal, principalContext: context.principalContext })
    let startupDone!: () => void
    const startup = new Promise<void>(resolve => { startupDone = resolve })
    const turn: Turn = { identity, generation: -1, controller: new AbortController(), finished: false, startup, startupDone, items: new Map(), toolKinds: new Map() }
    this.active = turn
    try {
      if (input.signal) {
        const abort = () => { void this.interruptTurn(context, { runtimeId: 'dsh', threadId: thread.id, turnId: identity.turnId }) }
        input.signal.addEventListener('abort', abort, { once: true })
        turn.abortCleanup = () => input.signal!.removeEventListener('abort', abort)
        if (input.signal.aborted) { abort(); throw new DshRuntimeError('runtime_cancelled') }
      }

      this.checkTurn(turn)
      await this.connect(context)
      turn.generation = this.generation
      turn.transport = this.connection
      const servers = await this.waitForHost(turn, () => this.options.getAuthorizedMcpServers?.({ ...structuredClone(identity), workspace: thread.workspace!, allowedTools: input.allowedTools ? [...input.allowedTools] : undefined, permissionLevel: input.permissionLevel, governanceProfile: input.governanceProfile, signal: turn.controller.signal }) ?? Promise.resolve([]))
      this.checkTurn(turn)
      this.validateServers(servers)
      if (servers.length && this.serverCapabilities.mcpCapabilities?.http !== true) throw new DshRuntimeError('runtime_mcp_unsupported')
      const config = JSON.stringify(servers)
      const mounted = this.mounted.get(thread.id)
      if (mounted !== config) {
        // Official ACP has no MCP-update request and resume rejects active IDs.
        // Mount once by closing/resuming the SAME durable session; subsequent
        // turns retain its history and MCP client through a Host session endpoint.
        if (!this.serverCapabilities.sessionCapabilities?.resume || (mounted !== undefined && !this.serverCapabilities.sessionCapabilities?.close)) throw new DshRuntimeError('runtime_unsupported')
        if (mounted !== undefined && mounted !== '[]') throw new DshRuntimeError('runtime_mcp_rebind_unsupported')
        if (mounted !== undefined) await this.connection!.request('session/close', { sessionId: thread.id })
        await this.connection!.request('session/resume', { sessionId: thread.id, cwd: thread.workspace, mcpServers: servers })
        this.mounted.set(thread.id, config)
      }
      this.checkTurn(turn)
      const handle: DshTurnHandle = { runtimeId: 'dsh', threadId: thread.id, turnId: identity.turnId }
      await this.waitForHost(turn, () => context.onTurnAccepted?.({ ...handle }) ?? Promise.resolve())
      this.checkTurn(turn)
      this.emit(turn, { kind: 'turn_lifecycle', state: 'running' })
      const transport = this.connection!
      turn.prompt = transport.request('session/prompt', { sessionId: thread.id, prompt: [{ type: 'text', text: input.text }] }, this.options.promptTimeoutMs ?? 15_000).then(result => {
        if (!this.current(turn)) return
        const state = result?.stopReason === 'cancelled' ? 'interrupted' : ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal'].includes(result?.stopReason) ? 'completed' : 'failed'
        this.finish(turn, state, state === 'failed' ? 'runtime_stop_reason_unknown' : undefined)
      }, () => { if (this.current(turn)) this.finish(turn, 'failed', 'runtime_request_failed') })
      return handle
    } catch (error) {
      const ownsConnection = turn.generation === this.generation
      if (!turn.cancelling) this.finish(turn, 'failed', 'runtime_turn_start_failed')
      if (ownsConnection) await this.retire()
      throw error instanceof DshRuntimeError ? error : new DshRuntimeError('runtime_turn_start_failed')
    } finally { turn.startupDone() }
  }
  private async waitForHost<T>(turn: Turn, action: () => Promise<T>): Promise<T> {
    this.checkTurn(turn)
    const signal = turn.controller.signal
    return new Promise<T>((resolve, reject) => {
      const abort = () => { cleanup(); reject(new DshRuntimeError('runtime_cancelled')) }
      const timer = setTimeout(() => { cleanup(); reject(new DshRuntimeError('runtime_host_timeout')) }, this.options.requestTimeoutMs ?? 15_000)
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
      signal.addEventListener('abort', abort, { once: true })
      Promise.resolve().then(action).then(value => { cleanup(); resolve(value) }, () => { cleanup(); reject(new DshRuntimeError('runtime_host_rejected')) })
    })
  }
  private validateServers(servers: readonly DshMcpServer[]) {
    for (const s of servers) {
      let url: URL
      try { url = new URL(s.url) } catch { throw new DshRuntimeError('runtime_mcp_invalid') }
      if (s.type !== 'http' || !s.name || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !Array.isArray(s.headers)) throw new DshRuntimeError('runtime_mcp_invalid')
    }
  }
  private current(turn: Turn) { return this.active === turn && !turn.finished && !turn.cancelling && !this.closed && turn.generation === this.generation }
  private checkTurn(turn: Turn) { if (this.active !== turn || turn.finished || turn.controller.signal.aborted || this.closed) throw new DshRuntimeError('runtime_stale_generation') }
  private emit(turn: Turn, payload: any) {
    const event = { ...structuredClone(turn.identity), ...payload, seq: ++this.seq, createdAt: new Date().toISOString() } as DshEvent
    for (const listener of this.listeners) if (listener.threadId === turn.identity.threadId) listener.push(structuredClone(event))
  }
  private receive(message: Wire, generation: number) {
    const turn = this.active
    if (message.method === 'session/update') {
      if (!turn || !this.current(turn) || turn.generation !== generation || message.params?.sessionId !== turn.identity.threadId) return
      const update = message.params.update
      const itemId = typeof update?.messageId === 'string' ? update.messageId : `${turn.identity.turnId}:assistant`
      if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text' && typeof update.content.text === 'string') this.emit(turn, { kind: 'assistant_delta', itemId, text: update.content.text })
      else if (update?.sessionUpdate === 'agent_thought_chunk' && update.content?.type === 'text' && typeof update.content.text === 'string') this.emit(turn, { kind: 'reasoning_delta', itemId: `${itemId}:reasoning`, text: update.content.text, visibility: 'full_runtime_text', source: 'model' })
      else if (['tool_call', 'tool_call_update'].includes(update?.sessionUpdate) && typeof update.toolCallId === 'string') {
        const previous = turn.items.get(update.toolCallId)
        const statuses: Record<string, DshToolItem['status']> = { pending: 'pending', in_progress: 'running', completed: 'completed', failed: 'failed' }
        const item: DshToolItem = { ...previous, id: update.toolCallId, turnId: turn.identity.turnId, kind: 'tool', toolKind: 'tool_call',
          status: statuses[update.status] ?? previous?.status ?? 'pending',
          summary: typeof update.title === 'string' ? update.title : previous?.summary,
          detail: acpToolDetail(update, previous?.detail),
          meta: { origin: 'acp', authoritativeExecutionReceipt: false } }
        turn.items.set(update.toolCallId, item)
        // ACP declares the tool kind on the call itself; permissions for that
        // call may arrive without it, so the turn remembers what it observed.
        if (typeof update.kind === 'string') turn.toolKinds.set(update.toolCallId, update.kind)
        this.emit(turn, { kind: 'item_snapshot', item })
      }
      // The item carries the ACP-relayed result text verbatim; no ExecutionReceipt
      // is fabricated from ACP tool updates because Host MCP owns tool receipts.
      return
    }
    if (message.method === 'session/request_permission' && message.id !== undefined) {
      if (!turn || !this.current(turn) || message.params?.sessionId !== turn.identity.threadId) {
        this.connection?.send({ id: message.id, result: { outcome: { outcome: 'cancelled' } } }); return
      }
      const choices = message.params.options
      if (!Array.isArray(choices) || !choices.every(o => typeof o?.optionId === 'string' && ['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(o.kind))) {
        this.connection?.send({ id: message.id, result: { outcome: { outcome: 'cancelled' } } }); return
      }
      const requestId = randomUUID()
      const timer = setTimeout(() => { this.settleApproval(requestId, 'cancel', 'approval_timeout'); void this.interruptTurn({}, { runtimeId: 'dsh', threadId: turn.identity.threadId, turnId: turn.identity.turnId }) }, this.options.approvalTimeoutMs ?? 60_000)
      this.approvals.set(requestId, { id: message.id, turn, options: structuredClone(choices), timer })
      const toolCallId = typeof message.params.toolCall?.toolCallId === 'string' ? message.params.toolCall.toolCallId : undefined
      // The Host owns the approval descriptor and classifies it from the ACP tool
      // kind. A kind this turn never observed stays absent: an unclassified
      // request must fall back to the generic descriptor, never be guessed into
      // a stronger or weaker one.
      const toolKind = typeof message.params.toolCall?.kind === 'string'
        ? message.params.toolCall.kind
        : toolCallId ? turn.toolKinds.get(toolCallId) : undefined
      this.emit(turn, { kind: 'approval_requested', approvalId: requestId, summary: 'DSH requests permission', meta: { options: structuredClone(choices), toolCallId, ...(toolKind ? { acpToolKind: toolKind } : {}) } })
      return
    }
    if (message.id !== undefined) this.connection?.send({ id: message.id, error: { code: -32601, message: 'Client method unavailable' } })
  }
  private settleApproval(id: string, decision: 'allow' | 'deny' | 'cancel', reason?: string, optionId?: string) {
    const approval = this.approvals.get(id)
    if (!approval) return false
    this.approvals.delete(id); clearTimeout(approval.timer)
    try { this.connection?.send({ id: approval.id, result: { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } } }) } catch { /* disconnected, still terminate local approval */ }
    this.emit(approval.turn, { kind: 'approval_resolved', approvalId: id, decision: decision === 'allow' ? 'allowed' : decision === 'deny' ? 'denied' : 'error', message: reason })
    return true
  }
  async resolveApproval(_context: DshContext, input: DshApprovalResponse) {
    this.assertRuntime(input)
    const approval = this.approvals.get(input.approvalId)
    if (!approval || !this.current(approval.turn) || input.threadId !== approval.turn.identity.threadId) throw new DshRuntimeError('runtime_approval_stale')
    const option = approval.options.find(o => o.kind === (input.decision === 'allowed' ? 'allow_once' : input.decision === 'denied' ? 'reject_once' : ''))
    if (!option) throw new DshRuntimeError('runtime_approval_invalid')
    this.settleApproval(input.approvalId, option.kind === 'allow_once' ? 'allow' : 'deny', undefined, option.optionId)
  }
  private finish(turn: Turn, state: 'completed' | 'failed' | 'interrupted', reason?: string) {
    if (turn.finished) return
    for (const [id, approval] of this.approvals) if (approval.turn === turn) this.settleApproval(id, 'cancel', reason ?? 'turn_finished')
    for (const [id, item] of turn.items) if (item.status === 'pending' || item.status === 'running') {
      const terminal: DshToolItem = { ...item, status: state === 'interrupted' ? 'aborted' : 'failed' }
      turn.items.set(id, terminal); this.emit(turn, { kind: 'item_snapshot', item: terminal })
    }
    turn.finished = true; turn.controller.abort(); turn.abortCleanup?.()
    this.emit(turn, { kind: 'turn_lifecycle', state, message: reason })
    if (this.active === turn) this.active = undefined
  }
  async interruptTurn(_context: DshContext, input: { runtimeId: string; threadId: string; turnId?: string | null }) {
    this.assertRuntime(input)
    const turn = this.active
    if (!turn || input.threadId !== turn.identity.threadId || (input.turnId && input.turnId !== turn.identity.turnId)) return
    if (turn.cancellation) return turn.cancellation
    // Reserve single-flight before aborting: AbortSignal listeners may reenter.
    let resolve!: () => void
    let reject!: (error: unknown) => void
    turn.cancellation = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    void this.cancelTurn(turn).then(resolve, reject)
    return turn.cancellation
  }
  private async cancelTurn(turn: Turn) {
    turn.cancelling = true
    turn.controller.abort()
    for (const [id, approval] of this.approvals) if (approval.turn === turn) this.settleApproval(id, 'cancel', 'runtime_cancelled')
    try { turn.transport?.notify('session/cancel', { sessionId: turn.identity.threadId }) } catch { /* already disconnected */ }
    // A cancel notification is not quiescence. Keep busy until the original
    // prompt response settles; timeout retires the transport, never reuses it.
    let timer: NodeJS.Timeout | undefined
    const quiescence = (async () => { await turn.startup; await turn.prompt })()
    try {
      const settled = await Promise.race([
        quiescence.then(() => true),
        new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), this.options.cancelTimeoutMs ?? this.options.requestTimeoutMs ?? 15_000) })
      ])
      if (!settled) {
        if (this.active === turn && (turn.generation === this.generation || turn.generation === -1)) await this.retire()
        await turn.transport?.close()
        await quiescence
      }
      await this.retiring
    } finally { if (timer) clearTimeout(timer) }
    this.finish(turn, 'interrupted', 'runtime_cancelled')
  }
  async closeSession(context: DshContext, input: { runtimeId: string; sessionId: string }) {
    this.assertRuntime(input)
    if (this.active && this.active.identity.threadId !== input.sessionId) throw new DshRuntimeError('runtime_busy')
    if (this.active) {
      await this.interruptTurn(context, { runtimeId: 'dsh', threadId: input.sessionId })
    }
    try {
      await this.connect(context)
      if (!this.serverCapabilities.sessionCapabilities?.close) throw new DshRuntimeError('runtime_unsupported')
      await this.connection!.request('session/close', { sessionId: input.sessionId })
    } finally { this.threads.delete(input.sessionId); await this.retire() }
    return { ok: true }
  }
  async readThreadStatus(_context: DshContext, input: { runtimeId: string; threadId: string }) {
    this.assertRuntime(input)
    if (!this.threads.has(input.threadId)) throw new DshRuntimeError('runtime_thread_not_found')
    return { id: input.threadId, runtimeId: this.runtimeId, latestSeq: this.seq, status: this.active?.identity.threadId === input.threadId ? 'running' : 'idle' }
  }
  async readThreadPage(_context: DshContext, _input: unknown): Promise<never> { throw new DshRuntimeError('runtime_unsupported') }
  async readToolArtifact(_context: DshContext, _input: unknown): Promise<never> { throw new DshRuntimeError('runtime_unsupported') }
  async renameThread(_context: DshContext, _input: unknown): Promise<never> { throw new DshRuntimeError('runtime_unsupported') }
  async deleteThread(_context: DshContext, _input: unknown): Promise<never> { throw new DshRuntimeError('runtime_unsupported') }
  async steerTurn(_context: DshContext, _input: unknown): Promise<never> { throw new DshRuntimeError('runtime_unsupported') }
  async usage(_context: DshContext, _input: unknown) { return { supported: false as const, reason: 'ACP does not expose usage aggregation' } }
  async capabilities(_context: DshContext) {
    const unavailable = { available: false }
    const mcpAvailable = !!this.options.getAuthorizedMcpServers
    return { contractVersion: 1 as const, runtimeId: this.runtimeId, transport: 'jsonrpc_stdio' as const,
      events: { live: true, replayable: false, sequenced: true, delivery: 'async_iterable' as const }, threadMaterialization: 'immediate' as const,
      latency: { phaseEvents: false, firstTokenMetric: false, turnDurationMetric: false },
      reasoning: { available: true, streaming: true, visibility: 'full_runtime_text' as const, source: 'model' as const },
      model: { inputModalities: ['text'] as ['text'], outputModalities: ['text'] as ['text'], supportsToolCalling: mcpAvailable },
      tools: { toolCalling: mcpAvailable, commandExecution: unavailable, fileChange: unavailable,
        mcp: { available: mcpAvailable }, web: unavailable, research: unavailable, computerUse: unavailable,
        skills: unavailable, subagents: unavailable, diagnostics: unavailable },
      controls: { interrupt: true, steer: false, approval: 'async' as const, userInput: 'unsupported' as const,
        compact: 'unsupported' as const, fork: false, review: false, goals: false, todos: false,
        resumeSession: !!this.serverCapabilities.sessionCapabilities?.resume },
      guard: { execution: 'unsupported' as const },
      storage: { guiOwnedThreads: false, backendThreadIdStable: true, usage: false, attachments: unavailable, memory: unavailable } }
  }
  subscribeEvents(_context: DshContext, input: { runtimeId: string; threadId: string; signal?: AbortSignal; sinceSeq?: number }): AsyncIterable<DshEvent> {
    this.assertRuntime(input)
    if (input.sinceSeq !== undefined) throw new DshRuntimeError('runtime_replay_unsupported')
    const queue: DshEvent[] = []
    let done = false; let wake: (() => void) | undefined
    let failure: DshRuntimeError | undefined
    const stop = () => { done = true; this.listeners.delete(listener); input.signal?.removeEventListener('abort', stop); wake?.() }
    const listener: Listener = { threadId: input.threadId, push: event => {
      if (queue.length >= 2048) { failure = new DshRuntimeError('runtime_event_queue_overflow'); stop(); return }
      queue.push(event); wake?.()
    }, stop }
    this.listeners.add(listener)
    input.signal?.addEventListener('abort', stop, { once: true })
    if (input.signal?.aborted) stop()
    return { async *[Symbol.asyncIterator]() {
      try { while (!done || queue.length) {
        if (failure) throw failure
        const value = queue.shift(); if (value) yield value; else await new Promise<void>(resolve => { wake = resolve })
      }
      if (failure) throw failure
      } finally { stop() }
    } }
  }
  private retire(): Promise<void> {
    if (this.retiring) return this.retiring
    this.mounted.clear()
    const owner = this.retirementOwner = { transport: this.connection, cleanup: this.deploymentCleanup }
    this.connection = undefined; this.deploymentCleanup = undefined; this.deployedVersion = undefined; ++this.generation
    // Defer external cleanup until the single-flight promise has been reserved.
    const task = Promise.resolve().then(async () => {
      await owner.transport?.close()
      await owner.cleanup?.()
    })
    this.retiring = task
    void task.then(() => {
      if (this.retiring === task) { this.retiring = undefined; this.retirementOwner = undefined }
    }, () => { /* Keep the original rejection and owner; no automatic retry. */ })
    return task
  }
  async invalidateModelAccess() {
    if (this.connecting) await this.connecting.catch(() => {})
    if (this.active && this.active.generation !== -1) this.finish(this.active, 'failed', 'runtime_model_route_changed')
    await this.retire()
    this.modelRouterIdentity = undefined
  }
  async close() {
    if (this.closed) { await this.retiring; return }
    if (this.active) this.finish(this.active, 'interrupted', 'runtime_closed')
    this.closed = true
    await this.retire()
    await this.connecting?.catch(() => {})
    for (const listener of [...this.listeners]) listener.stop()
  }
}
