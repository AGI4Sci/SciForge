import { z } from 'zod'
import {
  capabilityIdSchema,
  capabilityJsonValueSchema,
  type CapabilityJsonValue
} from '../../shared/capability-broker'
import type { CapabilityEvalPreflightSnapshot } from './preflight'

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

/**
 * The case contract is versioned independently from the wire/schema version.
 * Existing cases keep their legacy allow-list semantics until they opt in to
 * the intent-oriented contract.
 */
export const evalSemanticsVersionSchema = z.enum(['legacy-v1', 'semantics-v2'])
export type EvalSemanticsVersion = z.infer<typeof evalSemanticsVersionSchema>

export const evalTaskTypeSchema = z.enum(['action_smoke', 'routing', 'end_to_end'])
export type EvalTaskType = z.infer<typeof evalTaskTypeSchema>

/** Authoring metadata used to keep natural-language variants together. */
export const evalQueryStyleSchema = z.enum([
  'easy',
  'natural',
  'paraphrase',
  'contextual',
  'vague',
  'adversarial'
])
export type EvalQueryStyle = z.infer<typeof evalQueryStyleSchema>

/** Language used for the user-facing task text. This is authoring metadata;
 * it never changes the evaluator's hidden expectations. */
export const evalQueryLanguageSchema = z.enum(['zh-CN', 'en-US'])
export type EvalQueryLanguage = z.infer<typeof evalQueryLanguageSchema>

export const evalContextInputSchema = z.enum([
  'query',
  'workspace-files',
  'workspace-state',
  'conversation-history',
  'selection',
  'approval-state'
])
export type EvalContextInput = z.infer<typeof evalContextInputSchema>

/** Declares where a task's referents are expected to come from. */
export const evalContextContractSchema = z.object({
  mode: z.enum(['self-contained', 'workspace', 'conversation', 'selection', 'clarification']),
  visibleInputs: z.array(evalContextInputSchema).min(1).max(8),
  requiredTurns: z.number().int().min(1).max(32).default(1),
  missingContextBehavior: z.enum(['not-applicable', 'clarify', 'blocked']).default('not-applicable')
}).strict().superRefine((contract, context) => {
  if (contract.mode === 'conversation' && contract.requiredTurns < 2) {
    context.addIssue({
      code: 'custom',
      path: ['requiredTurns'],
      message: 'Conversation-context cases must require at least two turns.'
    })
  }
  if (contract.mode === 'clarification' && contract.missingContextBehavior !== 'clarify') {
    context.addIssue({
      code: 'custom',
      path: ['missingContextBehavior'],
      message: 'Clarification cases must declare missingContextBehavior=clarify.'
    })
  }
})
export type EvalContextContract = z.infer<typeof evalContextContractSchema>

/** User messages sent before the target query in a conversation-context case. */
export const evalPriorTurnSchema = nonEmptyString.max(10_000)

export const evalDifficultySchema = z.enum(['easy', 'medium', 'hard', 'adversarial'])
export type EvalDifficulty = z.infer<typeof evalDifficultySchema>

export const evalDatasetSplitSchema = z.enum(['development', 'holdout'])
export type EvalDatasetSplit = z.infer<typeof evalDatasetSplitSchema>

export const evalCaseSourceSchema = z.enum(['synthetic', 'real_user', 'regression', 'manually_written'])
export type EvalCaseSource = z.infer<typeof evalCaseSourceSchema>

export const evalEvaluationDimensionSchema = z.enum([
  'behavior',
  'discovery',
  'action_selection',
  'arguments',
  'authorization',
  'invocation',
  'task_completion',
  'result_correctness',
  'artifact_state_correctness',
  'robustness'
])
export type EvalEvaluationDimension = z.infer<typeof evalEvaluationDimensionSchema>

export const evalExpectedBehaviorSchema = z.enum(['complete', 'clarify', 'no_tool', 'decline'])
export type EvalExpectedBehavior = z.infer<typeof evalExpectedBehaviorSchema>

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
  'cleanup_failure',
  'workspace_persistence_failure',
  'behavior_mismatch'
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

const evalFinalStateOutputLocatorSchema = z.object({
  actionId: capabilityIdSchema,
  jsonPath: nonEmptyString.max(1_024)
}).strict()
export type EvalFinalStateOutputLocator = z.infer<typeof evalFinalStateOutputLocatorSchema>

export const evalFinalStateArtifactSchema = z.object({
  path: relativeWorkspacePathSchema.optional(),
  pathFromOutput: evalFinalStateOutputLocatorSchema.optional(),
  exists: z.boolean().default(true),
  minBytes: z.number().int().nonnegative().max(256 * 1024 * 1024).optional(),
  format: z.enum(['text', 'json', 'jsonl']).optional(),
  jsonPath: nonEmptyString.max(1_024).optional()
}).strict().superRefine((artifact, context) => {
  if ((artifact.path === undefined) === (artifact.pathFromOutput === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['path'],
      message: 'Exactly one of path or pathFromOutput is required.'
    })
  }
})
export type EvalFinalStateArtifact = z.infer<typeof evalFinalStateArtifactSchema>

export const evalFinalStateLineageSchema = z.object({
  sourcePath: relativeWorkspacePathSchema.optional(),
  sourceFromOutput: evalFinalStateOutputLocatorSchema.optional(),
  targetPath: relativeWorkspacePathSchema.optional(),
  targetFromOutput: evalFinalStateOutputLocatorSchema.optional(),
  sourceJsonPath: nonEmptyString.max(1_024).optional(),
  targetJsonPath: nonEmptyString.max(1_024).optional()
}).strict().superRefine((lineage, context) => {
  if ((lineage.sourcePath === undefined) === (lineage.sourceFromOutput === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['sourcePath'],
      message: 'Exactly one of sourcePath or sourceFromOutput is required.'
    })
  }
  if ((lineage.targetPath === undefined) === (lineage.targetFromOutput === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['targetPath'],
      message: 'Exactly one of targetPath or targetFromOutput is required.'
    })
  }
})
export type EvalFinalStateLineage = z.infer<typeof evalFinalStateLineageSchema>

export const evalExpectedFinalStateSchema = z.object({
  assertions: z.array(evalFinalStateAssertionSchema).max(256),
  artifacts: z.array(evalFinalStateArtifactSchema).max(128).default([]),
  dataLineage: z.array(evalFinalStateLineageSchema).max(128).default([])
}).strict()
// Keep the public case type source-compatible with older cases that only
// declare assertions; Zod still supplies empty arrays at runtime.
export type EvalExpectedFinalState = z.input<typeof evalExpectedFinalStateSchema>

/** Stable external oracle contract used by live execution and replay. */
export const evalFinalStateEvidenceSchema = z.object({
  taskSuccess: z.boolean().optional(),
  finalState: capabilityJsonValueSchema.optional(),
  evidence: z.array(nonEmptyString.max(4_096)).max(256).default([]),
  /** Action IDs whose outputs or state transitions the independent oracle verified. */
  verifiedActions: z.array(capabilityIdSchema).max(512).default([]),
  /** Dimensions explicitly verified by the independent oracle. */
  verifiedDimensions: z.array(evalEvaluationDimensionSchema).max(32).default([])
}).strict()
export type EvalFinalStateEvidence = z.infer<typeof evalFinalStateEvidenceSchema>

export const evalRubricItemSchema = z.object({
  id: nonEmptyString.max(128),
  description: nonEmptyString.max(2_000),
  type: z.enum(['deterministic', 'llm_judge']),
  weight: z.number().positive().max(100),
  maxScore: z.number().positive().max(100).default(1),
  threshold: z.number().nonnegative().max(100).default(0.5),
  assertion: evalFinalStateAssertionSchema.optional()
}).strict()
export type EvalRubricItem = z.infer<typeof evalRubricItemSchema>

export const evalLlmJudgeResultSchema = z.object({
  rubricId: nonEmptyString.max(128),
  score: z.number().finite().nonnegative().max(100),
  evidence: nonEmptyString.max(8_192).optional(),
  model: nonEmptyString.max(256).optional(),
  humanCalibration: z.object({
    reviewer: nonEmptyString.max(256),
    score: z.number().finite().nonnegative().max(100),
    rationale: nonEmptyString.max(8_192).optional(),
    reviewedAt: z.string().datetime({ offset: true }).optional()
  }).strict().optional()
}).strict()
export type EvalLlmJudgeResult = z.infer<typeof evalLlmJudgeResultSchema>

export const evalLlmJudgeSidecarSchema = z.object({
  schemaVersion: z.literal('sciforge.capability-eval.llm-judge.v1'),
  caseId: nonEmptyString.max(256),
  results: z.array(evalLlmJudgeResultSchema).max(128)
}).strict().superRefine((sidecar, context) => {
  const rubricIds = sidecar.results.map((result) => result.rubricId)
  if (new Set(rubricIds).size !== rubricIds.length) {
    context.addIssue({ code: 'custom', path: ['results'], message: 'Judge rubric IDs must be unique.' })
  }
})
export type EvalLlmJudgeSidecar = z.infer<typeof evalLlmJudgeSidecarSchema>

/**
 * Maintainer adjudication for a real Agent trace. The label is kept outside
 * the evaluator report so calibration can compare an independent oracle with
 * a fresh evaluator run.
 */
export const evalTraceCalibrationLabelSchema = z.object({
  outcome: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  failureTypes: z.array(evalFailureTypeSchema).max(32).default([]),
  reviewer: nonEmptyString.max(256),
  reviewedAt: z.string().datetime({ offset: true }),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.array(nonEmptyString.max(4_096)).min(1).max(32),
  rationale: nonEmptyString.max(8_192)
}).strict()
export type EvalTraceCalibrationLabel = z.infer<typeof evalTraceCalibrationLabelSchema>

export const evalTraceCalibrationCaseSchema = z.object({
  schemaVersion: z.literal('sciforge.capability-eval.trace-calibration.v1'),
  id: nonEmptyString.max(256),
  caseId: nonEmptyString.max(256),
  caseFile: relativeWorkspacePathSchema,
  rawTraceFile: relativeWorkspacePathSchema,
  normalizedTraceFile: relativeWorkspacePathSchema,
  sourceReport: relativeWorkspacePathSchema.optional(),
  split: z.enum(['train', 'holdout']),
  humanLabel: evalTraceCalibrationLabelSchema
}).strict()
export type EvalTraceCalibrationCase = z.infer<typeof evalTraceCalibrationCaseSchema>

export const evalExpectedSchema = z.object({
  domain: nonEmptyString.max(128).optional(),
  requiredDomains: z.array(nonEmptyString.max(128)).max(64).default([]),
  mustDiscover: z.array(capabilityIdSchema).max(512).default([]),
  requiredActions: z.array(capabilityIdSchema).max(512).default([]),
  /** Preferred actions used for selection metrics and diagnosis. */
  expectedActions: z.array(capabilityIdSchema).max(512).default([]),
  /** Semantically equivalent alternatives; this is not an allow-list. */
  acceptableActions: z.array(capabilityIdSchema).max(512).default([]),
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
    ['expectedActions', expected.expectedActions],
    ['acceptableActions', expected.acceptableActions],
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

  const positiveSelectionActions = [
    ...expected.expectedActions,
    ...expected.acceptableActions
  ]
  if (new Set(positiveSelectionActions).size !== positiveSelectionActions.length) {
    context.addIssue({
      code: 'custom',
      path: ['acceptableActions'],
      message: 'expectedActions and acceptableActions must not overlap.'
    })
  }
  if (expected.allowedActions.length > 0) {
    for (const actionId of positiveSelectionActions) {
      if (!expected.allowedActions.includes(actionId)) {
        context.addIssue({
          code: 'custom',
          path: ['allowedActions'],
          message: `Selection action ${actionId} must be included in allowedActions when an allow-list is declared.`
        })
      }
    }
  }

  const required = new Set(expected.requiredActions)
  const forbidden = new Set(expected.forbiddenActions)
  for (const actionId of required) {
    if (forbidden.has(actionId)) {
      context.addIssue({
        code: 'custom',
        path: ['requiredActions'],
        message: `Positive task action ${actionId} cannot also be forbidden.`
      })
    }
    if (expected.allowedActions.length > 0 && !expected.allowedActions.includes(actionId)) {
      context.addIssue({
        code: 'custom',
        path: ['allowedActions'],
        message: `Positive task action ${actionId} must be included in allowedActions when an allow-list is declared.`
      })
    }
  }
  for (const [index, group] of expected.alternativeActionGroups.entries()) {
    for (const actionId of group) {
      if (forbidden.has(actionId)) {
        context.addIssue({
          code: 'custom',
          path: ['alternativeActionGroups', index],
          message: `Alternative action ${actionId} cannot be forbidden.`
        })
      }
      if (expected.allowedActions.length > 0 && !expected.allowedActions.includes(actionId)) {
        context.addIssue({
          code: 'custom',
          path: ['alternativeActionGroups', index],
          message: `Alternative action ${actionId} must be included in allowedActions when an allow-list is declared.`
        })
      }
    }
  }
  if (expected.noCapabilityCalls === true && expected.requiredActions.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['noCapabilityCalls'],
      message: 'A no-capability-call task cannot require a positive task action.'
    })
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
  observedBehavior: evalExpectedBehaviorSchema.optional(),
  taskSuccess: z.boolean().optional(),
  finalState: capabilityJsonValueSchema.optional(),
  latencyMs: z.number().finite().nonnegative().max(86_400_000).optional()
}).strict()
export type EvalSimulation = z.infer<typeof evalSimulationSchema>

export const evalCaseSchema = z.object({
  id: nonEmptyString.max(256),
  query: nonEmptyString.max(10_000),
  queryLanguage: evalQueryLanguageSchema.optional(),
  contextContract: evalContextContractSchema.optional(),
  priorTurns: z.array(evalPriorTurnSchema).max(16).optional(),
  tags: z.array(nonEmptyString.max(128)).max(64).default([]),
  /** Stable scenario identity; variants of one user goal must share it. */
  scenarioId: nonEmptyString.max(256).optional(),
  queryStyle: evalQueryStyleSchema.optional(),
  difficulty: evalDifficultySchema.optional(),
  split: evalDatasetSplitSchema.optional(),
  source: evalCaseSourceSchema.optional(),
  /** Package-owned fixture/oracle profile. Never exposed to the Agent. */
  fixtureProfile: nonEmptyString.max(256).optional(),
  semanticsVersion: evalSemanticsVersionSchema.default('legacy-v1'),
  taskType: evalTaskTypeSchema.optional(),
  evaluationDimensions: z.array(evalEvaluationDimensionSchema).max(32).default([]),
  expectedBehavior: evalExpectedBehaviorSchema.optional(),
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
  if (value.semanticsVersion === 'semantics-v2') {
    if (!value.taskType) {
      context.addIssue({ code: 'custom', path: ['taskType'], message: 'semantics-v2 cases must declare taskType.' })
    }
    if (value.evaluationDimensions.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['evaluationDimensions'],
        message: 'semantics-v2 cases must declare at least one evaluation dimension.'
      })
    }
    if (value.expectedBehavior && !value.evaluationDimensions.includes('behavior')) {
      context.addIssue({
        code: 'custom',
        path: ['evaluationDimensions'],
        message: 'expectedBehavior requires the behavior evaluation dimension.'
      })
    }
  }
  const priorTurnCount = value.priorTurns?.length ?? 0
  if (value.contextContract?.mode === 'conversation') {
    if (priorTurnCount === 0) {
      context.addIssue({
        code: 'custom',
        path: ['priorTurns'],
        message: 'Conversation-context cases must declare at least one prior user turn.'
      })
    }
    if (value.contextContract.requiredTurns !== priorTurnCount + 1) {
      context.addIssue({
        code: 'custom',
        path: ['contextContract', 'requiredTurns'],
        message: 'requiredTurns must equal priorTurns.length + 1.'
      })
    }
  } else if (priorTurnCount > 0) {
    context.addIssue({
      code: 'custom',
      path: ['priorTurns'],
      message: 'priorTurns are only valid for conversation-context cases.'
    })
  }
})
export type EvalCase = z.infer<typeof evalCaseSchema>

export type EvalProviderAttempt = Readonly<{
  attempt: number
  success: boolean
  errorCode?: string
  /** Null when the trace did not expose reliable start/end timestamps. */
  latencyMs: number | null
  sequence?: number
}>

export type EvalInvocationOutcome = 'success' | 'failure' | 'unknown'

export type EvalActionIdentityStatus = 'resolved' | 'unresolved' | 'conflict'

export type EvalInvocation = Readonly<{
  /** Absent when the Host/Broker could not resolve the capability identity. */
  actionId?: string
  /** Opaque Broker operation reference, retained even when actionId is absent. */
  operationRef?: string
  /** Runtime call identity, retained independently from capability identity. */
  callId?: string
  identityStatus?: EvalActionIdentityStatus
  identitySource?: 'host-receipt' | 'operation-ref' | 'known-action' | 'unresolved'
  args: CapabilityJsonValue
  /** Structured capability output captured from the Host terminal receipt. */
  output?: CapabilityJsonValue
  success: boolean
  /** `success=false` is not a failure when outcome is `unknown`. */
  outcome?: EvalInvocationOutcome
  /** Runtime call identity. A new value means a new Agent logical invocation. */
  logicalInvocationId?: string
  /** Provider executions belonging to this logical invocation. */
  providerAttempts?: readonly EvalProviderAttempt[]
  firstAttemptSuccess?: boolean
  eventualSuccess?: boolean
  errorCode?: string
  retryCount: number
  /** Null when the trace did not expose reliable start/end timestamps. */
  latencyMs: number | null
  sequence?: number
  /** Trace position at which the broker invocation reached a terminal result. */
  authorizationSequence?: number
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
  /** Structured tool output when the receipt contains a capability result. */
  output?: CapabilityJsonValue
  status: 'running' | 'success' | 'error' | 'unknown'
  errorCode?: string
  sequence: number
}>

export type EvalTrace = Readonly<{
  /** Case-scoped identity shared by fixture preparation, Agent execution and oracle inspection. */
  runId?: string
  experimentId?: string
  runIndex?: number
  runtimeId?: string
  threadId?: string
  turnId?: string
  traceId?: string
  runtimeEvidence?: Readonly<{
    runtimeId?: string
    threadId?: string
    turnId?: string
    traceId?: string
    requestedModel?: string
    actualModel?: string
    actualModelStatus: 'observed' | 'unknown'
    provider?: string
    mode?: string
    reasoningEffort?: string
  }>
  /** Structured Host snapshot captured when live evaluation is blocked before Agent execution. */
  preflight?: CapabilityEvalPreflightSnapshot
  domain?: string
  domains?: readonly string[]
  discoveredActions: readonly string[]
  /** Whether raw discovery results exposed enough candidate identity to score recall. */
  discoveryEvidenceStatus?: 'complete' | 'partial' | 'unavailable'
  selectedActions: readonly EvalInvocation[]
  invocations: readonly EvalInvocation[]
  authorizationEvents: readonly EvalAuthorizationEvent[]
  toolCalls: number
  capabilityToolCalls?: number
  /** Number of actual capability invocation requests, including unresolved ones. */
  capabilityInvocationRequests?: number
  unresolvedActionCount?: number
  toolCallDetails?: readonly EvalToolCallDetail[]
  /** Assistant output captured from the same turn for deterministic inspection or an external LLM Judge. */
  assistantMessages?: readonly string[]
  finalAnswer?: string
  /** Optional structured behavior label from the runtime or an independent judge. */
  observedBehavior?: EvalExpectedBehavior
  retryCount: number
  latencyMs: number
  taskSuccess?: boolean
  executionStatus?: 'running' | 'completed' | 'failed' | 'aborted' | 'cancelled' | 'timed-out' | 'unknown'
  /** Runner/runtime error retained alongside partial events for replay. */
  executionError?: string
  taskLatencyMs?: number
  approvalCount?: number
  attemptEvidence?: 'complete' | 'partial' | 'unavailable'
  /** Whether the event stream is sufficient to make absence claims. */
  evidenceStatus?: 'complete' | 'partial' | 'unavailable'
  expectedLatestSeq?: number
  observedLatestSeq?: number
  /** Non-fatal sequence reconciliation note, kept separate from collection errors. */
  traceSequenceWarning?: string
  traceStatusWarning?: string
  traceCollectionError?: string
  tracePersistenceError?: string
  /** Durable copy of the isolated workspace retained for artifact review. */
  workspaceSnapshotDirectory?: string
  finalStateSource?: 'simulation' | 'trace' | 'inspector'
  /** Evidence emitted by an independent task/final-state inspector. */
  evidence?: readonly string[]
  /** Scores produced by an external, explicitly configured LLM judge. */
  llmJudgeResults?: readonly EvalLlmJudgeResult[]
  /** Action IDs explicitly verified by an independent oracle. */
  verifiedActionIds?: readonly string[]
  /** Dimensions explicitly verified by an independent oracle. */
  verifiedDimensions?: readonly EvalEvaluationDimension[]
  /** Provider-fault rules actually matched in a controlled live case. */
  faultMatches?: readonly Readonly<{
    ruleId?: string
    caseId?: string
    actionId: string
    callerId: string
    attempt: number
    injected: boolean
    errorCode: string
  }>[]
  finalState?: CapabilityJsonValue
  rawEventCount?: number
  unsupported?: readonly string[]
  usage?: Readonly<{
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }>
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
  model?: string
  rawScore?: number
  calibratedBy?: string
  calibratedAt?: string
}>

export type EvalFailure = Readonly<{
  type: EvalFailureType
  message: string
  expected?: CapabilityJsonValue
  actual?: CapabilityJsonValue
}>

export type EvalFailureStage =
  | 'dataset_preflight'
  | 'environment_runtime_start'
  | 'trace_collection'
  | 'identity_resolution'
  | 'discovery'
  | 'selection'
  | 'arguments'
  | 'authorization'
  | 'invocation'
  | 'behavior'
  | 'final_state_result'
  | 'unsupported'

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

export type EvalDimensionStatus = 'PASS' | 'FAIL' | 'N/A' | 'INCONCLUSIVE'

export type EvalDimensionResult = Readonly<{
  status: EvalDimensionStatus
  score?: number
  failures?: readonly EvalFailure[]
  note?: string
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
  semanticsVersion?: EvalSemanticsVersion
  taskType?: EvalTaskType
  expectedBehavior?: EvalExpectedBehavior
  dimensionResults?: Readonly<Partial<Record<EvalEvaluationDimension, EvalDimensionResult>>>
  diagnostics?: readonly EvalFailure[]
  failureStages?: readonly EvalFailureStage[]
  scores: EvalScores
  metrics: Readonly<{
    toolCalls: number
    retryCount: number
    latencyMs: number
    unnecessaryActionCount?: number
    toolCallCount?: number
    tokenUsage?: Readonly<{
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
    }>
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
  | 'passYield'
  | 'evaluableCoverage'
  | 'unresolvedActionRate'

export type EvalAggregateMetrics = Readonly<Record<EvalMetricKey, number | null>>

export type EvalMetricCoverage = Readonly<{
  numerator: number
  denominator: number
}>

export type EvalEvidenceCoverage = Readonly<{
  completeTrace: EvalMetricCoverage
  finalStateContract: EvalMetricCoverage
  finalStateEvidence: EvalMetricCoverage
  artifactContract: EvalMetricCoverage
  artifactEvidence: EvalMetricCoverage
  dataLineageContract: EvalMetricCoverage
  dataLineageEvidence: EvalMetricCoverage
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
  passRate: number | null
  routingAccuracy: number | null
  discoveryRecall: number | null
  actionSelectionAccuracy: number | null
  argumentAccuracy: number | null
  authorizationAccuracy: number | null
  invocationSuccessRate: number | null
  taskSuccessRate: number | null
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
  /** Content hash of the evaluator sources that produced this report. */
  evaluatorRevision?: string
  totalCases: number
  passed: number
  failed: number
  inconclusive: number
  decisiveCases: number
  passRate: number | null
  metrics: EvalAggregateMetrics
  metricCoverage?: Readonly<Partial<Record<EvalMetricKey, EvalMetricCoverage>>>
  evidenceCoverage?: EvalEvidenceCoverage
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
