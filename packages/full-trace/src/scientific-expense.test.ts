import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  LocalTraceStore,
  ScientificExpenseDraftBuilder,
  ScientificExpenseRecognizer,
  ScientificExpenseValidator,
  ScientificTraceCollector,
  createScientificExpenseBaselineJsonl,
  createScientificExpenseBaselineTrace,
  validateScientificExpenseBaselineTrace,
  type ScientificTraceEvent
} from './index.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true })
  }))
})

describe('scientific finance expense loop baseline traces', () => {
  test('creates a sanitized normal expense draft trace', () => {
    const trace = createScientificExpenseBaselineTrace({ scenario: 'normal-sanitized' })

    assert.equal(trace.expenseValidation.ok, true)
    assert.equal(trace.validation.ok, true)
    assert.equal(validateScientificExpenseBaselineTrace(trace).ok, true)
    assert.equal(trace.state, 'drafted')
    assert.equal(trace.recognizedExpenses.length, 3)
    assert.equal(trace.draft.status, 'drafted')
    assert.equal(trace.draft.sha256.length, 64)
    assert.equal(JSON.stringify(trace.events).includes('trang'), false)
    assert.equal(JSON.stringify(trace.events).includes('13800138000'), false)
    assertEventTypes(trace.events, [
      'USER_INPUT',
      'RESOURCE_USAGE_RECORDED',
      'COST_ESTIMATED',
      'AGENT_ACTION',
      'TOOL_CALL_COMPLETED',
      'EXPENSE_DRAFT_CREATED',
      'EVIDENCE_ATTACHED',
      'BUDGET_APPROVAL_REQUESTED',
      'BUDGET_APPROVAL_RECORDED',
      'HUMAN_REVIEW_RECORDED'
    ])
    assert.equal(
      trace.events.some((event) => event.type === 'EXPENSE_DRAFT_CREATED' && event.payload.realSubmissionAllowed === false),
      true
    )
    assert.equal(
      trace.events.some((event) => event.type === 'EXPENSE_DRAFT_CREATED' && event.payload.paymentAllowed === false),
      true
    )
  })

  test('creates a missing-fields fixture trace with a required question and blocked draft', () => {
    const trace = createScientificExpenseBaselineTrace({ scenario: 'missing-fields' })

    assert.equal(trace.expenseValidation.ok, false)
    assert.equal(trace.validation.ok, true)
    assert.equal(validateScientificExpenseBaselineTrace(trace).ok, true)
    assert.equal(trace.state, 'needs-information')
    assert.equal(trace.draft.status, 'needs-information')
    assert.equal(
      trace.expenseValidation.issues.some((issue) => issue.code === 'MISSING_REQUIRED_FIELD'),
      true
    )
    assertEventTypes(trace.events, [
      'USER_INPUT',
      'RESOURCE_USAGE_RECORDED',
      'COST_ESTIMATED',
      'AGENT_ACTION',
      'TOOL_CALL_COMPLETED',
      'HUMAN_REVIEW_REQUESTED',
      'EXPENSE_DRAFT_CREATED',
      'EVIDENCE_ATTACHED',
      'HUMAN_REVIEW_RECORDED'
    ])
    assert.equal(
      trace.events.some((event) => event.type === 'HUMAN_REVIEW_REQUESTED' && typeof event.payload.question === 'string'),
      true
    )
  })

  test('creates a duplicate-conflict fixture trace with rejection evidence', () => {
    const trace = createScientificExpenseBaselineTrace({ scenario: 'duplicate-conflict' })

    assert.equal(trace.expenseValidation.ok, false)
    assert.equal(trace.validation.ok, true)
    assert.equal(trace.state, 'rejected')
    assert.equal(trace.draft.status, 'rejected')
    assert.equal(
      trace.expenseValidation.issues.some((issue) => issue.code === 'DUPLICATE_EXPENSE'),
      true
    )
    assert.equal(
      trace.expenseValidation.issues.some((issue) => issue.code === 'AMOUNT_CONFLICT'),
      true
    )
    assert.equal(
      trace.events.some((event) => event.type === 'HUMAN_REVIEW_RECORDED' && event.payload.decision === 'rejected'),
      true
    )
  })

  test('blocks real submission, payment, and personal/payment information', () => {
    const validator = new ScientificExpenseValidator()
    const trace = createScientificExpenseBaselineTrace({
      scenario: 'normal-sanitized',
      fixture: {
        requestedAction: 'pay',
        paymentRequested: true,
        lines: [{
          usageId: 'usage-pii-001',
          resourceKind: 'api',
          quantity: 1,
          unit: 'token',
          unitCostUsd: 1,
          amountUsd: 1,
          occurredAt: '2026-08-07',
          projectId: 'project-pii',
          purpose: 'This contains private email researcher@example.com',
          receiptId: 'receipt-pii-001'
        }]
      }
    })
    const validation = validator.validate(trace.fixture)

    assert.equal(validation.ok, false)
    assert.deepEqual(new Set(validation.issues.map((issue) => issue.code)), new Set([
      'PII_DETECTED',
      'REAL_SUBMISSION_FORBIDDEN',
      'PAYMENT_FORBIDDEN'
    ]))

    const chineseFieldValidation = validator.validate({
      ...createScientificExpenseBaselineTrace({ scenario: 'normal-sanitized' }).fixture,
      ['\u94f6\u884c\u8d26\u53f7']: 'should-not-enter-trace'
    } as unknown as Parameters<ScientificExpenseValidator['validate']>[0])
    assert.equal(chineseFieldValidation.ok, false)
    assert.equal(
      chineseFieldValidation.issues.some((issue) => issue.code === 'PII_DETECTED'),
      true
    )
  })

  test('recognizes expense lines and creates deterministic draft artifacts', () => {
    const trace = createScientificExpenseBaselineTrace({ scenario: 'normal-sanitized' })
    const recognizer = new ScientificExpenseRecognizer()
    const draftBuilder = new ScientificExpenseDraftBuilder()
    const recognized = recognizer.recognize(trace.fixture)
    const draft = draftBuilder.build({
      scenario: trace.scenario,
      requestId: trace.requestId,
      state: trace.state,
      fixture: trace.fixture,
      recognizedExpenses: recognized,
      validation: trace.expenseValidation
    })

    assert.deepEqual(recognized, trace.recognizedExpenses)
    assert.equal(draft.sha256, trace.draft.sha256)
  })

  test('serializes expense baseline events as JSONL that can be parsed and closure-validated', () => {
    const jsonl = createScientificExpenseBaselineJsonl({ scenario: 'normal-sanitized' })
    const events = jsonl
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ScientificTraceEvent)

    assert.equal(events.length, 10)
    assert.equal(validateScientificExpenseBaselineTrace({ events }).ok, true)
  })

  test('stores expense baseline events through the scientific collector and local JSONL store', async () => {
    const temporary = await createTemporaryDirectory()
    const store = new LocalTraceStore({ storageDirectory: path.join(temporary, 'traces') })
    const collector = new ScientificTraceCollector(store)
    const trace = createScientificExpenseBaselineTrace({ scenario: 'normal-sanitized', traceId: 'trace-06c-store' })

    const result = await collector.collectMany(trace.events)
    const read = await store.read({ traceIds: ['trace-06c-store'] })

    assert.equal(result.length, trace.events.length)
    assert.equal(read.events.length, trace.events.length)
    assert.equal(JSON.stringify(read.events).includes('researcher@example.com'), false)
    assert.equal(JSON.stringify(read.events).includes('4111111111111111'), false)
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

async function createTemporaryDirectory(): Promise<string> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sciforge-scientific-expense-'))
  temporaryDirectories.push(temporary)
  return temporary
}
