import { createHash } from 'node:crypto'
import { isAbsolute, resolve, win32 } from 'node:path'
import type { TurnItem, ToolCallTurnItem, ToolResultTurnItem } from '../contracts/items.js'

const DEFAULT_MAX_ITEMS = 96
const DEFAULT_REPEATED_ACTION_OBSERVATION_THRESHOLD = 4
const DEFAULT_REPEATED_ACTION_ERROR_THRESHOLD = 3
const DEFAULT_ALTERNATING_THRESHOLD = 6
const DEFAULT_REDUNDANT_READ_THRESHOLD = 2
const MIN_ALTERNATING_THRESHOLD = 4

const READ_TOOL_NAMES = new Set([
  'read',
  'read_file',
  'gui_workspace_read',
  'mcp_gui_workspace_intel_gui_workspace_read'
])

const MUTATING_TOOL_NAMES = new Set([
  'write',
  'write_file',
  'edit',
  'edit_file',
  'edit_diff',
  'apply_patch',
  'delete',
  'delete_file',
  'move',
  'move_file',
  'rename'
])

const PATH_ARGUMENT_KEYS = [
  'path',
  'file_path',
  'filename',
  'target',
  'target_path',
  'source',
  'source_path',
  'destination',
  'destination_path',
  'from',
  'to'
] as const

/**
 * The pattern categories are inspired by the public, high-level stuck-loop
 * heuristics used by OpenHands. This is an independent SciForge implementation
 * over persisted TurnItem trajectories, not a port of OpenHands source code.
 * https://github.com/OpenHands/software-agent-sdk
 */
export type TrajectoryStuckKind =
  | 'repeated_action_observation'
  | 'repeated_action_error'
  | 'alternating_action_observation'
  | 'redundant_read'

export type TrajectoryStuckDetectorOptions = {
  /** Maximum number of persisted items examined per inspection. */
  maxItems?: number
  repeatedActionObservationThreshold?: number
  repeatedActionErrorThreshold?: number
  /** Number of trailing A/B pair repetitions required; normalized to an even value. */
  alternatingThreshold?: number
  /** Number of redundant reads of one unchanged file tolerated before stopping. */
  redundantReadThreshold?: number
  /** Workspace used to resolve relative and absolute aliases to one lexical path. */
  workspace?: string
  /** Restrict inspection to one turn. Otherwise the latest tool item's turn is used. */
  turnId?: string
}

export type RedundantReadEvidence = {
  path: string
  startLine: number
  endLine: number
}

export type TrajectoryStuckResult =
  | {
      stuck: false
      inspectedPairs: number
    }
  | {
      stuck: true
      inspectedPairs: number
      kind: TrajectoryStuckKind
      count: number
      callIds: string[]
      message: string
      redundantRead?: RedundantReadEvidence
    }

type NormalizedOptions = {
  maxItems: number
  repeatedActionObservationThreshold: number
  repeatedActionErrorThreshold: number
  alternatingThreshold: number
  redundantReadThreshold: number
  workspace: string
  turnId?: string
}

type ActionObservationPair = {
  call: ToolCallTurnItem
  result: ToolResultTurnItem
  actionSignature: string
  observationSignature: string
  pairSignature: string
  isError: boolean
}

type LineInterval = {
  start: number
  end: number
}

type ReadRange = LineInterval & {
  path: string
  version?: string
  contentFingerprint?: string
}

/** Pure, bounded trajectory inspection suitable for calling after each tool result. */
export function detectTrajectoryStuck(
  items: readonly TurnItem[],
  options: TrajectoryStuckDetectorOptions = {}
): TrajectoryStuckResult {
  const normalized = normalizeOptions(options)
  const boundedItems = items.slice(-normalized.maxItems)
  const turnId = normalized.turnId ?? latestToolTurnId(boundedItems)
  const turnItems = turnId
    ? boundedItems.filter((item) => item.turnId === turnId)
    : boundedItems
  const pairs = pairToolItems(itemsAfterLatestTrajectoryBoundary(turnItems))

  const errorRepeat = trailingSameActionErrors(
    pairs,
    normalized.repeatedActionErrorThreshold
  )
  if (errorRepeat) {
    return stuckResult(
      'repeated_action_error',
      pairs,
      errorRepeat,
      `The same action failed ${errorRepeat.length} consecutive times.`
    )
  }

  const exactRepeat = trailingIdenticalPairs(
    pairs,
    normalized.repeatedActionObservationThreshold
  )
  if (exactRepeat) {
    return stuckResult(
      'repeated_action_observation',
      pairs,
      exactRepeat,
      `The same action produced the same observation ${exactRepeat.length} consecutive times.`
    )
  }

  const alternating = trailingAlternatingPairs(pairs, normalized.alternatingThreshold)
  if (alternating) {
    return stuckResult(
      'alternating_action_observation',
      pairs,
      alternating,
      `The trajectory alternated between two action/observation pairs for ${alternating.length} steps.`
    )
  }

  const redundantRead = latestRedundantRead(
    pairs,
    normalized.workspace,
    normalized.redundantReadThreshold
  )
  if (redundantRead) {
    return {
      stuck: true,
      inspectedPairs: pairs.length,
      kind: 'redundant_read',
      count: redundantRead.count,
      callIds: redundantRead.callIds,
      message:
        `The latest read of ${redundantRead.range.path}:${redundantRead.range.start}-${redundantRead.range.end} ` +
        'is fully covered by successful reads since the last file mutation.',
      redundantRead: {
        path: redundantRead.range.path,
        startLine: redundantRead.range.start,
        endLine: redundantRead.range.end
      }
    }
  }

  return { stuck: false, inspectedPairs: pairs.length }
}

function itemsAfterLatestTrajectoryBoundary(items: readonly TurnItem[]): readonly TurnItem[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === 'user_message') {
      return items.slice(index + 1)
    }
  }
  return items
}

/** Stateful-looking convenience wrapper; inspection itself remains deterministic and pure. */
export class TrajectoryStuckDetector {
  private readonly options: TrajectoryStuckDetectorOptions

  constructor(options: TrajectoryStuckDetectorOptions = {}) {
    this.options = { ...options }
  }

  inspect(
    items: readonly TurnItem[],
    overrides: Pick<TrajectoryStuckDetectorOptions, 'workspace' | 'turnId'> = {}
  ): TrajectoryStuckResult {
    return detectTrajectoryStuck(items, { ...this.options, ...overrides })
  }
}

function normalizeOptions(options: TrajectoryStuckDetectorOptions): NormalizedOptions {
  const alternatingThreshold = positiveInteger(
    options.alternatingThreshold,
    DEFAULT_ALTERNATING_THRESHOLD,
    MIN_ALTERNATING_THRESHOLD
  )
  return {
    maxItems: positiveInteger(options.maxItems, DEFAULT_MAX_ITEMS, 1),
    repeatedActionObservationThreshold: positiveInteger(
      options.repeatedActionObservationThreshold,
      DEFAULT_REPEATED_ACTION_OBSERVATION_THRESHOLD,
      2
    ),
    repeatedActionErrorThreshold: positiveInteger(
      options.repeatedActionErrorThreshold,
      DEFAULT_REPEATED_ACTION_ERROR_THRESHOLD,
      2
    ),
    alternatingThreshold:
      alternatingThreshold % 2 === 0 ? alternatingThreshold : alternatingThreshold + 1,
    redundantReadThreshold: positiveInteger(
      options.redundantReadThreshold,
      DEFAULT_REDUNDANT_READ_THRESHOLD,
      1
    ),
    workspace: options.workspace?.trim() || '.',
    ...(options.turnId ? { turnId: options.turnId } : {})
  }
}

function positiveInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.floor(value))
}

function latestToolTurnId(items: readonly TurnItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === 'tool_call' || item?.kind === 'tool_result') return item.turnId
  }
  return undefined
}

function pairToolItems(items: readonly TurnItem[]): ActionObservationPair[] {
  const calls = new Map<string, ToolCallTurnItem>()
  const pairs: ActionObservationPair[] = []
  const pairIndexByCallId = new Map<string, number>()

  for (const item of items) {
    if (item.kind === 'tool_call') {
      calls.set(item.callId, item)
      continue
    }
    if (item.kind !== 'tool_result') continue
    const call = calls.get(item.callId)
    if (!call) continue
    if (isBashSessionControlCall(call)) continue
    const actionSignature = signature({ toolName: call.toolName, arguments: call.arguments })
    const observationSignature = signature({
      toolName: item.toolName,
      isError: item.isError === true,
      output: item.output
    })
    const pair: ActionObservationPair = {
      call,
      result: item,
      actionSignature,
      observationSignature,
      pairSignature: `${actionSignature}\n${observationSignature}`,
      isError: item.isError === true || item.status === 'failed' || outputLooksLikeError(item.output)
    }
    const existingIndex = pairIndexByCallId.get(item.callId)
    if (existingIndex === undefined) {
      pairIndexByCallId.set(item.callId, pairs.length)
      pairs.push(pair)
    } else {
      pairs[existingIndex] = pair
    }
  }
  return pairs
}

function isBashSessionControlCall(call: ToolCallTurnItem): boolean {
  if (call.toolName !== 'bash') return false
  const action = typeof call.arguments.action === 'string' ? call.arguments.action : ''
  return action === 'poll' || action === 'write' || action === 'stop'
}

function outputLooksLikeError(output: unknown): boolean {
  if (!isRecord(output)) return false
  return output.error !== undefined || output.ok === false
}

function trailingSameActionErrors(
  pairs: readonly ActionObservationPair[],
  threshold: number
): ActionObservationPair[] | null {
  const latest = pairs.at(-1)
  if (!latest?.isError) return null
  const run: ActionObservationPair[] = []
  for (let index = pairs.length - 1; index >= 0; index -= 1) {
    const pair = pairs[index]
    if (!pair?.isError || pair.actionSignature !== latest.actionSignature) break
    run.unshift(pair)
  }
  return run.length >= threshold ? run : null
}

function trailingIdenticalPairs(
  pairs: readonly ActionObservationPair[],
  threshold: number
): ActionObservationPair[] | null {
  const latest = pairs.at(-1)
  if (!latest) return null
  const run: ActionObservationPair[] = []
  for (let index = pairs.length - 1; index >= 0; index -= 1) {
    const pair = pairs[index]
    if (!pair || pair.pairSignature !== latest.pairSignature) break
    run.unshift(pair)
  }
  return run.length >= threshold ? run : null
}

function trailingAlternatingPairs(
  pairs: readonly ActionObservationPair[],
  threshold: number
): ActionObservationPair[] | null {
  if (pairs.length < threshold) return null
  const tail = pairs.slice(-threshold)
  const first = tail[0]?.pairSignature
  const second = tail[1]?.pairSignature
  if (!first || !second || first === second) return null
  const alternating = tail.every(
    (pair, index) => pair.pairSignature === (index % 2 === 0 ? first : second)
  )
  return alternating ? tail : null
}

function stuckResult(
  kind: Exclude<TrajectoryStuckKind, 'redundant_read'>,
  allPairs: readonly ActionObservationPair[],
  evidence: readonly ActionObservationPair[],
  message: string
): TrajectoryStuckResult {
  return {
    stuck: true,
    inspectedPairs: allPairs.length,
    kind,
    count: evidence.length,
    callIds: evidence.map((pair) => pair.call.callId),
    message
  }
}

function latestRedundantRead(
  pairs: readonly ActionObservationPair[],
  workspace: string,
  threshold: number
): { callId: string; range: ReadRange; count: number; callIds: string[] } | null {
  const coverage = new Map<string, LineInterval[]>()
  const versions = new Map<string, string>()
  const redundantByPath = new Map<string, Array<{ callId: string; range: ReadRange }>>()
  const unversionedReads = new Map<
    string,
    Map<string, Array<{ callId: string; range: ReadRange }>>
  >()
  let latest: { callId: string; range: ReadRange; count: number; callIds: string[] } | null = null

  pairs.forEach((pair, index) => {
    if (isSuccessfulMutation(pair)) {
      const paths = mutationPaths(pair, workspace)
      if (paths.length === 0) {
        coverage.clear()
        versions.clear()
        redundantByPath.clear()
        unversionedReads.clear()
      } else {
        paths.forEach((path) => {
          coverage.delete(path)
          versions.delete(path)
          redundantByPath.delete(path)
          unversionedReads.delete(path)
        })
      }
      latest = null
      return
    }

    if (!isSuccessfulRead(pair)) {
      if (index === pairs.length - 1) latest = null
      return
    }
    const range = readRange(pair, workspace)
    if (!range) {
      if (index === pairs.length - 1) latest = null
      return
    }
    if (!range.version) {
      if (!range.contentFingerprint) {
        if (index === pairs.length - 1) latest = null
        return
      }
      const readsForPath = unversionedReads.get(range.path) ?? new Map<
        string,
        Array<{ callId: string; range: ReadRange }>
      >()
      const key = `${range.start}:${range.end}:${range.contentFingerprint}`
      const reads: Array<{ callId: string; range: ReadRange }> = readsForPath.get(key) ?? []
      reads.push({ callId: pair.call.callId, range })
      readsForPath.set(key, reads)
      unversionedReads.set(range.path, readsForPath)
      const redundantCount = Math.max(0, reads.length - 1)
      latest = index === pairs.length - 1 && redundantCount >= threshold
        ? {
            callId: pair.call.callId,
            range,
            count: redundantCount,
            callIds: reads.slice(1).map((entry) => entry.callId)
          }
        : null
      return
    }
    unversionedReads.delete(range.path)
    const priorVersion = versions.get(range.path)
    if (range.version && priorVersion && range.version !== priorVersion) {
      coverage.delete(range.path)
      redundantByPath.delete(range.path)
    }
    if (range.version) versions.set(range.path, range.version)
    const intervals = coverage.get(range.path) ?? []
    const redundant = intervalIsCovered(intervals, range)
    coverage.set(range.path, mergeInterval(intervals, range))
    if (redundant) {
      const reads = redundantByPath.get(range.path) ?? []
      reads.push({ callId: pair.call.callId, range })
      redundantByPath.set(range.path, reads)
      latest = index === pairs.length - 1 && reads.length >= threshold
        ? {
            callId: pair.call.callId,
            range,
            count: reads.length,
            callIds: reads.map((entry) => entry.callId)
          }
        : null
    } else if (index === pairs.length - 1) {
      latest = null
    }
  })

  return latest
}

function isSuccessfulRead(pair: ActionObservationPair): boolean {
  if (pair.isError) return false
  return READ_TOOL_NAMES.has(pair.call.toolName) || pair.call.toolName.endsWith('_workspace_read')
}

function isSuccessfulMutation(pair: ActionObservationPair): boolean {
  if (pair.isError) return false
  return pair.call.toolKind === 'file_change' || MUTATING_TOOL_NAMES.has(pair.call.toolName)
}

function readRange(pair: ActionObservationPair, workspace: string): ReadRange | null {
  const output = structuredOutput(pair.result.output)
  if (output?.kind === 'directory' || output?.kind === 'image') return null
  const rawPath = firstString(
    output?.path,
    output?.absolute_path,
    output?.relative_path,
    output?.relativePath,
    pair.call.arguments.path
  )
  if (!rawPath) return null

  const outputWorkspace = firstString(output?.workspaceRoot, output?.workspace_root) || workspace
  const path = canonicalPath(rawPath, outputWorkspace)
  const version = firstString(
    output?.content_sha256,
    output?.contentHash,
    output?.etag,
    output?.version
  )
  const start = positiveLine(
    firstNumber(output?.start_line, output?.startLine, pair.call.arguments.offset),
    1
  )
  let end = positiveLine(firstNumber(output?.end_line, output?.endLine), 0)
  if (end === 0) {
    const limit = positiveLine(firstNumber(pair.call.arguments.limit), 0)
    const totalLines = positiveLine(firstNumber(output?.total_lines, output?.totalLines), 0)
    if (limit > 0) end = start + limit - 1
    else if (totalLines > 0 && output?.truncated !== true) end = totalLines
    else if (typeof output?.content === 'string') {
      end = start + Math.max(1, output.content.split(/\r?\n/).length) - 1
    }
  }
  if (end < start) return null
  return {
    path,
    start,
    end,
    ...(version ? { version } : { contentFingerprint: fullStableDigest(pair.result.output) })
  }
}

function fullStableDigest(value: unknown): string {
  const hash = createHash('sha256')
  try {
    hash.update(JSON.stringify(canonicalizeFull(value, new WeakSet<object>())) ?? 'undefined')
  } catch {
    hash.update(String(value))
  }
  return hash.digest('hex')
}

function canonicalizeFull(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value
  }
  if (typeof value === 'bigint') return `${value.toString()}n`
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return { __kind: 'circular' }
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((entry) => canonicalizeFull(entry, seen))
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalizeFull(record[key], seen)
    }
    return out
  } finally {
    seen.delete(value)
  }
}

function mutationPaths(pair: ActionObservationPair, workspace: string): string[] {
  const output = structuredOutput(pair.result.output)
  const candidates: string[] = []
  for (const key of PATH_ARGUMENT_KEYS) {
    const value = pair.call.arguments[key]
    if (typeof value === 'string' && value.trim()) candidates.push(value)
  }
  for (const value of [output?.path, output?.absolute_path, output?.relative_path, output?.relativePath]) {
    if (typeof value === 'string' && value.trim()) candidates.push(value)
  }
  const patch = typeof pair.call.arguments.patch === 'string'
    ? pair.call.arguments.patch
    : typeof pair.call.arguments.input === 'string'
      ? pair.call.arguments.input
      : ''
  candidates.push(...pathsFromPatch(patch))
  return [...new Set(candidates.map((path) => canonicalPath(path, workspace)))]
}

function pathsFromPatch(patch: string): string[] {
  if (!patch) return []
  const paths: string[] = []
  for (const line of patch.split(/\r?\n/)) {
    const custom = line.match(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/)
    if (custom?.[1]) paths.push(custom[1].trim())
    const unified = line.match(/^(?:---|\+\+)\+?\s+(?:[ab]\/)?(.+)$/)
    if (unified?.[1] && unified[1] !== '/dev/null') paths.push(unified[1].trim())
  }
  return paths
}

function structuredOutput(output: unknown): Record<string, unknown> | null {
  if (!isRecord(output)) return null
  const result = isRecord(output.result) ? output.result : null
  const structured = result && isRecord(result.structuredContent)
    ? result.structuredContent
    : null
  return structured ?? output
}

function intervalIsCovered(intervals: readonly LineInterval[], target: LineInterval): boolean {
  let cursor = target.start
  for (const interval of intervals) {
    if (interval.end < cursor) continue
    if (interval.start > cursor) return false
    cursor = Math.max(cursor, interval.end + 1)
    if (cursor > target.end) return true
  }
  return cursor > target.end
}

function mergeInterval(intervals: readonly LineInterval[], added: LineInterval): LineInterval[] {
  const sorted = [...intervals, { start: added.start, end: added.end }]
    .sort((left, right) => left.start - right.start || left.end - right.end)
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

function canonicalPath(rawPath: string, workspace: string): string {
  if (looksLikeWindowsPath(rawPath) || looksLikeWindowsPath(workspace)) {
    const absolute = win32.isAbsolute(rawPath)
      ? win32.resolve(rawPath)
      : win32.resolve(workspace || '.', rawPath)
    return absolute.replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`)
  }
  return isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspace || '.', rawPath)
}

function looksLikeWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\')
}

function positiveLine(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function signature(value: unknown): string {
  try {
    return JSON.stringify(canonicalize(value, new WeakSet<object>(), 0))
  } catch {
    return String(value)
  }
}

function canonicalize(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value
  }
  if (typeof value === 'bigint') return `${value.toString()}n`
  if (typeof value === 'string') {
    if (value.length <= 4_096) return value
    return {
      __kind: 'bounded_string',
      length: value.length,
      head: value.slice(0, 2_048),
      tail: value.slice(-2_048)
    }
  }
  if (typeof value !== 'object') return String(value)
  if (depth >= 8) return { __kind: 'max_depth' }
  if (seen.has(value)) return { __kind: 'circular' }
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const selected = value.length <= 64
        ? value
        : [...value.slice(0, 32), ...value.slice(-32)]
      return {
        __kind: 'array',
        length: value.length,
        values: selected.map((entry) => canonicalize(entry, seen, depth + 1))
      }
    }
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const selectedKeys = keys.length <= 64
      ? keys
      : [...keys.slice(0, 32), ...keys.slice(-32)]
    const out: Record<string, unknown> = {}
    for (const key of selectedKeys) out[key] = canonicalize(record[key], seen, depth + 1)
    if (keys.length > selectedKeys.length) out.__omittedKeyCount = keys.length - selectedKeys.length
    return out
  } finally {
    seen.delete(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
