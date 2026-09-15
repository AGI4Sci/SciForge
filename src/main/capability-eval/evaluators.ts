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
  if (!expected) return part(1)
  const actual = trace.domain ?? domainFromActions(trace.selectedActions)
  if (actual === expected) return part(1)
  return part(0, failure(
    'wrong_domain',
    `Expected domain ${expected}, received ${actual ?? 'none'}.`,
    expected,
    actual ?? null
  ))
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
  const requiredRecall = required.length === 0
    ? 1
    : required.filter((actionId) => actual.has(actionId)).length / required.length
  return part(failures.length > 0 ? 0 : requiredRecall, failures)
}

export function evaluateArguments(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expectations = Object.entries(evalCase.expected.arguments)
  if (expectations.length === 0) return part(1)
  const failures: EvalFailure[] = []
  let checks = 0
  let passed = 0
  for (const [actionId, expectation] of expectations) {
    const invocation = lastInvocation(trace.invocations, actionId)
    for (const path of expectation.required) {
      checks += 1
      if (invocation && hasPath(invocation.args, path)) passed += 1
      else failures.push(failure(
        'argument_mismatch',
        `Action ${actionId} is missing required argument ${path}.`,
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
        `Argument ${actionId}.${path} must have type ${expectedType}.`,
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
        `Argument ${actionId}.${path} did not match the expected value.`,
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
  return part(checks === 0 ? 1 : passed / checks, failures)
}

export function evaluateAuthorization(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expectations = Object.entries(evalCase.expected.authorization)
  if (expectations.length === 0) return part(1)
  const failures: EvalFailure[] = []
  let passed = 0
  for (const [actionId, expected] of expectations) {
    const events = trace.authorizationEvents.filter((event) => event.actionId === actionId)
    const actual = authorizationStatus(events, trace.invocations, actionId)
    if (actual === expected) {
      passed += 1
    } else {
      failures.push(failure(
        'authorization_mismatch',
        `Expected authorization ${expected} for ${actionId}, received ${actual}.`,
        expected,
        actual
      ))
    }
    if (expected === 'confirmation') {
      const requested = events.find((event) => event.status === 'requested')
      const allowed = events.find((event) => event.status === 'allowed')
      const invocation = lastInvocation(trace.invocations, actionId)
      if (requested && allowed && invocation &&
          sequenceOf(invocation, trace.invocations) <= sequenceOf(allowed, events)) {
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
    if (expected === 'deny' && trace.invocations.some((invocation) => (
      invocation.actionId === actionId && invocation.success
    ))) {
      failures.push(failure(
        'authorization_mismatch',
        `Denied action ${actionId} was invoked successfully.`,
        'no successful invocation',
        trace.invocations.filter((invocation) => invocation.actionId === actionId).map((invocation) => invocation.success)
      ))
    }
  }
  return part(failures.length > 0 ? 0 : passed / expectations.length, failures)
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
        !invocations.some((invocation) => invocation.errorCode === expected.errorCode)) {
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
      'final_state_mismatch',
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
  const argumentsPart = evaluateArguments(evalCase, trace)
  const authorization = evaluateAuthorization(evalCase, trace)
  const invocation = evaluateInvocation(evalCase, trace)
  const finalState = evaluateFinalState(evalCase, trace)
  const rubric = evaluateRubric(evalCase, trace)
  const taskSuccess = evaluateTaskSuccess(evalCase, trace)
  const failures = [
    ...routing.failures,
    ...discovery.failures,
    ...selection.failures,
    ...argumentsPart.failures,
    ...authorization.failures,
    ...invocation.failures,
    ...taskSuccess.failures,
    ...finalState.failures,
    ...rubric.failures,
    ...(trace.unsupported ?? []).map((message) => failure('trace_unsupported', message))
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
    actual: trace,
    rubric: rubric.results,
    failures
  }
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
  const actual = trace.taskSuccess === true
  if (actual === expected) return part(1)
  return part(0, failure(
    'task_failure',
    `Expected taskSuccess=${expected}, received ${actual}.`,
    expected,
    actual
  ))
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
