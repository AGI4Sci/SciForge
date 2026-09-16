import { z } from 'zod'
import {
  capabilityIdSchema,
  capabilityJsonValueSchema,
  type CapabilityJsonValue
} from '../../shared/capability-broker'

export const CAPABILITY_EVAL_SCHEMA_VERSION = 'sciforge.capability-eval.v1' as const

const nonEmptyString = z.string().trim().min(1)

const relativeWorkspacePathSchema = z.string().trim().min(1).max(4_096).superRefine((value, context) => {
  const segments = value.split(/[\\/]+/u)
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || segments.includes('..') || value === '.') {
    context.addIssue({ code: 'custom', message: 'Workspace fixture paths must stay within the isolated workspace.' })
  }
})

const toolNameSchema = nonEmptyString.max(256)

export const evalWorkspaceFixtureFileSchema = z.object({
  path: relativeWorkspacePathSchema,
  content: z.string().max(16 * 1024 * 1024)
}).strict()

export const evalWorkspaceFixturesSchema = z.object({
  files: z.array(evalWorkspaceFixtureFileSchema).max(256)
}).strict()
export type EvalWorkspaceFixtures = z.infer<typeof evalWorkspaceFixturesSchema>

export const evalArgumentTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'null'
])
export type EvalArgumentType = z.infer<typeof evalArgumentTypeSchema>

export const evalArgumentExpectationSchema = z.object({
  required: z.array(nonEmptyString).max(128).default([]),
  types: z.record(nonEmptyString, evalArgumentTypeSchema).default({}),
  values: z.record(nonEmptyString, capabilityJsonValueSchema).default({})
}).strict()
export type EvalArgumentExpectation = z.infer<typeof evalArgumentExpectationSchema>

export const evalInvocationExpectationSchema = z.object({
  success: z.boolean(),
  errorCode: nonEmptyString.max(128).optional(),
  maxRetryCount: z.number().int().nonnegative().max(100).optional()
}).strict()
export type EvalInvocationExpectation = z.infer<typeof evalInvocationExpectationSchema>

export const evalExpectedFailureSchema = z.object({
  actionId: capabilityIdSchema,
  errorCode: nonEmptyString.max(128).optional(),
  handling: z.enum(['reported', 'recovered'])
}).strict()
export type EvalExpectedFailure = z.infer<typeof evalExpectedFailureSchema>

export const evalAuthorizationExpectationSchema = z.enum(['allow', 'confirmation', 'deny'])
export type EvalAuthorizationExpectation = z.infer<typeof evalAuthorizationExpectationSchema>

export const evalWorkflowTypeSchema = z.enum(['single-action', 'multi-step', 'cross-domain'])
export type EvalWorkflowType = z.infer<typeof evalWorkflowTypeSchema>

export const evalFailureTypeSchema = z.enum([
  'wrong_domain',
  'ordering_mismatch',
  'missing_discovery',
  'wrong_action',
  'missing_alternative_action',
  'unexpected_action',
  'forbidden_action',
  'unnecessary_action',
  'missing_tool',
  'unexpected_tool',
  'forbidden_tool',
  'unnecessary_tool',
  'tool_failure',
  'argument_mismatch',
  'authorization_mismatch',
  'authorization_order',
  'invocation_missing',
  'invocation_failure',
  'expected_failure_mismatch',
  'retry_exceeded',
  'task_failure',
  'final_state_mismatch',
  'rubric_failure',
  'execution_error',
  'trace_unsupported',
  'cleanup_failure'
])
export type EvalFailureType = z.infer<typeof evalFailureTypeSchema>

export const evalSelfTestSchema = z.object({
  expectedFailureTypes: z.array(evalFailureTypeSchema).min(1).max(64)
}).strict()
export type EvalSelfTest = z.infer<typeof evalSelfTestSchema>

export const evalOrderingConstraintSchema = z.object({
  before: capabilityIdSchema,
  after: capabilityIdSchema
}).strict()
export type EvalOrderingConstraint = z.infer<typeof evalOrderingConstraintSchema>

export const evalFinalStateAssertionSchema = z.object({
  path: nonEmptyString.max(1_024),
  operator: z.enum(['equals', 'exists', 'includes']),
  value: capabilityJsonValueSchema.optional()
}).strict().superRefine((assertion, context) => {
  if (assertion.operator !== 'exists' && assertion.value === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['value'],
      message: `${assertion.operator} assertions require a value.`
    })
  }
})
export type EvalFinalStateAssertion = z.infer<typeof evalFinalStateAssertionSchema>

export const evalExpectedFinalStateSchema = z.object({
  assertions: z.array(evalFinalStateAssertionSchema).max(256)
}).strict()
export type EvalExpectedFinalState = z.infer<typeof evalExpectedFinalStateSchema>

/** Stable external oracle contract used by live execution and replay. */
export const evalFinalStateEvidenceSchema = z.object({
  taskSuccess: z.boolean().optional(),
  finalState: capabilityJsonValueSchema.optional(),
  evidence: z.array(nonEmptyString.max(4_096)).max(256).default([])
}).strict()
export type EvalFinalStateEvidence = z.infer<typeof evalFinalStateEvidenceSchema>

export const evalRubricItemSchema = z.object({
  id: nonEmptyString.max(128),
  description: nonEmptyString.max(2_000),
  type: z.enum(['deterministic', 'llm_judge']),
  weight: z.number().positive().max(100),
  maxScore: z.number().positive().max(100).default(1),
  assertion: evalFinalStateAssertionSchema.optional()
}).strict()
export type EvalRubricItem = z.infer<typeof evalRubricItemSchema>

export const evalExpectedSchema = z.object({
  domain: nonEmptyString.max(128).optional(),
  requiredDomains: z.array(nonEmptyString.max(128)).max(64).default([]),
  mustDiscover: z.array(capabilityIdSchema).max(512).default([]),
  requiredActions: z.array(capabilityIdSchema).max(512).default([]),
  alternativeActionGroups: z.array(z.array(capabilityIdSchema).min(1).max(64)).max(64).default([]),
  allowedActions: z.array(capabilityIdSchema).max(512).default([]),
  forbiddenActions: z.array(capabilityIdSchema).max(512).default([]),
  unnecessaryActions: z.array(capabilityIdSchema).max(512).default([]),
  ordering: z.array(evalOrderingConstraintSchema).max(128).default([]),
  authorization: z.record(capabilityIdSchema, evalAuthorizationExpectationSchema).default({}),
  invocation: z.record(capabilityIdSchema, evalInvocationExpectationSchema).default({}),
  arguments: z.record(capabilityIdSchema, evalArgumentExpectationSchema).default({}),
  tools: z.object({
    required: z.array(toolNameSchema).max(128).default([]),
    allowed: z.array(toolNameSchema).max(256).default([]),
    forbidden: z.array(toolNameSchema).max(256).default([]),
    unnecessary: z.array(toolNameSchema).max(256).default([])
  }).strict().default({ required: [], allowed: [], forbidden: [], unnecessary: [] }),
  noCapabilityCalls: z.boolean().optional(),
  taskSuccess: z.boolean().optional()
}).strict().superRefine((expected, context) => {
  const groups = [
    ['requiredDomains', expected.requiredDomains],
    ['mustDiscover', expected.mustDiscover],
    ['requiredActions', expected.requiredActions],
    ['alternativeActionGroups', expected.alternativeActionGroups.flat()],
    ['allowedActions', expected.allowedActions],
    ['forbiddenActions', expected.forbiddenActions],
    ['unnecessaryActions', expected.unnecessaryActions],
    ['tools.required', expected.tools.required],
    ['tools.allowed', expected.tools.allowed],
    ['tools.forbidden', expected.tools.forbidden],
    ['tools.unnecessary', expected.tools.unnecessary]
  ] as const
  for (const [name, values] of groups) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', path: [name], message: `${name} must not contain duplicates.` })
    }
  }
})
export type EvalExpected = z.infer<typeof evalExpectedSchema>

export const evalSimulationDiscoverySchema = z.object({
  actions: z.array(capabilityIdSchema).max(512),
  sequence: z.number().int().nonnegative().optional()
}).strict()

export const evalSimulationAuthorizationEventSchema = z.object({
  actionId: capabilityIdSchema,
  status: z.enum(['requested', 'allowed', 'denied', 'cancelled']),
  mode: z.enum(['confirmation', 'system']).optional(),
  sequence: z.number().int().nonnegative().optional()
}).strict()

export const evalSimulationAttemptSchema = z.object({
  success: z.boolean(),
  errorCode: nonEmptyString.max(128).optional(),
  latencyMs: z.number().finite().nonnegative().max(86_400_000).default(0),
  sequence: z.number().int().nonnegative().optional()
}).strict()

export const evalSimulationCallSchema = z.object({
  actionId: capabilityIdSchema,
  args: capabilityJsonValueSchema.default({}),
  outcome: z.enum(['success', 'failure']),
  errorCode: nonEmptyString.max(128).optional(),
  retryCount: z.number().int().nonnegative().max(100).default(0),
  latencyMs: z.number().finite().nonnegative().max(86_400_000).default(0),
  attempts: z.array(evalSimulationAttemptSchema).max(101).optional(),
  sequence: z.number().int().nonnegative().optional()
}).strict()

export const evalSimulationSchema = z.object({
  domain: nonEmptyString.max(128).optional(),
  discoveries: z.array(evalSimulationDiscoverySchema).max(512).default([]),
  authorizationEvents: z.array(evalSimulationAuthorizationEventSchema).max(512).default([]),
  calls: z.array(evalSimulationCallSchema).max(512).default([]),
  taskSuccess: z.boolean().optional(),
  finalState: capabilityJsonValueSchema.optional(),
  latencyMs: z.number().finite().nonnegative().max(86_400_000).optional()
}).strict()
export type EvalSimulation = z.infer<typeof evalSimulationSchema>

export const evalCaseSchema = z.object({
  id: nonEmptyString.max(256),
  query: nonEmptyString.max(10_000),
  tags: z.array(nonEmptyString.max(128)).max(64).default([]),
  workflowType: evalWorkflowTypeSchema.optional(),
  initialState: capabilityJsonValueSchema.optional(),
  fixtures: evalWorkspaceFixturesSchema.optional(),
  expected: evalExpectedSchema,
  expectedFailure: evalExpectedFailureSchema.optional(),
  expectedFinalState: evalExpectedFinalStateSchema.optional(),
  rubric: z.array(evalRubricItemSchema).max(128).default([]),
  selfTest: evalSelfTestSchema.optional(),
  simulation: evalSimulationSchema.optional()
}).strict().superRefine((value, context) => {
  const rubricIds = value.rubric.map((item) => item.id)
  if (new Set(rubricIds).size !== rubricIds.length) {
    context.addIssue({ code: 'custom', path: ['rubric'], message: 'Rubric IDs must be unique.' })
  }
})
export type EvalCase = z.infer<typeof evalCaseSchema>

export type EvalProviderAttempt = Readonly<{
  attempt: number
  success: boolean
  errorCode?: string
  latencyMs: number
  sequence?: number
}>

export type EvalInvocation = Readonly<{
  actionId: string
  args: CapabilityJsonValue
  success: boolean
  /** Runtime call identity. A new value means a new Agent logical invocation. */
  logicalInvocationId?: string
  /** Provider executions belonging to this logical invocation. */
  providerAttempts?: readonly EvalProviderAttempt[]
  firstAttemptSuccess?: boolean
  eventualSuccess?: boolean
  errorCode?: string
  retryCount: number
  latencyMs: number
  sequence?: number
}>

export type EvalAuthorizationEvent = Readonly<{
  actionId: string
  status: 'requested' | 'allowed' | 'denied' | 'cancelled'
  mode?: 'confirmation' | 'system'
  sequence?: number
}>

/** Display evidence for runtime tools, including calls without a resolved action ID. */
export type EvalToolCallDetail = Readonly<{
  callId: string
  toolName: string
  actionId?: string
  operationRef?: string
  args?: CapabilityJsonValue
  status: 'running' | 'success' | 'error' | 'unknown'
  errorCode?: string
  sequence: number
}>

export type EvalTrace = Readonly<{
  domain?: string
  domains?: readonly string[]
  discoveredActions: readonly string[]
  selectedActions: readonly EvalInvocation[]
  invocations: readonly EvalInvocation[]
  authorizationEvents: readonly EvalAuthorizationEvent[]
  toolCalls: number
  capabilityToolCalls?: number
  toolCallDetails?: readonly EvalToolCallDetail[]
  /** Assistant output captured from the same turn for deterministic inspection or an external LLM Judge. */
  assistantMessages?: readonly string[]
  finalAnswer?: string
  retryCount: number
  latencyMs: number
  taskSuccess?: boolean
  executionStatus?: 'running' | 'completed' | 'failed' | 'aborted' | 'cancelled' | 'timed-out' | 'unknown'
  /** Runner/runtime error retained alongside partial events for replay. */
  executionError?: string
  taskLatencyMs?: number
  approvalCount?: number
  attemptEvidence?: 'complete' | 'partial' | 'unavailable'
  finalStateSource?: 'simulation' | 'trace' | 'inspector'
  /** Evidence emitted by an independent task/final-state inspector. */
  evidence?: readonly string[]
  finalState?: CapabilityJsonValue
  rawEventCount?: number
  unsupported?: readonly string[]
}>

export type EvalOutcome = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export type EvalRubricResult = Readonly<{
  id: string
  status: 'passed' | 'failed' | 'unsupported' | 'skipped'
  score: number
  maxScore: number
  weight: number
  evidence?: string
  failure?: string
}>

export type EvalFailure = Readonly<{
  type: EvalFailureType
  message: string
  expected?: CapabilityJsonValue
  actual?: CapabilityJsonValue
}>

export type EvalScores = Readonly<{
  routing: number
  discovery: number
  selection: number
  arguments: number
  authorization: number
  invocation: number
  taskSuccess: number
  finalState: number
  rubric: number
}>

export type EvalCaseResult = Readonly<{
  caseId: string
  query: string
  tags: readonly string[]
  passed: boolean
  /** PASS/FAIL are decisive; INCONCLUSIVE means the trace lacks required evidence. */
  outcome: EvalOutcome
  domain?: string
  domains?: readonly string[]
  workflowType?: EvalWorkflowType
  scores: EvalScores
  metrics: Readonly<{
    toolCalls: number
    retryCount: number
    latencyMs: number
  }>
  discoveredActions: readonly string[]
  selectedActions: readonly string[]
  invocations: readonly EvalInvocation[]
  authorizationEvents: readonly EvalAuthorizationEvent[]
  expected: EvalExpected
  expectedFailure?: EvalExpectedFailure
  expectedFinalState?: EvalExpectedFinalState
  selfTest?: EvalSelfTest
  expectedFailureHandling: 'passed' | 'failed' | 'not-applicable'
  actual: EvalTrace
  rubric: readonly EvalRubricResult[]
  failures: readonly EvalFailure[]
}> 

export type EvalMetricKey =
  | 'routingAccuracy'
  | 'discoveryRecall'
  | 'actionSelectionAccuracy'
  | 'argumentAccuracy'
  | 'authorizationAccuracy'
  | 'invocationSuccessRate'
  | 'runtimeToolSuccessRate'
  | 'taskSuccessRate'
  | 'contractPassRate'
  | 'rawInvocationSuccessRate'
  | 'unexpectedInvocationFailureRate'
  | 'expectedFailureHandlingAccuracy'
  | 'retryRecoveryRate'
  | 'taskOutcomeAccuracy'
  | 'rawTaskSuccessRate'
  | 'averageToolCalls'
  | 'averageRetryCount'
  | 'averageLatencyMs'
  | 'requiredDomainAccuracy'
  | 'multiStepCompletionRate'
  | 'finalStateAccuracy'
  | 'forbiddenActionRate'
  | 'unnecessaryToolCallRate'
  | 'unexpectedToolCallRate'
  | 'firstAttemptSuccessRate'
  | 'eventualInvocationSuccessRate'
  | 'averageApprovalCount'
  | 'averageCapabilityToolCalls'
  | 'averageTaskLatencyMs'
  | 'unnecessaryCallsPerTask'

export type EvalAggregateMetrics = Readonly<Record<EvalMetricKey, number>>

export type EvalMetricCoverage = Readonly<{
  numerator: number
  denominator: number
}>

export type EvalExecutionMode = 'deterministic-simulation' | 'trace' | 'live-agent'

export type EvalBaselineComparison = Readonly<{
  baseline: EvalAggregateMetrics
  current: EvalAggregateMetrics
  delta: EvalAggregateMetrics
}>

export type EvalDomainAggregate = Readonly<{
  total: number
  passed: number
  failed: number
  inconclusive: number
  decisiveCases: number
  passRate: number
  routingAccuracy: number
  discoveryRecall: number
  actionSelectionAccuracy: number
  argumentAccuracy: number
  authorizationAccuracy: number
  invocationSuccessRate: number
  taskSuccessRate: number
}>

export type EvalFailureAggregate = Readonly<{
  count: number
  rate: number
}>

export type EvalAggregateReport = Readonly<{
  schemaVersion: typeof CAPABILITY_EVAL_SCHEMA_VERSION
  generatedAt: string
  runKind: 'golden-regression'
  scope: 'capability-unit' | 'agent-workflow'
  executionMode: EvalExecutionMode
  capabilityReference?: string
  totalCases: number
  passed: number
  failed: number
  inconclusive: number
  decisiveCases: number
  passRate: number
  metrics: EvalAggregateMetrics
  metricCoverage?: Readonly<Partial<Record<EvalMetricKey, EvalMetricCoverage>>>
  domainBreakdown: Readonly<Record<string, EvalDomainAggregate>>
  failureBreakdown: Readonly<Record<string, EvalFailureAggregate>>
  failures: readonly string[]
  cases: readonly EvalCaseResult[]
  baselineComparison?: EvalBaselineComparison
}> 

export type EvalSelfTestCaseResult = Readonly<{
  caseId: string
  query: string
  subjectResult: 'PASS' | 'FAIL'
  evaluatorTestResult: 'PASS' | 'FAIL'
  detectedFailures: readonly EvalFailure[]
  expected?: EvalExpected
  selfTest?: EvalSelfTest
  expectedFailureTypes: readonly EvalFailureType[]
  detectedExpectedFailureTypes: readonly EvalFailureType[]
  missedFailureTypes: readonly EvalFailureType[]
  unexpectedFailureTypes: readonly EvalFailureType[]
  actual?: EvalTrace
}> 

export type EvalSelfTestReport = Readonly<{
  schemaVersion: typeof CAPABILITY_EVAL_SCHEMA_VERSION
  generatedAt: string
  runKind: 'evaluator-self-test'
  executionMode: EvalExecutionMode
  totalCases: number
  expectedFailuresDetected: number
  missedFailures: number
  detectionRate: number
  cases: readonly EvalSelfTestCaseResult[]
}> 
