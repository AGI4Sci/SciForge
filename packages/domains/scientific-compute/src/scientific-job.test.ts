import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  LocalScientificFixtureScheduler,
  SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES,
  ScientificJobManager,
  createScientificJobBaselineJsonl,
  createScientificJobBaselineTrace,
  validateScientificJobBaselineTrace
} from './scientific-job.js'
import {
  LocalTraceStore,
  ScientificTraceCollector,
  type ScientificTraceEvent
} from '@sciforge/full-trace'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true })
  }))
})

describe('scientific compute job loop baseline traces', () => {
  test('delegates submit, monitor, cancel, resume, and result collection through a job manager', async () => {
    const scheduler = new LocalScientificFixtureScheduler()
    const manager = new ScientificJobManager(scheduler)
    const trace = createScientificJobBaselineTrace({ scenario: 'success', jobId: 'job-manager-fixture' })

    assert.deepEqual(await manager.submit(trace.jobId, trace.fixture), {
      jobId: trace.jobId,
      state: 'submitted'
    })
    assert.deepEqual(await manager.monitor(trace.jobId), {
      jobId: trace.jobId,
      state: 'running'
    })
    await assert.rejects(
      async () => manager.collectResult(trace.jobId),
      /before it is finished/
    )
    assert.deepEqual(await manager.cancel(trace.jobId, 'manual pause'), {
      jobId: trace.jobId,
      state: 'cancelled'
    })
    assert.deepEqual(await manager.resume(trace.jobId), {
      jobId: trace.jobId,
      state: 'resumed'
    })
    assert.deepEqual(await manager.monitor(trace.jobId), {
      jobId: trace.jobId,
      state: 'running'
    })
    assert.deepEqual(await manager.monitor(trace.jobId), {
      jobId: trace.jobId,
      state: 'finished'
    })

    const artifact = await manager.collectResult(trace.jobId)
    assert.equal(artifact.artifactId, `artifact-${trace.jobId}-result`)
    assert.equal(artifact.sha256.length, 64)
  })

  test('creates a successful low-cost fixture trace with job, result, cost, and review events', () => {
    const trace = createScientificJobBaselineTrace({ scenario: 'success' })

    assert.equal(trace.validation.ok, true)
    assert.equal(validateScientificJobBaselineTrace(trace).ok, true)
    assert.equal(trace.state, 'finished')
    assert.equal(trace.resourceUsage.gpuHours, 0)
    assert.equal(trace.resourceUsage.apiTokens, 0)
    assert.equal(trace.resourceUsage.estimatedUsd, 0)
    assertEventTypes(trace.events, [
      'TRACE_STARTED',
      'USER_INPUT',
      'AGENT_ACTION',
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.submitted,
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.started,
      'TOOL_CALL_COMPLETED',
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.finished,
      'ARTIFACT_CREATED',
      'EVIDENCE_ATTACHED',
      'RESOURCE_USAGE_RECORDED',
      'HUMAN_REVIEW_RECORDED',
      'TRACE_COMPLETED'
    ])
  })

  test('creates a blocked fixture trace with cancellation, diagnostic artifact, and human reason', () => {
    const trace = createScientificJobBaselineTrace({ scenario: 'blocked' })

    assert.equal(trace.validation.ok, true)
    assert.equal(trace.state, 'blocked')
    assertEventTypes(trace.events, [
      'TRACE_STARTED',
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.submitted,
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.started,
      'TOOL_CALL_COMPLETED',
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.failed,
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.cancelled,
      'ARTIFACT_CREATED',
      'EVIDENCE_ATTACHED',
      'RESOURCE_USAGE_RECORDED',
      'HUMAN_REVIEW_RECORDED',
      'TRACE_FAILED'
    ])
    assert.equal(
      trace.events.some((event) => event.type === SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.failed && event.payload.failureMode === 'missing-input-artifact'),
      true
    )
    assert.equal(
      trace.events.some((event) => event.type === 'HUMAN_REVIEW_RECORDED' && event.payload.reason),
      true
    )
  })

  test('creates a rerun fixture trace with failed attempt, resume, and final accepted result', () => {
    const trace = createScientificJobBaselineTrace({ scenario: 'rerun' })

    assert.equal(trace.validation.ok, true)
    assert.equal(trace.state, 'finished')
    assertEventTypes(trace.events, [
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.failed,
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.cancelled,
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.resumed,
      'TOOL_CALL_COMPLETED',
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.finished,
      'ARTIFACT_CREATED',
      'EVIDENCE_ATTACHED',
      'HUMAN_REVIEW_RECORDED',
      'TRACE_COMPLETED'
    ])
    assert.equal(countEvents(trace.events, SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.started), 2)
    assert.equal(countEvents(trace.events, SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.finished), 1)
  })

  test('creates a human-in-the-loop interaction trace for UI submission and review', () => {
    const trace = createScientificJobBaselineTrace({ scenario: 'human-interaction' })

    assert.equal(trace.validation.ok, true)
    assert.equal(validateScientificJobBaselineTrace(trace).ok, true)
    assert.equal(trace.state, 'finished')
    assertEventTypes(trace.events, [
      'TRACE_STARTED',
      'USER_INPUT',
      'HUMAN_REVIEW_REQUESTED',
      'HUMAN_REVIEW_RECORDED',
      'AGENT_ACTION',
      'TOOL_CALL_REQUESTED',
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.submitted,
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.started,
      'TOOL_CALL_COMPLETED',
      SCIENTIFIC_COMPUTE_TRACE_EVENT_TYPES.finished,
      'ARTIFACT_CREATED',
      'EVIDENCE_ATTACHED',
      'RESOURCE_USAGE_RECORDED',
      'TRACE_COMPLETED'
    ])
    assert.equal(
      trace.events.some((event) => event.payload.interactionStep === 'pre-run-confirmation'),
      true
    )
    assert.equal(
      trace.events.some((event) => event.payload.interactionStep === 'result-collected'),
      true
    )
    assert.equal(countEvents(trace.events, 'HUMAN_REVIEW_RECORDED'), 2)
  })

  test('serializes baseline events as JSONL that can be parsed and closure-validated', () => {
    const jsonl = createScientificJobBaselineJsonl({ scenario: 'success' })
    const events = jsonl
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ScientificTraceEvent)

    assert.equal(events.length, 12)
    assert.equal(validateScientificJobBaselineTrace({ events }).ok, true)
  })

  test('stores job baseline events through the scientific collector and local JSONL store', async () => {
    const temporary = await createTemporaryDirectory()
    const store = new LocalTraceStore({ storageDirectory: path.join(temporary, 'traces') })
    const collector = new ScientificTraceCollector(store)
    const trace = createScientificJobBaselineTrace({ scenario: 'success', traceId: 'trace-06b-store' })

    const result = await collector.collectMany(trace.events)
    const read = await store.read({ traceIds: ['trace-06b-store'] })

    assert.equal(result.length, trace.events.length)
    assert.equal(read.events.length, trace.events.length)
    assert.equal(JSON.stringify(read.events).includes('sk-'), false)
    assert.equal(JSON.stringify(read.events).includes('13800138000'), false)
  })
})

function assertEventTypes(
  events: readonly ScientificTraceEvent[],
  expectedTypes: readonly ScientificTraceEvent['type'][]
): void {
  const actualTypes = new Set(events.map((event) => event.type))
  for (const expected of expectedTypes) {
    assert.equal(actualTypes.has(expected), true, `Expected ${expected} in ${[...actualTypes].join(', ')}`)
  }
}

function countEvents(
  events: readonly ScientificTraceEvent[],
  type: ScientificTraceEvent['type']
): number {
  return events.filter((event) => event.type === type).length
}

async function createTemporaryDirectory(): Promise<string> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sciforge-scientific-job-'))
  temporaryDirectories.push(temporary)
  return temporary
}
