import { createHash } from 'node:crypto'
import {
  prepareScientificTraceEvent,
  validateScientificTraceClosure,
  validateScientificTraceEvent,
  type ScientificTraceActor,
  type ScientificTraceEvent,
  type ScientificTraceEventInput,
  type ScientificTraceValidationResult
} from './scientific.js'

export type ScientificExpenseScenario = 'normal-sanitized' | 'missing-fields' | 'duplicate-conflict'

export type ScientificExpenseState = 'drafted' | 'needs-information' | 'rejected'

export type ScientificExpenseResourceKind = 'gpu' | 'api' | 'storage' | 'human-time'

export type ScientificExpenseLineInput = {
  usageId?: string
  resourceKind?: ScientificExpenseResourceKind
  quantity?: number
  unit?: string
  unitCostUsd?: number
  amountUsd?: number
  occurredAt?: string
  projectId?: string
  purpose?: string
  receiptId?: string
  receiptHash?: string
}

export type ScientificExpenseFixtureInput = {
  requestId: string
  inputRef: string
  requesterId: string
  projectId?: string
  budgetId?: string
  policyRef: string
  requestedAction: 'draft-only' | 'submit' | 'pay'
  paymentRequested: boolean
  lines: ScientificExpenseLineInput[]
  declaredTotalUsd?: number
  reviewerId?: string
}

export type ScientificExpenseLineItem = Required<Pick<
  ScientificExpenseLineInput,
  'usageId' | 'resourceKind' | 'quantity' | 'unit' | 'unitCostUsd' | 'occurredAt' | 'projectId' | 'purpose'
>> & {
  amountUsd: number
  receiptId?: string
  receiptHash?: string
}

type RecognizableExpenseLineInput = ScientificExpenseLineInput & Required<Pick<
  ScientificExpenseLineInput,
  'usageId' | 'resourceKind' | 'quantity' | 'unit' | 'unitCostUsd' | 'occurredAt' | 'purpose'
>>

export type ScientificExpenseDraftArtifact = {
  artifactId: string
  draftId: string
  path: string
  sha256: string
  content: string
  status: ScientificExpenseState
}

export type ScientificExpenseValidationIssueCode =
  | 'MISSING_REQUIRED_FIELD'
  | 'DUPLICATE_EXPENSE'
  | 'AMOUNT_CONFLICT'
  | 'PII_DETECTED'
  | 'REAL_SUBMISSION_FORBIDDEN'
  | 'PAYMENT_FORBIDDEN'

export type ScientificExpenseValidationIssue = {
  code: ScientificExpenseValidationIssueCode
  field?: string
  message: string
}

export type ScientificExpenseValidationResult = {
  ok: boolean
  issues: ScientificExpenseValidationIssue[]
}

export type ScientificExpenseBaselineTrace = {
  scenario: ScientificExpenseScenario
  traceId: string
  requestId: string
  state: ScientificExpenseState
  fixture: ScientificExpenseFixtureInput
  recognizedExpenses: ScientificExpenseLineItem[]
  draft: ScientificExpenseDraftArtifact
  expenseValidation: ScientificExpenseValidationResult
  events: ScientificTraceEvent[]
  validation: ScientificTraceValidationResult
}

export type ScientificExpenseBaselineOptions = {
  scenario: ScientificExpenseScenario
  traceId?: string
  requestId?: string
  reviewerId?: string
  fixture?: Partial<ScientificExpenseFixtureInput>
}

export class ScientificExpenseRecognizer {
  recognize(fixture: ScientificExpenseFixtureInput): ScientificExpenseLineItem[] {
    return fixture.lines.flatMap((line) => {
      if (!isRecognizableLine(line, fixture.projectId)) return []
      const projectId = line.projectId ?? fixture.projectId
      if (!projectId) return []
      const quantity = line.quantity
      const unitCostUsd = line.unitCostUsd
      return [{
        usageId: line.usageId,
        resourceKind: line.resourceKind,
        quantity,
        unit: line.unit,
        unitCostUsd,
        amountUsd: roundCurrency(line.amountUsd ?? quantity * unitCostUsd),
        occurredAt: line.occurredAt,
        projectId,
        purpose: line.purpose,
        ...(line.receiptId ? { receiptId: line.receiptId } : {}),
        ...(line.receiptHash ? { receiptHash: line.receiptHash } : {})
      }]
    })
  }
}

export class ScientificExpenseValidator {
  validate(fixture: ScientificExpenseFixtureInput): ScientificExpenseValidationResult {
    const issues: ScientificExpenseValidationIssue[] = []

    if (!fixture.projectId) {
      issues.push(issue('MISSING_REQUIRED_FIELD', 'projectId', 'Expense fixture must identify the research project.'))
    }
    if (!fixture.budgetId) {
      issues.push(issue('MISSING_REQUIRED_FIELD', 'budgetId', 'Expense fixture must identify the budget to check.'))
    }
    if (!fixture.lines.length) {
      issues.push(issue('MISSING_REQUIRED_FIELD', 'lines', 'Expense fixture must include at least one resource line.'))
    }
    if (fixture.requestedAction !== 'draft-only') {
      issues.push(issue('REAL_SUBMISSION_FORBIDDEN', 'requestedAction', '06C fixtures may only create a draft.'))
    }
    if (fixture.paymentRequested) {
      issues.push(issue('PAYMENT_FORBIDDEN', 'paymentRequested', '06C fixtures must never request payment.'))
    }
    if (containsSensitiveValue(fixture)) {
      issues.push(issue('PII_DETECTED', undefined, 'Expense fixture contains PII or payment details.'))
    }

    const seenUsageIds = new Set<string>()
    const seenReceiptIds = new Set<string>()
    for (const [index, line] of fixture.lines.entries()) {
      const prefix = `lines[${index}]`
      if (!line.usageId) {
        issues.push(issue('MISSING_REQUIRED_FIELD', `${prefix}.usageId`, 'Expense line must reference a resource usage id.'))
      } else if (seenUsageIds.has(line.usageId)) {
        issues.push(issue('DUPLICATE_EXPENSE', `${prefix}.usageId`, 'Expense line duplicates a resource usage id.'))
      } else {
        seenUsageIds.add(line.usageId)
      }
      if (!line.resourceKind) {
        issues.push(issue('MISSING_REQUIRED_FIELD', `${prefix}.resourceKind`, 'Expense line must include a resource kind.'))
      }
      if (!isFiniteNonNegativeNumber(line.quantity)) {
        issues.push(issue('MISSING_REQUIRED_FIELD', `${prefix}.quantity`, 'Expense line must include a non-negative quantity.'))
      }
      if (!line.unit) {
        issues.push(issue('MISSING_REQUIRED_FIELD', `${prefix}.unit`, 'Expense line must include a unit.'))
      }
      if (!isFiniteNonNegativeNumber(line.unitCostUsd)) {
        issues.push(issue('MISSING_REQUIRED_FIELD', `${prefix}.unitCostUsd`, 'Expense line must include a non-negative unit cost.'))
      }
      if (!line.occurredAt) {
        issues.push(issue('MISSING_REQUIRED_FIELD', `${prefix}.occurredAt`, 'Expense line must include a usage date.'))
      }
      if (!line.purpose) {
        issues.push(issue('MISSING_REQUIRED_FIELD', `${prefix}.purpose`, 'Expense line must include a research purpose.'))
      }
      if (!line.projectId && !fixture.projectId) {
        issues.push(issue('MISSING_REQUIRED_FIELD', `${prefix}.projectId`, 'Expense line must identify a project directly or through the fixture.'))
      }
      if (line.receiptId) {
        if (seenReceiptIds.has(line.receiptId)) {
          issues.push(issue('DUPLICATE_EXPENSE', `${prefix}.receiptId`, 'Expense line duplicates a receipt id.'))
        } else {
          seenReceiptIds.add(line.receiptId)
        }
      }
      if (
        isFiniteNonNegativeNumber(line.quantity) &&
        isFiniteNonNegativeNumber(line.unitCostUsd) &&
        isFiniteNonNegativeNumber(line.amountUsd)
      ) {
        const expected = roundCurrency(line.quantity * line.unitCostUsd)
        if (roundCurrency(line.amountUsd) !== expected) {
          issues.push(issue('AMOUNT_CONFLICT', `${prefix}.amountUsd`, `Expense line amount ${line.amountUsd} does not match expected ${expected}.`))
        }
      }
    }

    return {
      ok: issues.length === 0,
      issues
    }
  }
}

export class ScientificExpenseDraftBuilder {
  build(input: {
    scenario: ScientificExpenseScenario
    requestId: string
    state: ScientificExpenseState
    fixture: ScientificExpenseFixtureInput
    recognizedExpenses: readonly ScientificExpenseLineItem[]
    validation: ScientificExpenseValidationResult
  }): ScientificExpenseDraftArtifact {
    const draftId = `expense-draft-${input.requestId}`
    const content = JSON.stringify({
      draftId,
      requestId: input.requestId,
      status: input.state,
      submissionMode: 'draft-only',
      realSubmissionAllowed: false,
      paymentAllowed: false,
      projectId: input.fixture.projectId ?? null,
      budgetId: input.fixture.budgetId ?? null,
      totalUsd: totalUsd(input.recognizedExpenses),
      lineItems: input.recognizedExpenses,
      validationIssues: input.validation.issues,
      policyRef: input.fixture.policyRef
    }, null, 2)

    return {
      artifactId: `artifact-${draftId}`,
      draftId,
      path: `artifacts/${input.requestId}/expense-draft.json`,
      sha256: sha256(content),
      content,
      status: input.state
    }
  }
}

export function createScientificExpenseBaselineTrace(
  options: ScientificExpenseBaselineOptions
): ScientificExpenseBaselineTrace {
  const traceId = options.traceId ?? `trace-06c-${options.scenario}`
  const requestId = options.requestId ?? `expense-06c-${options.scenario}`
  const reviewerId = options.reviewerId ?? 'finance-reviewer'
  const fixture = createExpenseFixture(options.scenario, {
    ...options.fixture,
    requestId,
    reviewerId
  })
  const recognizer = new ScientificExpenseRecognizer()
  const validator = new ScientificExpenseValidator()
  const draftBuilder = new ScientificExpenseDraftBuilder()
  const recognizedExpenses = recognizer.recognize(fixture)
  const expenseValidation = validator.validate(fixture)
  const state = stateForExpenseValidation(options.scenario, expenseValidation)
  const draft = draftBuilder.build({
    scenario: options.scenario,
    requestId,
    state,
    fixture,
    recognizedExpenses,
    validation: expenseValidation
  })
  const events = createExpenseScenarioEvents({
    scenario: options.scenario,
    traceId,
    requestId,
    reviewerId,
    fixture,
    recognizedExpenses,
    expenseValidation,
    state,
    draft
  })
  const validation = validateScientificTraceClosure(events)

  return {
    scenario: options.scenario,
    traceId,
    requestId,
    state,
    fixture,
    recognizedExpenses,
    draft,
    expenseValidation,
    events,
    validation
  }
}

export function createScientificExpenseBaselineJsonl(
  options: ScientificExpenseBaselineOptions
): string {
  return createScientificExpenseBaselineTrace(options)
    .events
    .map((event) => JSON.stringify(event))
    .join('\n')
}

export function validateScientificExpenseBaselineTrace(
  trace: Pick<ScientificExpenseBaselineTrace, 'events'>
): ScientificTraceValidationResult {
  const eventIssues = trace.events.flatMap((event) => validateScientificTraceEvent(event).issues)
  const closure = validateScientificTraceClosure(trace.events)
  return {
    ok: !eventIssues.some((validationIssue) => validationIssue.severity === 'error') && closure.ok,
    issues: [...eventIssues, ...closure.issues]
  }
}

type ExpenseScenarioEventOptions = {
  scenario: ScientificExpenseScenario
  traceId: string
  requestId: string
  reviewerId: string
  fixture: ScientificExpenseFixtureInput
  recognizedExpenses: readonly ScientificExpenseLineItem[]
  expenseValidation: ScientificExpenseValidationResult
  state: ScientificExpenseState
  draft: ScientificExpenseDraftArtifact
}

function createExpenseScenarioEvents(options: ExpenseScenarioEventOptions): ScientificTraceEvent[] {
  const events: ScientificTraceEventInput[] = []
  const input = eventId(options.requestId, 'input')
  const usage = eventId(options.requestId, 'resource-usage')
  const cost = eventId(options.requestId, 'cost-estimated')
  const recognized = eventId(options.requestId, 'recognized')
  const validated = eventId(options.requestId, 'validated')
  const reviewRequested = eventId(options.requestId, 'review-requested')
  const draftCreated = eventId(options.requestId, 'draft-created')
  const evidence = eventId(options.requestId, 'evidence')
  const budgetApproval = eventId(options.requestId, 'budget-approval')
  const reviewRecorded = eventId(options.requestId, 'review-recorded')

  events.push(
    baseEvent(options, {
      eventId: input,
      type: 'USER_INPUT',
      actor: { type: 'human', id: 'researcher' },
      payload: {
        text: `Create a draft-only expense record for ${options.fixture.requestId}.`,
        inputRef: options.fixture.inputRef,
        requestedAction: options.fixture.requestedAction,
        submissionMode: 'draft-only'
      },
      links: { inputs: [options.fixture.inputRef] }
    }),
    baseEvent(options, {
      eventId: usage,
      type: 'RESOURCE_USAGE_RECORDED',
      parentEventId: input,
      actor: { type: 'system', id: 'resource-accounting' },
      payload: {
        requestId: options.requestId,
        usageIds: options.fixture.lines.map((line) => line.usageId ?? 'missing-usage-id'),
        projectId: options.fixture.projectId ?? 'missing-project',
        lineCount: options.fixture.lines.length,
        source: '06c-local-fixture'
      },
      links: { costs: [`expense://${options.requestId}/usage`] }
    }),
    baseEvent(options, {
      eventId: cost,
      type: 'COST_ESTIMATED',
      parentEventId: usage,
      actor: { type: 'system', id: 'cost-calculator' },
      payload: {
        requestId: options.requestId,
        estimatedUsd: totalUsd(options.recognizedExpenses),
        declaredTotalUsd: options.fixture.declaredTotalUsd ?? null,
        currency: 'USD',
        calculationMode: 'fixture-deterministic'
      },
      links: { costs: [`expense://${options.requestId}/cost-estimate`] }
    }),
    baseEvent(options, {
      eventId: recognized,
      type: 'AGENT_ACTION',
      parentEventId: cost,
      actor: { type: 'agent', id: 'codex-runtime' },
      payload: {
        action: 'recognize_expense_lines',
        recognizedLineCount: options.recognizedExpenses.length,
        recognizedExpenseIds: options.recognizedExpenses.map((line) => line.usageId),
        totalUsd: totalUsd(options.recognizedExpenses)
      }
    }),
    baseEvent(options, {
      eventId: validated,
      type: 'TOOL_CALL_COMPLETED',
      parentEventId: recognized,
      actor: { type: 'tool', id: 'expense-validator' },
      payload: {
        toolName: 'expense.validator.validate',
        ok: options.expenseValidation.ok,
        issueCodes: options.expenseValidation.issues.map((validationIssue) => validationIssue.code),
        forbiddenRealSubmission: true,
        forbiddenPayment: true
      }
    })
  )

  if (!options.expenseValidation.ok) {
    events.push(baseEvent(options, {
      eventId: reviewRequested,
      type: 'HUMAN_REVIEW_REQUESTED',
      parentEventId: validated,
      actor: { type: 'system', id: 'expense-workflow' },
      payload: {
        requestId: options.requestId,
        requiredDecision: true,
        question: questionForValidation(options.expenseValidation),
        issueCodes: options.expenseValidation.issues.map((validationIssue) => validationIssue.code)
      },
      links: { reviews: [`review://${options.reviewerId}/${options.requestId}/question`] }
    }))
  }

  const draftParent = options.expenseValidation.ok ? validated : reviewRequested
  events.push(
    baseEvent(options, {
      eventId: draftCreated,
      type: 'EXPENSE_DRAFT_CREATED',
      parentEventId: draftParent,
      actor: { type: 'agent', id: 'codex-runtime' },
      payload: {
        draftId: options.draft.draftId,
        artifactId: options.draft.artifactId,
        path: options.draft.path,
        contentHash: options.draft.sha256,
        status: options.draft.status,
        submissionMode: 'draft-only',
        realSubmissionAllowed: false,
        paymentAllowed: false
      },
      links: { artifacts: [`artifact://${options.draft.artifactId}`] }
    }),
    baseEvent(options, {
      eventId: evidence,
      type: 'EVIDENCE_ATTACHED',
      parentEventId: draftCreated,
      actor: { type: 'agent', id: 'codex-runtime' },
      payload: {
        evidenceId: `evidence-${options.draft.artifactId}`,
        evidenceType: evidenceTypeForState(options.state),
        target: draftCreated,
        validationSummary: validationSummaryForState(options.state)
      },
      links: {
        artifacts: [`artifact://${options.draft.artifactId}`],
        evidence: [`evidence://${options.draft.artifactId}/expense-validation`]
      }
    })
  )

  if (options.state === 'drafted') {
    events.push(
      baseEvent(options, {
        eventId: eventId(options.requestId, 'budget-approval-requested'),
        type: 'BUDGET_APPROVAL_REQUESTED',
        parentEventId: evidence,
        actor: { type: 'system', id: 'budget-manager' },
        payload: {
          requestId: options.requestId,
          budgetId: options.fixture.budgetId,
          totalUsd: totalUsd(options.recognizedExpenses),
          requiredDecision: true
        },
        links: { reviews: [`review://${options.reviewerId}/${options.requestId}/budget`] }
      }),
      baseEvent(options, {
        eventId: budgetApproval,
        type: 'BUDGET_APPROVAL_RECORDED',
        parentEventId: eventId(options.requestId, 'budget-approval-requested'),
        actor: { type: 'human', id: options.reviewerId },
        payload: {
          requestId: options.requestId,
          budgetId: options.fixture.budgetId,
          decision: 'approved',
          reason: 'Draft expense is sanitized, complete, and within the fixture budget.'
        },
        links: { reviews: [`review://${options.reviewerId}/${options.requestId}/budget`] }
      })
    )
  }

  events.push(baseEvent(options, {
    eventId: reviewRecorded,
    type: 'HUMAN_REVIEW_RECORDED',
    parentEventId: options.state === 'drafted' ? budgetApproval : evidence,
    actor: { type: 'human', id: options.reviewerId },
    payload: {
      reviewerId: options.reviewerId,
      decision: finalDecisionForState(options.state),
      reason: reviewReasonForState(options.state),
      noRealSubmission: true,
      noPayment: true
    },
    links: { reviews: [`review://${options.reviewerId}/${options.requestId}`] }
  }))

  return prepareExpenseScenarioEvents(events)
}

function createExpenseFixture(
  scenario: ScientificExpenseScenario,
  overrides: Partial<ScientificExpenseFixtureInput>
): ScientificExpenseFixtureInput {
  const requestId = overrides.requestId ?? `expense-06c-${scenario}`
  const base: ScientificExpenseFixtureInput = {
    requestId,
    inputRef: `input://fixtures/${requestId}.json`,
    requesterId: 'researcher',
    projectId: 'project-protein-mini',
    budgetId: 'budget-ai-compute-2026',
    policyRef: 'policy://expense/draft-only/v0.1',
    requestedAction: 'draft-only',
    paymentRequested: false,
    declaredTotalUsd: 13.43,
    lines: [
      {
        usageId: 'usage-gpu-001',
        resourceKind: 'gpu',
        quantity: 2,
        unit: 'gpu-hour',
        unitCostUsd: 4.5,
        amountUsd: 9,
        occurredAt: '2026-08-07',
        purpose: 'Protein mini fixture GPU validation',
        receiptId: 'receipt-gpu-001',
        receiptHash: sha256('receipt-gpu-001')
      },
      {
        usageId: 'usage-api-001',
        resourceKind: 'api',
        quantity: 1000,
        unit: 'token',
        unitCostUsd: 0.004,
        amountUsd: 4,
        occurredAt: '2026-08-07',
        purpose: 'Agent planning token usage',
        receiptId: 'receipt-api-001',
        receiptHash: sha256('receipt-api-001')
      },
      {
        usageId: 'usage-storage-001',
        resourceKind: 'storage',
        quantity: 1,
        unit: 'gb-month',
        unitCostUsd: 0.43,
        amountUsd: 0.43,
        occurredAt: '2026-08-07',
        purpose: 'Artifact bundle storage',
        receiptId: 'receipt-storage-001',
        receiptHash: sha256('receipt-storage-001')
      }
    ]
  }

  if (scenario === 'missing-fields') {
    return mergeFixture(base, {
      projectId: undefined,
      budgetId: undefined,
      declaredTotalUsd: undefined,
      lines: [
        {
          usageId: 'usage-missing-001',
          resourceKind: 'gpu',
          quantity: 1,
          unit: 'gpu-hour',
          unitCostUsd: 4.5,
          occurredAt: '2026-08-07'
        }
      ]
    }, overrides)
  }

  if (scenario === 'duplicate-conflict') {
    return mergeFixture(base, {
      declaredTotalUsd: 18,
      lines: [
        {
          usageId: 'usage-conflict-001',
          resourceKind: 'api',
          quantity: 1000,
          unit: 'token',
          unitCostUsd: 0.004,
          amountUsd: 4,
          occurredAt: '2026-08-07',
          purpose: 'Agent planning token usage',
          receiptId: 'receipt-dupe-001',
          receiptHash: sha256('receipt-dupe-001')
        },
        {
          usageId: 'usage-conflict-002',
          resourceKind: 'api',
          quantity: 1000,
          unit: 'token',
          unitCostUsd: 0.004,
          amountUsd: 14,
          occurredAt: '2026-08-07',
          purpose: 'Duplicate receipt with conflicting amount',
          receiptId: 'receipt-dupe-001',
          receiptHash: sha256('receipt-dupe-001')
        }
      ]
    }, overrides)
  }

  return mergeFixture(base, {}, overrides)
}

function mergeFixture(
  base: ScientificExpenseFixtureInput,
  scenarioOverrides: Partial<ScientificExpenseFixtureInput>,
  explicitOverrides: Partial<ScientificExpenseFixtureInput>
): ScientificExpenseFixtureInput {
  return {
    ...base,
    ...scenarioOverrides,
    ...explicitOverrides,
    lines: explicitOverrides.lines ?? scenarioOverrides.lines ?? base.lines
  }
}

function stateForExpenseValidation(
  scenario: ScientificExpenseScenario,
  validation: ScientificExpenseValidationResult
): ScientificExpenseState {
  if (validation.ok) return 'drafted'
  if (scenario === 'duplicate-conflict') return 'rejected'
  return 'needs-information'
}

function isRecognizableLine(
  line: ScientificExpenseLineInput,
  fixtureProjectId: string | undefined
): line is RecognizableExpenseLineInput {
  return Boolean(
    line.usageId &&
    line.resourceKind &&
    isFiniteNonNegativeNumber(line.quantity) &&
    line.unit &&
    isFiniteNonNegativeNumber(line.unitCostUsd) &&
    line.occurredAt &&
    (line.projectId || fixtureProjectId) &&
    line.purpose
  )
}

function totalUsd(lines: readonly Pick<ScientificExpenseLineItem, 'amountUsd'>[]): number {
  return roundCurrency(lines.reduce((total, line) => total + line.amountUsd, 0))
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function containsSensitiveValue(value: unknown): boolean {
  if (typeof value === 'string') return hasSensitiveText(value)
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveValue(entry))
  if (!isRecord(value)) return false
  return Object.entries(value).some(([name, entry]) => {
    if (SENSITIVE_FIELD_NAMES.has(normalizeFieldName(name))) return true
    return containsSensitiveValue(entry)
  })
}

function hasSensitiveText(value: string): boolean {
  return EMAIL_PATTERN.test(value) ||
    CHINA_MAINLAND_PHONE_PATTERN.test(value) ||
    CHINA_ID_CARD_PATTERN.test(value) ||
    BANK_CARD_PATTERN.test(value) ||
    SECRET_PATTERN.test(value)
}

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9\u4e00-\u9fa5]/g, '')
}

function issue(
  code: ScientificExpenseValidationIssueCode,
  field: string | undefined,
  message: string
): ScientificExpenseValidationIssue {
  return {
    code,
    ...(field ? { field } : {}),
    message
  }
}

function questionForValidation(validation: ScientificExpenseValidationResult): string {
  const codes = new Set(validation.issues.map((validationIssue) => validationIssue.code))
  if (codes.has('DUPLICATE_EXPENSE') || codes.has('AMOUNT_CONFLICT')) {
    return 'Please review the duplicate receipt or amount conflict before any draft is accepted.'
  }
  if (codes.has('PII_DETECTED')) {
    return 'Please remove personal or payment information and provide only sanitized evidence references.'
  }
  return 'Please provide the missing project, budget, usage, date, purpose, or amount fields.'
}

function evidenceTypeForState(state: ScientificExpenseState): string {
  if (state === 'drafted') return 'sanitized-expense-draft-and-cost-calculation'
  if (state === 'rejected') return 'duplicate-or-conflicting-expense-review'
  return 'missing-expense-fields-question'
}

function validationSummaryForState(state: ScientificExpenseState): string {
  if (state === 'drafted') return 'Expense draft is complete, sanitized, and ready for human approval.'
  if (state === 'rejected') return 'Expense draft is blocked because duplicate or conflicting data was detected.'
  return 'Expense draft is blocked until required fields are supplied.'
}

function finalDecisionForState(state: ScientificExpenseState): string {
  if (state === 'drafted') return 'approved-draft-only'
  if (state === 'rejected') return 'rejected'
  return 'needs-information'
}

function reviewReasonForState(state: ScientificExpenseState): string {
  if (state === 'drafted') {
    return 'Reviewer approved the sanitized draft record only; no real submission or payment was performed.'
  }
  if (state === 'rejected') {
    return 'Reviewer rejected the draft because duplicate receipt or amount conflict must be resolved manually.'
  }
  return 'Reviewer blocked the draft until missing project, budget, date, purpose, or amount fields are supplied.'
}

function baseEvent(
  options: ExpenseScenarioEventOptions,
  input: Omit<ScientificTraceEventInput, 'traceId' | 'source'>
): ScientificTraceEventInput {
  return {
    ...input,
    traceId: options.traceId,
    actor: input.actor ?? defaultActorFor(input.type),
    source: {
      module: 'scientific-expense-manager',
      provider: 'local-expense-fixture',
      runtimeId: 'local-expense-runtime',
      requestId: options.requestId,
      idempotencyKey: `${options.traceId}:${input.eventId ?? input.type}`
    }
  }
}

function prepareExpenseScenarioEvents(events: readonly ScientificTraceEventInput[]): ScientificTraceEvent[] {
  return events.map((event, index) => prepareScientificTraceEvent({
    ...event,
    timestamp: timestampForIndex(index)
  }))
}

function eventId(requestId: string, name: string): string {
  return `${requestId}-${name}`
}

function timestampForIndex(index: number): string {
  return new Date(Date.UTC(2026, 7, 7, 1, 0, index * 10)).toISOString()
}

function defaultActorFor(type: ScientificTraceEventInput['type']): ScientificTraceActor {
  if (type.startsWith('BUDGET_APPROVAL')) return { type: 'human', id: 'finance-reviewer' }
  if (type.startsWith('HUMAN_REVIEW')) return { type: 'human', id: 'finance-reviewer' }
  if (type === 'RESOURCE_USAGE_RECORDED' || type === 'COST_ESTIMATED') return { type: 'system', id: 'resource-accounting' }
  return { type: 'agent', id: 'codex-runtime' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

const SENSITIVE_FIELD_NAMES = new Set([
  'email',
  'phone',
  'phonenumber',
  'mobile',
  'idcard',
  'idnumber',
  'identitynumber',
  'bankaccount',
  'bankcard',
  'cardnumber',
  'creditcard',
  'paymentaccount',
  'password',
  'token',
  'apikey',
  'secret',
  '\u90ae\u7bb1',
  '\u624b\u673a\u53f7',
  '\u7535\u8bdd',
  '\u8eab\u4efd\u8bc1',
  '\u94f6\u884c\u5361',
  '\u94f6\u884c\u8d26\u53f7',
  '\u4ed8\u6b3e\u8d26\u53f7',
])

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const CHINA_MAINLAND_PHONE_PATTERN = /\b1[3-9]\d{9}\b/
const CHINA_ID_CARD_PATTERN = /\b\d{17}[\dXx]\b/
const BANK_CARD_PATTERN = /\b(?:\d[ -]*?){16,19}\b/
const SECRET_PATTERN = /\b(?:sk|ghp|github_pat|xoxb)-[A-Za-z0-9_-]{12,}\b/
