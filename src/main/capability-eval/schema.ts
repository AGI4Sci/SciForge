import { z } from 'zod'
import {
  capabilityIdSchema,
  capabilityJsonValueSchema,
  type CapabilityJsonValue
} from '../../shared/capability-broker'

export const CAPABILITY_EVAL_SCHEMA_VERSION = 'sciforge.capability-eval.v1' as const

const nonEmptyString = z.string().trim().min(1)

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

export const evalAuthorizationExpectationSchema = z.enum(['allow', 'confirmation', 'deny'])
export type EvalAuthorizationExpectation = z.infer<typeof evalAuthorizationExpectationSchema>

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
  mustDiscover: z.array(capabilityIdSchema).max(512).default([]),
  requiredActions: z.array(capabilityIdSchema).max(512).default([]),
  allowedActions: z.array(capabilityIdSchema).max(512).default([]),
  forbiddenActions: z.array(capabilityIdSchema).max(512).default([]),
  authorization: z.record(capabilityIdSchema, evalAuthorizationExpectationSchema).default({}),
  invocation: z.record(capabilityIdSchema, evalInvocationExpectationSchema).default({}),
  arguments: z.record(capabilityIdSchema, evalArgumentExpectationSchema).default({}),
  taskSuccess: z.boolean().optional()
}).strict().superRefine((expected, context) => {
  const groups = [
    ['mustDiscover', expected.mustDiscover],
    ['requiredActions', expected.requiredActions],
    ['allowedActions', expected.allowedActions],
    ['forbiddenActions', expected.forbiddenActions]
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

export const evalSimulationCallSchema = z.object({
  actionId: capabilityIdSchema,
  args: capabilityJsonValueSchema.default({}),
  outcome: z.enum(['success', 'failure']),
  errorCode: nonEmptyString.max(128).optional(),
  retryCount: z.number().int().nonnegative().max(100).default(0),
  latencyMs: z.number().finite().nonnegative().max(86_400_000).default(0),
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
  initialState: capabilityJsonValueSchema.optional(),
  expected: evalExpectedSchema,
  expectedFinalState: evalExpectedFinalStateSchema.optional(),
  rubric: z.array(evalRubricItemSchema).max(128).default([]),
  simulation: evalSimulationSchema.optional()
}).strict().superRefine((value, context) => {
  const rubricIds = value.rubric.map((item) => item.id)
  if (new Set(rubricIds).size !== rubricIds.length) {
    context.addIssue({ code: 'custom', path: ['rubric'], message: 'Rubric IDs must be unique.' })
  }
})
export type EvalCase = z.infer<typeof evalCaseSchema>

export type EvalInvocation = Readonly<{
  actionId: string
  args: CapabilityJsonValue
  success: boolean
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

export type EvalTrace = Readonly<{
  domain?: string
  discoveredActions: readonly string[]
  selectedActions: readonly EvalInvocation[]
  invocations: readonly EvalInvocation[]
  authorizationEvents: readonly EvalAuthorizationEvent[]
  toolCalls: number
  retryCount: number
  latencyMs: number
  taskSuccess?: boolean
  finalState?: CapabilityJsonValue
  rawEventCount?: number
  unsupported?: readonly string[]
}>

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
  type:
    | 'wrong_domain'
    | 'missing_discovery'
    | 'wrong_action'
    | 'forbidden_action'
    | 'argument_mismatch'
    | 'authorization_mismatch'
    | 'authorization_order'
    | 'invocation_missing'
    | 'invocation_failure'
    | 'retry_exceeded'
    | 'task_failure'
    | 'final_state_mismatch'
    | 'rubric_failure'
    | 'execution_error'
    | 'trace_unsupported'
    | 'cleanup_failure'
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
  domain?: string
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
  | 'taskSuccessRate'
  | 'averageToolCalls'
  | 'averageRetryCount'
  | 'averageLatencyMs'

export type EvalAggregateMetrics = Readonly<Record<EvalMetricKey, number>>

export type EvalExecutionMode = 'deterministic-simulation' | 'trace'

export type EvalBaselineComparison = Readonly<{
  baseline: EvalAggregateMetrics
  current: EvalAggregateMetrics
  delta: EvalAggregateMetrics
}>

export type EvalDomainAggregate = Readonly<{
  total: number
  passed: number
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
  executionMode: EvalExecutionMode
  capabilityReference?: string
  totalCases: number
  passed: number
  failed: number
  passRate: number
  metrics: EvalAggregateMetrics
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
