import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ToolCallLike } from '../ports/tool-host.js'

export type ToolStormBreakerOptions = {
  windowSize?: number
  threshold?: number
  /** Workspace used to collapse relative and absolute read-path aliases. */
  workspace?: string
  /** Defaults must track the built-in read tool defaults. */
  defaultReadOffset?: number
  defaultReadLimit?: number
  /** Suppress reads whose requested range is already covered above this ratio. */
  maxReadOverlapRatio?: number
}

export type ToolStormInspectContext = {
  workspace?: string
}

export type ToolStormResultContext = ToolStormInspectContext & {
  isError?: boolean
}

export type ToolEvidenceResult = {
  evidenceGained: boolean
  duplicateResult: boolean
  resultHash?: string
}

type RecentToolCall = {
  name: string
  args: string
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

const DEFAULT_WINDOW_SIZE = 8
const DEFAULT_THRESHOLD = 3
const DEFAULT_READ_OFFSET = 1
const DEFAULT_READ_LIMIT = 2000
const DEFAULT_MAX_READ_OVERLAP_RATIO = 0.9
const MUTATING_TOOL_NAMES = new Set(['write', 'edit', 'edit_diff', 'apply_patch', 'delete', 'move'])
const STORM_EXEMPT_TOOL_NAMES = new Set(['request_user_input', 'user_input'])

/**
 * Prevents repeated identical tool calls from inflating dynamic history
 * and cache misses. It is deliberately turn-scoped; a new user turn is
 * a new intent, so the AgentLoop resets the breaker between turns.
 */
export class ToolStormBreaker {
  private readonly windowSize: number
  private readonly threshold: number
  private readonly workspace?: string
  private readonly defaultReadOffset: number
  private readonly defaultReadLimit: number
  private readonly maxReadOverlapRatio: number
  private readonly recent: RecentToolCall[] = []
  private readonly readEvidence = new Map<string, ReadEvidence>()
  private readonly pendingReads = new Map<string, { path: string; start: number; end: number }>()
  private readonly consumedReadOverrides = new Set<string>()

  constructor(options: ToolStormBreakerOptions = {}) {
    this.windowSize = Math.max(1, Math.floor(options.windowSize ?? DEFAULT_WINDOW_SIZE))
    this.threshold = Math.max(2, Math.floor(options.threshold ?? DEFAULT_THRESHOLD))
    this.workspace = normalizeWorkspace(options.workspace)
    this.defaultReadOffset = positiveInteger(options.defaultReadOffset, DEFAULT_READ_OFFSET)
    this.defaultReadLimit = positiveInteger(options.defaultReadLimit, DEFAULT_READ_LIMIT)
    this.maxReadOverlapRatio = boundedRatio(
      options.maxReadOverlapRatio,
      DEFAULT_MAX_READ_OVERLAP_RATIO
    )
  }

  inspect(
    call: ToolCallLike,
    context: ToolStormInspectContext = {}
  ): { suppress: boolean; reason?: string } {
    if (STORM_EXEMPT_TOOL_NAMES.has(call.toolName)) return { suppress: false }
    if (isBashSessionControlCall(call)) return { suppress: false }
    const name = call.toolName
    const args = stableStringify(argumentsWithoutReason(call.arguments))
    const readOnly = !isMutatingToolCall(call)

    if (!readOnly) {
      this.invalidateReadEvidence(call, context)
      this.clearReadOnlyEntries()
    }

    const count = this.recent.reduce(
      (sum, entry) => sum + (entry.name === name && entry.args === args ? 1 : 0),
      0
    )

    const read = call.toolName === 'read'
      ? this.readDescriptor(call, context)
      : undefined
    const overrideReason = read ? readOverrideReason(call.arguments) : undefined
    const overrideKey = read && overrideReason
      ? `${read.path}\0${read.start}:${read.end}\0${overrideReason}`
      : undefined
    if (overrideKey && !this.consumedReadOverrides.has(overrideKey)) {
      this.consumedReadOverrides.add(overrideKey)
      this.remember(name, args, readOnly)
      this.rememberPendingRead(call.callId, read)
      return { suppress: false }
    }

    if (count >= this.threshold - 1) {
      return {
        suppress: true,
        reason:
          `${name} was called with identical arguments ${count + 1} times in this turn; ` +
          'repeat-loop guard suppressed the duplicate. Choose a narrower query or explain why another identical call is needed.'
      }
    }

    // Reads are stricter than generic tools: a successful or already-scheduled
    // range is redundant even when the raw arguments are byte-identical.
    const overlapRatio = read ? this.readRangeCoverageRatio(read) : 0
    if (read && overlapRatio >= this.maxReadOverlapRatio) {
      return {
        suppress: true,
        reason:
          `read range ${read.start}-${read.end} for ${read.path} is ${Math.round(overlapRatio * 100)}% covered or scheduled in this turn; ` +
          'repeat-loop guard suppressed the redundant read. Request an uncovered range, or provide a reason to force one reread.'
      }
    }

    this.remember(name, args, readOnly)
    this.rememberPendingRead(call.callId, read)
    return { suppress: false }
  }

  /**
   * Records successful tool output after execution. The return value lets the
   * loop distinguish a successful call from one that actually added evidence.
   */
  recordResult(
    call: ToolCallLike,
    output: unknown,
    context: ToolStormResultContext = {}
  ): ToolEvidenceResult {
    this.pendingReads.delete(call.callId)
    if (call.toolName !== 'read' || context.isError === true || isErrorOutput(output)) {
      return { evidenceGained: false, duplicateResult: false }
    }
    const requested = this.readDescriptor(call, context)
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

  reset(): void {
    this.recent.length = 0
    this.readEvidence.clear()
    this.pendingReads.clear()
    this.consumedReadOverrides.clear()
  }

  private remember(name: string, args: string, readOnly: boolean): void {
    this.recent.push({ name, args, readOnly })
    while (this.recent.length > this.windowSize) this.recent.shift()
  }

  private workspaceFor(context: ToolStormInspectContext): string | undefined {
    return normalizeWorkspace(context.workspace) ?? this.workspace
  }

  private readDescriptor(
    call: ToolCallLike,
    context: ToolStormInspectContext
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

  private invalidateReadEvidence(call: ToolCallLike, context: ToolStormInspectContext): void {
    const workspace = this.workspaceFor(context)
    const paths = mutationPaths(call.arguments)
      .map((entry) => normalizeReadPath(entry, workspace))
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

function argumentsWithoutReason(argumentsValue: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(argumentsValue, 'reason')) return argumentsValue
  const { reason: _reason, ...rest } = argumentsValue
  return rest
}

function readOverrideReason(argumentsValue: Record<string, unknown>): string | undefined {
  if (typeof argumentsValue.reason !== 'string') return undefined
  const reason = argumentsValue.reason.trim()
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

function isErrorOutput(output: unknown): boolean {
  const record = asRecord(output)
  return typeof record?.error === 'string' && record.error.length > 0
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

function isMutatingToolCall(call: ToolCallLike): boolean {
  if (call.toolKind === 'file_change') return true
  return MUTATING_TOOL_NAMES.has(call.toolName)
}

function isBashSessionControlCall(call: ToolCallLike): boolean {
  if (call.toolName !== 'bash') return false
  const action = typeof call.arguments.action === 'string' ? call.arguments.action : ''
  return action === 'poll' || action === 'write' || action === 'stop'
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(canonicalize(value))
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
