import type { CapabilityJsonValue } from '../../shared/capability-broker'
import {
  type EvalAuthorizationExpectation,
  type EvalAuthorizationEvent,
  type EvalCase,
  type EvalCaseResult,
  type EvalFailure,
  type EvalFinalStateAssertion,
  type EvalInvocation,
  type EvalRubricResult,
  type EvalScores,
  type EvalTrace
} from './schema'

export function evaluateRouting(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expected = evalCase.expected.domain
  const requiredDomains = evalCase.expected.requiredDomains
  const actualDomains = new Set(trace.domains ?? domainsFromInvocations(trace.invocations))
  if (!expected && requiredDomains.length === 0) return part(1)
  const actual = trace.domain ?? domainFromActions(trace.selectedActions)
  const failures: EvalFailure[] = []
  let checks = 0
  let passed = 0
  if (expected) {
    checks += 1
    if (actual === expected) passed += 1
    else failures.push(failure(
      'wrong_domain',
      `Expected domain ${expected}, received ${actual ?? 'none'}.`,
      expected,
      actual ?? null
    ))
  }
  for (const domain of requiredDomains) {
    checks += 1
    if (actualDomains.has(domain)) passed += 1
    else failures.push(failure(
      'wrong_domain',
      `Expected workflow to route through domain ${domain}.`,
      domain,
      [...actualDomains]
    ))
  }
  return part(checks === 0 ? 1 : passed / checks, failures)
}

export function evaluateDiscovery(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expected = evalCase.expected.mustDiscover
  if (expected.length === 0) return part(1)
  const discovered = new Set(trace.discoveredActions)
  const matched = expected.filter((actionId) => discovered.has(actionId))
  const failures = expected
    .filter((actionId) => !discovered.has(actionId))
    .map((actionId) => failure(
      'missing_discovery',
      `Expected ${actionId} to be discovered.`,
      actionId,
      trace.discoveredActions
    ))
  return part(matched.length / expected.length, failures)
}

export function evaluateActionSelection(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const actual = new Set(trace.selectedActions.map((invocation) => invocation.actionId))
  const required = evalCase.expected.requiredActions
  const allowed = evalCase.expected.allowedActions.length > 0
    ? new Set(evalCase.expected.allowedActions)
    : new Set(required)
  const failures: EvalFailure[] = []
  for (const actionId of required) {
    if (!actual.has(actionId)) {
      failures.push(failure(
        'wrong_action',
        `Required action ${actionId} was not selected.`,
        actionId,
        [...actual]
      ))
    }
  }
  for (const group of evalCase.expected.alternativeActionGroups) {
    if (group.some((actionId) => actual.has(actionId))) continue
    failures.push(failure(
      'missing_alternative_action',
      `At least one action from the alternative group was required: ${group.join(', ')}.`,
      group,
      [...actual]
    ))
  }
  for (const actionId of actual) {
    if (evalCase.expected.forbiddenActions.includes(actionId)) {
      failures.push(failure(
        'forbidden_action',
        `Forbidden action ${actionId} was selected.`,
        evalCase.expected.forbiddenActions,
        actionId
      ))
      continue
    }
    if (allowed.size > 0 && !allowed.has(actionId)) {
      failures.push(failure(
        'wrong_action',
        `Action ${actionId} is outside the allowed action set.`,
        [...allowed],
        actionId
      ))
    }
  }
  if (evalCase.expected.noCapabilityCalls && trace.invocations.length > 0) {
    failures.push(failure(
      'unexpected_action',
      'This task explicitly requires no Capability action calls.',
      [],
      trace.invocations.map((invocation) => invocation.actionId)
    ))
  }
  const requiredRecall = required.length === 0
    ? 1
    : required.filter((actionId) => actual.has(actionId)).length / required.length
  return part(failures.length > 0 ? 0 : requiredRecall, failures)
}

export function evaluateOrdering(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const constraints = evalCase.expected.ordering
  if (constraints.length === 0) return part(1)
  const failures: EvalFailure[] = []
  let passed = 0
  for (const constraint of constraints) {
    const before = firstInvocation(trace.invocations, constraint.before)
    const after = firstInvocation(trace.invocations, constraint.after)
    if (!before || !after || sequenceOf(before, trace.invocations) < sequenceOf(after, trace.invocations)) {
      passed += 1
      continue
    }
    failures.push(failure(
      'ordering_mismatch',
      `Expected ${constraint.before} to run before ${constraint.after}.`,
      `${constraint.before} → ${constraint.after}`,
      `${constraint.after} → ${constraint.before}`
    ))
  }
  return part(passed / constraints.length, failures)
}

export function evaluateUnnecessaryActions(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const unnecessary = new Set(evalCase.expected.unnecessaryActions)
  if (unnecessary.size === 0) return part(1)
  const actual = trace.invocations.filter((invocation) => unnecessary.has(invocation.actionId))
  if (actual.length === 0) return part(1)
  return part(0, actual.map((invocation) => failure(
    'unnecessary_action',
    `Action ${invocation.actionId} was explicitly marked unnecessary for this task.`,
    [...unnecessary],
    invocation.actionId
  )))
}

const PROTOCOL_TOOL_NAMES = new Set([
  'sciforge_discover',
  'sciforge_observe',
  'sciforge_invoke',
  'sciforge_events'
])

/**
 * Evaluates runtime tools that are visible in the trace but are not
 * capability actions. Protocol tools are always allowed; a case may allow
 * additional tools explicitly when its workflow contract requires them.
 */
export function evaluateToolUsage(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const details = trace.toolCallDetails ?? []
  const expected = evalCase.expected.tools
  const required = new Set(expected.required)
  const allowed = new Set(expected.allowed)
  const forbidden = new Set(expected.forbidden)
  const unnecessary = new Set(expected.unnecessary)
  const actualNames = new Set(details.map((detail) => detail.toolName))
  const failures: EvalFailure[] = []

  for (const toolName of required) {
    if (!actualNames.has(toolName)) {
      failures.push(failure(
        'missing_tool',
        `Required runtime tool ${toolName} was not called.`,
        toolName,
        [...actualNames]
      ))
    }
  }
  for (const detail of details) {
    if (forbidden.has(detail.toolName)) {
      failures.push(failure(
        'forbidden_tool',
        `Runtime tool ${detail.toolName} is forbidden for this task.`,
        [...forbidden],
        detail.toolName
      ))
    } else if (unnecessary.has(detail.toolName)) {
      failures.push(failure(
        'unnecessary_tool',
        `Runtime tool ${detail.toolName} was explicitly marked unnecessary for this task.`,
        [...unnecessary],
        detail.toolName
      ))
    }
    if (PROTOCOL_TOOL_NAMES.has(detail.toolName)) {
      if (detail.status === 'error') {
        failures.push(failure(
          'tool_failure',
          `Runtime protocol tool ${detail.toolName} failed${detail.errorCode ? ` (${detail.errorCode})` : ''}.`,
          'success',
          detail.errorCode ?? detail.status
        ))
      }
      continue
    }
    if (!forbidden.has(detail.toolName) && !unnecessary.has(detail.toolName) &&
        allowed.size > 0 && !allowed.has(detail.toolName)) {
      failures.push(failure(
        'unexpected_tool',
        `Runtime tool ${detail.toolName} is outside the allowed tool set.`,
        [...allowed],
        detail.toolName
      ))
    }
    if (detail.status === 'error') {
      failures.push(failure(
        'tool_failure',
        `Runtime tool ${detail.toolName} failed${detail.errorCode ? ` (${detail.errorCode})` : ''}.`,
        'success',
        detail.errorCode ?? detail.status
      ))
    }
  }
  return part(failures.length === 0 ? 1 : 0, failures)
}

export function evaluateArguments(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expectations = Object.entries(evalCase.expected.arguments)
  if (expectations.length === 0) return part(1)
  const failures: EvalFailure[] = []
  let checks = 0
  let passed = 0
  for (const [actionId, expectation] of expectations) {
    const invocations = trace.invocations.filter((invocation) => invocation.actionId === actionId)
    const targets: readonly (EvalInvocation | undefined)[] = invocations.length > 0 ? invocations : [undefined]
    for (const invocation of targets) {
      const label = invocation?.logicalInvocationId ? ` (${invocation.logicalInvocationId})` : ''
      for (const path of expectation.required) {
        checks += 1
        if (invocation && hasPath(invocation.args, path)) passed += 1
        else failures.push(failure(
          'argument_mismatch',
          `Action ${actionId}${label} is missing required argument ${path}.`,
          path,
          invocation ? invocation.args : null
        ))
      }
      for (const [path, expectedType] of Object.entries(expectation.types)) {
        checks += 1
        const value = invocation ? getPath(invocation.args, path) : undefined
        if (value !== undefined && argumentType(value) === expectedType) passed += 1
        else failures.push(failure(
          'argument_mismatch',
          `Argument ${actionId}.${path}${label} must have type ${expectedType}.`,
          expectedType,
          value === undefined ? null : value
        ))
      }
      for (const [path, expectedValue] of Object.entries(expectation.values)) {
        checks += 1
        const value = invocation ? getPath(invocation.args, path) : undefined
        if (value !== undefined && deepEqual(value, expectedValue)) passed += 1
        else failures.push(failure(
          'argument_mismatch',
          `Argument ${actionId}.${path}${label} did not match the expected value.`,
          expectedValue,
          value === undefined ? null : value
        ))
      }
      if (!invocation && expectation.required.length === 0 &&
          Object.keys(expectation.types).length === 0 &&
          Object.keys(expectation.values).length === 0) {
        checks += 1
        failures.push(failure(
          'argument_mismatch',
          `Action ${actionId} was not invoked, so its arguments cannot be evaluated.`,
          actionId,
          null
        ))
      }
    }
  }
  return part(checks === 0 ? 1 : passed / checks, failures)
}

export function evaluateAuthorization(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expectations = Object.entries(evalCase.expected.authorization)
  if (expectations.length === 0) return part(1)
  const failures: EvalFailure[] = []
  let checks = 0
  let passed = 0
  for (const [actionId, expected] of expectations) {
    const events = trace.authorizationEvents.filter((event) => event.actionId === actionId)
    const invocations = trace.invocations.filter((invocation) => invocation.actionId === actionId)
    if (invocations.length === 0) {
      checks += 1
      const actual = authorizationStatus(events, [], actionId)
      if (actual === expected) passed += 1
      else failures.push(failure(
        'authorization_mismatch',
        `Expected authorization ${expected} for ${actionId}, received ${actual}.`,
        expected,
        actual
      ))
      if (expected === 'confirmation') appendConfirmationFailures(
        failures, actionId, events, undefined, trace.invocations, events
      )
      continue
    }
    for (const invocation of invocations) {
      checks += 1
      const relevantEvents = authorizationEventsBeforeInvocation(events, invocation)
      const actual = authorizationStatus(relevantEvents, [invocation], actionId)
      if (actual === expected) passed += 1
      else failures.push(failure(
        'authorization_mismatch',
        `Expected authorization ${expected} for ${actionId}, received ${actual}.`,
        expected,
        actual
      ))
      if (expected === 'confirmation') appendConfirmationFailures(
        failures, actionId, relevantEvents, invocation, trace.invocations, events
      )
      if (expected === 'deny' && invocation.success) {
        failures.push(failure(
          'authorization_mismatch',
          `Denied action ${actionId} was invoked successfully.`,
          'no successful invocation',
          invocation.success
        ))
      }
    }
  }
  return part(failures.length > 0 ? 0 : checks === 0 ? 1 : passed / checks, failures)
}

function appendConfirmationFailures(
  failures: EvalFailure[],
  actionId: string,
  events: readonly EvalAuthorizationEvent[],
  invocation: EvalInvocation | undefined,
  allInvocations: readonly EvalInvocation[],
  allEvents: readonly EvalAuthorizationEvent[]
): void {
  const requested = events.find((event) => event.status === 'requested')
  const allowed = events.find((event) => event.status === 'allowed')
  const firstAllowed = allEvents.find((event) => event.status === 'allowed')
  const hasConfirmation = allEvents.some((event) => event.status === 'requested') && Boolean(firstAllowed)
  if (hasConfirmation && invocation &&
      sequenceOf(invocation, allInvocations) <= sequenceOf(firstAllowed!, allEvents)) {
    failures.push(failure(
      'authorization_order',
      `Action ${actionId} was invoked before its confirmation was resolved.`,
      'approval before invoke',
      'invoke before approval'
    ))
  }
  if (!requested || !allowed) {
    failures.push(failure(
      'authorization_mismatch',
      `Action ${actionId} did not produce a complete confirmation request/resolution pair.`,
      'requested → allowed',
      events.map((event) => event.status)
    ))
  }
}

function authorizationEventsBeforeInvocation(
  events: readonly EvalAuthorizationEvent[],
  invocation: EvalInvocation
): readonly EvalAuthorizationEvent[] {
  const invocationSequence = invocation.sequence
  if (invocationSequence === undefined) return events
  return events.filter((event) => event.sequence === undefined || event.sequence <= invocationSequence)
}

export function evaluateInvocation(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expectations = Object.entries(evalCase.expected.invocation)
  if (expectations.length === 0) {
    if (trace.invocations.length === 0) return part(1)
    const successful = trace.invocations.filter((invocation) => invocation.success).length
    const failures = trace.invocations
      .filter((invocation) => !invocation.success)
      .map((invocation) => failure(
        'invocation_failure',
        `Invocation of ${invocation.actionId} failed${invocation.errorCode ? ` (${invocation.errorCode})` : ''}.`,
        true,
        false
      ))
    return part(successful / trace.invocations.length, failures)
  }

  const failures: EvalFailure[] = []
  let passed = 0
  for (const [actionId, expected] of expectations) {
    const invocations = trace.invocations.filter((invocation) => invocation.actionId === actionId)
    if (invocations.length === 0) {
      failures.push(failure(
        'invocation_missing',
        `Expected action ${actionId} to be invoked.`,
        expected.success,
        null
      ))
      continue
    }
    const matchingOutcome = invocations.find((invocation) => invocation.success === expected.success)
    if (!matchingOutcome) {
      failures.push(failure(
        'invocation_failure',
        `Expected ${actionId} invocation success=${expected.success}.`,
        expected.success,
        invocations.map((invocation) => invocation.success)
      ))
      continue
    }
    if (expected.errorCode !== undefined &&
        !invocations.some((invocation) => invocation.errorCode === expected.errorCode ||
          invocation.providerAttempts?.some((attempt) => attempt.errorCode === expected.errorCode) === true)) {
      failures.push(failure(
        'invocation_failure',
        `Expected ${actionId} to report error ${expected.errorCode}.`,
        expected.errorCode,
        invocations.map((invocation) => invocation.errorCode ?? null)
      ))
      continue
    }
    const last = invocations[invocations.length - 1]
    if (expected.maxRetryCount !== undefined && last && last.retryCount > expected.maxRetryCount) {
      failures.push(failure(
        'retry_exceeded',
        `Action ${actionId} used ${last.retryCount} retries; maximum is ${expected.maxRetryCount}.`,
        expected.maxRetryCount,
        last.retryCount
      ))
      continue
    }
    passed += 1
  }
  return part(failures.length > 0 ? 0 : passed / expectations.length, failures)
}

export function evaluateFinalState(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const assertions = evalCase.expectedFinalState?.assertions ?? []
  if (assertions.length === 0) return part(1)
  if (trace.finalState === undefined) {
    return part(0, failure(
      'trace_unsupported',
      'Expected final state assertions, but the execution did not provide final state.',
      assertions,
      null
    ))
  }
  const failures: EvalFailure[] = []
  let passed = 0
  for (const assertion of assertions) {
    const actual = getPath(trace.finalState, assertion.path)
    const ok = finalStateAssertionPasses(assertion, actual)
    if (ok) passed += 1
    else failures.push(failure(
      'final_state_mismatch',
      `Final state assertion failed at ${assertion.path}.`,
      assertion.operator === 'exists' ? true : assertion.value ?? null,
      actual === undefined ? null : actual
    ))
  }
  return part(failures.length > 0 ? 0 : passed / assertions.length, failures)
}

export function evaluateRubric(evalCase: EvalCase, trace: EvalTrace): RubricEvaluation {
  const results: EvalRubricResult[] = []
  const failures: EvalFailure[] = []
  let weightedScore = 0
  let weightedMax = 0
  for (const item of evalCase.rubric) {
    if (item.type === 'llm_judge') {
      failures.push(failure(
        'trace_unsupported',
        `Rubric ${item.id} requires LLM Judge infrastructure, which is not configured in the MVP.`,
        'llm_judge',
        'unsupported'
      ))
      results.push({
        id: item.id,
        status: 'unsupported',
        score: 0,
        maxScore: item.maxScore,
        weight: item.weight,
        evidence: 'LLM judge infrastructure is not configured in the MVP.'
      })
      continue
    }
    if (!item.assertion || trace.finalState === undefined) {
      failures.push(failure(
        'trace_unsupported',
        `Rubric ${item.id} cannot be evaluated without a deterministic assertion and final state.`,
        'deterministic assertion and final state',
        null
      ))
      results.push({
        id: item.id,
        status: 'unsupported',
        score: 0,
        maxScore: item.maxScore,
        weight: item.weight,
        evidence: 'No deterministic assertion or final state was provided.'
      })
      continue
    }
    const actual = getPath(trace.finalState, item.assertion.path)
    const passed = finalStateAssertionPasses(item.assertion, actual)
    weightedMax += item.weight * item.maxScore
    if (passed) {
      weightedScore += item.weight * item.maxScore
      results.push({
        id: item.id,
        status: 'passed',
        score: item.maxScore,
        maxScore: item.maxScore,
        weight: item.weight,
        evidence: `Deterministic assertion passed at ${item.assertion.path}.`
      })
    } else {
      const message = `Deterministic rubric assertion failed at ${item.assertion.path}.`
      failures.push(failure('rubric_failure', message, item.assertion.value ?? true, actual ?? null))
      results.push({
        id: item.id,
        status: 'failed',
        score: 0,
        maxScore: item.maxScore,
        weight: item.weight,
        failure: message
      })
    }
  }
  return {
    score: weightedMax === 0 ? (evalCase.rubric.length === 0 ? 1 : 0) : weightedScore / weightedMax,
    results,
    failures
  }
}

export function evaluateCase(evalCase: EvalCase, execution: EvalExecutionView): EvalCaseResult {
  const trace = execution.trace
  const routing = evaluateRouting(evalCase, trace)
  const discovery = evaluateDiscovery(evalCase, trace)
  const selection = evaluateActionSelection(evalCase, trace)
  const ordering = evaluateOrdering(evalCase, trace)
  const unnecessary = evaluateUnnecessaryActions(evalCase, trace)
  const tools = evaluateToolUsage(evalCase, trace)
  const argumentsPart = evaluateArguments(evalCase, trace)
  const authorization = evaluateAuthorization(evalCase, trace)
  const invocation = evaluateInvocation(evalCase, trace)
  const expectedFailure = evaluateExpectedFailure(evalCase, trace)
  const finalState = evaluateFinalState(evalCase, trace)
  const rubric = evaluateRubric(evalCase, trace)
  const taskSuccess = evaluateTaskSuccess(evalCase, trace)
  const failures = [
    ...routing.failures,
    ...discovery.failures,
    ...selection.failures,
    ...ordering.failures,
    ...unnecessary.failures,
    ...tools.failures,
    ...argumentsPart.failures,
    ...authorization.failures,
    ...invocation.failures,
    ...expectedFailure.failures,
    ...taskSuccess.failures,
    ...finalState.failures,
    ...rubric.failures,
    ...(trace.unsupported ?? []).map((message) => failure('trace_unsupported', message)),
    ...(trace.executionError ? [failure('execution_error', trace.executionError)] : [])
  ]
  const scores: EvalScores = {
    routing: routing.score,
    discovery: discovery.score,
    selection: selection.score,
    arguments: argumentsPart.score,
    authorization: authorization.score,
    invocation: invocation.score,
    taskSuccess: taskSuccess.score,
    finalState: finalState.score,
    rubric: rubric.score
  }
  return {
    caseId: evalCase.id,
    query: evalCase.query,
    tags: evalCase.tags,
    passed: failures.length === 0,
    ...(trace.domain ? { domain: trace.domain } : {}),
    scores,
    metrics: {
      toolCalls: trace.toolCalls,
      retryCount: trace.retryCount,
      latencyMs: trace.latencyMs
    },
    discoveredActions: [...trace.discoveredActions],
    selectedActions: trace.selectedActions.map((invocation) => invocation.actionId),
    invocations: [...trace.invocations],
    authorizationEvents: [...trace.authorizationEvents],
    expected: evalCase.expected,
    ...(evalCase.expectedFailure ? { expectedFailure: evalCase.expectedFailure } : {}),
    ...(evalCase.expectedFinalState ? { expectedFinalState: evalCase.expectedFinalState } : {}),
    ...(evalCase.selfTest ? { selfTest: evalCase.selfTest } : {}),
    ...(evalCase.workflowType ? { workflowType: evalCase.workflowType } : {}),
    ...(trace.domains ? { domains: [...trace.domains] } : {}),
    expectedFailureHandling: evalCase.expectedFailure
      ? expectedFailure.failures.length === 0 ? 'passed' : 'failed'
      : 'not-applicable',
    actual: trace,
    rubric: rubric.results,
    failures,
    outcome: outcomeFromFailures(failures)
  }
}

export function evaluateExpectedFailure(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expectation = evalCase.expectedFailure
  if (!expectation) return part(1)
  const invocations = trace.invocations.filter((invocation) => invocation.actionId === expectation.actionId)
  const matchingFailure = findExpectedFailure(invocations, expectation.errorCode)
  if (!matchingFailure) {
    return part(0, failure(
      'expected_failure_mismatch',
      `Expected ${expectation.actionId} to report ${expectation.errorCode ?? 'a provider failure'}.`,
      expectation,
      invocations.map((invocation) => ({ success: invocation.success, errorCode: invocation.errorCode ?? null }))
    ))
  }
  const recovered = matchingFailure.sameInvocationRecovery ||
    invocations.slice(matchingFailure.invocationIndex + 1).some((invocation) => invocation.success)
  if (expectation.handling === 'recovered' && !recovered) {
    return part(0, failure(
      'expected_failure_mismatch',
      `Expected ${expectation.actionId} to recover after the expected failure.`,
      'failure followed by success',
      invocations.map((invocation) => invocation.success)
    ))
  }
  if (expectation.handling === 'reported' && recovered) {
    return part(0, failure(
      'expected_failure_mismatch',
      `Expected ${expectation.actionId} failure to remain reported, but a later retry succeeded.`,
      'terminal failure',
      invocations.map((invocation) => invocation.success)
    ))
  }
  return part(1)
}

function findExpectedFailure(
  invocations: readonly EvalInvocation[],
  expectedErrorCode: string | undefined
): Readonly<{ invocationIndex: number; sameInvocationRecovery: boolean }> | undefined {
  for (const [invocationIndex, invocation] of invocations.entries()) {
    const attempts = invocation.providerAttempts ?? []
    const failedAttemptIndex = attempts.findIndex((attempt) => (
      !attempt.success && (expectedErrorCode === undefined || attempt.errorCode === expectedErrorCode)
    ))
    if (failedAttemptIndex >= 0) {
      return {
        invocationIndex,
        sameInvocationRecovery: attempts.slice(failedAttemptIndex + 1).some((attempt) => attempt.success)
      }
    }
    if (!invocation.success &&
        (expectedErrorCode === undefined || invocation.errorCode === expectedErrorCode)) {
      return { invocationIndex, sameInvocationRecovery: false }
    }
  }
  return undefined
}

export type EvalExecutionView = Readonly<{
  trace: EvalTrace
}>

export type EvaluationPart = Readonly<{
  score: number
  failures: readonly EvalFailure[]
}>

export type RubricEvaluation = Readonly<{
  score: number
  results: readonly EvalRubricResult[]
  failures: readonly EvalFailure[]
}>

function evaluateTaskSuccess(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expected = evalCase.expected.taskSuccess ?? true
  if (trace.taskSuccess === undefined) {
    return part(0, failure(
      'trace_unsupported',
      'Task success was not reported by the execution or final-state inspector.',
      expected,
      null
    ))
  }
  const actual = trace.taskSuccess
  if (actual === expected) return part(1)
  return part(0, failure(
    'task_failure',
    `Expected taskSuccess=${expected}, received ${actual}.`,
    expected,
    actual
  ))
}

const INCONCLUSIVE_FAILURE_TYPES = new Set<EvalFailure['type']>([
  'trace_unsupported',
  'execution_error',
  'cleanup_failure'
])

function outcomeFromFailures(failures: readonly EvalFailure[]): 'PASS' | 'FAIL' | 'INCONCLUSIVE' {
  if (failures.some((failure) => !INCONCLUSIVE_FAILURE_TYPES.has(failure.type))) return 'FAIL'
  return failures.length > 0 ? 'INCONCLUSIVE' : 'PASS'
}

function authorizationStatus(
  events: readonly EvalAuthorizationEvent[],
  invocations: readonly EvalInvocation[],
  actionId: string
): EvalAuthorizationExpectation | 'unknown' {
  if (events.some((event) => event.status === 'denied' || event.status === 'cancelled')) return 'deny'
  if (events.some((event) => event.status === 'requested' || event.status === 'allowed')) return 'confirmation'
  const invocation = lastInvocation(invocations, actionId)
  if (invocation && !invocation.success && isAuthorizationError(invocation.errorCode)) return 'deny'
  if (invocation) return 'allow'
  return 'unknown'
}

function isAuthorizationError(errorCode: string | undefined): boolean {
  return errorCode === 'approval_denied' ||
    errorCode === 'approval_cancelled' ||
    errorCode === 'audience_denied' ||
    errorCode === 'permission_denied'
}

function finalStateAssertionPasses(assertion: EvalFinalStateAssertion, actual: unknown): boolean {
  if (assertion.operator === 'exists') return actual !== undefined
  if (actual === undefined || assertion.value === undefined) return false
  if (assertion.operator === 'equals') return deepEqual(actual, assertion.value)
  if (Array.isArray(actual)) return actual.some((entry) => deepEqual(entry, assertion.value))
  return typeof actual === 'string' && typeof assertion.value === 'string'
    ? actual.includes(assertion.value)
    : false
}

function domainFromActions(actions: readonly EvalInvocation[]): string | undefined {
  return actions[0]?.actionId.split('.')[0]
}

function domainsFromInvocations(invocations: readonly EvalInvocation[]): string[] {
  return [...new Set(invocations.map((invocation) => invocation.actionId.split('.')[0]))]
}

function firstInvocation(invocations: readonly EvalInvocation[], actionId: string): EvalInvocation | undefined {
  return invocations.find((invocation) => invocation.actionId === actionId)
}

function lastInvocation(invocations: readonly EvalInvocation[], actionId: string): EvalInvocation | undefined {
  return [...invocations].reverse().find((invocation) => invocation.actionId === actionId)
}

function sequenceOf(value: { sequence?: number }, collection: readonly unknown[]): number {
  return value.sequence ?? collection.indexOf(value)
}

function argumentType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function hasPath(value: unknown, path: string): boolean {
  return getPath(value, path) !== undefined
}

function getPath(value: unknown, path: string): unknown {
  let current = value
  for (const segment of path.split('.').filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/u.test(segment)) {
      current = current[Number(segment)]
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return deepEqual(leftKeys, rightKeys) && leftKeys.every((key) => deepEqual(left[key], right[key]))
  }
  return false
}

function part(score: number, failures: EvalFailure | readonly EvalFailure[] = []): EvaluationPart {
  return { score, failures: Array.isArray(failures) ? failures : [failures] }
}

function failure(
  type: EvalFailure['type'],
  message: string,
  expected?: unknown,
  actual?: unknown
): EvalFailure {
  return {
    type,
    message,
    ...(expected !== undefined ? { expected: asJsonValue(expected) } : {}),
    ...(actual !== undefined ? { actual: asJsonValue(actual) } : {})
  }
}

function asJsonValue(value: unknown): CapabilityJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(asJsonValue)
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, asJsonValue(entry)]))
  }
  return String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
