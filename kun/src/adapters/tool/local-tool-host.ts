import type {
  ToolHost,
  ToolHostContext,
  ToolHostResult,
  ToolCallLike,
  ToolExecutionUpdate
} from '../../ports/tool-host.js'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ApprovalRequest } from '../../domain/approval.js'
import { createApprovalRequest } from '../../domain/approval.js'
import type { TurnItem } from '../../contracts/items.js'
import { makeToolResultItem, makeApprovalItem } from '../../domain/item.js'
import {
  createExecutionReceipt,
  type ExecutionOutcome,
  type ExecutionReceipt
} from '@sciforge/execution-governance'
import { buildBuiltinLocalTools } from './builtin-tools.js'
import { CapabilityRegistry } from './capability-registry.js'
import {
  applyPostToolHookResults,
  applyPreToolHookResults,
  runToolHooks,
  type ResolvedToolHook
} from './tool-hooks.js'
import {
  normalizeRateLimitedToolOutput
} from './tool-rate-limit.js'
import {
  normalizeReadTrackerOptions,
  ReadTracker,
  type ReadTrackerOptions
} from './read-tracker.js'
import { sandboxBlockForTool, type SandboxBlock } from './sandbox-policy.js'
import { redactSensitiveString } from '../../shared/redact-sensitive.js'

const FILE_PATH_POLICY_TOOL_NAMES = new Set(['read', 'write', 'edit', 'apply_patch', 'list', 'glob', 'grep'])
const RATE_LIMIT_PAYLOAD_TOOL_NAMES = new Set(['read', 'grep', 'find', 'ls'])
const REMOTE_EXECUTOR_MCP_SERVER_ID = 'remote_executor'

/**
 * A single registered tool. Tools are pure functions that observe the
 * abort signal and may be guarded by an approval policy.
 */
export type LocalTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  toolKind: 'tool_call' | 'command_execution' | 'file_change'
  metadata?: Record<string, unknown>
  /**
   * Tool policy. `auto` runs the tool without asking. `on-request` and
   * `suggest` always ask the user. `never` blocks the tool. `untrusted`
   * prompts unless the call is in an allow-list.
   */
  policy: 'auto' | 'on-request' | 'suggest' | 'never' | 'untrusted'
  /**
   * Optional gating predicate. When present, the tool is only listed
   * and only executed when `shouldAdvertise` returns true for the
   * active turn context. Use this for mode/plan-only tools such as
   * `create_plan`.
   */
  shouldAdvertise?: (context: ToolHostContext) => boolean
  execute: (
    args: Record<string, unknown>,
    context: ToolHostContext,
    onUpdate?: (update: ToolExecutionUpdate) => Promise<void> | void
  ) => Promise<{
    output: unknown
    isError?: boolean
    receiptMetadata?: Partial<Omit<ExecutionReceipt, 'status' | 'output' | 'detail'>>
  }>
}

export type LocalToolHostOptions = {
  tools?: LocalTool[]
  registry?: CapabilityRegistry
  /** Allow-list for `untrusted` policy. Tools outside the list always prompt. */
  allowList?: string[]
  /** Optional PreToolUse/PostToolUse hooks. */
  hooks?: readonly ResolvedToolHook[]
  /** Runtime read-before-edit guard. Disabled by default for direct unit use. */
  readTracker?: boolean | ReadTrackerOptions
}

/**
 * Default tool host. Runs tools in-process with abort-signal support
 * and approval gating through the `ToolHostContext.awaitApproval`
 * callback. The host is approval-aware at two layers:
 *
 * 1. A tool with `policy: 'never'` is rejected up front.
 * 2. A tool with `policy: 'on-request' | 'suggest' | 'untrusted'`
 *    always asks before running when the runtime approval policy
 *    permits tool execution.
 *
 * Tools that declare a `shouldAdvertise` predicate are also gated at
 * the listing layer and the execution layer. This is how `create_plan`
 * stays scoped to GUI plan/refine turns.
 */
export class LocalToolHost implements ToolHost {
  readonly id = 'local'
  private readonly registry: CapabilityRegistry
  private readonly allowList: Set<string>
  private readonly hooks: readonly ResolvedToolHook[]
  private readonly readTracker: ReadTracker

  constructor(options: LocalToolHostOptions) {
    this.registry = options.registry ?? CapabilityRegistry.fromLocalTools(options.tools ?? [])
    this.allowList = new Set(options.allowList ?? [])
    this.hooks = options.hooks ?? []
    this.readTracker = new ReadTracker(normalizeReadTrackerOptions(options.readTracker))
  }

  listTools(context?: ToolHostContext) {
    return Promise.resolve(this.registry.listTools(context))
  }

  diagnostics() {
    return this.registry.diagnostics()
  }

  async execute(
    call: ToolCallLike,
    context: ToolHostContext,
    onUpdate?: (item: TurnItem) => Promise<void> | void
  ): Promise<ToolHostResult> {
    if (context.abortSignal.aborted) {
      throw new Error('tool call aborted before start')
    }
    const { tool } = this.registry.resolveTool(call.toolName, context, call.providerId)
    if (tool.policy === 'never') {
      return this.errorToolHostResult(
        context,
        call,
        tool,
        `tool ${call.toolName} is disabled by policy`,
        'approval_policy_blocked',
        false,
        'fatal_error'
      )
    }
    const sandboxBlock = sandboxBlockForTool(tool, context)
    if (sandboxBlock) {
      return this.errorToolHostResult(
        context,
        call,
        tool,
        sandboxBlock.message,
        sandboxBlock.code,
        false,
        'fatal_error'
      )
    }
    let preHookResults
    try {
      preHookResults = await runToolHooks({
        hooks: this.hooks,
        invocation: {
          phase: 'PreToolUse',
          call,
          context: hookContext(context)
        }
      })
    } catch (error) {
      return this.errorToolHostResult(
        context,
        call,
        tool,
        hookErrorMessage(error),
        'hook_failed',
        false
      )
    }
    const preHookDecision = applyPreToolHookResults(call, preHookResults)
    if (preHookDecision.denied) {
      return this.errorToolHostResult(
        context,
        preHookDecision.call,
        tool,
        preHookDecision.denied,
        'hook_denied',
        false,
        'fatal_error'
      )
    }
    const activeCall = preHookDecision.call
    const readValidation = this.readTracker.validateBeforeTool({ context, call: activeCall })
    if (!readValidation.ok) {
      return this.errorToolHostResult(
        context,
        activeCall,
        tool,
        readValidation.message,
        'read_before_edit_required',
        false
      )
    }
    const runtimeBlock = this.runtimePolicyBlock(tool, activeCall, context)
    if (runtimeBlock) {
      return this.errorToolHostResult(
        context,
        activeCall,
        tool,
        runtimeBlock.message,
        runtimeBlock.code,
        false,
        'fatal_error'
      )
    }
    const needsApproval = this.requiresApproval(tool, activeCall, context)
    if (needsApproval) {
      const approvalId = `appr_${activeCall.callId}`
      const approval: ApprovalRequest = createApprovalRequest({
        id: approvalId,
        threadId: context.threadId,
        turnId: context.turnId,
        toolName: activeCall.toolName,
        summary: this.buildApprovalSummary(activeCall)
      })
      const decision = await context.awaitApproval(approval)
      if (decision !== 'allow') {
        const item = makeApprovalItem({
          id: `item_${approvalId}`,
          turnId: context.turnId,
          threadId: context.threadId,
          approvalId,
          toolName: activeCall.toolName,
          summary: approval.summary
        })
        return this.toolHostResult(item, false, {
          outcome: 'fatal_error',
          errorCode: 'approval_denied'
        })
      }
    }
    if (context.abortSignal.aborted) {
      throw new Error('tool call aborted while waiting for approval')
    }
    let executionOutcome:
      | { status: 'succeeded'; result: Awaited<ReturnType<LocalTool['execute']>> }
      | { status: 'failed'; error: unknown }
    let acceptingUpdates = true
    const pendingUpdates: Promise<void>[] = []
    try {
      const result = await tool.execute(activeCall.arguments, context, (update) => {
        if (!acceptingUpdates || !onUpdate) return
        const partialItem = makeToolResultItem({
          id: `item_${activeCall.callId}`,
          turnId: context.turnId,
          threadId: context.threadId,
          callId: activeCall.callId,
          toolName: activeCall.toolName,
          toolKind: activeCall.toolKind ?? tool.toolKind,
          output: update.output,
          isError: update.isError,
          status: 'running'
        })
        const pendingUpdate = (async () => {
          await onUpdate(partialItem)
        })()
        // Keep fire-and-forget failures handled until the lifecycle drain reports them.
        void pendingUpdate.catch(() => undefined)
        pendingUpdates.push(pendingUpdate)
        return pendingUpdate
      })
      executionOutcome = { status: 'succeeded', result }
    } catch (error) {
      executionOutcome = { status: 'failed', error }
    }
    acceptingUpdates = false
    const updateResults = await Promise.allSettled(pendingUpdates)
    const rejectedUpdate = updateResults.find(
      (updateResult): updateResult is PromiseRejectedResult => updateResult.status === 'rejected'
    )
    if (executionOutcome.status === 'failed' || rejectedUpdate) {
      const terminalError = executionOutcome.status === 'failed'
        ? executionOutcome.error
        : rejectedUpdate?.reason
      if (context.abortSignal.aborted) throw terminalError
      const message = terminalError instanceof Error ? terminalError.message : String(terminalError)
      return this.errorToolHostResult(
        context,
        activeCall,
        tool,
        message,
        'tool_execution_failed',
        true
      )
    }
    const result = executionOutcome.result
    let postHookResults
    try {
      postHookResults = await runToolHooks({
        hooks: this.hooks,
        invocation: {
          phase: 'PostToolUse',
          call: activeCall,
          context: hookContext(context),
          result
        }
      })
    } catch (error) {
      return this.errorToolHostResult(
        context,
        activeCall,
        tool,
        hookErrorMessage(error),
        'hook_failed',
        true
      )
    }
    const hookedResult = applyPostToolHookResults(result, postHookResults)
    const rateLimited = shouldNormalizeRateLimitedToolOutput(activeCall.toolName)
      ? normalizeRateLimitedToolOutput(hookedResult.output)
      : { output: hookedResult.output, isError: false, rateLimited: false }
    const output = rateLimited.rateLimited ? rateLimited.output : hookedResult.output
    const isError = hookedResult.isError || rateLimited.isError
    this.readTracker.observeToolResult({
      context,
      call: activeCall,
      output,
      isError
    })
    const item = makeToolResultItem({
      id: `item_${activeCall.callId}`,
      turnId: context.turnId,
      threadId: context.threadId,
      callId: activeCall.callId,
      toolName: activeCall.toolName,
      toolKind: activeCall.toolKind ?? tool.toolKind,
      output,
      isError
    })
    return this.toolHostResult(item, !needsApproval, result.receiptMetadata)
  }

  clearReadTracker(threadId?: string): void {
    this.readTracker.clear(threadId)
  }

  private runtimePolicyBlock(
    tool: LocalTool,
    call: ToolCallLike,
    context: ToolHostContext
  ): SandboxBlock | {
    code: 'approval_policy_blocked' | 'bash_command_policy_denied' | 'file_path_policy_denied'
    message: string
  } | null {
    const sandboxBlock = sandboxBlockForTool(
      { name: call.toolName, toolKind: call.toolKind ?? tool.toolKind },
      context
    )
    if (sandboxBlock) return sandboxBlock
    const bashPolicyBlock = bashCommandPolicyBlock(call, context)
    if (bashPolicyBlock) return bashPolicyBlock
    const bashGitSafetyBlock = defaultBashGitSafetyBlock(call)
    if (bashGitSafetyBlock) return bashGitSafetyBlock
    const filePolicyBlock = filePathPolicyBlock(call, context)
    if (filePolicyBlock) return filePolicyBlock
    if (this.isInteractiveGuiGateTool(call.toolName)) return null
    if (tool.policy === 'never') {
      return {
        code: 'approval_policy_blocked',
        message: `tool ${call.toolName} is disabled by tool policy`
      }
    }
    return null
  }

  private requiresApproval(tool: LocalTool, call: ToolCallLike, context: ToolHostContext): boolean {
    if (this.isInteractiveGuiGateTool(call.toolName)) return false
    if (tool.policy === 'never' || context.approvalPolicy === 'never') return false
    if (context.sandboxMode === 'danger-full-access') return false
    if (this.isTrustedRemoteExecutorBypass(tool, call)) return false
    switch (context.approvalPolicy) {
      case 'auto':
        return false
      case 'on-request':
      case 'suggest':
        return tool.policy !== 'auto'
      case 'untrusted':
        if (tool.policy === 'auto') return !this.allowList.has(call.toolName)
        return true
    }
  }

  private isInteractiveGuiGateTool(toolName: string): boolean {
    return toolName === 'user_input' || toolName === 'request_user_input'
  }

  private isTrustedRemoteExecutorBypass(tool: LocalTool, call: ToolCallLike): boolean {
    if (mcpServerIdFromTool(tool) !== REMOTE_EXECUTOR_MCP_SERVER_ID) return false
    return hasTrustedApprovalBypass(call.metadata) || hasTrustedApprovalBypass(call.arguments)
  }

  private buildApprovalSummary(call: ToolCallLike): string {
    const args = Object.entries(call.arguments)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(', ')
    return redactSensitiveString(`Run ${call.toolName}(${args})`)
  }

  private errorToolHostResult(
    context: ToolHostContext,
    call: ToolCallLike,
    tool: LocalTool,
    message: string,
    code: string,
    approved: boolean,
    outcome: ExecutionOutcome = 'retryable_error'
  ): ToolHostResult {
    const item = makeToolResultItem({
      id: `item_${call.callId}`,
      turnId: context.turnId,
      threadId: context.threadId,
      callId: call.callId,
      toolName: call.toolName,
      toolKind: call.toolKind ?? tool.toolKind,
      output: { code, error: message, detail: message },
      isError: true
    })
    return this.toolHostResult(item, approved, {
      outcome,
      errorCode: code
    })
  }

  private toolHostResult(
    item: TurnItem,
    approved: boolean,
    receiptMetadata?: Partial<Omit<ExecutionReceipt, 'status' | 'output' | 'detail'>>
  ): ToolHostResult {
    const output = item.kind === 'tool_result' ? item.output : { detail: 'tool execution cancelled' }
    return {
      item,
      approved,
      receipt: createExecutionReceipt({
        status: item.kind !== 'tool_result'
          ? 'cancelled'
          : item.isError === true
            ? 'error'
            : 'success',
        output,
        detail: toolBoundaryDetail(output),
        metadata: receiptMetadata as Record<string, unknown> | undefined
      })
    }
  }

  /** Tool builder helper for tests and feature scripts. */
  static defineTool(
    tool: Omit<LocalTool, 'policy' | 'toolKind'> & {
      policy?: LocalTool['policy']
      toolKind?: LocalTool['toolKind']
    }
  ): LocalTool {
    return {
      policy: tool.policy ?? 'on-request',
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      toolKind: tool.toolKind ?? 'tool_call',
      execute: tool.execute,
      ...(tool.metadata ? { metadata: tool.metadata } : {}),
      ...(tool.shouldAdvertise ? { shouldAdvertise: tool.shouldAdvertise } : {})
    }
  }
}

function shouldNormalizeRateLimitedToolOutput(toolName: string): boolean {
  return !RATE_LIMIT_PAYLOAD_TOOL_NAMES.has(toolName)
}

function mcpServerIdFromTool(tool: LocalTool): string {
  const metadata = objectRecord(tool.metadata)
  const mcp = objectRecord(metadata.mcp)
  return typeof mcp.serverId === 'string' ? mcp.serverId : ''
}

function hasTrustedApprovalBypass(value: unknown): boolean {
  const record = objectRecord(value)
  if (record.trustedApprovalBypass === true) return true
  if (record.trusted === true && (
    record.bypassApproval === true ||
    record.approvalBypass === true ||
    record.trustedBypass === true ||
    record.bypass === 'approval'
  )) {
    return true
  }
  return (
    isObjectRecord(record._meta) && hasTrustedApprovalBypass(record._meta)
  ) || (
    isObjectRecord(record.metadata) && hasTrustedApprovalBypass(record.metadata)
  )
}

function objectRecord(value: unknown): Record<string, unknown> {
  return isObjectRecord(value) ? value : {}
}

function toolBoundaryDetail(output: unknown): string {
  if (typeof output === 'string') return output
  if (output == null) return ''
  const detail = objectRecord(output).detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function bashCommandPolicyBlock(
  call: ToolCallLike,
  context: ToolHostContext
): { code: 'bash_command_policy_denied'; message: string } | null {
  if (call.toolName !== 'bash') return null
  const policy = context.bashCommandPolicy
  if (!policy) return null
  const command = typeof call.arguments.command === 'string' ? call.arguments.command : null
  if (command === null) {
    const action = typeof call.arguments.action === 'string' ? call.arguments.action : ''
    if (action === 'poll' || action === 'stop') return null
    return {
      code: 'bash_command_policy_denied',
      message: 'bash command policy only allows command execution or bash session control actions'
    }
  }
  const allowPatterns = policy.allowPatterns ?? []
  if (allowPatterns.length > 0 && !allowPatterns.some((pattern) => regexMatches(pattern, command))) {
    return {
      code: 'bash_command_policy_denied',
      message: 'bash command does not match this turn command policy allowPatterns'
    }
  }
  const denyPattern = (policy.denyPatterns ?? []).find((pattern) => regexMatches(pattern, command))
  if (denyPattern) {
    return {
      code: 'bash_command_policy_denied',
      message: `bash command matched this turn command policy denyPattern: ${denyPattern}`
    }
  }
  return null
}

function defaultBashGitSafetyBlock(
  call: ToolCallLike
): { code: 'bash_command_policy_denied'; message: string } | null {
  if (call.toolName !== 'bash') return null
  const command = typeof call.arguments.command === 'string' ? call.arguments.command : ''
  const blocked = firstBroadGitStagingCommand(command)
  if (!blocked) return null
  return {
    code: 'bash_command_policy_denied',
    message: `bash git staging safety blocked broad repository staging command: ${blocked}. Stage explicit paths instead, for example: git add path/to/file path/to/dir`
  }
}

function firstBroadGitStagingCommand(command: string): string | null {
  const normalized = command.replace(/\\\r?\n/g, ' ')
  for (const segment of normalized.split(/&&|\|\||[;\n]/)) {
    const tokens = shellishTokens(segment)
    for (let index = 0; index < tokens.length; index += 1) {
      if (commandName(tokens[index]) !== 'git') continue
      const subcommandIndex = gitSubcommandIndex(tokens, index)
      const subcommand = tokens[subcommandIndex]?.toLowerCase()
      if (subcommand === 'add' && isBroadGitAdd(tokens.slice(subcommandIndex + 1))) {
        return compactCommandSegment(segment)
      }
      if (subcommand === 'commit' && isBroadGitCommit(tokens.slice(subcommandIndex + 1))) {
        return compactCommandSegment(segment)
      }
    }
  }
  return null
}

function gitSubcommandIndex(tokens: string[], gitIndex: number): number {
  let index = gitIndex + 1
  while (index < tokens.length) {
    const token = tokens[index]
    if (!token.startsWith('-')) return index
    const lower = token.toLowerCase()
    index += gitGlobalOptionConsumesValue(lower) ? 2 : 1
  }
  return index
}

function gitGlobalOptionConsumesValue(option: string): boolean {
  return option === '-c' ||
    option === '--config-env' ||
    option === '--git-dir' ||
    option === '--work-tree' ||
    option === '--namespace' ||
    option === '--exec-path'
}

function isBroadGitAdd(args: string[]): boolean {
  const hasBroadPath = args.some(isBroadGitPathspec)
  if (hasBroadPath) return true
  const hasBroadFlag = args.some(isBroadGitAddFlag)
  if (!hasBroadFlag) return false
  return !args.some(isScopedGitPathspec)
}

function isBroadGitCommit(args: string[]): boolean {
  return args.some((arg) => {
    const lower = arg.toLowerCase()
    return lower === '--all' || /^-[^-]*a/.test(lower)
  })
}

function isBroadGitAddFlag(arg: string): boolean {
  const lower = arg.toLowerCase()
  return lower === '-a' ||
    lower === '--all' ||
    lower === '-u' ||
    lower === '--update' ||
    /^-[^-]*(?:a|u)/.test(lower)
}

function isBroadGitPathspec(arg: string): boolean {
  const value = stripShellQuotes(arg).trim()
  return value === '.' ||
    value === './' ||
    value === ':/' ||
    value === '*' ||
    value === './*'
}

function isScopedGitPathspec(arg: string): boolean {
  const value = stripShellQuotes(arg).trim()
  if (!value || value === '--' || value.startsWith('-')) return false
  return !isBroadGitPathspec(value)
}

function shellishTokens(input: string): string[] {
  return input.match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\s]+/g)?.map(stripShellQuotes) ?? []
}

function stripShellQuotes(input: string): string {
  const trimmed = input.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function commandName(token: string | undefined): string {
  return token?.trim().split(/[\\/]/).pop()?.toLowerCase() ?? ''
}

function compactCommandSegment(segment: string): string {
  const compact = segment.trim().replace(/\s+/g, ' ')
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
}

function filePathPolicyBlock(
  call: ToolCallLike,
  context: ToolHostContext
): { code: 'file_path_policy_denied'; message: string } | null {
  const policy = context.filePathPolicy
  if (!policy) return null
  if (!FILE_PATH_POLICY_TOOL_NAMES.has(call.toolName)) return null
  const rawPath = typeof call.arguments.path === 'string' ? call.arguments.path : null
  if (rawPath === null) return null
  const path = normalizePolicyPath(rawPath, context.workspace)
  const allowPaths = (policy.allowPaths ?? []).map((allowedPath) =>
    normalizePolicyPath(allowedPath, context.workspace)
  )
  const allowPatterns = policy.allowPatterns ?? []
  const allowedByPath = allowPaths.length > 0 && allowPaths.some((allowedPath) =>
    isPathWithinOrSame(path, allowedPath)
  )
  const allowedByPattern = allowPatterns.length > 0 && allowPatterns.some((pattern) =>
    regexMatches(pattern, path)
  )
  if ((allowPaths.length > 0 || allowPatterns.length > 0) && !allowedByPath && !allowedByPattern) {
    return {
      code: 'file_path_policy_denied',
      message: 'file path does not match this turn file path policy'
    }
  }
  const denyPattern = (policy.denyPatterns ?? []).find((pattern) => regexMatches(pattern, path))
  if (denyPattern) {
    return {
      code: 'file_path_policy_denied',
      message: `file path matched this turn file path policy denyPattern: ${denyPattern}`
    }
  }
  return null
}

function normalizePolicyPath(path: string, workspace: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(workspace || process.cwd(), path)
}

function isPathWithinOrSame(path: string, allowedPath: string): boolean {
  const rel = relative(allowedPath, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function regexMatches(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

function hookContext(
  context: ToolHostContext
): Pick<ToolHostContext, 'threadId' | 'turnId' | 'workspace' | 'project' | 'threadMode' | 'taskType' | 'approvalPolicy' | 'sandboxMode'> {
  return {
    threadId: context.threadId,
    turnId: context.turnId,
    workspace: context.workspace,
    approvalPolicy: context.approvalPolicy,
    ...(context.sandboxMode ? { sandboxMode: context.sandboxMode } : {}),
    ...(context.project ? { project: context.project } : {}),
    ...(context.threadMode ? { threadMode: context.threadMode } : {}),
    ...(context.taskType ? { taskType: context.taskType } : {})
  }
}

function hookErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `tool hook failed: ${message}`
}

/**
 * Tiny default tool used by smoke tests: echoes its argument so the
 * rest of the loop has a tool to call when the GUI hasn't provided any.
 */
export const echoTool: LocalTool = LocalToolHost.defineTool({
  name: 'echo',
  description: 'Echo the input argument back to the model.',
  toolKind: 'tool_call',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text']
  },
  policy: 'auto',
  execute: async (args) => ({ output: { echoed: args.text ?? '' } })
})

function createUserInputTool(name: string): LocalTool {
  const optionSchema = {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          label: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['label']
      }
    ]
  }
  return LocalToolHost.defineTool({
    name,
    description: 'Ask the GUI user a structured question and wait for the answer.',
    toolKind: 'tool_call',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        question: { type: 'string' },
        message: { type: 'string' },
        options: {
          type: 'array',
          description: 'Optional answer choices for a single question. Use strings or {label, description} objects.',
          items: optionSchema
        },
        questions: {
          type: 'array',
          description: 'One to three structured questions. Each question may include answer options.',
          items: {
            type: 'object',
            properties: {
              header: { type: 'string' },
              id: { type: 'string' },
              question: { type: 'string' },
              options: {
                type: 'array',
                items: optionSchema
              }
            },
            required: ['question']
          }
        }
      },
      required: []
    },
    policy: 'auto',
    execute: async (args, context) => {
      if (!context.awaitUserInput) {
        return {
          output: { error: 'GUI user input is not available in this runtime context' },
          isError: true
        }
      }
      const inputId = `in_${Math.random().toString(36).slice(2, 10)}`
      const itemId = `item_${inputId}`
      const prompt = String(args.prompt ?? args.question ?? args.message ?? 'Input requested')
      const questions = normalizeUserInputQuestions(args, inputId, prompt)
      const resolution = await context.awaitUserInput({ id: inputId, itemId, prompt, questions })
      return {
        output: resolution,
        isError: resolution.status === 'cancelled'
      }
    }
  })
}

export const userInputTool: LocalTool = createUserInputTool('user_input')
export const requestUserInputTool: LocalTool = createUserInputTool('request_user_input')

export const defaultLocalTools: LocalTool[] = [
  ...buildBuiltinLocalTools(),
  echoTool,
  userInputTool,
  requestUserInputTool
]

function normalizeUserInputQuestions(
  args: Record<string, unknown>,
  fallbackId: string,
  fallbackPrompt: string
): Array<{
  header: string
  id: string
  question: string
  options: Array<{ label: string; description: string }>
}> {
  const rawQuestions = arrayFromValue(args.questions)
  if (rawQuestions && rawQuestions.length > 0) {
    const questions = rawQuestions
      .map((question, index) => normalizeUserInputQuestion(question, index, fallbackId))
      .filter((question) => question !== null)
    if (questions.length > 0) return questions
  }
  const rawOptions = arrayFromValue(args.options)
  const options = rawOptions
    ? rawOptions
        .map((option) => normalizeUserInputOption(option))
        .filter((option) => option !== null)
    : []
  return [
    {
      header: 'Input',
      id: String(args.id ?? fallbackId),
      question: fallbackPrompt,
      options
    }
  ]
}

function arrayFromValue(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizeUserInputQuestion(
  value: unknown,
  index: number,
  fallbackId: string
): {
  header: string
  id: string
  question: string
  options: Array<{ label: string; description: string }>
} | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const question = typeof raw.question === 'string' && raw.question.trim()
    ? raw.question.trim()
    : null
  if (!question) return null
  const rawOptions = arrayFromValue(raw.options)
  const options = rawOptions
    ? rawOptions
        .map((option) => normalizeUserInputOption(option))
        .filter((option) => option !== null)
    : []
  return {
    header: typeof raw.header === 'string' && raw.header.trim() ? raw.header.trim() : `Question ${index + 1}`,
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${fallbackId}_${index + 1}`,
    question,
    options
  }
}

function normalizeUserInputOption(
  value: unknown
): { label: string; description: string } | null {
  if (typeof value === 'string' && value.trim()) {
    return {
      label: value.trim(),
      description: ''
    }
  }
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null
  if (!label) return null
  return {
    label,
    description: typeof raw.description === 'string' ? raw.description : ''
  }
}

import { createCreatePlanTool, type CreatePlanAdapterOptions } from './create-plan-tool.js'

/**
 * Build the default tool list including the `create_plan` tool. The
 * `create_plan` tool is gated to plan/refine turns via its
 * `shouldAdvertise` predicate, so it is safe to ship with the
 * default set: non-plan turns never see it in the model tool list.
 */
export function buildDefaultLocalTools(planOptions: CreatePlanAdapterOptions = {}): LocalTool[] {
  return [...defaultLocalTools, createCreatePlanTool(planOptions)]
}
