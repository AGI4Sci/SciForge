import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type JsonRecord = Record<string, unknown>

export type MultisessionEvidence = Readonly<{
  schemaVersion: 1
  runId: string
  generatedAt: string
  batch: {
    requestId: string
    requestedCount: number
    successCount: number
    failureCount: number
    actionOverlapMs: number | null
  }
  sessions: JsonRecord[]
  releases: JsonRecord[]
  finalResources: JsonRecord
  harnessState?: JsonRecord
}>

const SECRET_KEY = /(?:authorization|api.?key|token|secret|password|cookie|localStorage|sessionStorage|cdpEndpoint|imageBase64|imagePath)/iu
const SENSITIVE_VALUE = /(?:\b(?:https?|wss?):\/\/|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]+|(?:^|\s)[A-Za-z]:\\|(?:^|\s)\/(?:Users|home|tmp)\/)/iu
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

export function buildMultisessionEvidence(input: unknown): MultisessionEvidence {
  const capture = record(input, 'capture')
  const runId = safeId(capture.runId, 'runId')
  const batchEnvelope = record(capture.batch, 'batch')
  const batch = dataRecord(batchEnvelope, 'batch')
  const results = array(batch.results, 'batch.results').map((item, index) => (
    record(item, `batch.results[${index}]`)
  ))
  if (results.length < 2 || results.length > 8) {
    throw new Error('batch.results must contain between 2 and 8 children')
  }

  const sessionIds = results.map((item, index) => safeId(
    item.sessionId, `batch.results[${index}].sessionId`,
  ))
  const targetIds = results.map((item, index) => safeId(
    item.targetId, `batch.results[${index}].targetId`,
  ))
  requireUnique(sessionIds, 'sessionId')
  requireUnique(targetIds, 'targetId')

  const sessions = results.map((item, index) => {
    const resultEnvelope = record(item.result, `batch.results[${index}].result`)
    const ok = resultEnvelope.ok === true
    const resultData = ok ? dataRecord(resultEnvelope, `batch.results[${index}].result`) : {}
    const error = ok ? undefined : record(resultEnvelope.error, `batch.results[${index}].result.error`)
    if (ok) validateSuccessfulChild(resultData, index)
    const timeline = ok ? optionalRecord(resultData.timeline) : undefined
    return sanitize({
      sessionId: sessionIds[index],
      targetId: targetIds[index],
      requestId: safeId(item.requestId, `batch.results[${index}].requestId`),
      ok,
      backend: resultData.backend,
      requestedIsolation: resultData.requestedIsolation,
      effectiveIsolation: resultData.effectiveIsolation,
      degraded: resultData.degraded,
      action: resultData.action,
      verification: resultData.verification,
      finalObservation: resultData.finalObservation,
      timeline,
      error: error && {
        code: safeId(error.code, `batch.results[${index}].result.error.code`),
        retryable: error.retryable,
      },
    }) as JsonRecord
  })

  const successCount = sessions.filter((item) => item.ok === true).length
  const requestedCount = results.length
  const failureCount = requestedCount - successCount
  if (successCount < 2) throw new Error('evidence requires at least two successful overlapping actions')
  assertCount(batch.requestedCount, requestedCount, 'batch.requestedCount')
  assertCount(batch.successCount, successCount, 'batch.successCount')
  assertCount(batch.failureCount, failureCount, 'batch.failureCount')

  const releases = array(capture.releases, 'releases').map((item, index) => {
    const envelope = record(item, `releases[${index}]`)
    if (envelope.ok !== true) throw new Error(`releases[${index}] did not succeed`)
    const data = dataRecord(envelope, `releases[${index}]`)
    if (data.state !== 'closed') throw new Error(`releases[${index}] did not close its session`)
    return sanitize({
      sessionId: safeId(data.sessionId, `releases[${index}].data.sessionId`),
      targetId: safeId(data.targetId, `releases[${index}].data.targetId`),
      state: data.state,
      reason: data.reason,
    }) as JsonRecord
  })
  if (releases.length !== requestedCount) {
    throw new Error('releases must contain exactly one successful close per batch child')
  }
  requireUnique(releases.map((item) => String(item.sessionId)), 'release sessionId')
  if (new Set(releases.map((item) => item.sessionId)).size !== new Set(sessionIds).size ||
      sessionIds.some((sessionId) => !releases.some((item) => item.sessionId === sessionId))) {
    throw new Error('release sessionIds must exactly match batch sessionIds')
  }
  for (let index = 0; index < sessionIds.length; index += 1) {
    const release = releases.find((item) => item.sessionId === sessionIds[index])
    if (release?.targetId !== targetIds[index]) {
      throw new Error(`release targetId does not match batch target for ${sessionIds[index]}`)
    }
  }

  const finalCapabilities = dataRecord(record(capture.finalCapabilities, 'finalCapabilities'), 'finalCapabilities')
  const runtime = record(finalCapabilities.runtime, 'finalCapabilities.data.runtime')
  const counts = record(runtime.counts, 'finalCapabilities.data.runtime.counts')
  const finalResources = {
    sessions: integer(counts.sessions, 'runtime.counts.sessions'),
    requests: integer(counts.requests, 'runtime.counts.requests'),
    activeLeases: integer(counts.activeLeases, 'runtime.counts.activeLeases'),
    activeChannels: integer(runtime.activeChannels, 'runtime.activeChannels'),
    activeRequests: integer(runtime.activeRequests, 'runtime.activeRequests'),
    cleanupPending: integer(runtime.cleanupPending, 'runtime.cleanupPending'),
    waiters: integer(runtime.waiters, 'runtime.waiters'),
    backendHandles: integer(runtime.backendHandles, 'runtime.backendHandles'),
    tombstones: integer(counts.tombstones, 'runtime.counts.tombstones'),
    releasedLeaseTombstones: integer(
      counts.releasedLeaseTombstones, 'runtime.counts.releasedLeaseTombstones',
    ),
  }
  for (const [name, value] of Object.entries(finalResources)) {
    if (!name.toLowerCase().includes('tombstone') && value !== 0) {
      throw new Error(`active resource ${name} must be zero, received ${value}`)
    }
  }

  return {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    batch: {
      requestId: safeId(
        record(batchEnvelope.provenance, 'batch.provenance').requestId,
        'batch.provenance.requestId',
      ),
      requestedCount,
      successCount,
      failureCount,
      actionOverlapMs: commonActionOverlapMs(sessions),
    },
    sessions,
    releases,
    finalResources,
    ...(capture.harnessState ? { harnessState: sanitize(record(capture.harnessState, 'harnessState')) as JsonRecord } : {}),
  }
}

function validateSuccessfulChild(data: JsonRecord, index: number): void {
  const prefix = `batch.results[${index}].result.data`
  if (data.backend !== 'browser-cdp') throw new Error(`${prefix}.backend must be browser-cdp`)
  if (data.degraded !== false) throw new Error(`${prefix}.degraded must be false`)
  const requestedIsolation = requiredString(data.requestedIsolation, `${prefix}.requestedIsolation`)
  const effectiveIsolation = requiredString(data.effectiveIsolation, `${prefix}.effectiveIsolation`)
  if (requestedIsolation !== 'host-app-scoped' || effectiveIsolation !== requestedIsolation) {
    throw new Error(`${prefix} isolation degraded or changed`)
  }
  const action = record(data.action, `${prefix}.action`)
  const outcome = record(action.outcome, `${prefix}.action.outcome`)
  if (
    outcome.committed !== true || outcome.mayHaveTakenEffect !== true ||
    outcome.verification !== 'verified'
  ) {
    throw new Error(`${prefix}.action.outcome must be committed and backend-verified`)
  }
  const verification = record(data.verification, `${prefix}.verification`)
  if (verification.status !== 'verified' || verification.matched !== true) {
    throw new Error(`${prefix}.verification must contain verified semantic readback`)
  }
  const finalObservation = record(data.finalObservation, `${prefix}.finalObservation`)
  if (array(finalObservation.semanticTree, `${prefix}.finalObservation.semanticTree`).length === 0) {
    throw new Error(`${prefix}.finalObservation.semanticTree must not be empty`)
  }
  const timeline = record(data.timeline, `${prefix}.timeline`)
  timestamp(timeline.actionStartedAt, `${prefix}.timeline.actionStartedAt`)
  timestamp(timeline.actionCompletedAt, `${prefix}.timeline.actionCompletedAt`)
}

function commonActionOverlapMs(sessions: readonly JsonRecord[]): number | null {
  const intervals = sessions.flatMap((session) => {
    if (session.ok !== true) return []
    const timeline = optionalRecord(session.timeline)
    if (!timeline) return []
    return [[
      timestamp(timeline.actionStartedAt, 'timeline.actionStartedAt'),
      timestamp(timeline.actionCompletedAt, 'timeline.actionCompletedAt'),
    ] as const]
  })
  if (intervals.length < 2) return null
  const overlap = Math.min(...intervals.map(([, end]) => end)) - Math.max(...intervals.map(([start]) => start))
  if (overlap <= 0) throw new Error('successful action intervals do not overlap')
  return overlap
}

export function sanitize(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '<redacted>'
  if (typeof value === 'string') return SENSITIVE_VALUE.test(value) ? '<redacted-sensitive-value>' : value.slice(0, 8_192)
  if (Array.isArray(value)) return value.slice(0, 512).map((item) => sanitize(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as JsonRecord).map(([childKey, child]) => [
      childKey, sanitize(child, childKey),
    ]))
  }
  return value
}

function dataRecord(envelope: JsonRecord, name: string): JsonRecord {
  if (envelope.ok !== true) throw new Error(`${name} envelope is not ok`)
  return record(envelope.data, `${name}.data`)
}

function record(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`)
  return value as JsonRecord
}

function optionalRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  return value
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function safeId(value: unknown, name: string): string {
  const normalized = requiredString(value, name)
  if (!SAFE_ID.test(normalized)) throw new Error(`${name} must be a safe identifier`)
  return normalized
}

function integer(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${name} must be a nonnegative integer`)
  return Number(value)
}

function timestamp(value: unknown, name: string): number {
  const parsed = Date.parse(requiredString(value, name))
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an ISO timestamp`)
  return parsed
}

function assertCount(value: unknown, expected: number, name: string): void {
  if (integer(value, name) !== expected) throw new Error(`${name} does not match child results`)
}

function requireUnique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${name} values must be unique`)
}

function parseOptions(argv: readonly string[]): { input: string; output: string } {
  const options = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value) throw new Error('Expected --input and --output arguments.')
    options.set(key, value)
  }
  const input = options.get('--input')
  const output = options.get('--output')
  if (!input || !output) throw new Error('--input and --output are required.')
  return { input: resolve(input), output: resolve(output) }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const capture = JSON.parse(await readFile(options.input, 'utf8')) as unknown
  const evidence = buildMultisessionEvidence(capture)
  await mkdir(dirname(options.output), { recursive: true })
  await writeFile(options.output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  process.stdout.write(
    `Wrote sanitized evidence for ${evidence.batch.requestedCount} sessions; ` +
    `success=${evidence.batch.successCount}, failure=${evidence.batch.failureCount}.\n`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
