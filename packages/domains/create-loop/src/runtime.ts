import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import type {
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import {
  type DomainWorkflowExecutionReceiptProvider
} from '@sciforge/domain-sdk/workflow-template'
import {
  type CreateLoopSnapshot,
  type WorkflowApprovalDecision,
  type WorkflowCodeCheckResult,
  type WorkflowCodeLanguage,
  type WorkflowNodeRunResultV1,
  type WorkflowNodeTestResult,
  type WorkflowNodeV1,
  type WorkflowPendingApprovalV1,
  type WorkflowRunResult,
  type WorkflowRunStatus,
  type WorkflowRunV1,
  type WorkflowRuntimeStatus,
  type WorkflowSettingsV1,
  type WorkflowV1
} from './contract.js'
import {
  MAX_WORKFLOW_RUNS,
  defaultWorkflowSettings,
  normalizeWorkflowSettings
} from './workflow-settings.js'

const SCHEMA_VERSION = 1
const SCHEDULER_POLL_MS = 30_000
const MAX_NODE_EXECUTIONS = 200
const DEFAULT_MAX_RUN_DURATION_MS = 30 * 60_000
const CODE_TIMEOUT_MS = 30_000

type PersistedState = {
  schemaVersion: typeof SCHEMA_VERSION
  revision: number
  settings: WorkflowSettingsV1
}

type Payload = { json: unknown; text: string }
type ActiveRun = {
  workflowId: string
  runId: string
  controller: AbortController
  promise: Promise<void>
}
type ApprovalWaiter = {
  approval: WorkflowPendingApprovalV1
  resolve: (decision: WorkflowApprovalDecision) => void
}

export type CreateLoopRuntimeOptions = Readonly<{
  statePath: string
  executionReceiptProviders?: readonly DomainWorkflowExecutionReceiptProvider[]
  now?: () => Date
  createId?: () => string
  setInterval?: (handler: () => void, delay: number) => unknown
  clearInterval?: (handle: unknown) => void
}>

export class CreateLoopRuntime {
  readonly #statePath: string
  readonly #now: () => Date
  readonly #createId: () => string
  readonly #setInterval: (handler: () => void, delay: number) => unknown
  readonly #clearInterval: (handle: unknown) => void
  readonly #executionReceiptProviders: readonly DomainWorkflowExecutionReceiptProvider[]
  #context: DomainMainRuntimeLifecycleContext | null = null
  #state: PersistedState | null = null
  #stateOperation: Promise<unknown> = Promise.resolve()
  #activeRuns = new Map<string, ActiveRun>()
  #nodeStatus: WorkflowRuntimeStatus['nodeStatus'] = {}
  #nodeResults: WorkflowRuntimeStatus['nodeResults'] = {}
  #approvals = new Map<string, ApprovalWaiter>()
  #scheduler: unknown = null
  #webhookServer: Server | null = null
  #disposed = false
  #enabled = false

  constructor(options: CreateLoopRuntimeOptions) {
    this.#statePath = path.resolve(options.statePath)
    this.#executionReceiptProviders = Object.freeze([...(options.executionReceiptProviders ?? [])])
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
    this.#setInterval = options.setInterval ??
      ((handler, delay) => globalThis.setInterval(handler, delay))
    this.#clearInterval = options.clearInterval ??
      ((handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>))
  }

  async activate(context: DomainMainRuntimeLifecycleContext): Promise<DomainMainRuntimeDisposer> {
    if (this.#context || this.#disposed) {
      throw new Error('Create Loop runtime cannot be activated more than once.')
    }
    this.#context = context
    await this.#load()
    const applyEnablement = (enabled: boolean): void => {
      this.#enabled = enabled
      if (enabled) {
        this.#startScheduler()
        void this.#syncWebhook()
      } else {
        this.#stopScheduler()
        void this.#stopWebhook()
        this.#cancelAll('Create Loop package was disabled.')
      }
    }
    applyEnablement(await context.enablement.isEnabled())
    const unsubscribe = context.enablement.subscribe(applyEnablement)
    const abort = (): void => { void this.close() }
    context.signal.addEventListener('abort', abort, { once: true })
    return async () => {
      context.signal.removeEventListener('abort', abort)
      unsubscribe()
      await this.close()
    }
  }

  async close(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#enabled = false
    this.#stopScheduler()
    await this.#stopWebhook()
    this.#cancelAll('Create Loop runtime stopped.')
    await Promise.allSettled([...this.#activeRuns.values()].map((run) => run.promise))
    this.#activeRuns.clear()
    this.#approvals.clear()
    this.#context = null
  }

  async read(): Promise<CreateLoopSnapshot> {
    this.#requireActive()
    await this.#stateOperation
    return snapshot(await this.#load())
  }

  async save(
    settings: WorkflowSettingsV1,
    expectedRevision?: number
  ): Promise<CreateLoopSnapshot> {
    this.#requireActive()
    const normalized = normalizeWorkflowSettings(settings)
    const result = await this.#mutate((current) => {
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new Error(
          `Create Loop changed from revision ${expectedRevision} to ${current.revision}; reload before saving.`
        )
      }
      return {
        schemaVersion: SCHEMA_VERSION,
        revision: current.revision + 1,
        settings: normalized
      }
    })
    await this.#syncWebhook()
    return snapshot(result)
  }

  status(): WorkflowRuntimeStatus {
    this.#requireActive()
    return {
      runningWorkflowIds: [...this.#activeRuns.keys()],
      nodeStatus: clone(this.#nodeStatus),
      nodeResults: clone(this.#nodeResults),
      powerSaveBlockerActive: false,
      pendingApprovals: [...this.#approvals.values()].map(({ approval }) => ({ ...approval }))
    }
  }

  async runWorkflow(
    workflowId: string,
    input?: unknown,
    callerWorkspaceRoot = ''
  ): Promise<WorkflowRunResult> {
    this.#requireEnabled()
    if (this.#activeRuns.has(workflowId)) {
      const active = this.#activeRuns.get(workflowId)!
      return { ok: true, runId: active.runId, status: 'running', message: 'Workflow is already running.' }
    }
    const state = await this.#load()
    const workflow = state.settings.workflows.find((candidate) => candidate.id === workflowId)
    if (!workflow) return { ok: false, message: 'Workflow not found.' }
    const trigger = workflow.nodes.find((node) => node.type === 'manual-trigger') ??
      workflow.nodes.find((node) => node.type.endsWith('-trigger'))
    if (!trigger) return { ok: false, message: 'Workflow has no trigger node.' }
    return this.#startRun(
      workflow,
      trigger.id,
      payloadFromInput(input),
      'manual',
      callerWorkspaceRoot
    )
  }

  async stopWorkflow(workflowId: string): Promise<WorkflowRunResult> {
    this.#requireActive()
    const run = this.#activeRuns.get(workflowId)
    if (!run) return { ok: false, message: 'Workflow is not running.' }
    run.controller.abort(new Error('Stopped by user.'))
    return { ok: true, runId: run.runId, status: 'error', message: 'Stop requested.' }
  }

  resolveApproval(token: string, decision: WorkflowApprovalDecision): boolean {
    this.#requireActive()
    const waiter = this.#approvals.get(token)
    if (!waiter) return false
    this.#approvals.delete(token)
    waiter.resolve(decision)
    return true
  }

  async runNode(
    workflowId: string,
    nodeId: string,
    callerWorkspaceRoot = ''
  ): Promise<WorkflowRunResult> {
    this.#requireEnabled()
    const state = await this.#load()
    const workflow = state.settings.workflows.find((candidate) => candidate.id === workflowId)
    const node = workflow?.nodes.find((candidate) => candidate.id === nodeId)
    if (!workflow || !node) return { ok: false, message: 'Workflow node not found.' }
    const runId = this.#createId()
    const result = await this.#executeNode(
      workflow,
      node,
      { json: {}, text: '' },
      runId,
      new AbortController().signal,
      callerWorkspaceRoot
    )
    this.#nodeStatus[workflowId] = { [nodeId]: result.status }
    this.#nodeResults[workflowId] = { [nodeId]: result }
    return {
      ok: result.status === 'success',
      runId,
      status: result.status === 'success' ? 'success' : 'error',
      message: result.message || result.error
    }
  }

  async testNode(
    workflowId: string,
    nodeId: string,
    mockJson: string,
    callerWorkspaceRoot = ''
  ): Promise<WorkflowNodeTestResult> {
    this.#requireEnabled()
    const state = await this.#load()
    const workflow = state.settings.workflows.find((candidate) => candidate.id === workflowId)
    const node = workflow?.nodes.find((candidate) => candidate.id === nodeId)
    if (!workflow || !node) return { ok: false, message: 'Workflow node not found.' }
    let parsed: unknown
    try {
      parsed = mockJson.trim() ? JSON.parse(mockJson) : {}
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    const result = await this.#executeNode(
      workflow,
      node,
      { json: parsed, text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed) },
      this.#createId(),
      new AbortController().signal,
      callerWorkspaceRoot
    )
    return result.status === 'success' ? { ok: true, result } : { ok: false, message: result.error || result.message }
  }

  async #startRun(
    workflow: WorkflowV1,
    triggerNodeId: string,
    input: Payload,
    trigger: string,
    callerWorkspaceRoot = ''
  ): Promise<WorkflowRunResult> {
    const runId = this.#createId()
    const controller = new AbortController()
    this.#nodeStatus[workflow.id] = {}
    this.#nodeResults[workflow.id] = {}
    const promise = this.#executeRun(
      workflow,
      triggerNodeId,
      input,
      trigger,
      runId,
      controller.signal,
      callerWorkspaceRoot
    )
      .catch((error) => this.#log('error', `Workflow ${workflow.id} failed.`, error))
      .finally(() => {
        this.#activeRuns.delete(workflow.id)
        const cleanup = setTimeout(() => {
          if (!this.#activeRuns.has(workflow.id)) {
            delete this.#nodeStatus[workflow.id]
            delete this.#nodeResults[workflow.id]
          }
        }, 8_000)
        cleanup.unref?.()
      })
    this.#activeRuns.set(workflow.id, { workflowId: workflow.id, runId, controller, promise })
    return { ok: true, runId, status: 'running', message: 'Workflow started.' }
  }

  async #executeRun(
    workflow: WorkflowV1,
    triggerNodeId: string,
    input: Payload,
    trigger: string,
    runId: string,
    signal: AbortSignal,
    callerWorkspaceRoot: string
  ): Promise<void> {
    const startedAt = this.#now().toISOString()
    let status: WorkflowRunStatus = 'success'
    let message = 'Workflow completed.'
    const results: WorkflowNodeRunResultV1[] = []
    try {
      await withTimeout(
        this.#executeGraph(
          workflow,
          triggerNodeId,
          input,
          runId,
          signal,
          results,
          callerWorkspaceRoot
        ),
        this.#workflowTimeoutMs(workflow),
        signal
      )
    } catch (error) {
      status = 'error'
      message = signal.aborted ? 'Workflow stopped.' : errorMessage(error)
    }
    const finishedAt = this.#now().toISOString()
    let run: WorkflowRunV1 = {
      id: runId,
      trigger,
      status,
      startedAt,
      finishedAt,
      message,
      nodeResults: results
    }
    const receiptProvider = this.#executionReceiptProvider(workflow)
    if (receiptProvider?.writeRunReceipt) {
      try {
        const reportPath = await receiptProvider.writeRunReceipt({
          statePath: this.#statePath,
          workflow,
          run,
          workspaceRoot: callerWorkspaceRoot
        })
        run = { ...run, reportPath }
      } catch (error) {
        run = {
          ...run,
          status: 'error',
          message: `Workflow audit report failed: ${errorMessage(error)}`
        }
      }
    }
    status = run.status
    message = run.message
    await this.#mutate((current) => {
      const workflows = current.settings.workflows.map((candidate) =>
        candidate.id === workflow.id
          ? {
              ...candidate,
              lastRunAt: finishedAt,
              lastStatus: status,
              lastMessage: message,
              runs: [...candidate.runs, run].slice(-MAX_WORKFLOW_RUNS)
            }
          : candidate
      )
      return {
        ...current,
        revision: current.revision + 1,
        settings: { ...current.settings, workflows }
      }
    })
  }

  async #executeGraph(
    workflow: WorkflowV1,
    triggerNodeId: string,
    initial: Payload,
    runId: string,
    signal: AbortSignal,
    results: WorkflowNodeRunResultV1[],
    callerWorkspaceRoot: string
  ): Promise<Payload> {
    const byId = new Map(workflow.nodes.map((node) => [node.id, node]))
    const queue: Array<{ nodeId: string; payload: Payload }> = [{ nodeId: triggerNodeId, payload: initial }]
    let last = initial
    let executed = 0
    while (queue.length > 0) {
      if (signal.aborted) throw signal.reason
      if (++executed > MAX_NODE_EXECUTIONS) throw new Error(`Workflow exceeded ${MAX_NODE_EXECUTIONS} node executions.`)
      const current = queue.shift()!
      const node = byId.get(current.nodeId)
      if (!node) continue
      const result = await this.#executeNode(
        workflow,
        node,
        current.payload,
        runId,
        signal,
        callerWorkspaceRoot
      )
      results.push(result)
      this.#nodeStatus[workflow.id] = {
        ...(this.#nodeStatus[workflow.id] ?? {}),
        [node.id]: result.status
      }
      this.#nodeResults[workflow.id] = {
        ...(this.#nodeResults[workflow.id] ?? {}),
        [node.id]: result
      }
      if (result.status !== 'success') {
        if (node.onError === 'continue') continue
        throw new Error(result.error || result.message)
      }
      last = payloadFromResult(result)
      const branch = branchFromMessage(result.message)
      for (const edge of workflow.connections.filter((candidate) => candidate.source === node.id)) {
        if (branch && edge.sourceHandle && edge.sourceHandle !== branch) continue
        queue.push({ nodeId: edge.target, payload: last })
      }
    }
    return last
  }

  async #executeNode(
    workflow: WorkflowV1,
    node: WorkflowNodeV1,
    payload: Payload,
    runId: string,
    signal: AbortSignal,
    callerWorkspaceRoot = ''
  ): Promise<WorkflowNodeRunResultV1> {
    const startedAt = this.#now().toISOString()
    this.#nodeStatus[workflow.id] = {
      ...(this.#nodeStatus[workflow.id] ?? {}),
      [node.id]: 'running'
    }
    const retries = Math.min(10, Math.max(0, node.retries ?? 0))
    const receiptProvider = this.#executionReceiptProvider(workflow)
    const timeoutMs = receiptProvider?.nodeTimeoutMs?.(workflow, node) ?? 0
    const timeoutDeadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const remainingTimeoutMs = timeoutMs > 0
          ? Math.max(1, timeoutDeadline - Date.now())
          : 0
        const output = timeoutMs > 0
          ? await withAbortTimeout(
              (nodeSignal) => this.#nodeOutput(
                workflow,
                node,
                payload,
                runId,
                nodeSignal,
                callerWorkspaceRoot,
                startedAt
              ),
              remainingTimeoutMs,
              signal,
              `Node '${node.id}' timed out after ${timeoutMs} ms.`
            )
          : await this.#nodeOutput(
              workflow,
              node,
              payload,
              runId,
              signal,
              callerWorkspaceRoot,
              startedAt
            )
        return {
          nodeId: node.id,
          status: 'success',
          startedAt,
          finishedAt: this.#now().toISOString(),
          message: output.message,
          outputJson: JSON.stringify(output.payload.json),
          inputJson: JSON.stringify(payload.json),
          retries: attempt,
          threadId: output.threadId ?? '',
          error: ''
        }
      } catch (error) {
        const timeoutBudgetExhausted = timeoutMs > 0 && Date.now() >= timeoutDeadline
        if (!signal.aborted && !timeoutBudgetExhausted && attempt < retries) {
          await abortableDelay(Math.max(0, node.retryDelayMs ?? 0), signal)
          continue
        }
        if (!signal.aborted && receiptProvider?.recoverAgentResult) {
          try {
            const recoveredText = await receiptProvider.recoverAgentResult({
              workflow,
              node,
              incoming: payload.json,
              workspaceRoot: callerWorkspaceRoot,
              nodeStartedAt: startedAt
            })
            return {
              nodeId: node.id,
              status: 'success',
              startedAt,
              finishedAt: this.#now().toISOString(),
              message: recoveredText,
              outputJson: JSON.stringify({ text: recoveredText }),
              inputJson: JSON.stringify(payload.json),
              retries: attempt,
              threadId: '',
              error: `Recovered from immutable execution receipt '${receiptProvider.id}' after Agent failure: ${errorMessage(error)}`
            }
          } catch {
            // Preserve the original Agent failure when the package-owned
            // receipt provider cannot prove a recoverable execution.
          }
        }
        if (node.onError === 'fallback') {
          const fallback = parseJsonOrText(node.fallbackJson ?? '{}')
          return {
            nodeId: node.id,
            status: 'success',
            startedAt,
            finishedAt: this.#now().toISOString(),
            message: 'Node fallback applied.',
            outputJson: JSON.stringify(fallback),
            inputJson: JSON.stringify(payload.json),
            retries: attempt,
            threadId: '',
            error: errorMessage(error)
          }
        }
        return {
          nodeId: node.id,
          status: 'error',
          startedAt,
          finishedAt: this.#now().toISOString(),
          message: '',
          outputJson: '',
          inputJson: JSON.stringify(payload.json),
          retries: attempt,
          threadId: '',
          error: errorMessage(error)
        }
      }
    }
    throw new Error('Unreachable workflow retry state.')
  }

  async #nodeOutput(
    workflow: WorkflowV1,
    node: WorkflowNodeV1,
    payload: Payload,
    runId: string,
    signal: AbortSignal,
    callerWorkspaceRoot: string,
    nodeStartedAt: string
  ): Promise<{ payload: Payload; message: string; threadId?: string }> {
    if (node.disabled) return { payload, message: 'Skipped disabled node.' }
    switch (node.type) {
      case 'manual-trigger':
      case 'schedule-trigger':
      case 'webhook-trigger':
      case 'merge':
        return { payload, message: 'Trigger received.' }
      case 'llm': {
        const prompt = interpolate(node.config.prompt, payload)
        const responseText = await this.#reason(prompt, node.config.model, signal)
        const text = this.#executionReceiptProvider(workflow)?.normalizeModelOutput?.({
          workflow,
          node,
          incoming: payload,
          responseText
        }) ?? responseText
        return { payload: { json: { text }, text }, message: text }
      }
      case 'ai-agent': {
        const context = this.#requireContext()
        if (!context.agentExecution) {
          throw new Error('The Host does not provide agent execution.')
        }
        const state = await this.#load()
        const trigger = workflow.nodes.find((candidate) => candidate.type.endsWith('-trigger'))
        const triggerWorkspace = trigger && 'workspaceRoot' in trigger.config
          ? interpolate(trigger.config.workspaceRoot ?? '', payload).trim()
          : ''
        const workspaceRoot =
          interpolate(node.config.workspaceRoot, payload).trim() ||
          triggerWorkspace ||
          state.settings.defaultWorkspaceRoot.trim() ||
          callerWorkspaceRoot.trim()
        if (!workspaceRoot) {
          throw new Error('AI Agent nodes require an active or configured workspace.')
        }
        const result = await context.agentExecution.run({
          ...(node.config.runtimeId ? { runtimeId: node.config.runtimeId } : {}),
          prompt: interpolate(node.config.prompt, payload),
          workspaceRoot,
          ...(node.config.model.trim() ? { model: node.config.model.trim() } : {}),
          ...(node.config.reasoningEffort === 'off'
            ? {}
            : { reasoningEffort: node.config.reasoningEffort }),
          ...(node.config.allowedTools
            ? { allowedTools: node.config.allowedTools }
            : {}),
          mode: node.config.mode,
          signal
        })
        const receiptProvider = this.#executionReceiptProvider(workflow)
        const resultText = receiptProvider?.hydrateAgentResult
          ? await receiptProvider.hydrateAgentResult({
              workflow,
              node,
              text: result.text,
              workspaceRoot,
              incoming: payload.json,
              nodeStartedAt
            })
          : result.text
        return {
          payload: { json: { text: resultText }, text: resultText },
          message: resultText,
          ...(result.threadId ? { threadId: result.threadId } : {})
        }
      }
      case 'parameter-extractor': {
        const instruction = `${node.config.instruction}\nReturn JSON only.\nInput:\n${interpolate(node.config.source || '{{text}}', payload)}`
        const text = await this.#reason(instruction, node.config.model, signal)
        const json = parseJson(text)
        return { payload: { json, text }, message: text }
      }
      case 'question-classifier': {
        const labels = node.config.categories.map((category) => `${category.id}: ${category.label}`).join('\n')
        const prompt = `${node.config.instruction}\nChoose one category id and return only that id.\n${labels}\nInput:\n${payload.text}`
        const selected = (await this.#reason(prompt, node.config.model, signal)).trim()
        return { payload, message: `branch:${selected}` }
      }
      case 'condition':
      case 'filter': {
        const matches = evaluateCondition(valueAt(payload, node.config.leftExpr), node.config.operator, node.config.rightValue, node.config.caseSensitive)
        if (node.type === 'filter' && !matches) return { payload, message: 'branch:__none__' }
        return { payload, message: `branch:${matches ? 'true' : 'false'}` }
      }
      case 'switch': {
        const index = node.config.rules.findIndex((rule) =>
          evaluateCondition(valueAt(payload, rule.leftExpr), rule.operator, rule.rightValue, rule.caseSensitive)
        )
        return { payload, message: `branch:${index >= 0 ? `case-${index}` : node.config.fallback ? 'fallback' : '__none__'}` }
      }
      case 'set-fields': {
        const values = Object.fromEntries(node.config.fields.map((field) => [field.key, interpolate(field.value, payload)]))
        const base = node.config.keepIncoming && isRecord(payload.json) ? payload.json : {}
        const json = { ...base, ...values }
        return { payload: { json, text: JSON.stringify(json) }, message: 'Fields set.' }
      }
      case 'template': {
        const text = interpolate(node.config.template, payload)
        const json = node.config.outputMode === 'json' ? parseJson(text) : { text }
        return { payload: { json, text }, message: text }
      }
      case 'json': {
        if (node.config.mode === 'parse') {
          const json = node.config.strict
            ? JSON.parse(payload.text) as unknown
            : parseJson(payload.text)
          return { payload: { json, text: payload.text }, message: 'JSON parsed.' }
        }
        const text = JSON.stringify(payload.json)
        return { payload: { json: { text }, text }, message: text }
      }
      case 'sort': {
        const array = Array.isArray(payload.json) ? [...payload.json] : []
        array.sort((left, right) => compareValues(pathValue(left, node.config.field), pathValue(right, node.config.field), node.config.numeric) * (node.config.order === 'desc' ? -1 : 1))
        return { payload: { json: array, text: JSON.stringify(array) }, message: 'Items sorted.' }
      }
      case 'limit': {
        const array = Array.isArray(payload.json) ? payload.json : []
        const json = node.config.from === 'last' ? array.slice(-node.config.count) : array.slice(0, node.config.count)
        return { payload: { json, text: JSON.stringify(json) }, message: 'Items limited.' }
      }
      case 'aggregate': {
        const array = Array.isArray(payload.json) ? payload.json : []
        const values = array.map((item) => pathValue(item, node.config.field))
        const json = node.config.mode === 'count'
          ? { count: array.length }
          : node.config.mode === 'sum'
            ? { sum: values.reduce<number>((sum, value) => sum + Number(value || 0), 0) }
            : node.config.mode === 'join'
              ? { text: values.join(node.config.separator) }
              : { values }
        return { payload: { json, text: JSON.stringify(json) }, message: 'Values aggregated.' }
      }
      case 'http-request': {
        const response = await fetch(interpolate(node.config.url, payload), {
          method: node.config.method,
          headers: Object.fromEntries(node.config.headers.filter((header) => header.key.trim()).map((header) => [header.key, interpolate(header.value, payload)])),
          ...(node.config.method === 'GET' || node.config.method === 'DELETE'
            ? {}
            : { body: interpolate(node.config.body, payload) }),
          signal
        })
        const text = await response.text()
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
        const json = node.config.parseJson ? parseJson(text) : { status: response.status, body: text }
        return { payload: { json, text }, message: `HTTP ${response.status}` }
      }
      case 'delay':
        await abortableDelay(Math.max(0, node.config.delayMs), signal)
        return { payload, message: 'Delay completed.' }
      case 'code':
        return executeCode(node.config.language, node.config.code, payload, signal)
      case 'output': {
        if (node.config.mode === 'text') {
          const text = interpolate(node.config.textTemplate, payload)
          return { payload: { json: { text }, text }, message: text }
        }
        if (node.config.mode === 'json') {
          const json = pathValue(payload.json, node.config.jsonPath)
          return { payload: { json, text: JSON.stringify(json) }, message: 'Output selected.' }
        }
        return { payload, message: payload.text }
      }
      case 'human-approval': {
        const decision = await this.#waitForApproval(workflow, node, runId, signal)
        if (decision === 'rejected') throw new Error('Human approval rejected.')
        return { payload, message: 'Human approval granted.' }
      }
      case 'subworkflow': {
        const target = (await this.#load()).settings.workflows.find(
          (candidate) => candidate.id === node.config.workflowId
        )
        if (!target || target.id === workflow.id) {
          throw new Error('Subworkflow target is missing or recursively references itself.')
        }
        const trigger = target.nodes.find((candidate) => candidate.type === 'manual-trigger') ??
          target.nodes.find((candidate) => candidate.type.endsWith('-trigger'))
        if (!trigger) throw new Error('Subworkflow target has no trigger.')
        const output = await this.#executeGraph(
          target,
          trigger.id,
          payload,
          runId,
          signal,
          [],
          callerWorkspaceRoot
        )
        return { payload: output, message: output.text || 'Subworkflow completed.' }
      }
      case 'loop': {
        const target = (await this.#load()).settings.workflows.find(
          (candidate) => candidate.id === node.config.workflowId
        )
        if (!target || target.id === workflow.id) {
          throw new Error('Loop body is missing or recursively references itself.')
        }
        const trigger = target.nodes.find((candidate) => candidate.type === 'manual-trigger') ??
          target.nodes.find((candidate) => candidate.type.endsWith('-trigger'))
        if (!trigger) throw new Error('Loop body has no trigger.')
        const maxIterations = Math.min(100, Math.max(1, node.config.maxIterations))
        if (node.config.mode === 'foreach') {
          const selected = node.config.arraySource
            ? valueAt(payload, node.config.arraySource)
            : payload.json
          const items = Array.isArray(selected) ? selected.slice(0, maxIterations) : []
          const runItem = async (item: unknown): Promise<Payload> =>
            this.#executeGraph(
              target,
              trigger.id,
              payloadFromInput(item),
              runId,
              signal,
              [],
              callerWorkspaceRoot
            )
          const outputs = node.config.execution === 'parallel'
            ? await Promise.all(items.map((item) => runItem(item)))
            : await items.reduce<Promise<Payload[]>>(async (pending, item) => [
                ...(await pending),
                await runItem(item)
              ], Promise.resolve([]))
          const json = outputs.map((output) => output.json)
          return { payload: { json, text: JSON.stringify(json) }, message: `${outputs.length} items completed.` }
        }
        let current = payload
        let count = 0
        while (count < maxIterations) {
          const iterationResults: WorkflowNodeRunResultV1[] = []
          current = await this.#executeGraph(
            target,
            trigger.id,
            current,
            runId,
            signal,
            iterationResults,
            callerWorkspaceRoot
          )
          count += 1
          if (current.json && typeof current.json === 'object' && !Array.isArray(current.json)) {
            const currentRecord = current.json as Record<string, unknown>
            const existingTrace = Array.isArray(currentRecord.loopExecutionTrace)
              ? currentRecord.loopExecutionTrace
              : []
            const nextJson = {
              ...currentRecord,
              loopExecutionTrace: [
                ...existingTrace,
                {
                  round: count,
                  nodes: iterationResults.map((result) => ({
                    nodeId: result.nodeId,
                    status: result.status,
                    retries: result.retries ?? 0,
                    threadId: result.threadId,
                    startedAt: result.startedAt,
                    finishedAt: result.finishedAt,
                    error: result.error
                  }))
                }
              ]
            }
            current = { json: nextJson, text: JSON.stringify(nextJson) }
          }
          if (evaluateCondition(
            valueAt(current, node.config.leftExpr),
            node.config.operator,
            node.config.rightValue,
            node.config.caseSensitive
          )) break
        }
        return { payload: current, message: `${count} iterations completed.` }
      }
      case 'generate-image':
        throw new Error('Image generation requires the generic image capability port.')
      case 'research-search':
      case 'paper-download':
        throw new Error(`${node.type} requires the generic research capability port.`)
      case 'custom': {
        const module = (await this.#load()).settings.modules.find(
          (candidate) => candidate.id === node.config.moduleId
        )
        if (!module) throw new Error('Custom module not found.')
        const fields = Object.fromEntries(module.fields.map((field) => {
          const raw = node.config.values[field.key] ?? field.defaultValue
          const value = field.type === 'number'
            ? Number(raw)
            : field.type === 'boolean'
              ? raw === 'true'
              : raw
          return [field.key, value]
        }))
        const sourcePayload = fields
        if (module.language === 'javascript') {
          const output = runInNewContext(
            `(async ($json, $text, $fields) => { ${module.code}\n})`,
            {},
            { timeout: CODE_TIMEOUT_MS }
          )(payload.json, payload.text, fields)
          const resolved = await output
          return { payload: payloadFromInput(resolved ?? sourcePayload), message: 'Custom module completed.' }
        }
        const bin = module.language === 'python' ? 'python3' : 'bash'
        const text = await runProcess(bin, ['-c', module.code], JSON.stringify(payload.json), signal, {
          WORKFLOW_JSON: JSON.stringify(payload.json),
          WORKFLOW_TEXT: payload.text,
          WORKFLOW_FIELDS: JSON.stringify(fields)
        })
        return { payload: payloadFromInput(parseJsonOrText(text)), message: text || 'Custom module completed.' }
      }
      default:
        return { payload, message: 'Node completed.' }
    }
  }

  async #reason(prompt: string, requestedModel: string, signal: AbortSignal): Promise<string> {
    const access = await this.#requireContext().modelAccess.textReasoner()
    if (!access) throw new Error('No text reasoner is configured.')
    const base = access.baseUrl.replace(/\/+$/, '')
    const url = base.endsWith('/v1') ? `${base}/responses` : `${base}/v1/responses`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(access.apiKey ? { authorization: `Bearer ${access.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: requestedModel.trim() || access.model,
        input: prompt
      }),
      signal
    })
    const raw = await response.text()
    if (!response.ok) throw new Error(`Model request failed (${response.status}): ${raw.slice(0, 500)}`)
    return modelText(parseJson(raw))
  }

  async #waitForApproval(
    workflow: WorkflowV1,
    node: Extract<WorkflowNodeV1, { type: 'human-approval' }>,
    runId: string,
    signal: AbortSignal
  ): Promise<WorkflowApprovalDecision> {
    const token = this.#createId()
    return new Promise<WorkflowApprovalDecision>((resolve, reject) => {
      const approval: WorkflowPendingApprovalV1 = {
        token,
        workflowId: workflow.id,
        runId,
        nodeId: node.id,
        nodeName: node.name,
        title: node.config.title,
        instruction: node.config.instruction,
        createdAt: this.#now().toISOString()
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (decision: WorkflowApprovalDecision): void => {
        if (timer) clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        resolve(decision)
      }
      const abort = (): void => {
        if (timer) clearTimeout(timer)
        this.#approvals.delete(token)
        reject(signal.reason)
      }
      signal.addEventListener('abort', abort, { once: true })
      this.#approvals.set(token, {
        approval,
        resolve: (decision) => {
          finish(decision)
        }
      })
      if (node.config.timeoutMs > 0) {
        timer = setTimeout(() => {
          this.#approvals.delete(token)
          finish(node.config.onTimeout)
        }, node.config.timeoutMs)
      }
    })
  }

  #startScheduler(): void {
    if (this.#scheduler !== null) return
    this.#scheduler = this.#setInterval(() => { void this.#runDueSchedules() }, SCHEDULER_POLL_MS)
    void this.#runDueSchedules()
  }

  #stopScheduler(): void {
    if (this.#scheduler === null) return
    this.#clearInterval(this.#scheduler)
    this.#scheduler = null
  }

  async #runDueSchedules(): Promise<void> {
    if (!this.#enabled || this.#disposed) return
    const state = await this.#load()
    const now = this.#now()
    const workflows = state.settings.workflows.map((workflow) => {
      if (!workflow.enabled || this.#activeRuns.has(workflow.id)) return workflow
      const triggers = workflow.nodes.filter(
        (node): node is Extract<WorkflowNodeV1, { type: 'schedule-trigger' }> =>
          node.type === 'schedule-trigger' && !node.disabled && node.config.schedule.kind !== 'manual'
      )
      const due = triggers.find((node) => isScheduleDue(node.config.schedule, workflow.nextRunAt, now))
      if (!due) return workflow
      void this.#startRun(workflow, due.id, { json: {}, text: '' }, due.id)
      return { ...workflow, nextRunAt: nextScheduleAt(due.config.schedule, now) }
    })
    if (workflows.some((workflow, index) => workflow !== state.settings.workflows[index])) {
      await this.#mutate((current) => ({
        ...current,
        revision: current.revision + 1,
        settings: { ...current.settings, workflows }
      }))
    }
  }

  async #syncWebhook(): Promise<void> {
    if (!this.#enabled || this.#disposed) return this.#stopWebhook()
    const state = await this.#load()
    const shouldListen = state.settings.enabled &&
      state.settings.workflows.some((workflow) => workflow.enabled && workflow.nodes.some((node) => node.type === 'webhook-trigger'))
    if (!shouldListen) return this.#stopWebhook()
    if (this.#webhookServer?.listening) {
      const address = this.#webhookServer.address()
      if (address && typeof address === 'object' && address.port === state.settings.webhookPort) return
      await this.#stopWebhook()
    }
    const server = createServer((request, response) => { void this.#handleWebhook(request, response) })
    this.#webhookServer = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(state.settings.webhookPort, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
  }

  async #stopWebhook(): Promise<void> {
    const server = this.#webhookServer
    this.#webhookServer = null
    if (!server?.listening) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  async #handleWebhook(request: IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
    try {
      const state = await this.#load()
      if (!authorized(request, state.settings.webhookSecret)) {
        writeJsonResponse(response, 401, { ok: false, message: 'Unauthorized.' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const workflow = state.settings.workflows.find((candidate) =>
        candidate.enabled && candidate.nodes.some((node) =>
          node.type === 'webhook-trigger' && !node.disabled &&
          node.config.path === url.pathname &&
          (node.config.method === 'ANY' || node.config.method === request.method)
        )
      )
      if (!workflow) {
        writeJsonResponse(response, 404, { ok: false, message: 'No enabled workflow matches this webhook.' })
        return
      }
      const trigger = workflow.nodes.find((node) =>
        node.type === 'webhook-trigger' && node.config.path === url.pathname
      )!
      const body = await readBody(request)
      const result = await this.#startRun(workflow, trigger.id, payloadFromInput(body), trigger.id)
      writeJsonResponse(response, result.ok ? 202 : 400, result)
    } catch (error) {
      writeJsonResponse(response, 500, { ok: false, message: errorMessage(error) })
    }
  }

  #cancelAll(message: string): void {
    for (const run of this.#activeRuns.values()) run.controller.abort(new Error(message))
    for (const [token, waiter] of this.#approvals) {
      this.#approvals.delete(token)
      waiter.resolve('rejected')
    }
  }

  async #load(): Promise<PersistedState> {
    if (this.#state) return this.#state
    try {
      const parsed = JSON.parse(await readFile(this.#statePath, 'utf8')) as Partial<PersistedState>
      this.#state = {
        schemaVersion: SCHEMA_VERSION,
        revision: Number.isInteger(parsed.revision) ? Math.max(0, Number(parsed.revision)) : 0,
        settings: normalizeWorkflowSettings(parsed.settings)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await this.#quarantineCorruptState()
      }
      this.#state = {
        schemaVersion: SCHEMA_VERSION,
        revision: 0,
        settings: defaultWorkflowSettings()
      }
      await this.#persist(this.#state)
    }
    return this.#state
  }

  async #mutate(transform: (state: PersistedState) => PersistedState): Promise<PersistedState> {
    const pending = this.#stateOperation.then(async () => {
      const current = await this.#load()
      const next = transform(current)
      await this.#persist(next)
      this.#state = next
      return next
    })
    this.#stateOperation = pending.catch(() => undefined)
    return pending
  }

  async #persist(state: PersistedState): Promise<void> {
    await mkdir(path.dirname(this.#statePath), { recursive: true })
    const temp = `${this.#statePath}.${process.pid}.${this.#createId()}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.#statePath)
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
  }

  async #quarantineCorruptState(): Promise<void> {
    const target = `${this.#statePath}.corrupt-${Date.now()}`
    await rename(this.#statePath, target).catch(() => undefined)
  }

  #requireContext(): DomainMainRuntimeLifecycleContext {
    if (!this.#context || this.#disposed) throw new Error('Create Loop runtime is not active.')
    return this.#context
  }

  #requireActive(): void {
    this.#requireContext()
  }

  #requireEnabled(): void {
    this.#requireActive()
    if (!this.#enabled) throw new Error('Create Loop package is disabled.')
  }

  #executionReceiptProvider(
    workflow: WorkflowV1
  ): DomainWorkflowExecutionReceiptProvider | undefined {
    return this.#executionReceiptProviders.find((provider) => provider.matches(workflow))
  }

  #workflowTimeoutMs(workflow: WorkflowV1): number {
    return this.#executionReceiptProvider(workflow)?.workflowTimeoutMs?.(workflow)
      ?? DEFAULT_MAX_RUN_DURATION_MS
  }

  #log(level: 'debug' | 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
    this.#context?.log({ level, message, ...(detail === undefined ? {} : { detail }) })
  }
}

export function createLoopStatePath(userDataDir: string): string {
  return path.join(userDataDir, 'domains', 'create-loop', 'state.json')
}

export async function checkWorkflowCode(
  language: WorkflowCodeLanguage,
  code: string
): Promise<WorkflowCodeCheckResult> {
  if (!code.trim()) return { status: 'ok' }
  try {
    if (language === 'javascript') {
      new Function('$json', '$text', `"use strict";\n${code}`)
      return { status: 'ok' }
    }
    const bin = language === 'python' ? 'python3' : 'bash'
    const args = language === 'python' ? ['-m', 'py_compile', '-'] : ['-n']
    await runProcess(bin, args, code, new AbortController().signal)
    return { status: 'ok' }
  } catch (error) {
    const message = errorMessage(error)
    return /ENOENT/.test(message)
      ? { status: 'unavailable', message: `${language} is not installed.` }
      : { status: 'error', message }
  }
}

function snapshot(state: PersistedState): CreateLoopSnapshot {
  return { revision: state.revision, settings: clone(state.settings) }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function payloadFromInput(input: unknown): Payload {
  if (typeof input === 'string') return { json: { text: input }, text: input }
  const json = input ?? {}
  return { json, text: isRecord(json) && typeof json.text === 'string' ? json.text : JSON.stringify(json) }
}

function payloadFromResult(result: WorkflowNodeRunResultV1): Payload {
  if (!result.outputJson) return { json: {}, text: result.message }
  const json = parseJson(result.outputJson)
  return {
    json,
    text: isRecord(json) && typeof json.text === 'string'
      ? json.text
      : result.outputJson
  }
}

function branchFromMessage(message: string): string | null {
  return message.startsWith('branch:') ? message.slice('branch:'.length) : null
}

function interpolate(template: string, payload: Payload): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, raw: string) => {
    const expression = raw.trim()
    if (expression === 'text') return payload.text
    if (expression === 'json') return JSON.stringify(payload.json)
    if (expression.startsWith('json.')) return String(pathValue(payload.json, expression.slice(5)) ?? '')
    return ''
  })
}

function valueAt(payload: Payload, expression: string): unknown {
  const normalized = expression.trim()
  if (!normalized || normalized === 'text') return payload.text
  if (normalized === 'json') return payload.json
  return pathValue(payload.json, normalized.replace(/^json\./, ''))
}

function pathValue(value: unknown, rawPath: string): unknown {
  if (!rawPath.trim()) return value
  return rawPath.split('.').filter(Boolean).reduce<unknown>((current, key) =>
    isRecord(current) ? current[key] : Array.isArray(current) ? current[Number(key)] : undefined, value)
}

function evaluateCondition(
  left: unknown,
  operator: string,
  rightRaw: string,
  caseSensitive: boolean
): boolean {
  const rawLeft = left == null ? '' : typeof left === 'string' ? left : JSON.stringify(left)
  const leftText = caseSensitive ? rawLeft : rawLeft.toLowerCase()
  const rightText = caseSensitive ? rightRaw : rightRaw.toLowerCase()
  switch (operator) {
    case 'contains': return leftText.includes(rightText)
    case 'notContains': return !leftText.includes(rightText)
    case 'equals': return leftText === rightText
    case 'notEquals': return leftText !== rightText
    case 'startsWith': return leftText.startsWith(rightText)
    case 'endsWith': return leftText.endsWith(rightText)
    case 'isEmpty': return !leftText
    case 'isNotEmpty': return Boolean(leftText)
    case 'gt': return Number(left) > Number(rightRaw)
    case 'gte': return Number(left) >= Number(rightRaw)
    case 'lt': return Number(left) < Number(rightRaw)
    case 'lte': return Number(left) <= Number(rightRaw)
    default: return false
  }
}

function compareValues(left: unknown, right: unknown, numeric: boolean): number {
  if (numeric) return Number(left ?? 0) - Number(right ?? 0)
  return String(left ?? '').localeCompare(String(right ?? ''))
}

async function executeCode(
  language: WorkflowCodeLanguage,
  code: string,
  payload: Payload,
  signal: AbortSignal
): Promise<{ payload: Payload; message: string }> {
  if (language === 'javascript') {
    const output = runInNewContext(
      `(async ($json, $text) => { ${code}\n})`,
      {},
      { timeout: CODE_TIMEOUT_MS }
    )(payload.json, payload.text)
    const json = await output
    return { payload: payloadFromInput(json), message: 'JavaScript completed.' }
  }
  const bin = language === 'python' ? 'python3' : 'bash'
  const args = language === 'python' ? ['-c', code] : ['-c', code]
  const text = await runProcess(bin, args, JSON.stringify(payload.json), signal, {
    WORKFLOW_JSON: JSON.stringify(payload.json),
    WORKFLOW_TEXT: payload.text
  })
  return { payload: payloadFromInput(parseJsonOrText(text)), message: text }
}

async function runProcess(
  bin: string,
  args: string[],
  stdin: string,
  signal: AbortSignal,
  extraEnv: Record<string, string> = {}
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), CODE_TIMEOUT_MS)
    const abort = (): void => { child.kill('SIGTERM') }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason)
      else if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `${bin} exited with code ${code}.`))
    })
    child.stdin.end(stdin)
  })
}

function modelText(value: unknown): string {
  if (!isRecord(value)) return String(value ?? '')
  if (typeof value.output_text === 'string') return value.output_text
  if (Array.isArray(value.output)) {
    return value.output.flatMap((item) =>
      isRecord(item) && Array.isArray(item.content)
        ? item.content.map((content) => isRecord(content) && typeof content.text === 'string' ? content.text : '')
        : []
    ).filter(Boolean).join('\n')
  }
  return typeof value.text === 'string' ? value.text : JSON.stringify(value)
}

function isScheduleDue(
  schedule: Extract<WorkflowNodeV1, { type: 'schedule-trigger' }>['config']['schedule'],
  nextRunAt: string,
  now: Date
): boolean {
  if (schedule.kind === 'manual') return false
  if (!nextRunAt) return true
  return Date.parse(nextRunAt) <= now.getTime()
}

function nextScheduleAt(
  schedule: Extract<WorkflowNodeV1, { type: 'schedule-trigger' }>['config']['schedule'],
  now: Date
): string {
  if (schedule.kind === 'interval') {
    return new Date(now.getTime() + Math.max(1, schedule.everyMinutes) * 60_000).toISOString()
  }
  if (schedule.kind === 'at') return schedule.atTime
  if (schedule.kind === 'daily') {
    const [hour, minute] = schedule.timeOfDay.split(':').map(Number)
    const next = new Date(now)
    next.setHours(hour || 0, minute || 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    return next.toISOString()
  }
  return ''
}

function authorized(request: IncomingMessage, secret: string): boolean {
  if (!secret.trim()) return true
  return request.headers['x-sciforge-secret'] === secret ||
    request.headers.authorization === `Bearer ${secret}`
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let raw = ''
  for await (const chunk of request) {
    raw += String(chunk)
    if (raw.length > 5_000_000) throw new Error('Webhook body is too large.')
  }
  return raw.trim() ? parseJsonOrText(raw) : {}
}

function writeJsonResponse(
  response: import('node:http').ServerResponse,
  status: number,
  value: unknown
): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}

function parseJson(text: string): unknown {
  const trimmed = text.trim()
  const candidates = [trimmed]
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    candidates.push(match[1]!.trim())
  }
  candidates.push(...extractBalancedJsonValues(trimmed).reverse())
  let lastError: unknown
  for (const candidate of [...new Set(candidates)]) {
    for (const value of [candidate, repairJsonLike(candidate)]) {
      try {
        return JSON.parse(value)
      } catch (error) {
        lastError = error
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Invalid JSON.')
}

function repairJsonLike(text: string): string {
  return escapeUnquotedQuotesInStrings(text
    .replace(/^\uFEFF/u, '')
    .replace(/([{,]\s*)'([^'\\\r\n]+)'(\s*:)/gu, '$1"$2"$3')
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)/gu, '$1"$2"$3')
    .replace(/,\s*([}\]])/gu, '$1'))
}

function escapeUnquotedQuotesInStrings(text: string): string {
  let repaired = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (!inString) {
      repaired += character
      if (character === '"') inString = true
      continue
    }
    if (escaped) {
      repaired += character
      escaped = false
      continue
    }
    if (character === '\\') {
      repaired += character
      escaped = true
      continue
    }
    if (character !== '"') {
      repaired += character
      continue
    }
    const nextSignificant = text.slice(index + 1).match(/^\s*([,:}\]])/u)?.[1]
    if (nextSignificant || text.slice(index + 1).trim() === '') {
      repaired += character
      inString = false
    } else {
      repaired += '\\"'
    }
  }
  return repaired
}

function extractBalancedJsonValues(text: string): string[] {
  const values: string[] = []
  for (let start = 0; start < text.length; start += 1) {
    const opening = text[start]
    if (opening !== '{' && opening !== '[') continue
    const stack: string[] = [opening]
    let inString = false
    let escaped = false
    for (let index = start + 1; index < text.length; index += 1) {
      const character = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') {
        inString = true
        continue
      }
      if (character === '{' || character === '[') stack.push(character)
      else if (character === '}' || character === ']') {
        const expected = character === '}' ? '{' : '['
        if (stack.pop() !== expected) break
        if (stack.length === 0) {
          values.push(text.slice(start, index + 1))
          start = index
          break
        }
      }
    }
  }
  return values
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Workflow timed out.')), timeoutMs)
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function withAbortTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal: AbortSignal,
  timeoutMessage: string
): Promise<T> {
  const controller = new AbortController()
  const relayAbort = () => controller.abort(parentSignal.reason)
  if (parentSignal.aborted) relayAbort()
  else parentSignal.addEventListener('abort', relayAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs)
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
  })
  try {
    return await Promise.race([operation(controller.signal), aborted])
  } finally {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', relayAbort)
  }
}
