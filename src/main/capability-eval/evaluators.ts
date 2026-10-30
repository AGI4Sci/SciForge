import type { CapabilityJsonValue } from '../../shared/capability-broker'
import {
  type EvalAuthorizationExpectation,
  type EvalAuthorizationEvent,
  type EvalArgumentExpectation,
  type EvalCase,
  type EvalCaseResult,
  type EvalFailure,
  type EvalFailureStage,
  type EvalFinalStateAssertion,
  type EvalExpectedBehavior,
  type EvalEvaluationDimension,
  type EvalDimensionResult,
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
  const canAssertAbsence = trace.evidenceStatus !== 'partial' && trace.evidenceStatus !== 'unavailable'
  const failures: EvalFailure[] = []
  let checks = 0
  let passed = 0
  if (expected) {
    checks += 1
    if (actual === expected) passed += 1
    else if (!actual && !canAssertAbsence) checks -= 1
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
    else if (!canAssertAbsence) checks -= 1
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
  const discoveryEvidenceIsIncomplete = trace.discoveryEvidenceStatus === 'partial' ||
    trace.evidenceStatus === 'partial' ||
    trace.evidenceStatus === 'unavailable'
  if (discoveryEvidenceIsIncomplete) {
    return part(
      matched.length / expected.length,
      [failure(
        'trace_unsupported',
        'Discovery was observed, but the raw candidate identity was incomplete; discovery recall cannot be decided.',
        expected,
        trace.discoveredActions
      )]
    )
  }
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
  if (evalCase.semanticsVersion === 'semantics-v2') {
    return evaluateIntentActionSelection(evalCase, trace)
  }
  return evaluateLegacyActionSelection(evalCase, trace)
}

function evaluateLegacyActionSelection(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const actual = new Set(resolvedInvocations(trace.selectedActions).flatMap((invocation) => invocation.actionId ? [invocation.actionId] : []))
  const required = evalCase.expected.requiredActions
  const allowed = evalCase.expected.allowedActions.length > 0
    ? new Set(evalCase.expected.allowedActions)
    : new Set(required)
  const failures: EvalFailure[] = []
  const canAssertAbsence = trace.evidenceStatus !== 'partial' && trace.evidenceStatus !== 'unavailable'
  for (const actionId of required) {
    if (!actual.has(actionId) && canAssertAbsence) {
      failures.push(failure(
        'wrong_action',
        `Required action ${actionId} was not selected.`,
        actionId,
        [...actual]
      ))
    }
  }
  for (const group of evalCase.expected.alternativeActionGroups) {
    if (group.some((actionId) => actual.has(actionId)) || !canAssertAbsence) continue
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

/**
 * Intent-oriented selection semantics. Preferred and acceptable actions are
 * diagnostic/selection evidence; only explicit required, forbidden and
 * allow-list contracts become hard action constraints.
 */
function evaluateIntentActionSelection(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  // Routing cases score the first observed capability choice. Later calls do
  // not repair an initially wrong route, but they still participate in
  // explicit business-policy constraints below.
  const selected = evalCase.taskType === 'routing'
    ? trace.selectedActions.slice(0, 1)
    : trace.selectedActions
  const actual = new Set(resolvedInvocations(selected).flatMap((invocation) => invocation.actionId ? [invocation.actionId] : []))
  const observed = new Set([
    ...resolvedInvocations(trace.selectedActions).flatMap((invocation) => invocation.actionId ? [invocation.actionId] : []),
    ...resolvedInvocations(trace.invocations).flatMap((invocation) => invocation.actionId ? [invocation.actionId] : [])
  ])
  const preferred = evalCase.expected.expectedActions
  const acceptable = evalCase.expected.acceptableActions
  const targetActions = [...new Set([...preferred, ...acceptable])]
  const canAssertAbsence = trace.evidenceStatus !== 'partial' && trace.evidenceStatus !== 'unavailable'
  const failures: EvalFailure[] = []

  if (trace.unresolvedActionCount && trace.unresolvedActionCount > 0) {
    failures.push(failure(
      'trace_unsupported',
      `The trace contains ${trace.unresolvedActionCount} capability invocation request(s) without a trusted action identity.`,
      'resolved capability identity',
      trace.unresolvedActionCount
    ))
  }

  if (targetActions.length > 0 && canAssertAbsence && !targetActions.some((actionId) => actual.has(actionId)) &&
      !(trace.unresolvedActionCount && trace.unresolvedActionCount > 0)) {
    failures.push(failure(
      'wrong_action',
      'No preferred or semantically acceptable action was selected.',
      targetActions,
      [...actual]
    ))
  } else if (targetActions.length > 0 && !canAssertAbsence && actual.size === 0) {
    failures.push(failure('trace_unsupported', 'Routing action-selection evidence was incomplete.'))
  }

  for (const actionId of evalCase.expected.requiredActions) {
    if (!observed.has(actionId) && canAssertAbsence) {
      failures.push(failure(
        'wrong_action',
        `Required action ${actionId} was not selected.`,
        actionId,
        [...actual]
      ))
    }
  }
  for (const group of evalCase.expected.alternativeActionGroups) {
    if (group.some((actionId) => observed.has(actionId)) || !canAssertAbsence) continue
    failures.push(failure(
      'missing_alternative_action',
      `At least one action from the alternative group was required: ${group.join(', ')}.`,
      group,
      [...actual]
    ))
  }
  for (const actionId of observed) {
    if (evalCase.expected.forbiddenActions.includes(actionId)) {
      failures.push(failure(
        'forbidden_action',
        `Forbidden action ${actionId} was selected.`,
        evalCase.expected.forbiddenActions,
        actionId
      ))
    }
    if (evalCase.expected.allowedActions.length > 0 && !evalCase.expected.allowedActions.includes(actionId)) {
      failures.push(failure(
        'wrong_action',
        `Action ${actionId} is outside the explicitly declared allow-list.`,
        evalCase.expected.allowedActions,
        actionId
      ))
    }
  }
  if (evalCase.expected.noCapabilityCalls && trace.invocations.length > 0) {
    failures.push(failure(
      'unexpected_action',
      'This task explicitly requires no Capability action calls.',
      [],
      trace.invocations.map((invocation) => invocation.actionId ?? invocation.operationRef ?? 'unresolved')
    ))
  }

  const preferredMatched = preferred.filter((actionId) => actual.has(actionId)).length
  let selectionScore: number
  if (preferred.length > 0) {
    selectionScore = preferredMatched === preferred.length || (preferred.length === 1 && acceptable.some((actionId) => actual.has(actionId)))
      ? 1
      : preferredMatched / preferred.length
  } else if (acceptable.length > 0) {
    selectionScore = acceptable.some((actionId) => actual.has(actionId)) ? 1 : 0
  } else if (evalCase.expected.requiredActions.length > 0) {
    const required = evalCase.expected.requiredActions
    selectionScore = required.filter((actionId) => actual.has(actionId)).length / required.length
  } else if (evalCase.expected.alternativeActionGroups.length > 0) {
    const groups = evalCase.expected.alternativeActionGroups
    selectionScore = groups.filter((group) => group.some((actionId) => actual.has(actionId))).length / groups.length
  } else if (evalCase.expected.noCapabilityCalls) {
    selectionScore = trace.invocations.length === 0 ? 1 : 0
  } else {
    failures.push(failure(
      'trace_unsupported',
      'Action selection requires expectedActions, acceptableActions, requiredActions, alternativeActionGroups, or noCapabilityCalls.'
    ))
    selectionScore = 0
  }
  return part(selectionScore, failures)
}

export function evaluateOrdering(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const constraints = evalCase.expected.ordering
  if (constraints.length === 0) return part(1)
  const failures: EvalFailure[] = []
  let passed = 0
  for (const constraint of constraints) {
    const before = firstInvocation(trace.invocations, constraint.before)
    const after = firstInvocation(trace.invocations, constraint.after)
    if ((!before || !after) && (trace.evidenceStatus === 'partial' || trace.evidenceStatus === 'unavailable')) {
      continue
    }
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
  const actual = trace.invocations.filter((invocation) => invocation.actionId !== undefined && unnecessary.has(invocation.actionId))
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
  const canAssertAbsence = trace.evidenceStatus !== 'partial' && trace.evidenceStatus !== 'unavailable'
  const expectedFailure = evalCase.expectedFailure

  for (const toolName of required) {
    if (!actualNames.has(toolName) && canAssertAbsence) {
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
      const isExpectedFailure = detail.status === 'error' &&
        expectedFailure !== undefined &&
        detail.actionId === expectedFailure.actionId &&
        (expectedFailure.errorCode === undefined || detail.errorCode === expectedFailure.errorCode)
      if (detail.status === 'error' && !isExpectedFailure) {
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
  if (evalCase.semanticsVersion === 'semantics-v2' && evalCase.taskType === 'routing') {
    const first = trace.invocations[0]
    const targetActions = new Set([
      ...evalCase.expected.expectedActions,
      ...evalCase.expected.acceptableActions,
      ...evalCase.expected.requiredActions
    ])
    if (!first) {
      return trace.evidenceStatus === 'partial' || trace.evidenceStatus === 'unavailable'
        ? part(0, failure('trace_unsupported', 'Routing argument evidence was incomplete.'))
        : part(0, failure('argument_mismatch', 'No task-directed invocation was observed for argument evaluation.', [...targetActions], null))
    }
    if (!first.actionId) {
      return part(0, failure('trace_unsupported', 'The first capability invocation has no trusted action identity.'))
    }
    if (targetActions.size > 0 && !targetActions.has(first.actionId)) {
      return part(0, failure('argument_mismatch', 'The first task-directed invocation was outside the expected routing set.', [...targetActions], first.actionId))
    }
    const selectedExpectation = evalCase.expected.arguments[first.actionId]
    if (!selectedExpectation) {
      return part(0, failure('trace_unsupported', `No argument oracle was declared for selected routing action ${first.actionId}.`))
    }
    return evaluateArgumentExpectation(first.actionId, selectedExpectation, [first])
  }
  const failures: EvalFailure[] = []
  let checks = 0
  let passed = 0
  for (const [actionId, expectation] of expectations) {
    const invocations = evalCase.semanticsVersion === 'semantics-v2' && evalCase.taskType === 'routing'
      ? trace.invocations.slice(0, 1).filter((invocation) => invocation.actionId === actionId)
      : trace.invocations.filter((invocation) => invocation.actionId === actionId)
    if (invocations.length === 0 && (trace.evidenceStatus === 'partial' || trace.evidenceStatus === 'unavailable')) continue
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

function evaluateArgumentExpectation(
  actionId: string,
  expectation: EvalArgumentExpectation,
  invocations: readonly EvalInvocation[]
): EvaluationPart {
  const failures: EvalFailure[] = []
  let checks = 0
  let passed = 0
  for (const invocation of invocations) {
    const label = invocation.logicalInvocationId ? ` (${invocation.logicalInvocationId})` : ''
    for (const path of expectation.required) {
      checks += 1
      if (hasPath(invocation.args, path)) passed += 1
      else failures.push(failure('argument_mismatch', `Action ${actionId}${label} is missing required argument ${path}.`, path, invocation.args))
    }
    for (const [path, expectedType] of Object.entries(expectation.types)) {
      checks += 1
      const value = getPath(invocation.args, path)
      if (value !== undefined && argumentType(value) === expectedType) passed += 1
      else failures.push(failure('argument_mismatch', `Argument ${actionId}.${path}${label} must have type ${expectedType}.`, expectedType, value ?? null))
    }
    for (const [path, expectedValue] of Object.entries(expectation.values)) {
      checks += 1
      const value = getPath(invocation.args, path)
      if (value !== undefined && deepEqual(value, expectedValue)) passed += 1
      else failures.push(failure('argument_mismatch', `Argument ${actionId}.${path}${label} did not match the expected value.`, expectedValue, value ?? null))
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
    if (invocations.length === 0 && (trace.evidenceStatus === 'partial' || trace.evidenceStatus === 'unavailable')) continue
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
      const relevantEvents = authorizationEventsBeforeInvocation(events, invocation, trace.invocations)
      if (!invocationSucceeded(invocation) && !invocationFailed(invocation)) {
        failures.push(failure(
          'trace_unsupported',
          `Authorization for ${actionId} cannot be evaluated because the invocation has no reliable terminal outcome.`,
          expected,
          'unknown'
        ))
        continue
      }
      const actual = authorizationStatus(relevantEvents, [invocation], actionId)
      const expectedDeniedFailure = expectedDeniedAuthorizationFailure(evalCase, actionId)
      if (
        authorizationMatchesExpectation(expected, actual, relevantEvents, invocation, trace.invocations) ||
        (expected === 'confirmation' && expectedDeniedFailure && actual === 'deny' && invocationFailed(invocation))
      ) passed += 1
      else failures.push(failure(
        'authorization_mismatch',
        `Expected authorization ${expected} for ${actionId}, received ${actual}.`,
        expected,
        actual
      ))
      if (expected === 'confirmation') appendConfirmationFailures(
        failures,
        actionId,
        relevantEvents,
        invocation,
        trace.invocations,
        events,
        expectedDeniedFailure
      )
      if (expected === 'deny' && invocationSucceeded(invocation)) {
        failures.push(failure(
          'authorization_mismatch',
          `Denied action ${actionId} was invoked successfully.`,
          'no successful invocation',
          invocationSucceeded(invocation)
        ))
      }
    }
  }
  return part(failures.length > 0 ? 0 : checks === 0 ? 1 : passed / checks, failures)
}

function authorizationMatchesExpectation(
  expected: EvalAuthorizationExpectation,
  actual: EvalAuthorizationExpectation | 'unknown',
  events: readonly EvalAuthorizationEvent[],
  invocation: EvalInvocation,
  allInvocations: readonly EvalInvocation[]
): boolean {
  if (actual === expected) return true
  // A case that declares `allow` may still emit the confirmation protocol.
  // Treat it as allowed only when the approval was resolved before the
  // terminal capability invocation, preserving the stricter `confirmation`
  // expectation for cases that explicitly test the protocol itself.
  if (expected !== 'allow' || actual !== 'confirmation') return false
  const allowed = events.find((event) => event.status === 'allowed')
  return allowed !== undefined &&
    sequenceOf(allowed, events) < authorizationSequenceOf(invocation, allInvocations)
}

function appendConfirmationFailures(
  failures: EvalFailure[],
  actionId: string,
  events: readonly EvalAuthorizationEvent[],
  invocation: EvalInvocation | undefined,
  allInvocations: readonly EvalInvocation[],
  allEvents: readonly EvalAuthorizationEvent[],
  expectedDeniedFailure = false
): void {
  const requested = events.find((event) => event.status === 'requested')
  const allowed = events.find((event) => event.status === 'allowed')
  const denied = events.find((event) => event.status === 'denied' || event.status === 'cancelled')
  const firstAllowed = allEvents.find((event) => event.status === 'allowed')
  if (expectedDeniedFailure) {
    if (!requested || !denied) {
      failures.push(failure(
        'authorization_mismatch',
        `Action ${actionId} did not produce a complete confirmation request/denial pair.`,
        'requested → denied',
        events.map((event) => event.status)
      ))
    }
    return
  }
  const hasConfirmation = allEvents.some((event) => event.status === 'requested') && Boolean(firstAllowed)
  if (hasConfirmation && invocation &&
      authorizationSequenceOf(invocation, allInvocations) <= sequenceOf(firstAllowed!, allEvents)) {
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

function expectedDeniedAuthorizationFailure(evalCase: EvalCase, actionId: string): boolean {
  const expectedFailure = evalCase.expectedFailure
  return expectedFailure?.actionId === actionId &&
    expectedFailure.handling === 'reported' &&
    isAuthorizationError(expectedFailure.errorCode)
}

function authorizationEventsBeforeInvocation(
  events: readonly EvalAuthorizationEvent[],
  invocation: EvalInvocation,
  allInvocations: readonly EvalInvocation[]
): readonly EvalAuthorizationEvent[] {
  const invocationSequence = authorizationSequenceOf(invocation, allInvocations)
  return events.filter((event) => event.sequence === undefined || event.sequence <= invocationSequence)
}

function authorizationSequenceOf(
  invocation: EvalInvocation,
  collection: readonly EvalInvocation[]
): number {
  return invocation.authorizationSequence ?? sequenceOf(invocation, collection)
}

export function evaluateInvocation(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expectations = Object.entries(evalCase.expected.invocation)
  if (evalCase.semanticsVersion === 'semantics-v2' && evalCase.taskType === 'routing') {
    return evaluateRoutingInvocation(evalCase, trace)
  }
  if (expectations.length === 0) {
    if (trace.invocations.length === 0) return part(1)
    const successful = trace.invocations.filter(invocationSucceeded).length
    const unknown = trace.invocations.filter((invocation) => !invocationSucceeded(invocation) && !invocationFailed(invocation))
    const failures = trace.invocations
      .filter(invocationFailed)
      .map((invocation) => failure(
        'invocation_failure',
        `Invocation of ${invocation.actionId ?? invocation.operationRef ?? 'unresolved'} failed${invocation.errorCode ? ` (${invocation.errorCode})` : ''}.`,
        true,
        false
      ))
    if (unknown.length > 0) failures.push(failure('trace_unsupported', 'At least one capability invocation has no reliable terminal outcome.'))
    return part(successful / trace.invocations.length, failures)
  }

  const failures: EvalFailure[] = []
  let passed = 0
  for (const [actionId, expected] of expectations) {
    const invocations = evalCase.semanticsVersion === 'semantics-v2' && evalCase.taskType === 'routing'
      ? trace.invocations.slice(0, 1).filter((invocation) => invocation.actionId === actionId)
      : trace.invocations.filter((invocation) => invocation.actionId === actionId)
    if (invocations.length === 0) {
      if (trace.evidenceStatus === 'partial' || trace.evidenceStatus === 'unavailable') continue
      failures.push(failure(
        'invocation_missing',
        `Expected action ${actionId} to be invoked.`,
        expected.success,
        null
      ))
      continue
    }
    const matchingOutcome = invocations.find((invocation) => (
      expected.success ? invocationSucceeded(invocation) : invocationFailed(invocation)
    ))
    if (!matchingOutcome) {
      failures.push(failure(
        invocations.some((invocation) => !invocationSucceeded(invocation) && !invocationFailed(invocation))
          ? 'trace_unsupported'
          : 'invocation_failure',
        `Expected ${actionId} invocation success=${expected.success}.`,
        expected.success,
        invocations.map(invocationOutcome)
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

function evaluateRoutingInvocation(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const targetActions = [...new Set([
    ...evalCase.expected.expectedActions,
    ...evalCase.expected.acceptableActions,
    ...evalCase.expected.requiredActions
  ])]
  const first = trace.invocations[0]
  const canAssertAbsence = trace.evidenceStatus !== 'partial' && trace.evidenceStatus !== 'unavailable'
    if (!first) {
    if (!canAssertAbsence) return part(0, [failure('trace_unsupported', 'Routing invocation evidence was incomplete.')])
    return part(0, failure('invocation_missing', 'No task-directed capability invocation was observed.', targetActions, null))
  }
  if (!first.actionId) {
    return part(0, failure('trace_unsupported', 'The first capability invocation has no trusted action identity.'))
  }
  if (targetActions.length > 0 && !targetActions.includes(first.actionId)) {
    return part(0, failure('invocation_missing', 'The first task-directed invocation was outside the expected routing set.', targetActions, first.actionId))
  }
  if (!invocationSucceeded(first) && !invocationFailed(first)) {
    return part(0, failure('trace_unsupported', `The first ${first.actionId} invocation has no reliable terminal outcome.`))
  }
  const expected = evalCase.expected.invocation[first.actionId]
  if (expected && invocationSucceeded(first) !== expected.success) {
    return part(0, failure('invocation_failure', `Expected ${first.actionId} invocation success=${expected.success}.`, expected.success, invocationOutcome(first)))
  }
  if (!expected && !invocationSucceeded(first)) {
    return part(0, failure('invocation_failure', `The first ${first.actionId} invocation failed.`, true, false))
  }
  if (expected?.errorCode !== undefined && first.errorCode !== expected.errorCode) {
    return part(0, failure('invocation_failure', `Expected ${first.actionId} to report error ${expected.errorCode}.`, expected.errorCode, first.errorCode ?? null))
  }
  if (expected?.maxRetryCount !== undefined && first.retryCount > expected.maxRetryCount) {
    return part(0, failure('retry_exceeded', `Action ${first.actionId} used ${first.retryCount} retries; maximum is ${expected.maxRetryCount}.`, expected.maxRetryCount, first.retryCount))
  }
  return part(1)
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
      const judgeResult = trace.llmJudgeResults?.find((result) => result.rubricId === item.id)
      if (!judgeResult) {
        failures.push(failure(
          'trace_unsupported',
          `Rubric ${item.id} requires an external LLM Judge sidecar.`,
          'llm_judge',
          'unsupported'
        ))
        results.push({
          id: item.id,
          status: 'unsupported',
          score: 0,
          maxScore: item.maxScore,
          weight: item.weight,
          evidence: 'No judge sidecar result was supplied.'
        })
        continue
      }
      const rawScore = Math.min(item.maxScore, judgeResult.score)
      const score = Math.min(item.maxScore, judgeResult.humanCalibration?.score ?? rawScore)
      const passed = score >= item.threshold
      weightedMax += item.weight * item.maxScore
      if (passed) weightedScore += item.weight * score
      const evidence = [
        judgeResult.evidence ?? `LLM Judge score ${rawScore}/${item.maxScore}.`,
        ...(judgeResult.humanCalibration
          ? [`Human calibration by ${judgeResult.humanCalibration.reviewer}: ${score}/${item.maxScore}.${judgeResult.humanCalibration.rationale ? ` ${judgeResult.humanCalibration.rationale}` : ''}`]
          : [])
      ].join(' ')
      results.push({
        id: item.id,
        status: passed ? 'passed' : 'failed',
        score,
        maxScore: item.maxScore,
        weight: item.weight,
        evidence,
        ...(judgeResult.model ? { model: judgeResult.model } : {}),
        ...(judgeResult.humanCalibration ? {
          rawScore,
          calibratedBy: judgeResult.humanCalibration.reviewer,
          ...(judgeResult.humanCalibration.reviewedAt ? { calibratedAt: judgeResult.humanCalibration.reviewedAt } : {})
        } : {}),
        ...(passed ? {} : { failure: `LLM Judge score ${score} is below threshold ${item.threshold}.` })
      })
      if (!passed) {
        failures.push(failure(
          'rubric_failure',
          `LLM Judge rubric ${item.id} scored below its threshold.`,
          item.threshold,
          score
        ))
      }
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
  const legacyFailures = [
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
  if (evalCase.semanticsVersion === 'semantics-v2') {
    return evaluateIntentCase({
      evalCase,
      trace,
      routing,
      discovery,
      selection,
      ordering,
      unnecessary,
      tools,
      argumentsPart,
      authorization,
      invocation,
      expectedFailure,
      finalState,
      rubric,
      taskSuccess,
      scores
    })
  }
  return {
    caseId: evalCase.id,
    query: evalCase.query,
    tags: evalCase.tags,
    passed: legacyFailures.length === 0,
    ...(trace.domain ? { domain: trace.domain } : {}),
    semanticsVersion: evalCase.semanticsVersion,
    ...(evalCase.taskType ? { taskType: evalCase.taskType } : {}),
    scores,
    failureStages: failureStagesFor(legacyFailures, trace),
    discoveredActions: [...trace.discoveredActions],
    selectedActions: resolvedInvocations(trace.selectedActions).flatMap((invocation) => invocation.actionId ? [invocation.actionId] : []),
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
    failures: legacyFailures,
    outcome: outcomeFromFailures(legacyFailures),
    metrics: {
      toolCalls: trace.toolCalls,
      retryCount: trace.retryCount,
      latencyMs: trace.latencyMs,
      unnecessaryActionCount: trace.invocations.filter((invocation) => invocation.actionId !== undefined && evalCase.expected.unnecessaryActions.includes(invocation.actionId)).length,
      toolCallCount: trace.toolCalls,
      ...(trace.usage ? { tokenUsage: trace.usage } : {})
    }
  }
}

type EvaluatorParts = Readonly<{
  evalCase: EvalCase
  trace: EvalTrace
  routing: EvaluationPart
  discovery: EvaluationPart
  selection: EvaluationPart
  ordering: EvaluationPart
  unnecessary: EvaluationPart
  tools: EvaluationPart
  argumentsPart: EvaluationPart
  authorization: EvaluationPart
  invocation: EvaluationPart
  expectedFailure: EvaluationPart
  finalState: EvaluationPart
  rubric: RubricEvaluation
  taskSuccess: EvaluationPart
  scores: EvalScores
}>

const ALL_EVALUATION_DIMENSIONS: readonly EvalEvaluationDimension[] = [
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
]

function evaluateIntentCase(parts: EvaluatorParts): EvalCaseResult {
  const { evalCase, trace, selection, ordering, unnecessary, tools } = parts
  const declared = new Set(evalCase.evaluationDimensions)
  const dimensionResults: Partial<Record<EvalEvaluationDimension, EvalDimensionResult>> = {}
  const diagnostics: EvalFailure[] = []
  const hardFailures: EvalFailure[] = []

  for (const dimension of ALL_EVALUATION_DIMENSIONS) {
    if (!declared.has(dimension)) {
      dimensionResults[dimension] = { status: 'N/A', note: 'Dimension not declared by this case.' }
      continue
    }
    const evaluation = dimensionEvaluation(parts, dimension)
    const dimensionFailures = [...evaluation.failures]
    const status = dimensionFailures.some((item) => item.type === 'trace_unsupported' || item.type === 'execution_error')
      ? 'INCONCLUSIVE'
      : dimensionFailures.length > 0 ? 'FAIL' : 'PASS'
    dimensionResults[dimension] = {
      status,
      score: evaluation.score,
      ...(dimensionFailures.length > 0 ? { failures: dimensionFailures } : {})
    }
    const hard = v2HardFailures(evalCase, dimension, dimensionFailures)
    hardFailures.push(...hard)
    diagnostics.push(...dimensionFailures.filter((item) => !hard.includes(item)))
  }

  // Explicit business/policy contracts remain active even when the case only
  // uses action selection as a diagnostic dimension (or omits it entirely).
  const selectionPolicyFailures = selection.failures.filter((item) => (
    item.type === 'forbidden_action' ||
    item.type === 'unexpected_action' ||
    item.type === 'missing_alternative_action' ||
    item.message.startsWith('Required action ') ||
    (item.type === 'wrong_action' && evalCase.expected.allowedActions.length > 0)
  ))
  hardFailures.push(...selectionPolicyFailures)
  diagnostics.push(...selection.failures.filter((item) => !selectionPolicyFailures.includes(item)))
  hardFailures.push(...ordering.failures)
  diagnostics.push(...unnecessary.failures)
  const toolPolicyFailures = tools.failures.filter((item) => (
    item.type === 'forbidden_tool' ||
    item.type === 'missing_tool' ||
    (item.type === 'unexpected_tool' && evalCase.expected.tools.allowed.length > 0)
  ))
  hardFailures.push(...toolPolicyFailures)
  diagnostics.push(...tools.failures.filter((item) => !toolPolicyFailures.includes(item)))

  const infrastructureFailures = [
    ...(trace.unsupported ?? []).map((message) => failure('trace_unsupported', message)),
    ...(trace.executionError ? [failure('execution_error', trace.executionError)] : [])
  ]
  hardFailures.push(...infrastructureFailures)

  const failures = uniqueFailures(hardFailures)
  const diagnosticFailures = uniqueFailures(diagnostics)
  const hasInconclusiveDimension = infrastructureFailures.length > 0 ||
    [...declared].some((dimension) => dimensionResults[dimension]?.status === 'INCONCLUSIVE')
  const taskSuccess = parts.taskSuccess
  const scores = {
    ...parts.scores,
    selection: declared.has('action_selection') ? parts.selection.score : 0,
    discovery: declared.has('discovery') ? parts.discovery.score : 0,
    arguments: declared.has('arguments') ? parts.argumentsPart.score : 0,
    authorization: declared.has('authorization') ? parts.authorization.score : 0,
    invocation: declared.has('invocation') ? parts.invocation.score : 0,
    taskSuccess: declared.has('task_completion') ? taskSuccess.score : 0,
    finalState: declared.has('result_correctness') || declared.has('artifact_state_correctness') ? parts.finalState.score : 0,
    rubric: declared.has('result_correctness') ? parts.rubric.score : 0
  }
  return {
    caseId: evalCase.id,
    query: evalCase.query,
    tags: evalCase.tags,
    passed: failures.length === 0 && !hasInconclusiveDimension,
    outcome: failures.length === 0 && !hasInconclusiveDimension
      ? 'PASS'
      : outcomeFromFailures(failures),
    ...(trace.domain ? { domain: trace.domain } : {}),
    ...(trace.domains ? { domains: [...trace.domains] } : {}),
    ...(evalCase.workflowType ? { workflowType: evalCase.workflowType } : {}),
    semanticsVersion: evalCase.semanticsVersion,
    ...(evalCase.taskType ? { taskType: evalCase.taskType } : {}),
    ...(evalCase.expectedBehavior ? { expectedBehavior: evalCase.expectedBehavior } : {}),
    dimensionResults,
    failureStages: failureStagesFor([...failures, ...diagnosticFailures], trace),
    ...(diagnosticFailures.length > 0 ? { diagnostics: diagnosticFailures } : {}),
    scores,
    metrics: {
      toolCalls: trace.toolCalls,
      retryCount: trace.retryCount,
      latencyMs: trace.latencyMs,
      unnecessaryActionCount: trace.invocations.filter((invocation) => invocation.actionId !== undefined && evalCase.expected.unnecessaryActions.includes(invocation.actionId)).length,
      toolCallCount: trace.toolCalls,
      ...(trace.usage ? { tokenUsage: trace.usage } : {})
    },
    discoveredActions: [...trace.discoveredActions],
    selectedActions: resolvedInvocations(trace.selectedActions).flatMap((invocation) => invocation.actionId ? [invocation.actionId] : []),
    invocations: [...trace.invocations],
    authorizationEvents: [...trace.authorizationEvents],
    expected: evalCase.expected,
    ...(evalCase.expectedFailure ? { expectedFailure: evalCase.expectedFailure } : {}),
    ...(evalCase.expectedFinalState ? { expectedFinalState: evalCase.expectedFinalState } : {}),
    ...(evalCase.selfTest ? { selfTest: evalCase.selfTest } : {}),
    expectedFailureHandling: evalCase.expectedFailure
      ? parts.expectedFailure.failures.length === 0 ? 'passed' : 'failed'
      : 'not-applicable',
    actual: trace,
    rubric: parts.rubric.results,
    failures
  }
}

function dimensionEvaluation(parts: EvaluatorParts, dimension: EvalEvaluationDimension): EvaluationPart {
  switch (dimension) {
    case 'behavior': return evaluateExpectedBehavior(parts.evalCase, parts.trace)
    case 'discovery': return parts.discovery
    case 'action_selection': return parts.selection
    case 'arguments': return parts.argumentsPart
    case 'authorization': return parts.authorization
    case 'invocation': return parts.invocation
    case 'task_completion': return parts.taskSuccess
    case 'result_correctness': return evaluateResultCorrectness(parts)
    case 'artifact_state_correctness': return evaluateArtifactState(parts)
    case 'robustness': return parts.evalCase.expectedFailure ? parts.expectedFailure : (
      parts.trace.evidenceStatus === 'complete' && !parts.trace.executionError
        ? part(1)
        : part(0, failure('trace_unsupported', 'Robustness requires complete execution evidence or an expected failure contract.'))
    )
  }
}

function evaluateResultCorrectness(parts: EvaluatorParts): EvaluationPart {
  if (parts.evalCase.rubric.length > 0) return parts.rubric
  if (parts.evalCase.expectedFinalState) return parts.finalState
  if (parts.trace.taskSuccess !== undefined) return parts.taskSuccess
  return part(0, failure('trace_unsupported', 'Result correctness requires a result oracle, final-state contract, or task outcome evidence.'))
}

function evaluateArtifactState(parts: EvaluatorParts): EvaluationPart {
  const expected = parts.evalCase.expectedFinalState
  const expectedActions = new Set([
    ...parts.evalCase.expected.requiredActions,
    ...parts.evalCase.expected.expectedActions,
    ...parts.evalCase.expected.acceptableActions
  ])
  const independentlyVerifiedActions = (parts.trace.verifiedActionIds ?? [])
    .filter((actionId) => expectedActions.has(actionId))
  if (expected === undefined || (expected.artifacts.length === 0 && expected.dataLineage.length === 0)) {
    if (
      parts.trace.finalStateSource === 'inspector' &&
      parts.trace.verifiedDimensions?.includes('artifact_state_correctness') === true &&
      independentlyVerifiedActions.length > 0 &&
      (parts.trace.evidence?.length ?? 0) > 0 &&
      parts.trace.evidenceStatus === 'complete' &&
      !(parts.trace.unsupported?.length)
    ) {
      return part(1)
    }
    return part(0, failure('trace_unsupported', 'Artifact/state correctness requires an artifact or data-lineage contract.'))
  }
  if (parts.trace.unsupported?.length) return part(0, failure('trace_unsupported', parts.trace.unsupported.join('; ')))
  const artifactState = parts.trace.finalState && typeof parts.trace.finalState === 'object'
    ? (parts.trace.finalState as Record<string, unknown>).artifacts
    : undefined
  const lineageState = parts.trace.finalState && typeof parts.trace.finalState === 'object'
    ? (parts.trace.finalState as Record<string, unknown>).dataLineage
    : undefined
  const expectedCount = expected.artifacts.length + expected.dataLineage.length
  const observedCount = (artifactState && typeof artifactState === 'object' ? Object.keys(artifactState).length : 0) +
    (lineageState && typeof lineageState === 'object' ? Object.keys(lineageState).length : 0)
  return observedCount >= expectedCount
    ? part(1)
    : part(0, failure('final_state_mismatch', 'Expected artifact or data-lineage evidence was not observed.', expectedCount, observedCount))
}

function evaluateExpectedBehavior(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expected = evalCase.expectedBehavior
  if (!expected) return part(1)
  const observed = trace.observedBehavior ?? inferBehavior(trace, expected)
  if (!observed) return part(0, failure('trace_unsupported', `Expected behavior ${expected} was not reported by the runtime.`))
  if (observed === expected) return part(1)
  return part(0, failure('behavior_mismatch', `Expected behavior ${expected}, received ${observed}.`, expected, observed))
}

function inferBehavior(trace: EvalTrace, expected: EvalExpectedBehavior): EvalExpectedBehavior | undefined {
  const hasCalls = trace.invocations.length > 0 || (trace.toolCallDetails ?? []).length > 0
  if (!hasCalls && expected === 'no_tool') return 'no_tool'
  if (trace.taskSuccess === true && expected === 'complete') return 'complete'
  return undefined
}

function v2HardFailures(
  evalCase: EvalCase,
  dimension: EvalEvaluationDimension,
  failures: readonly EvalFailure[]
): EvalFailure[] {
  if (evalCase.taskType !== 'end_to_end' || dimension !== 'action_selection') return [...failures]
  return failures.filter((item) => item.type === 'execution_error' ||
    item.type === 'forbidden_action' ||
    item.type === 'unexpected_action' ||
    item.type === 'missing_alternative_action' ||
    item.message.startsWith('Required action '))
}

function uniqueFailures(failures: readonly EvalFailure[]): EvalFailure[] {
  const seen = new Set<string>()
  return failures.filter((item) => {
    const key = `${item.type}:${item.message}:${JSON.stringify(item.actual ?? null)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function failureStagesFor(
  failures: readonly EvalFailure[],
  trace?: Pick<EvalTrace, 'traceCollectionError'>
): EvalFailureStage[] {
  const stages = new Set<EvalFailureStage>()
  for (const item of failures) {
    if (item.type === 'wrong_domain' || item.type === 'missing_discovery') stages.add('discovery')
    else if (item.type.includes('action') || item.type === 'ordering_mismatch') stages.add('selection')
    else if (item.type === 'argument_mismatch') stages.add('arguments')
    else if (item.type.startsWith('authorization')) stages.add('authorization')
    else if (item.type.includes('invocation') || item.type === 'retry_exceeded' || item.type === 'expected_failure_mismatch') stages.add('invocation')
    else if (item.type.includes('tool')) stages.add('invocation')
    else if (item.type === 'behavior_mismatch') stages.add('behavior')
    else if (item.type === 'final_state_mismatch' || item.type === 'task_failure' || item.type === 'rubric_failure') stages.add('final_state_result')
    else if (item.type === 'execution_error') stages.add(item.message.startsWith('preflight') ? 'dataset_preflight' : 'environment_runtime_start')
    else if (item.type === 'cleanup_failure' || item.type === 'workspace_persistence_failure') stages.add('trace_collection')
    else if (item.type === 'trace_unsupported') {
      if (trace?.traceCollectionError === item.message) stages.add('trace_collection')
      else stages.add('unsupported')
    }
  }
  return [...stages]
}

export function evaluateExpectedFailure(evalCase: EvalCase, trace: EvalTrace): EvaluationPart {
  const expectation = evalCase.expectedFailure
  if (!expectation) return part(1)
  const invocations = trace.invocations.filter((invocation) => invocation.actionId === expectation.actionId)
  const matchingFailure = findExpectedFailure(invocations, expectation.errorCode)
  if (!matchingFailure) {
    if (invocations.some((invocation) => !invocationSucceeded(invocation) && !invocationFailed(invocation))) {
      return part(0, failure('trace_unsupported', `Expected ${expectation.actionId} has an invocation with unknown terminal outcome.`))
    }
    return part(0, failure(
      'expected_failure_mismatch',
      `Expected ${expectation.actionId} to report ${expectation.errorCode ?? 'a provider failure'}.`,
      expectation,
      invocations.map((invocation) => ({ outcome: invocationOutcome(invocation), errorCode: invocation.errorCode ?? null }))
    ))
  }
  const recovered = matchingFailure.sameInvocationRecovery ||
    invocations.slice(matchingFailure.invocationIndex + 1).some(invocationSucceeded)
  if (expectation.handling === 'recovered' && !recovered) {
    return part(0, failure(
      'expected_failure_mismatch',
      `Expected ${expectation.actionId} to recover after the expected failure.`,
      'failure followed by success',
      invocations.map(invocationOutcome)
    ))
  }
  if (expectation.handling === 'reported' && recovered) {
    return part(0, failure(
      'expected_failure_mismatch',
      `Expected ${expectation.actionId} failure to remain reported, but a later retry succeeded.`,
      'terminal failure',
      invocations.map(invocationOutcome)
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
    if (attempts.length === 0 && invocationFailed(invocation) &&
        (expectedErrorCode === undefined || invocation.errorCode === expectedErrorCode)) {
      return { invocationIndex, sameInvocationRecovery: false }
    }
    const failedAttemptIndex = attempts.findIndex((attempt) => (
      !attempt.success && (expectedErrorCode === undefined || attempt.errorCode === expectedErrorCode)
    ))
    if (failedAttemptIndex >= 0) {
      return {
        invocationIndex,
        sameInvocationRecovery: attempts.slice(failedAttemptIndex + 1).some((attempt) => attempt.success)
      }
    }
    if (invocationFailed(invocation) &&
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
  'cleanup_failure',
  'workspace_persistence_failure'
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
  if (invocation && invocationFailed(invocation) && isAuthorizationError(invocation.errorCode)) return 'deny'
  if (invocation && (invocationSucceeded(invocation) || invocationFailed(invocation))) return 'allow'
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
  return resolvedInvocations(actions)[0]?.actionId?.split('.')[0]
}

function domainsFromInvocations(invocations: readonly EvalInvocation[]): string[] {
  return [...new Set(resolvedInvocations(invocations).flatMap((invocation) => invocation.actionId ? [invocation.actionId.split('.')[0]] : []))]
}

function firstInvocation(invocations: readonly EvalInvocation[], actionId: string): EvalInvocation | undefined {
  return invocations.find((invocation) => invocation.actionId === actionId)
}

function lastInvocation(invocations: readonly EvalInvocation[], actionId: string): EvalInvocation | undefined {
  return [...invocations].reverse().find((invocation) => invocation.actionId === actionId)
}

function resolvedInvocations(invocations: readonly EvalInvocation[]): EvalInvocation[] {
  return invocations.filter((invocation): invocation is EvalInvocation & { actionId: string } => Boolean(invocation.actionId))
}

function invocationSucceeded(invocation: EvalInvocation): boolean {
  return invocation.outcome === 'success' || (invocation.outcome === undefined && invocation.success)
}

function invocationFailed(invocation: EvalInvocation): boolean {
  return invocation.outcome === 'failure' || (invocation.outcome === undefined && !invocation.success)
}

function invocationOutcome(invocation: EvalInvocation): 'success' | 'failure' | 'unknown' {
  if (invocation.outcome) return invocation.outcome
  return invocation.success ? 'success' : 'failure'
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
