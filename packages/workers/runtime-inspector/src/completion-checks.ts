import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { Worker } from 'node:worker_threads'
import { z } from 'zod'
import type { RuntimeInspectorFailure } from './contract.js'

export const COMPLETION_CHECK_DEFAULT_MAX_FILE_BYTES = 512 * 1024
export const COMPLETION_CHECK_MAX_FILE_BYTES = 1024 * 1024
export const COMPLETION_CHECK_MAX_TOTAL_BYTES = 4 * 1024 * 1024
const COMPLETION_CHECK_MAX_MATCHES = 500
export const COMPLETION_CHECK_REGEX_TIMEOUT_MS = 500

const COMPLETION_CHECK_REGEX_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')

try {
  const regex = new RegExp(workerData.pattern, workerData.flags)
  if (workerData.operation === 'test') {
    parentPort.postMessage({ ok: true, matched: regex.test(workerData.text) })
  } else {
    const values = []
    let match
    while ((match = regex.exec(workerData.text)) !== null && values.length < workerData.maxMatches) {
      const value = typeof workerData.group === 'number'
        ? match[workerData.group]
        : match.groups?.[workerData.group]
      if (typeof value === 'string') values.push(value.slice(0, 256))
      if (match[0].length === 0) regex.lastIndex += 1
    }
    parentPort.postMessage({ ok: true, values })
  }
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  })
}
`

const completionPathSchema = z.string().trim().min(1).max(4096)
const regexFlagsSchema = z.string().max(4).regex(/^(?!.*([imsu]).*\1)[imsu]*$/).optional()

const textPatternSchema = z.object({
  pattern: z.string().min(1).max(512),
  mode: z.enum(['text', 'regex']).default('text'),
  flags: regexFlagsSchema,
  label: z.string().trim().min(1).max(160).optional(),
  blocking: z.boolean().default(true)
}).strict()

const contentFileSchema = z.object({
  path: completionPathSchema,
  required: z.array(textPatternSchema).max(50).optional(),
  forbidden: z.array(textPatternSchema).max(50).optional()
}).strict().superRefine((value, context) => {
  if ((value.required?.length ?? 0) + (value.forbidden?.length ?? 0) === 0) {
    context.addIssue({ code: 'custom', message: 'Each content file needs at least one required or forbidden check.' })
  }
})

const fileExistsSchema = z.object({
  path: completionPathSchema,
  label: z.string().trim().min(1).max(160).optional(),
  blocking: z.boolean().default(true)
}).strict()

const captureSourceSchema = z.object({
  path: completionPathSchema,
  pattern: z.string().min(1).max(512),
  flags: regexFlagsSchema,
  group: z.union([z.number().int().min(0).max(20), z.string().trim().min(1).max(64)]).default(1)
}).strict()

const captureEqualitySchema = z.object({
  label: z.string().trim().min(1).max(160),
  sources: z.array(captureSourceSchema).min(1).max(20),
  normalize: z.enum(['exact', 'trim', 'case_insensitive', 'number']).default('trim'),
  blocking: z.boolean().default(true)
}).strict()

const thresholdSchema = z.object({
  max: z.number().int().min(0).max(100_000),
  blocking: z.boolean().optional()
}).strict()

const latexLogSchema = z.object({
  path: completionPathSchema,
  errors: thresholdSchema.optional(),
  undefined_references: thresholdSchema.optional(),
  overfull_boxes: thresholdSchema.optional()
}).strict()

export const CompletionChecksInputSchema = z.object({
  workspace_root: z.string().trim().min(1).max(4096).optional()
    .describe('Workspace sandbox. Defaults to the worker configured workspace root.'),
  files: z.array(contentFileSchema).max(32).optional(),
  file_exists: z.array(fileExistsSchema).max(64).optional(),
  capture_equalities: z.array(captureEqualitySchema).max(32).optional(),
  latex_logs: z.array(latexLogSchema).max(16).optional(),
  max_file_bytes: z.number().int().min(1).max(COMPLETION_CHECK_MAX_FILE_BYTES).optional()
}).strict().superRefine((value, context) => {
  const count = (value.files?.length ?? 0) +
    (value.file_exists?.length ?? 0) +
    (value.capture_equalities?.length ?? 0) +
    (value.latex_logs?.length ?? 0)
  if (count === 0) {
    context.addIssue({ code: 'custom', message: 'Configure at least one completion check.' })
  }
})

export type CompletionChecksInput = z.input<typeof CompletionChecksInputSchema>
export type ParsedCompletionChecksInput = z.output<typeof CompletionChecksInputSchema>
export type CompletionCheckFindingKind =
  | 'required_text_missing'
  | 'forbidden_text_present'
  | 'capture_mismatch'
  | 'capture_missing'
  | 'file_missing'
  | 'file_not_regular'
  | 'file_too_large'
  | 'total_input_limit'
  | 'latex_errors'
  | 'latex_undefined_references'
  | 'latex_overfull_boxes'

export type CompletionCheckFinding = {
  id: string
  kind: CompletionCheckFindingKind
  severity: 'blocking' | 'warning'
  message: string
  path?: string
  label?: string
  expected?: unknown
  actual?: unknown
}

export type CompletionChecksSuccess = {
  ok: true
  passed: boolean
  clean: boolean
  workspaceRoot: string
  findings: CompletionCheckFinding[]
  summary: {
    checksRun: number
    checksPassed: number
    blockingFindings: number
    nonBlockingFindings: number
    filesInspected: number
    bytesRead: number
  }
  boundaries: {
    readOnly: true
    shellExecution: 'disabled'
    fileSource: 'saved_workspace_files_only'
    maxFileBytes: number
    maxTotalBytes: number
  }
}

export type CompletionChecksResult = CompletionChecksSuccess | RuntimeInspectorFailure

export class CompletionCheckError extends Error {
  readonly code: 'invalid_request' | 'path_outside_repository' | 'file_read_failed'
  readonly suggestion: string
  readonly details?: unknown

  constructor(
    code: CompletionCheckError['code'],
    message: string,
    suggestion: string,
    details?: unknown
  ) {
    super(message)
    this.name = 'CompletionCheckError'
    this.code = code
    this.suggestion = suggestion
    this.details = details
  }
}

type LoadedFile = {
  requestedPath: string
  exists: boolean
  regular: boolean
  bytes: number
  text?: string
  limit?: 'file' | 'total'
}

export async function runCompletionChecks(
  input: ParsedCompletionChecksInput,
  workspaceRootInput: string
): Promise<CompletionChecksSuccess> {
  const workspaceRoot = await realpath(workspaceRootInput).catch(() => {
    throw new CompletionCheckError(
      'file_read_failed',
      `Workspace root could not be resolved: ${workspaceRootInput}`,
      'Choose an existing workspace directory.'
    )
  })
  const maxFileBytes = input.max_file_bytes ?? COMPLETION_CHECK_DEFAULT_MAX_FILE_BYTES
  const findings: CompletionCheckFinding[] = []
  const cache = new Map<string, LoadedFile>()
  let checksRun = 0
  let checksPassed = 0
  let bytesRead = 0

  const addFinding = (
    finding: Omit<CompletionCheckFinding, 'severity'> & { blocking: boolean }
  ): void => {
    const { blocking, ...rest } = finding
    findings.push({ ...rest, severity: blocking ? 'blocking' : 'warning' })
  }

  const load = async (requestedPath: string, needsText: boolean): Promise<LoadedFile> => {
    const cacheKey = `${requestedPath}\u0000${needsText ? 'text' : 'stat'}`
    const cached = needsText
      ? cache.get(`${requestedPath}\u0000text`)
      : cache.get(`${requestedPath}\u0000stat`) ?? cache.get(`${requestedPath}\u0000text`)
    if (cached) return cached

    const safe = await resolveWorkspaceFile(workspaceRoot, requestedPath)
    if (!safe.exists) {
      const missing = { requestedPath, exists: false, regular: false, bytes: 0 }
      cache.set(cacheKey, missing)
      return missing
    }
    const info = await lstat(safe.realPath).catch((error: unknown) => {
      throw fileReadError(requestedPath, error)
    })
    if (!info.isFile()) {
      const nonRegular = { requestedPath, exists: true, regular: false, bytes: info.size }
      cache.set(cacheKey, nonRegular)
      return nonRegular
    }
    if (!needsText) {
      const statOnly = { requestedPath, exists: true, regular: true, bytes: info.size }
      cache.set(cacheKey, statOnly)
      return statOnly
    }
    if (info.size > maxFileBytes) {
      const tooLarge = { requestedPath, exists: true, regular: true, bytes: info.size, limit: 'file' as const }
      cache.set(cacheKey, tooLarge)
      return tooLarge
    }
    if (bytesRead + info.size > COMPLETION_CHECK_MAX_TOTAL_BYTES) {
      const overTotal = { requestedPath, exists: true, regular: true, bytes: info.size, limit: 'total' as const }
      cache.set(cacheKey, overTotal)
      return overTotal
    }
    const handle = await open(safe.realPath, 'r').catch((error: unknown) => {
      throw fileReadError(requestedPath, error)
    })
    try {
      const text = await handle.readFile('utf8')
      const loaded = { requestedPath, exists: true, regular: true, bytes: Buffer.byteLength(text), text }
      bytesRead += loaded.bytes
      cache.set(`${requestedPath}\u0000text`, loaded)
      cache.set(`${requestedPath}\u0000stat`, loaded)
      return loaded
    } catch (error) {
      throw fileReadError(requestedPath, error)
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  const ensureText = async (
    path: string,
    id: string,
    blocking: boolean
  ): Promise<string | null> => {
    const file = await load(path, true)
    if (!file.exists) {
      addFinding({ id, kind: 'file_missing', blocking, path, message: `Required file is missing: ${path}` })
      return null
    }
    if (!file.regular) {
      addFinding({ id, kind: 'file_not_regular', blocking, path, message: `Path is not a regular file: ${path}` })
      return null
    }
    if (file.limit === 'file') {
      addFinding({
        id,
        kind: 'file_too_large',
        blocking,
        path,
        expected: { maxBytes: maxFileBytes },
        actual: { bytes: file.bytes },
        message: `File exceeds the configured per-file input limit: ${path}`
      })
      return null
    }
    if (file.limit === 'total') {
      addFinding({
        id,
        kind: 'total_input_limit',
        blocking,
        path,
        expected: { maxBytes: COMPLETION_CHECK_MAX_TOTAL_BYTES },
        actual: { bytesRead, nextFileBytes: file.bytes },
        message: `Reading ${path} would exceed the completion-check total input limit.`
      })
      return null
    }
    return file.text ?? ''
  }

  for (const [fileIndex, file] of (input.files ?? []).entries()) {
    for (const [index, check] of (file.required ?? []).entries()) {
      checksRun += 1
      const id = `required:${fileIndex}:${index}`
      const text = await ensureText(file.path, id, check.blocking)
      const matched = text !== null && await patternMatches(text, check.pattern, check.mode, check.flags)
      if (matched) checksPassed += 1
      else if (text !== null) {
        addFinding({
          id,
          kind: 'required_text_missing',
          blocking: check.blocking,
          path: file.path,
          label: check.label,
          expected: { mode: check.mode, pattern: check.pattern },
          message: check.label ? `Required check failed: ${check.label}` : `Required ${check.mode} was not found in ${file.path}.`
        })
      }
    }
    for (const [index, check] of (file.forbidden ?? []).entries()) {
      checksRun += 1
      const id = `forbidden:${fileIndex}:${index}`
      const text = await ensureText(file.path, id, check.blocking)
      const matched = text !== null && await patternMatches(text, check.pattern, check.mode, check.flags)
      if (text !== null && !matched) checksPassed += 1
      else if (text !== null) {
        addFinding({
          id,
          kind: 'forbidden_text_present',
          blocking: check.blocking,
          path: file.path,
          label: check.label,
          expected: { absent: true, mode: check.mode, pattern: check.pattern },
          actual: { present: true },
          message: check.label ? `Forbidden check failed: ${check.label}` : `Forbidden ${check.mode} was found in ${file.path}.`
        })
      }
    }
  }

  for (const [index, check] of (input.file_exists ?? []).entries()) {
    checksRun += 1
    const id = `exists:${index}`
    const file = await load(check.path, false)
    if (file.exists && file.regular) checksPassed += 1
    else {
      addFinding({
        id,
        kind: file.exists ? 'file_not_regular' : 'file_missing',
        blocking: check.blocking,
        path: check.path,
        label: check.label,
        message: file.exists ? `Path is not a regular file: ${check.path}` : `Required file is missing: ${check.path}`
      })
    }
  }

  for (const [index, check] of (input.capture_equalities ?? []).entries()) {
    checksRun += 1
    const id = `capture:${index}`
    const findingsBefore = findings.length
    const captured: string[] = []
    let missing = false
    for (const source of check.sources) {
      const text = await ensureText(source.path, id, check.blocking)
      if (text === null) {
        missing = true
        continue
      }
      const values = await regexCaptures(text, source.pattern, source.flags, source.group)
      if (values.length === 0) missing = true
      captured.push(...values)
    }
    const normalized = captured.map((value) => normalizeCapture(value, check.normalize))
    const unique = [...new Set(normalized)]
    if (!missing && unique.length === 1) checksPassed += 1
    else if (missing && findings.length === findingsBefore) {
      addFinding({
        id,
        kind: 'capture_missing',
        blocking: check.blocking,
        label: check.label,
        expected: { capturedValues: 'one or more per source' },
        actual: { capturedCount: captured.length },
        message: `Capture equality could not collect every required value: ${check.label}`
      })
    } else if (!missing) {
      addFinding({
        id,
        kind: 'capture_mismatch',
        blocking: check.blocking,
        label: check.label,
        expected: { uniqueValues: 1, normalize: check.normalize },
        actual: { uniqueValues: unique.slice(0, 20) },
        message: `Captured values are inconsistent: ${check.label}`
      })
    }
  }

  for (const [index, check] of (input.latex_logs ?? []).entries()) {
    const text = await ensureText(check.path, `latex:${index}`, true)
    const thresholds = [
      {
        key: 'errors' as const,
        findingKind: 'latex_errors' as const,
        count: text === null ? 0 : countLines(text, /^!\s/m),
        config: check.errors ?? { max: 0, blocking: true },
        defaultBlocking: true
      },
      {
        key: 'undefined_references' as const,
        findingKind: 'latex_undefined_references' as const,
        count: text === null ? 0 : countLines(text, /(?:undefined references?|reference .* undefined|citation .* undefined)/i),
        config: check.undefined_references ?? { max: 0, blocking: true },
        defaultBlocking: true
      },
      {
        key: 'overfull_boxes' as const,
        findingKind: 'latex_overfull_boxes' as const,
        count: text === null ? 0 : countLines(text, /Overfull \\[hv]box/i),
        config: check.overfull_boxes ?? { max: 0, blocking: false },
        defaultBlocking: false
      }
    ]
    for (const threshold of thresholds) {
      checksRun += 1
      if (text === null) continue
      if (threshold.count <= threshold.config.max) checksPassed += 1
      else {
        addFinding({
          id: `latex:${index}:${threshold.key}`,
          kind: threshold.findingKind,
          blocking: threshold.config.blocking ?? threshold.defaultBlocking,
          path: check.path,
          expected: { max: threshold.config.max },
          actual: { count: threshold.count },
          message: `LaTeX log ${threshold.key.replaceAll('_', ' ')} count ${threshold.count} exceeds threshold ${threshold.config.max}.`
        })
      }
    }
  }

  const blockingFindings = findings.filter((finding) => finding.severity === 'blocking').length
  return {
    ok: true,
    passed: blockingFindings === 0,
    clean: findings.length === 0,
    workspaceRoot,
    findings,
    summary: {
      checksRun,
      checksPassed,
      blockingFindings,
      nonBlockingFindings: findings.length - blockingFindings,
      filesInspected: new Set([...cache.values()].filter((file) => file.exists).map((file) => file.requestedPath)).size,
      bytesRead
    },
    boundaries: {
      readOnly: true,
      shellExecution: 'disabled',
      fileSource: 'saved_workspace_files_only',
      maxFileBytes,
      maxTotalBytes: COMPLETION_CHECK_MAX_TOTAL_BYTES
    }
  }
}

async function patternMatches(
  text: string,
  pattern: string,
  mode: 'text' | 'regex',
  flags?: string
): Promise<boolean> {
  if (mode === 'text') return text.includes(pattern)
  const result = await executeRegex({ operation: 'test', text, pattern, flags: normalizeRegexFlags(flags) })
  return result.matched
}

async function regexCaptures(
  text: string,
  pattern: string,
  flags: string | undefined,
  group: number | string
): Promise<string[]> {
  const result = await executeRegex({
    operation: 'capture',
    text,
    pattern,
    flags: normalizeRegexFlags(`${flags ?? ''}g`),
    group,
    maxMatches: COMPLETION_CHECK_MAX_MATCHES
  })
  return result.values
}

type RegexWorkerRequest =
  | { operation: 'test'; text: string; pattern: string; flags: string }
  | {
      operation: 'capture'
      text: string
      pattern: string
      flags: string
      group: number | string
      maxMatches: number
    }

type RegexWorkerResult =
  | { matched: boolean; values?: never }
  | { values: string[]; matched?: never }

function executeRegex(request: Extract<RegexWorkerRequest, { operation: 'test' }>): Promise<{ matched: boolean }>
function executeRegex(request: Extract<RegexWorkerRequest, { operation: 'capture' }>): Promise<{ values: string[] }>
function executeRegex(request: RegexWorkerRequest): Promise<RegexWorkerResult> {
  if (looksUnsafeRegex(request.pattern)) {
    throw new CompletionCheckError(
      'invalid_request',
      'A regex was rejected because it contains a high-risk repetition, ambiguous alternation, or backreference.',
      'Use a bounded, linear regex without overlapping repeated alternatives, nested repetition, or backreferences.',
      { pattern: request.pattern }
    )
  }

  return new Promise((resolveResult, rejectResult) => {
    const worker = new Worker(COMPLETION_CHECK_REGEX_WORKER_SOURCE, {
      eval: true,
      workerData: request,
      resourceLimits: {
        maxOldGenerationSizeMb: 32,
        maxYoungGenerationSizeMb: 8,
        stackSizeMb: 2
      }
    })
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      worker.removeAllListeners()
      void worker.terminate()
      callback()
    }
    const timeout = setTimeout(() => {
      finish(() => rejectResult(new CompletionCheckError(
        'invalid_request',
        `A completion-check regex exceeded the ${COMPLETION_CHECK_REGEX_TIMEOUT_MS} ms execution limit.`,
        'Use a bounded, linear regex or a literal text check.',
        { pattern: request.pattern, timeoutMs: COMPLETION_CHECK_REGEX_TIMEOUT_MS }
      )))
    }, COMPLETION_CHECK_REGEX_TIMEOUT_MS)

    worker.once('message', (message: unknown) => {
      finish(() => {
        if (!isRegexWorkerMessage(message)) {
          rejectResult(regexWorkerFailure(request.pattern, 'The regex worker returned an invalid result.'))
        } else if (!message.ok) {
          rejectResult(new CompletionCheckError(
            'invalid_request',
            `Invalid completion-check regex: ${message.error}`,
            'Fix the regex pattern and flags.',
            { pattern: request.pattern, flags: request.flags }
          ))
        } else if (request.operation === 'test' && typeof message.matched === 'boolean') {
          resolveResult({ matched: message.matched })
        } else if (request.operation === 'capture' && isStringArray(message.values)) {
          resolveResult({ values: message.values })
        } else {
          rejectResult(regexWorkerFailure(request.pattern, 'The regex worker returned a mismatched result.'))
        }
      })
    })
    worker.once('error', (error) => {
      finish(() => rejectResult(regexWorkerFailure(request.pattern, error.message)))
    })
    worker.once('exit', (code) => {
      if (code !== 0) {
        finish(() => rejectResult(regexWorkerFailure(
          request.pattern,
          `The regex worker exited unexpectedly with code ${code}.`
        )))
      }
    })
  })
}

function normalizeRegexFlags(flags = ''): string {
  return [...new Set(flags)].join('')
}

function isRegexWorkerMessage(message: unknown): message is {
  ok: boolean
  matched?: unknown
  values?: unknown
  error?: unknown
} {
  if (!message || typeof message !== 'object') return false
  const value = message as Record<string, unknown>
  if (typeof value.ok !== 'boolean') return false
  if (!value.ok) return typeof value.error === 'string' && value.error.length <= 1_000
  return typeof value.matched === 'boolean' || isStringArray(value.values)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length <= COMPLETION_CHECK_MAX_MATCHES &&
    value.every((item) => typeof item === 'string' && item.length <= 256)
}

function regexWorkerFailure(pattern: string, reason: string): CompletionCheckError {
  return new CompletionCheckError(
    'invalid_request',
    `Completion-check regex execution failed: ${reason}`,
    'Use a valid, bounded regex or a literal text check.',
    { pattern }
  )
}

function looksUnsafeRegex(pattern: string): boolean {
  if (/\\[1-9]/.test(pattern) || /\\k<[^>]+>/.test(pattern)) return true
  if (/\((?:\?:)?[^()]*(?:\*|\+|\{\d*,?\d*})[^()]*\)(?:\*|\+|\{\d*,?\d*})/.test(pattern)) return true
  return hasAmbiguousRepeatedAlternation(pattern)
}

/**
 * Reject the common polynomial/exponential case where a repeated group has
 * alternatives that can consume the same prefix, for example `(a|aa)+` or
 * `(\\w|\\w\\w)+`. This intentionally errs on the conservative side. The worker
 * timeout remains the enforcement boundary for constructs this scan does not
 * recognize.
 */
function hasAmbiguousRepeatedAlternation(pattern: string): boolean {
  const groups: Array<{ contentStart: number }> = []
  let escaped = false
  let inCharacterClass = false

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '[') {
      inCharacterClass = true
      continue
    }
    if (char === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue
    if (char === '(') {
      groups.push({ contentStart: groupContentStart(pattern, index) })
      continue
    }
    if (char !== ')' || groups.length === 0) continue

    const group = groups.pop()
    if (!group || !hasUnboundedQuantifierAt(pattern, index + 1)) continue
    const alternatives = splitTopLevelAlternatives(pattern.slice(group.contentStart, index))
    if (alternatives.length < 2) continue
    if (alternatives.some((branch) => branch.length === 0 || beginsWithNullableAtom(branch))) return true

    const tokens = alternatives.map(firstRegexAtom)
    for (let left = 0; left < alternatives.length; left += 1) {
      for (let right = left + 1; right < alternatives.length; right += 1) {
        if (alternatives[left]!.startsWith(alternatives[right]!) ||
          alternatives[right]!.startsWith(alternatives[left]!)) return true
        if (regexAtomsOverlap(tokens[left], tokens[right])) return true
      }
    }
  }
  return false
}

function groupContentStart(pattern: string, openIndex: number): number {
  if (pattern[openIndex + 1] !== '?') return openIndex + 1
  if (pattern[openIndex + 2] === '<') {
    const close = pattern.indexOf('>', openIndex + 3)
    return close === -1 ? openIndex + 1 : close + 1
  }
  return openIndex + 3
}

function hasUnboundedQuantifierAt(pattern: string, index: number): boolean {
  if (pattern[index] === '*' || pattern[index] === '+') return true
  if (pattern[index] !== '{') return false
  const close = pattern.indexOf('}', index + 1)
  if (close === -1) return false
  return /^\{\d*,\}$/.test(pattern.slice(index, close + 1))
}

function splitTopLevelAlternatives(body: string): string[] {
  const alternatives: string[] = []
  let start = 0
  let depth = 0
  let escaped = false
  let inCharacterClass = false
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '[') inCharacterClass = true
    else if (char === ']' && inCharacterClass) inCharacterClass = false
    else if (!inCharacterClass && char === '(') depth += 1
    else if (!inCharacterClass && char === ')') depth = Math.max(0, depth - 1)
    else if (!inCharacterClass && char === '|' && depth === 0) {
      alternatives.push(body.slice(start, index))
      start = index + 1
    }
  }
  alternatives.push(body.slice(start))
  return alternatives
}

function beginsWithNullableAtom(branch: string): boolean {
  const atom = firstRegexAtom(branch)
  if (!atom) return true
  return branch[atom.end] === '?' || branch[atom.end] === '*'
}

type RegexAtom = { key: string; end: number; literal?: string; any?: boolean } | null

function firstRegexAtom(branch: string): RegexAtom {
  let index = branch.startsWith('^') ? 1 : 0
  if (index >= branch.length) return null
  const char = branch[index]!
  if (char === '.') return { key: '.', end: index + 1, any: true }
  if (char === '\\') {
    const next = branch[index + 1]
    if (!next) return { key: '\\', end: index + 1, literal: '\\' }
    if ((next === 'p' || next === 'P') && branch[index + 2] === '{') {
      const close = branch.indexOf('}', index + 3)
      const end = close === -1 ? index + 2 : close + 1
      return { key: branch.slice(index, end), end }
    }
    const literal = /[AbBdDsSwWZz]/.test(next) ? undefined : next
    return { key: branch.slice(index, index + 2), end: index + 2, literal }
  }
  if (char === '[') {
    let escaped = false
    for (let cursor = index + 1; cursor < branch.length; cursor += 1) {
      if (escaped) escaped = false
      else if (branch[cursor] === '\\') escaped = true
      else if (branch[cursor] === ']') {
        return { key: branch.slice(index, cursor + 1), end: cursor + 1 }
      }
    }
  }
  return { key: char, end: index + 1, literal: char }
}

function regexAtomsOverlap(left: RegexAtom, right: RegexAtom): boolean {
  if (!left || !right) return true
  if (left.any || right.any) return true
  if (left.key === right.key) return true
  if (left.literal && right.literal) return left.literal === right.literal
  return false
}

function normalizeCapture(value: string, mode: 'exact' | 'trim' | 'case_insensitive' | 'number'): string {
  if (mode === 'exact') return value
  const trimmed = value.trim()
  if (mode === 'case_insensitive') return trimmed.toLocaleLowerCase()
  if (mode === 'number') {
    const parsed = Number(trimmed.replaceAll(',', ''))
    return Number.isFinite(parsed) ? String(parsed) : `not-a-number:${trimmed}`
  }
  return trimmed
}

function countLines(text: string, pattern: RegExp): number {
  return text.split(/\r?\n/).filter((line) => {
    pattern.lastIndex = 0
    return pattern.test(line)
  }).length
}

async function resolveWorkspaceFile(
  workspaceRoot: string,
  requestedPath: string
): Promise<{ exists: false; realPath: string } | { exists: true; realPath: string }> {
  const candidate = resolve(isAbsolute(requestedPath) ? requestedPath : resolve(workspaceRoot, requestedPath))
  assertInsideWorkspace(workspaceRoot, candidate, requestedPath)
  try {
    const resolved = await realpath(candidate)
    assertInsideWorkspace(workspaceRoot, resolved, requestedPath)
    return { exists: true, realPath: resolved }
  } catch (error) {
    if (error instanceof CompletionCheckError) throw error
    if (!isMissingError(error)) throw fileReadError(requestedPath, error)
    let ancestor = dirname(candidate)
    while (ancestor !== dirname(ancestor)) {
      try {
        const resolvedAncestor = await realpath(ancestor)
        assertInsideWorkspace(workspaceRoot, resolvedAncestor, requestedPath)
        return { exists: false, realPath: candidate }
      } catch (ancestorError) {
        if (ancestorError instanceof CompletionCheckError) throw ancestorError
        if (!isMissingError(ancestorError)) throw fileReadError(requestedPath, ancestorError)
        ancestor = dirname(ancestor)
      }
    }
    return { exists: false, realPath: candidate }
  }
}

function assertInsideWorkspace(workspaceRoot: string, candidate: string, requestedPath: string): void {
  const rel = relative(workspaceRoot, candidate)
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return
  throw new CompletionCheckError(
    'path_outside_repository',
    `Completion-check path must stay inside the workspace: ${requestedPath}`,
    'Use a workspace-relative path that resolves inside workspace_root.',
    { path: requestedPath }
  )
}

function fileReadError(path: string, error: unknown): CompletionCheckError {
  return new CompletionCheckError(
    'file_read_failed',
    `Could not inspect completion-check file ${path}: ${error instanceof Error ? error.message : String(error)}`,
    'Check that the path is a readable saved file inside the workspace.',
    { path }
  )
}

function isMissingError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}
