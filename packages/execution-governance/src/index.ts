import { createHash } from 'node:crypto'
import path from 'node:path'

export type ExecutionToolKind = 'tool_call' | 'command_execution' | 'file_change'

export type ExecutionAttemptInput = {
  callId: string
  toolName: string
  providerId?: string
  toolKind?: ExecutionToolKind
  arguments: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type ExecutionGovernorOptions = {
  windowSize?: number
  threshold?: number
  semanticFailureThreshold?: number
  workspace?: string
  defaultReadOffset?: number
  defaultReadLimit?: number
  maxReadOverlapRatio?: number
}

export type ExecutionGovernorContext = {
  workspace?: string
  ownedSurfaceInspectionAvailable?: boolean
}

export type ExecutionReceiptInput = {
  status: 'success' | 'error' | 'cancelled'
  output?: unknown
  errorCode?: string
  failureClass?: string
  resourceIdentity?: string
  evidenceDelta?: boolean
  stateChanged?: boolean
  detail?: string
}

export type NormalizedExecutionAttempt = {
  callId: string
  toolName: string
  toolKind: ExecutionToolKind
  family: string
  exactFingerprint: string
  semanticFingerprint: string
  resourceIdentity: string
  trustedComputerUse: boolean
  mutating: boolean
}

export type NormalizedExecutionReceipt = {
  callId: string
  status: 'success' | 'error' | 'cancelled'
  family: string
  failureClass: string
  errorCode: string
  resourceIdentity: string
  evidenceDelta: boolean
  stateChanged: boolean
  detail: string
}

export type ExecutionGovernorDecision = {
  action: 'allow' | 'steer' | 'deny'
  code?:
    | 'exact_repeat'
    | 'semantic_failure_retry'
    | 'semantic_failure_exhausted'
    | 'redundant_read'
    | 'owned_surface_policy_denied'
  reason?: string
  guidance?: string
  attempt: NormalizedExecutionAttempt
}

export type ExecutionEvidenceResult = {
  evidenceGained: boolean
  duplicateResult: boolean
  resultHash?: string
  receipt: NormalizedExecutionReceipt
  decision: ExecutionGovernorDecision
}

type RecentExecutionAttempt = {
  exactFingerprint: string
  semanticFingerprint: string
  readOnly: boolean
}

type LineInterval = {
  start: number
  end: number
}

type ReadEvidence = {
  covered: LineInterval[]
  resultHashes: Set<string>
}

type SemanticFailureStreak = {
  key: string
  count: number
}

type StoredExecutionAttempt = NormalizedExecutionAttempt & {
  rawArguments: Record<string, unknown>
}

const DEFAULT_WINDOW_SIZE = 8
const DEFAULT_THRESHOLD = 3
const DEFAULT_SEMANTIC_FAILURE_THRESHOLD = 2
const DEFAULT_READ_OFFSET = 1
const DEFAULT_READ_LIMIT = 2000
const DEFAULT_MAX_READ_OVERLAP_RATIO = 0.9
const MUTATING_TOOL_NAMES = new Set(['write', 'edit', 'edit_diff', 'apply_patch', 'delete', 'move'])
const GOVERNOR_EXEMPT_TOOL_NAMES = new Set(['request_user_input', 'user_input'])
const VOLATILE_ARGUMENT_KEYS = new Set([
  'callid',
  'call_id',
  'expiresat',
  'expectedrevision',
  'invocation',
  'invocationid',
  'requestid',
  'request_id',
  'revision',
  'semanticsrevision',
  'semanticrevision',
  'token',
  'toolid',
  'tool_call_id'
])

/**
 * Runtime-neutral execution governance state. KUN invokes it before tool
 * execution; observe-only runtimes feed the same attempt/receipt sequence
 * after their normalized lifecycle events arrive.
 */
export class ExecutionGovernorCore {
  private readonly windowSize: number
  private readonly threshold: number
  private readonly semanticFailureThreshold: number
  private readonly workspace?: string
  private readonly defaultReadOffset: number
  private readonly defaultReadLimit: number
  private readonly maxReadOverlapRatio: number
  private readonly recent: RecentExecutionAttempt[] = []
  private readonly attemptsByCallId = new Map<string, StoredExecutionAttempt>()
  private readonly readEvidence = new Map<string, ReadEvidence>()
  private readonly genericResultHashes = new Map<string, Set<string>>()
  private readonly pendingReads = new Map<string, { path: string; start: number; end: number }>()
  private readonly consumedReadOverrides = new Set<string>()
  private semanticFailureStreak: SemanticFailureStreak | null = null

  constructor(options: ExecutionGovernorOptions = {}) {
    this.windowSize = Math.max(1, Math.floor(options.windowSize ?? DEFAULT_WINDOW_SIZE))
    this.threshold = Math.max(2, Math.floor(options.threshold ?? DEFAULT_THRESHOLD))
    this.semanticFailureThreshold = Math.max(
      2,
      Math.floor(options.semanticFailureThreshold ?? DEFAULT_SEMANTIC_FAILURE_THRESHOLD)
    )
    this.workspace = normalizeWorkspace(options.workspace)
    this.defaultReadOffset = positiveInteger(options.defaultReadOffset, DEFAULT_READ_OFFSET)
    this.defaultReadLimit = positiveInteger(options.defaultReadLimit, DEFAULT_READ_LIMIT)
    this.maxReadOverlapRatio = boundedRatio(
      options.maxReadOverlapRatio,
      DEFAULT_MAX_READ_OVERLAP_RATIO
    )
  }

  inspectAttempt(
    input: ExecutionAttemptInput,
    context: ExecutionGovernorContext = {}
  ): ExecutionGovernorDecision {
    const attempt = normalizeExecutionAttempt(input, context)
    this.attemptsByCallId.set(input.callId, { ...attempt, rawArguments: input.arguments })
    if (GOVERNOR_EXEMPT_TOOL_NAMES.has(normalizedToolName(input.toolName)) || isSessionControlCall(input)) {
      return { action: 'allow', attempt }
    }

    if (attempt.mutating) {
      this.invalidateReadEvidence(input, context)
      this.clearReadOnlyEntries()
    }

    if (
      attempt.family === 'command_execution:os-gui-automation' &&
      context.ownedSurfaceInspectionAvailable === true
    ) {
      return {
        action: 'deny',
        code: 'owned_surface_policy_denied',
        reason: 'Shell-based OS screenshots and window automation are blocked while an owned surface-inspection capability is available.',
        guidance: ownedSurfaceGuidance(),
        attempt
      }
    }

    const read = normalizedToolName(input.toolName) === 'read'
      ? this.readDescriptor(input, context)
      : undefined
    const overrideReason = read ? readOverrideReason(input.arguments) : undefined
    const overrideKey = read && overrideReason
      ? `${read.path}\0${read.start}:${read.end}\0${overrideReason}`
      : undefined
    if (overrideKey && !this.consumedReadOverrides.has(overrideKey)) {
      this.consumedReadOverrides.add(overrideKey)
      this.remember(attempt)
      this.rememberPendingRead(input.callId, read)
      return { action: 'allow', attempt }
    }

    const overlapRatio = read ? this.readRangeCoverageRatio(read) : 0
    if (read && overlapRatio >= this.maxReadOverlapRatio) {
      return {
        action: 'steer',
        code: 'redundant_read',
        reason: `Read range ${read.start}-${read.end} for ${read.path} is ${Math.round(overlapRatio * 100)}% covered or scheduled in this turn.`,
        guidance: 'Request an uncovered range, or provide a reason to force one reread.',
        attempt
      }
    }

    const failureDecision = this.semanticFailureDecision(attempt)
    if (failureDecision) return failureDecision

    if (!attempt.trustedComputerUse) {
      const exactCount = this.recent.reduce(
        (sum, entry) => sum + Number(entry.exactFingerprint === attempt.exactFingerprint),
        0
      )
      if (exactCount >= this.threshold) {
        return {
          action: 'deny',
          code: 'exact_repeat',
          reason: `${input.toolName} repeated identical arguments ${exactCount + 1} times in this turn.`,
          guidance: 'Use the latest receipt, choose a distinct verifiable action, or report the blocker.',
          attempt
        }
      }
      if (exactCount >= this.threshold - 1) {
        this.remember(attempt)
        return {
          action: 'steer',
          code: 'exact_repeat',
          reason: `${input.toolName} repeated identical arguments ${exactCount + 1} times in this turn.`,
          guidance: 'Do not execute the duplicate; inspect the latest receipt and use a different action.',
          attempt
        }
      }
    }

    this.remember(attempt)
    this.rememberPendingRead(input.callId, read)
    return { action: 'allow', attempt }
  }

  recordReceipt(
    callId: string,
    input: ExecutionReceiptInput,
    context: ExecutionGovernorContext = {}
  ): ExecutionEvidenceResult {
    const attempt = this.attemptsByCallId.get(callId) ?? normalizeExecutionAttempt({
      callId,
      toolName: 'unknown_tool',
      arguments: {}
    }, context)
    this.pendingReads.delete(callId)
    const error = input.status !== 'success' || isErrorOutput(input.output)
    const evidence = error
      ? { evidenceGained: false, duplicateResult: false, resultHash: undefined }
      : this.recordSuccessfulEvidence(attempt, input.output, context)
    const receipt = normalizeExecutionReceipt(attempt, input, evidence.evidenceGained)
    const decision = this.recordSemanticOutcome(attempt, receipt)
    return {
      ...evidence,
      receipt,
      decision
    }
  }

  reset(): void {
    this.recent.length = 0
    this.attemptsByCallId.clear()
    this.readEvidence.clear()
    this.genericResultHashes.clear()
    this.pendingReads.clear()
    this.consumedReadOverrides.clear()
    this.semanticFailureStreak = null
  }

  private semanticFailureDecision(
    attempt: NormalizedExecutionAttempt
  ): ExecutionGovernorDecision | null {
    const streak = this.semanticFailureStreak
    if (!streak || streak.count < this.semanticFailureThreshold) return null
    if (!streak.key.startsWith(`${attempt.family}\0`)) return null
    const [, failureClass, resourceIdentity] = streak.key.split('\0')
    if (resourceIdentity && attempt.resourceIdentity && resourceIdentity !== attempt.resourceIdentity) return null
    return {
      action: 'deny',
      code: 'semantic_failure_exhausted',
      reason: `${attempt.family} already failed ${streak.count} consecutive times with ${failureClass || 'the same semantic failure'}.`,
      guidance: recoveryGuidance(attempt.family, failureClass),
      attempt
    }
  }

  private recordSemanticOutcome(
    attempt: NormalizedExecutionAttempt,
    receipt: NormalizedExecutionReceipt
  ): ExecutionGovernorDecision {
    if (attempt.trustedComputerUse && receipt.status === 'success') {
      this.semanticFailureStreak = null
      return { action: 'allow', attempt }
    }
    const failed = receipt.status !== 'success' || (!receipt.evidenceDelta && !receipt.stateChanged)
    if (!failed) {
      this.semanticFailureStreak = null
      return { action: 'allow', attempt }
    }
    const key = `${attempt.family}\0${receipt.failureClass}\0${receipt.resourceIdentity}`
    this.semanticFailureStreak = this.semanticFailureStreak?.key === key
      ? { key, count: this.semanticFailureStreak.count + 1 }
      : { key, count: 1 }
    if (this.semanticFailureStreak.count < this.semanticFailureThreshold) {
      return { action: 'allow', attempt }
    }
    return {
      action: 'steer',
      code: 'semantic_failure_retry',
      reason: `${attempt.family} failed ${this.semanticFailureStreak.count} consecutive times with ${receipt.failureClass}.`,
      guidance: recoveryGuidance(attempt.family, receipt.failureClass),
      attempt
    }
  }

  private recordSuccessfulEvidence(
    attempt: NormalizedExecutionAttempt,
    output: unknown,
    context: ExecutionGovernorContext
  ): { evidenceGained: boolean; duplicateResult: boolean; resultHash?: string } {
    if (attempt.mutating || isSessionControlFamily(attempt.family)) {
      return { evidenceGained: true, duplicateResult: false }
    }
    if (normalizedToolName(attempt.toolName) !== 'read') {
      const resultHash = hashToolResult(output)
      const evidenceKey = `${attempt.family}\0${attempt.resourceIdentity}`
      const hashes = this.genericResultHashes.get(evidenceKey) ?? new Set<string>()
      const duplicateResult = hashes.has(resultHash)
      hashes.add(resultHash)
      this.genericResultHashes.set(evidenceKey, hashes)
      return { evidenceGained: !duplicateResult, duplicateResult, resultHash }
    }
    const original = this.attemptInputForRead(attempt)
    const requested = original ? this.readDescriptor(original, context) : undefined
    if (!requested) return { evidenceGained: false, duplicateResult: false }
    const record = asRecord(output)
    const resultPath = typeof record?.path === 'string' && record.path.trim()
      ? normalizeReadPath(record.path, this.workspaceFor(context))
      : requested.path
    const actual = actualReadInterval(record, requested)
    const evidence = this.readEvidence.get(resultPath) ?? {
      covered: [],
      resultHashes: new Set<string>()
    }
    const wasCovered = intervalCovered(evidence.covered, actual)
    const resultHash = hashReadResult(output)
    const duplicateResult = evidence.resultHashes.has(resultHash)
    evidence.covered = mergeInterval(evidence.covered, actual)
    evidence.resultHashes.add(resultHash)
    this.readEvidence.set(resultPath, evidence)
    return {
      evidenceGained: !wasCovered && !duplicateResult,
      duplicateResult,
      resultHash
    }
  }

  private attemptInputForRead(attempt: NormalizedExecutionAttempt): ExecutionAttemptInput | undefined {
    const stored = this.attemptsByCallId.get(attempt.callId)
    if (!stored) return undefined
    return {
      callId: attempt.callId,
      toolName: attempt.toolName,
      toolKind: attempt.toolKind,
      arguments: stored.rawArguments
    }
  }

  private remember(attempt: NormalizedExecutionAttempt): void {
    this.recent.push({
      exactFingerprint: attempt.exactFingerprint,
      semanticFingerprint: attempt.semanticFingerprint,
      readOnly: !attempt.mutating
    })
    while (this.recent.length > this.windowSize) this.recent.shift()
  }

  private workspaceFor(context: ExecutionGovernorContext): string | undefined {
    return normalizeWorkspace(context.workspace) ?? this.workspace
  }

  private readDescriptor(
    call: ExecutionAttemptInput,
    context: ExecutionGovernorContext
  ): { path: string; start: number; end: number } | undefined {
    const rawPath = typeof call.arguments.path === 'string' ? call.arguments.path.trim() : ''
    if (!rawPath) return undefined
    const start = positiveInteger(call.arguments.offset, this.defaultReadOffset)
    const limit = positiveInteger(call.arguments.limit, this.defaultReadLimit)
    return {
      path: normalizeReadPath(rawPath, this.workspaceFor(context)),
      start,
      end: start + limit - 1
    }
  }

  private readRangeCoverageRatio(read: { path: string; start: number; end: number }): number {
    const evidence = this.readEvidence.get(read.path)?.covered ?? []
    const pending = [...this.pendingReads.values()].filter((entry) => entry.path === read.path)
    return intervalCoverageRatio([...evidence, ...pending], read)
  }

  private rememberPendingRead(
    callId: string,
    read: { path: string; start: number; end: number } | undefined
  ): void {
    if (read) this.pendingReads.set(callId, read)
  }

  private invalidateReadEvidence(call: ExecutionAttemptInput, context: ExecutionGovernorContext): void {
    const workspace = this.workspaceFor(context)
    const paths = mutationPaths(call.arguments).map((entry) => normalizeReadPath(entry, workspace))
    if (paths.length === 0) {
      this.readEvidence.clear()
      this.pendingReads.clear()
      this.consumedReadOverrides.clear()
      return
    }
    for (const changedPath of paths) {
      this.readEvidence.delete(changedPath)
      for (const [callId, pending] of this.pendingReads) {
        if (pending.path === changedPath) this.pendingReads.delete(callId)
      }
      for (const key of this.consumedReadOverrides) {
        if (key.startsWith(`${changedPath}\0`)) this.consumedReadOverrides.delete(key)
      }
    }
  }

  private clearReadOnlyEntries(): void {
    for (let index = this.recent.length - 1; index >= 0; index -= 1) {
      if (this.recent[index]?.readOnly) this.recent.splice(index, 1)
    }
  }
}

export function normalizeExecutionAttempt(
  input: ExecutionAttemptInput,
  context: ExecutionGovernorContext = {}
): NormalizedExecutionAttempt {
  const toolName = normalizedToolName(input.toolName) || 'unknown_tool'
  const toolKind = input.toolKind ?? inferToolKind(toolName)
  const trustedComputerUse = isTrustedComputerUse(input)
  const family = executionFamily(input, toolKind, trustedComputerUse)
  const exactArguments = trustedComputerUse
    ? { ...input.arguments, invocation: input.callId }
    : argumentsWithoutReason(input.arguments)
  const semanticArguments = stripVolatileArguments(argumentsWithoutReason(input.arguments))
  const resourceIdentity = executionResourceIdentity(input, context)
  const attempt: NormalizedExecutionAttempt = {
    callId: input.callId,
    toolName,
    toolKind,
    family,
    exactFingerprint: `${toolKind}:${toolName}:${stableStringify(exactArguments)}`,
    semanticFingerprint: `${family}:${resourceIdentity}:${stableStringify(semanticArguments)}`,
    resourceIdentity,
    trustedComputerUse,
    mutating: isMutatingToolCall(input)
  }
  return attempt
}

export function normalizeExecutionReceipt(
  attempt: NormalizedExecutionAttempt,
  input: ExecutionReceiptInput,
  inferredEvidenceDelta = false
): NormalizedExecutionReceipt {
  const errorCode = normalizeFailureToken(input.errorCode || errorCodeFromValue(input.output) || errorCodeFromText(input.detail))
  const failureClass = normalizeFailureToken(
    input.failureClass || failureClassFor(errorCode, input.status, input.evidenceDelta ?? inferredEvidenceDelta)
  ) || 'none'
  return {
    callId: attempt.callId,
    status: input.status,
    family: attempt.family,
    failureClass,
    errorCode,
    resourceIdentity: normalizedReceiptResourceIdentity(input.resourceIdentity, attempt.resourceIdentity),
    evidenceDelta: input.evidenceDelta ?? inferredEvidenceDelta,
    stateChanged: input.stateChanged ?? (attempt.mutating && input.status === 'success'),
    detail: input.detail?.trim().slice(0, 800) ?? ''
  }
}

function normalizedReceiptResourceIdentity(
  receiptIdentity: string | undefined,
  attemptIdentity: string
): string {
  const value = receiptIdentity?.trim() || ''
  if (!value) return attemptIdentity
  if (attemptIdentity.startsWith('resource:') && !value.includes(':')) return `resource:${value}`
  if (attemptIdentity.startsWith('path:') && !value.startsWith('path:')) return `path:${value}`
  return value
}

function executionFamily(
  input: ExecutionAttemptInput,
  toolKind: ExecutionToolKind,
  trustedComputerUse: boolean
): string {
  if (trustedComputerUse) return `${toolKind}:trusted-computer-use`
  if (toolKind === 'file_change') return 'file_change:file-change'
  if (toolKind === 'command_execution') {
    const command = commandExecutionText(input)
    if (isOsGuiAutomationCommand(command)) return 'command_execution:os-gui-automation'
    return `command_execution:${commandFamily(command)}`
  }
  const name = normalizedToolName(input.toolName)
  if (name === 'sciforge_discover') return 'tool_call:capability.discover'
  if (name === 'sciforge_observe') return 'tool_call:capability.observe'
  if (name === 'sciforge_invoke') {
    const operationFamily = stringValue(input.metadata?.operationFamily)
    return `tool_call:${operationFamily || 'capability.invoke'}`
  }
  if (name === 'sciforge_events') return 'tool_call:capability.events'
  if (/(search|grep|find|rg|query)/u.test(name)) return 'tool_call:search-read'
  if (/(read|open|cat|fetch|get|list)/u.test(name)) return 'tool_call:read'
  if (/(write|create|update|delete|patch|edit)/u.test(name)) return 'tool_call:write'
  return `tool_call:${name || 'tool'}`
}

function executionResourceIdentity(
  input: ExecutionAttemptInput,
  context: ExecutionGovernorContext
): string {
  const args = input.arguments
  const componentId = stringValue(args.componentId) || stringValue(args.component_id)
  const targetId = stringValue(args.targetId) || stringValue(args.target_id)
  if (componentId || targetId) return `surface:${componentId}/${targetId}`
  const pathValue = stringValue(args.path) || stringValue(args.filePath) || stringValue(args.file_path)
  if (pathValue) return `path:${normalizeReadPath(pathValue, normalizeWorkspace(context.workspace))}`
  const resource = asRecord(args.resource)
  const resourceId = stringValue(resource?.id) || stringValue(resource?.resourceRef) || stringValue(args.resourceRef)
  if (resourceId) return `resource:${resourceId}`
  const query = stringValue(args.query)
  if (query) return `query:${canonicalText(query)}`
  return ''
}

function stripVolatileArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileArguments)
  const record = asRecord(value)
  if (!record) return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]+/gu, '')
    if (VOLATILE_ARGUMENT_KEYS.has(normalizedKey)) continue
    out[key] = stripVolatileArguments(entry)
  }
  return out
}

function isOsGuiAutomationCommand(command: string): boolean {
  const value = executableScript(command).toLowerCase()
  if (!value) return false
  return [
    /\bscreencapture\b/u,
    /\b(?:gnome-screenshot|scrot|spectacle|xfce4-screenshooter)\b/u,
    /\b(?:xdotool|wmctrl)\b/u,
    /\bosascript\b[\s\S]{0,800}\b(?:system events|window|process|frontmost|activate|tell application)\b/u,
    /\bpython(?:3(?:\.\d+)?)?\b[\s\S]{0,1600}\b(?:import\s+(?:quartz|appkit|mss)|from\s+(?:pil|quartz|appkit|mss)\s+import|cgwindow(?:list|image)|imagegrab\.grab|pyautogui\.screenshot)\b/u,
    /\b(?:swift|ruby)\b[\s\S]{0,1600}\b(?:cgwindowlist|cgwindowimage|system events)\b/u,
    /\bpowershell(?:\.exe)?\b[\s\S]{0,1000}\b(?:copyfromscreen|uiautomation|user32|findwindow|getwindowrect)\b/u
  ].some((pattern) => pattern.test(value))
}

function commandExecutionText(input: ExecutionAttemptInput): string {
  const args = input.arguments
  const command = stringValue(args.command) || stringValue(args.cmd) || stringValue(input.metadata?.command)
  const argv = firstStringArray(args.args, args.argv)
  return shellScriptFromCommandAndArgs(command, argv) || command
}

function shellScriptFromCommandAndArgs(command: string, args: string[]): string {
  const commandName = basenameCommand(command)
  if (!['sh', 'bash', 'zsh', 'dash', 'fish'].includes(commandName)) return command
  const scriptIndex = args.findIndex((value) => value === '-c' || value === '-lc' || /^-[^-]*c/u.test(value))
  return scriptIndex >= 0 ? args[scriptIndex + 1]?.trim() || command : command
}

function executableScript(command: string): string {
  return command
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .join('\n')
}

function commandFamily(command: string): string {
  const script = executableScript(command)
  const match = script.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*(?:command\s+)?([^\s;&|]+)/u)
  const head = basenameCommand(match?.[1] || 'shell')
  if (head === 'date' || head === 'time') return 'shell/date'
  if (['cat', 'sed', 'head', 'tail', 'nl', 'less'].includes(head)) return 'shell/read-file'
  if (['rg', 'grep', 'find', 'fd'].includes(head)) return 'shell/search'
  if (['ls', 'pwd', 'stat'].includes(head)) return 'shell/list'
  if (['curl', 'wget'].includes(head)) return 'shell/fetch'
  return `shell/${head}`
}

function isTrustedComputerUse(input: ExecutionAttemptInput): boolean {
  const name = normalizedToolName(input.toolName)
  const server = normalizedToolName(stringValue(input.metadata?.server) || stringValue(input.metadata?.providerId))
  return name === 'computer_use' || name.endsWith('_computer_use') || server === 'gui_owl_computer_use'
}

function isSessionControlCall(input: ExecutionAttemptInput): boolean {
  if (normalizedToolName(input.toolName) !== 'bash') return false
  const action = stringValue(input.arguments.action)
  return action === 'poll' || action === 'write' || action === 'stop'
}

function isSessionControlFamily(family: string): boolean {
  return family === 'command_execution:shell/poll'
}

function isMutatingToolCall(input: ExecutionAttemptInput): boolean {
  if (input.toolKind === 'file_change') return true
  return MUTATING_TOOL_NAMES.has(normalizedToolName(input.toolName))
}

function recoveryGuidance(family: string, failureClass: string): string {
  if (failureClass === 'stale_resource' || family === 'tool_call:surface.inspect') {
    return 'Call sciforge_discover for surface.inspect, then invoke the returned operation through sciforge_invoke using only current opaque references. If discovery or invocation still fails, report the broker receipt instead of using OS GUI automation.'
  }
  return 'Stop varying volatile arguments. Inspect the latest executor receipt, choose a genuinely different evidence-gaining method, or report the blocker.'
}

function ownedSurfaceGuidance(): string {
  return 'Use the owned broker: call sciforge_discover for surface.inspect, then call sciforge_invoke with the returned operation and resource references. Do not use screencapture, osascript, window enumeration, or another OS-level GUI fallback.'
}

function failureClassFor(
  errorCode: string,
  status: ExecutionReceiptInput['status'],
  evidenceDelta: boolean
): string {
  if (
    errorCode === 'unknown_resource_ref' ||
    errorCode === 'stale_resource_ref' ||
    errorCode === 'stale_resource' ||
    errorCode === 'semantic_revision_conflict'
  ) return 'stale_resource'
  if (errorCode.includes('invalid') || errorCode.includes('schema')) return 'invalid_arguments'
  if (errorCode.includes('permission') || errorCode.includes('denied')) return 'permission_denied'
  if (errorCode.includes('timeout')) return 'timeout'
  if (status !== 'success') return errorCode || 'execution_error'
  if (!evidenceDelta) return 'no_evidence_delta'
  return 'none'
}

function errorCodeFromValue(value: unknown): string {
  const record = asRecord(value)
  if (!record) return ''
  const error = asRecord(record.error)
  return stringValue(error?.code) || stringValue(record.errorCode) || stringValue(record.code)
}

function errorCodeFromText(value: string | undefined): string {
  const text = value?.trim() || ''
  if (!text) return ''
  const structured = text.match(/["']?code["']?\s*[:=]\s*["']([a-z0-9_.-]+)["']/iu)?.[1]
  if (structured) return structured
  if (/unknown resource ref|unknown_resource_ref/iu.test(text)) return 'unknown_resource_ref'
  if (/stale resource|semantic revision conflict/iu.test(text)) return 'stale_resource_ref'
  if (/input validation|invalid arguments/iu.test(text)) return 'invalid_arguments'
  if (/permission denied|not permitted/iu.test(text)) return 'permission_denied'
  if (/timed?\s*out|timeout/iu.test(text)) return 'timeout'
  return ''
}

function normalizeFailureToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/gu, '_').replace(/^_+|_+$/gu, '')
}

function inferToolKind(toolName: string): ExecutionToolKind {
  if (toolName === 'exec_command' || toolName === 'bash' || toolName === 'local_shell') return 'command_execution'
  if (toolName === 'apply_patch') return 'file_change'
  return 'tool_call'
}

function normalizedToolName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
}

function basenameCommand(value: string): string {
  return value.trim().split(/[\\/]/u).pop()?.toLowerCase() || 'shell'
}

function canonicalText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

function argumentsWithoutReason(argumentsValue: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(argumentsValue, 'reason')) return argumentsValue
  const { reason: _reason, ...rest } = argumentsValue
  return rest
}

function readOverrideReason(argumentsValue: Record<string, unknown>): string | undefined {
  const reason = stringValue(argumentsValue.reason)
  return reason || undefined
}

function mutationPaths(argumentsValue: Record<string, unknown>): string[] {
  const candidates = [
    argumentsValue.path,
    argumentsValue.file_path,
    argumentsValue.source,
    argumentsValue.destination,
    argumentsValue.from,
    argumentsValue.to
  ]
  return candidates.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function normalizeWorkspace(workspace: string | undefined): string | undefined {
  if (!workspace?.trim()) return undefined
  return path.resolve(workspace)
}

function normalizeReadPath(rawPath: string, workspace: string | undefined): string {
  const normalizedInput = rawPath.trim()
  if (path.isAbsolute(normalizedInput)) return path.normalize(normalizedInput)
  return path.resolve(workspace ?? process.cwd(), normalizedInput)
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function boundedRatio(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue
    const strings = value.map(stringValue).filter(Boolean)
    if (strings.length) return strings
  }
  return []
}

function isErrorOutput(output: unknown): boolean {
  const record = asRecord(output)
  return Boolean(record?.error)
}

function actualReadInterval(
  output: Record<string, unknown> | undefined,
  requested: LineInterval
): LineInterval {
  const start = positiveInteger(output?.start_line, requested.start)
  const end = positiveInteger(output?.end_line, requested.end)
  return { start, end: Math.max(start, end) }
}

function intervalCovered(intervals: readonly LineInterval[], target: LineInterval): boolean {
  return intervals.some((interval) => interval.start <= target.start && interval.end >= target.end)
}

function intervalCoverageRatio(intervals: readonly LineInterval[], target: LineInterval): number {
  const clipped = intervals
    .map((interval) => ({
      start: Math.max(interval.start, target.start),
      end: Math.min(interval.end, target.end)
    }))
    .filter((interval) => interval.end >= interval.start)
  const covered = mergeInterval([], ...clipped)
    .reduce((sum, interval) => sum + interval.end - interval.start + 1, 0)
  return covered / Math.max(1, target.end - target.start + 1)
}

function mergeInterval(
  intervals: readonly LineInterval[],
  ...additions: readonly LineInterval[]
): LineInterval[] {
  const sorted = [...intervals, ...additions].sort((left, right) => left.start - right.start)
  const merged: LineInterval[] = []
  for (const interval of sorted) {
    const previous = merged.at(-1)
    if (!previous || interval.start > previous.end + 1) {
      merged.push({ ...interval })
      continue
    }
    previous.end = Math.max(previous.end, interval.end)
  }
  return merged
}

function hashReadResult(output: unknown): string {
  const record = asRecord(output)
  const content = typeof record?.content === 'string' ? record.content : stableStringify(output)
  return createHash('sha256').update(content).digest('hex')
}

function hashToolResult(output: unknown): string {
  return createHash('sha256').update(stableStringify(output)).digest('hex')
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(canonicalize(value)) ?? String(value)
  } catch {
    return String(value)
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalize((value as Record<string, unknown>)[key])
  }
  return out
}
