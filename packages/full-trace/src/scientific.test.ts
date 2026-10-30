import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  LocalTraceStore,
  SCIENTIFIC_TRACE_PII_REDACTION_MARKER,
  SCIENTIFIC_TRACE_SCHEMA_VERSION,
  SCIENTIFIC_TRACE_SOURCE,
  ScientificTraceCollector,
  ScientificTraceValidationError,
  TRACE_REDACTION_MARKER,
  prepareScientificTraceEvent,
  validateScientificTraceClosure,
  validateScientificTraceEvent,
  type ScientificTraceEvent,
  type ScientificTraceEventInput
} from './index.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true })
  }))
})

describe('scientific trace validation', () => {
  test('accepts a closed trace with input, artifact, evidence, review reason, and parent links', () => {
    const events = closedTraceEvents()
    const validation = validateScientificTraceClosure(events)

    assert.equal(validation.ok, true)
    assert.deepEqual(validation.issues, [])
  })

  test('rejects traces that are missing required scientific evidence fields', () => {
    const emptyValidation = validateScientificTraceClosure([])
    assertIssueCodes(emptyValidation, [
      'MISSING_INPUT',
      'MISSING_ARTIFACT',
      'MISSING_EVIDENCE',
      'MISSING_HUMAN_REASON'
    ])

    const input = scientificEvent({
      eventId: 'event-user-input',
      type: 'USER_INPUT',
      payload: { text: 'Run the baseline fixture.' },
      links: { inputs: ['input://fixture/baseline'] }
    })
    const danglingAction = scientificEvent({
      eventId: 'event-dangling-action',
      type: 'AGENT_ACTION',
      parentEventId: 'event-missing-parent',
      payload: { summary: 'This event points at a missing parent.' }
    })
    const reviewWithoutReason = scientificEvent({
      eventId: 'event-review-without-reason',
      type: 'HUMAN_REVIEW_RECORDED',
      parentEventId: input.eventId,
      payload: { decision: 'approved' }
    })

    const validation = validateScientificTraceClosure([input, danglingAction, reviewWithoutReason])
    assertIssueCodes(validation, [
      'MISSING_ARTIFACT',
      'MISSING_EVIDENCE',
      'MISSING_PARENT_EVENT',
      'MISSING_HUMAN_REASON'
    ])

    const traceWithArtifactWithoutIntegrity = closedTraceEvents().map((event) => {
      if (event.type !== 'ARTIFACT_CREATED') return event
      return {
        ...event,
        payload: {
          artifactId: 'artifact-without-integrity',
          path: 'results/missing-hash.txt'
        }
      }
    })
    assertIssueCodes(validateScientificTraceClosure(traceWithArtifactWithoutIntegrity), ['MISSING_ARTIFACT'])
  })

  test('rejects traces with broken causal links between artifacts, evidence, reviews, and roots', () => {
    const closed = closedTraceEvents()
    const evidenceWithoutLocalArtifact = closed.map((event) => {
      if (event.type !== 'EVIDENCE_ATTACHED') return event
      return scientificEvent({
        eventId: event.eventId,
        type: 'EVIDENCE_ATTACHED',
        parentEventId: event.parentEventId,
        payload: {
          evidenceId: 'evidence-external-artifact',
          evidenceType: 'result-file',
          target: 'artifact://not-created-in-this-trace'
        },
        links: {
          evidence: ['evidence://external'],
          artifacts: ['artifact://not-created-in-this-trace']
        }
      })
    })
    assertIssueCodes(validateScientificTraceClosure(evidenceWithoutLocalArtifact), ['INVALID_TRACE_LINK'])

    const unanchoredReview = closed.map((event) => {
      if (event.type !== 'HUMAN_REVIEW_RECORDED') return event
      return scientificEvent({
        eventId: event.eventId,
        type: 'HUMAN_REVIEW_RECORDED',
        parentEventId: 'event-agent-action',
        payload: {
          decision: 'approved',
          reason: 'This review skips evidence and approval request linkage.'
        }
      })
    })
    assertIssueCodes(validateScientificTraceClosure(unanchoredReview), ['INVALID_TRACE_LINK'])

    const cycleA = scientificEvent({
      eventId: 'event-cycle-a',
      type: 'AGENT_ACTION',
      parentEventId: 'event-cycle-b',
      payload: { summary: 'A cycle start.' }
    })
    const cycleB = scientificEvent({
      eventId: 'event-cycle-b',
      type: 'TOOL_CALL_COMPLETED',
      parentEventId: 'event-cycle-a',
      payload: { toolName: 'cycle.fixture' }
    })
    assertIssueCodes(validateScientificTraceClosure([...closed, cycleA, cycleB]), ['INVALID_TRACE_LINK'])
  })

  test('rejects mixed trace ids, duplicate roots or terminals, and terminal events without one causal closure', () => {
    const closed = closedTraceEvents()
    const mixedTrace = closed.map((event, index) => index === 3
      ? { ...event, traceId: 'trace-from-another-run' }
      : event)
    assertIssueCodes(validateScientificTraceClosure(mixedTrace), ['INVALID_TRACE_SCOPE'])

    const duplicateRoot = scientificEvent({
      eventId: 'event-second-root',
      type: 'TRACE_STARTED',
      payload: { purpose: 'invalid second root' }
    })
    assertIssueCodes(validateScientificTraceClosure([...closed, duplicateRoot]), ['INVALID_TRACE_STATE'])

    const duplicateTerminal = scientificEvent({
      eventId: 'event-second-terminal',
      type: 'TRACE_FAILED',
      parentEventId: 'event-review',
      payload: { reason: 'invalid second terminal' }
    })
    assertIssueCodes(validateScientificTraceClosure([...closed, duplicateTerminal]), ['INVALID_TRACE_STATE'])

    const disconnectedTerminal = closed.map((event) => event.type === 'TRACE_COMPLETED'
      ? { ...event, parentEventId: 'event-agent-action' }
      : event)
    assertIssueCodes(validateScientificTraceClosure(disconnectedTerminal), [
      'MISSING_ARTIFACT',
      'MISSING_EVIDENCE',
      'MISSING_HUMAN_REASON'
    ])
  })

  test('rejects individual events that miss parent, artifact, evidence, review, or input data', () => {
    assertIssueCodes(validateScientificTraceEvent(scientificEvent({
      type: 'AGENT_ACTION',
      payload: { summary: 'No parent event.' }
    })), ['MISSING_PARENT_EVENT'])

    assertIssueCodes(validateScientificTraceEvent(scientificEvent({
      type: 'ARTIFACT_CREATED',
      parentEventId: 'event-user-input',
      payload: { artifactId: 'artifact-without-integrity' }
    })), ['MISSING_ARTIFACT'])

    assertIssueCodes(validateScientificTraceEvent(scientificEvent({
      type: 'EVIDENCE_ATTACHED',
      parentEventId: 'event-artifact',
      payload: { evidenceId: 'evidence-without-target', evidenceType: 'baseline' }
    })), ['MISSING_EVIDENCE'])

    assertIssueCodes(validateScientificTraceEvent(scientificEvent({
      type: 'HUMAN_REVIEW_RECORDED',
      parentEventId: 'event-evidence',
      payload: { decision: 'approved' }
    })), ['MISSING_HUMAN_REASON'])

    assertIssueCodes(validateScientificTraceEvent(scientificEvent({
      type: 'USER_INPUT',
      payload: {}
    })), ['MISSING_INPUT'])
  })

  test('detects raw credentials and PII before an event enters trace storage', () => {
    const secret = 'sk-live-abcdefghijklmnopqrstuvwxyz'
    const secretValidation = validateScientificTraceEvent(rawScientificEvent({
      type: 'USER_INPUT',
      parentEventId: 'event-root',
      payload: {
        text: `Use ${secret} for the model call.`,
        apiKey: secret
      }
    }))
    assert.equal(secretValidation.ok, true)
    assertIssueCodes(secretValidation, ['SECRET_DETECTED'])

    const piiValidation = validateScientificTraceEvent(rawScientificEvent({
      type: 'USER_INPUT',
      parentEventId: 'event-root',
      payload: {
        text: 'Please contact wang@example.com or 13800138000 before running.',
        phone: '13800138000'
      }
    }))
    assert.equal(piiValidation.ok, false)
    assertIssueCodes(piiValidation, ['PII_DETECTED'])

    const internationalPii = rawScientificEvent({
      type: 'USER_INPUT',
      parentEventId: 'event-root',
      payload: {
        text: 'Call 415-555-2671 and charge 4111 1111 1111 1111.'
      }
    })
    assertIssueCodes(validateScientificTraceEvent(internationalPii), ['PII_DETECTED'])
    const sanitized = prepareScientificTraceEvent(internationalPii)
    assert.equal(JSON.stringify(sanitized).includes('415-555-2671'), false)
    assert.equal(JSON.stringify(sanitized).includes('4111 1111 1111 1111'), false)
  })
})

describe('ScientificTraceCollector', () => {
  test('stores sanitized scientific events through the existing JSONL trace store', async () => {
    const temporary = await createTemporaryDirectory()
    const traceId = 'trace-scientific-collector'
    const secret = 'sk-live-abcdefghijklmnopqrstuvwxyz'
    const email = 'wang@example.com'
    const phone = '13800138000'
    const store = new LocalTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      sensitiveValues: ['opaque-upstream-token']
    })
    const collector = new ScientificTraceCollector(store)

    const result = await collector.collect({
      traceId,
      type: 'USER_INPUT',
      parentEventId: 'event-root',
      actor: { type: 'human', id: 'user-1' },
      source: {
        module: 'composer',
        runtimeId: 'codex',
        threadId: 'thread-1',
        turnId: 'turn-1',
        requestId: 'request-1'
      },
      payload: {
        text: `Run the fixture, then notify ${email}. Secret: ${secret}; opaque-upstream-token.`,
        apiKey: secret,
        phone
      },
      links: { inputs: ['input://fixture/baseline'] }
    })

    assert.equal(result.stored, true)
    assert.equal(result.traceEvent.source, SCIENTIFIC_TRACE_SOURCE)
    assert.equal(result.traceEvent.kind, 'agent_event')

    const read = await store.read({ traceIds: [traceId] })
    const serialized = JSON.stringify(read.events)
    assert.equal(serialized.includes(secret), false)
    assert.equal(serialized.includes('opaque-upstream-token'), false)
    assert.equal(serialized.includes(email), false)
    assert.equal(serialized.includes(phone), false)
    assert.equal(serialized.includes(TRACE_REDACTION_MARKER), true)
    assert.equal(serialized.includes(SCIENTIFIC_TRACE_PII_REDACTION_MARKER), true)
    assert.equal(read.events[0]?.source, SCIENTIFIC_TRACE_SOURCE)
  })

  test('rejects invalid scientific events before writing to the sink', async () => {
    const temporary = await createTemporaryDirectory()
    const store = new LocalTraceStore({ storageDirectory: path.join(temporary, 'traces') })
    const collector = new ScientificTraceCollector(store)

    await assert.rejects(
      collector.collect({
        traceId: 'trace-invalid-artifact',
        type: 'ARTIFACT_CREATED',
        actor: { type: 'agent', id: 'agent-1' },
        source: { module: 'workspace-host' },
        payload: {
          artifactId: 'artifact-1',
          sha256: '0'.repeat(64)
        }
      }),
      ScientificTraceValidationError
    )

    const read = await store.read()
    assert.equal(read.events.length, 0)
  })
})

function closedTraceEvents(): ScientificTraceEvent[] {
  const started = scientificEvent({
    eventId: 'event-trace-started',
    type: 'TRACE_STARTED',
    payload: { purpose: 'scientific validation fixture' }
  })
  const input = scientificEvent({
    eventId: 'event-user-input',
    type: 'USER_INPUT',
    parentEventId: started.eventId,
    payload: { text: 'Predict the sample protein structure.' },
    links: { inputs: ['input://protein/sample.fa'] }
  })
  const action = scientificEvent({
    eventId: 'event-agent-action',
    type: 'AGENT_ACTION',
    parentEventId: input.eventId,
    payload: { summary: 'Create a reproducible analysis plan.' }
  })
  const artifact = scientificEvent({
    eventId: 'event-artifact',
    type: 'ARTIFACT_CREATED',
    parentEventId: action.eventId,
    payload: {
      artifactId: 'artifact-structure-1',
      path: 'results/structure.pdb',
      sha256: '0'.repeat(64)
    },
    links: { artifacts: ['artifact://structure-1'] }
  })
  const evidence = scientificEvent({
    eventId: 'event-evidence',
    type: 'EVIDENCE_ATTACHED',
    parentEventId: artifact.eventId,
    payload: {
      evidenceId: 'evidence-structure-source',
      evidenceType: 'result-file',
      target: artifact.eventId
    },
    links: {
      evidence: ['evidence://structure-source'],
      artifacts: ['artifact://structure-1']
    }
  })
  const review = scientificEvent({
    eventId: 'event-review',
    type: 'HUMAN_REVIEW_RECORDED',
    parentEventId: evidence.eventId,
    payload: {
      reviewer: 'reviewer-1',
      decision: 'approved',
      reason: 'The output file and evidence match the fixture baseline.'
    },
    links: { reviews: ['review://reviewer-1/approval'] }
  })
  const completed = scientificEvent({
    eventId: 'event-trace-completed',
    type: 'TRACE_COMPLETED',
    parentEventId: review.eventId,
    payload: { status: 'completed' }
  })
  return [started, input, action, artifact, evidence, review, completed]
}

function scientificEvent(input: Partial<ScientificTraceEventInput> & Pick<ScientificTraceEventInput, 'type' | 'payload'>): ScientificTraceEvent {
  return prepareScientificTraceEvent({
    traceId: 'trace-scientific-validation',
    actor: { type: 'agent', id: 'agent-1' },
    source: { module: 'full-trace-test' },
    ...input
  })
}

function rawScientificEvent(input: Partial<ScientificTraceEventInput> & Pick<ScientificTraceEventInput, 'type' | 'payload'>): ScientificTraceEvent {
  return {
    schemaVersion: SCIENTIFIC_TRACE_SCHEMA_VERSION,
    eventId: input.eventId ?? 'event-raw',
    traceId: input.traceId ?? 'trace-raw',
    type: input.type,
    timestamp: input.timestamp ?? '2026-08-06T00:00:00.000Z',
    actor: input.actor ?? { type: 'human', id: 'user-1' },
    source: input.source ?? { module: 'full-trace-test' },
    payload: input.payload,
    ...(input.parentEventId ? { parentEventId: input.parentEventId } : {}),
    ...(input.links ? { links: input.links } : {})
  }
}

function assertIssueCodes(
  validation: { issues: readonly { code: string }[] },
  expectedCodes: readonly string[]
): void {
  const actualCodes = validation.issues.map((issue) => issue.code)
  for (const expected of expectedCodes) {
    assert.equal(
      actualCodes.includes(expected),
      true,
      `Expected ${expected} in ${actualCodes.join(', ')}`
    )
  }
}

async function createTemporaryDirectory(): Promise<string> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sciforge-scientific-trace-'))
  temporaryDirectories.push(temporary)
  return temporary
}
