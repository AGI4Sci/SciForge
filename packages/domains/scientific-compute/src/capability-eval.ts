import {
  DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND,
  type DomainCapabilityEvalContribution,
  type DomainCapabilityEvalFixture,
  type DomainCapabilityEvalObservedInvocation,
  type DomainCapabilityEvalOracleResult,
  type DomainCapabilityEvalRunContext
} from '@sciforge/domain-sdk/capability-eval'
import { validateScientificTraceClosure } from '@sciforge/full-trace'
import {
  SCIENTIFIC_COMPUTE_CAPABILITY_IDS,
  scientificComputeRunBaselineInputSchema,
  scientificComputeRunBaselineResultSchema,
  scientificComputeStatusResultSchema
} from './contract.js'
import { SCIENTIFIC_COMPUTE_DOMAIN_MODULE_ID } from './definition.js'

export const SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_KIND = MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND

export const SCIENTIFIC_COMPUTE_STATUS_EVAL_CASE_ID = 'scientific-compute-status-local-fixture'
export const SCIENTIFIC_COMPUTE_BASELINE_SUCCESS_EVAL_CASE_ID =
  'scientific-compute-baseline-success-local-fixture'
export const SCIENTIFIC_COMPUTE_BASELINE_BLOCKED_EVAL_CASE_ID =
  'scientific-compute-baseline-blocked-local-fixture'

const SCIENTIFIC_COMPUTE_ROUTING_PROFILES: Readonly<Record<string, string>> = Object.freeze({
  'core.compute.status': SCIENTIFIC_COMPUTE_STATUS_EVAL_CASE_ID,
  'core.compute.run': SCIENTIFIC_COMPUTE_BASELINE_SUCCESS_EVAL_CASE_ID
})

export const SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_CONTRIBUTION: DomainCapabilityEvalContribution = Object.freeze({
  moduleId: SCIENTIFIC_COMPUTE_DOMAIN_MODULE_ID,
  contractVersion: DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  actionIds: [
    SCIENTIFIC_COMPUTE_CAPABILITY_IDS.status,
    SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline
  ],
  evaluationActionIds: [
    SCIENTIFIC_COMPUTE_CAPABILITY_IDS.status,
    SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline
  ],
  prepare: prepareScientificComputeEvaluationFixture,
  inspect: inspectScientificComputeEvaluation
})

async function prepareScientificComputeEvaluationFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture | undefined> {
  const caseId = scientificComputeEvaluationCaseId(context)
  let metadata: DomainCapabilityEvalFixture['metadata']
  if (caseId === SCIENTIFIC_COMPUTE_STATUS_EVAL_CASE_ID) {
    metadata = { expectedAction: SCIENTIFIC_COMPUTE_CAPABILITY_IDS.status }
  } else if (caseId === SCIENTIFIC_COMPUTE_BASELINE_SUCCESS_EVAL_CASE_ID) {
    metadata = { expectedAction: SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline, scenario: 'success' }
  } else if (caseId === SCIENTIFIC_COMPUTE_BASELINE_BLOCKED_EVAL_CASE_ID) {
    metadata = { expectedAction: SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline, scenario: 'blocked' }
  } else {
    return undefined
  }
  return {
    fixtureId: `scientific-compute.${caseId}.v1`,
    paths: [],
    metadata
  }
}

async function inspectScientificComputeEvaluation(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult | undefined> {
  const caseId = scientificComputeEvaluationCaseId(input.context)
  if (caseId === SCIENTIFIC_COMPUTE_STATUS_EVAL_CASE_ID) {
    return inspectStatus(input.invocations)
  }
  if (caseId === SCIENTIFIC_COMPUTE_BASELINE_SUCCESS_EVAL_CASE_ID) {
    return inspectBaseline(input.invocations, 'success')
  }
  if (caseId === SCIENTIFIC_COMPUTE_BASELINE_BLOCKED_EVAL_CASE_ID) {
    return inspectBaseline(input.invocations, 'blocked')
  }
  return undefined
}

function scientificComputeEvaluationCaseId(context: DomainCapabilityEvalRunContext): string {
  return context.fixtureProfile && SCIENTIFIC_COMPUTE_ROUTING_PROFILES[context.fixtureProfile]
    ? SCIENTIFIC_COMPUTE_ROUTING_PROFILES[context.fixtureProfile]
    : context.caseId
}

function inspectStatus(
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
): DomainCapabilityEvalOracleResult {
  const invocation = invocations.find(({ actionId }) => actionId === SCIENTIFIC_COMPUTE_CAPABILITY_IDS.status)
  if (!invocation?.success) {
    return failure('Scientific Compute status did not complete successfully.')
  }
  const parsed = scientificComputeStatusResultSchema.safeParse(unwrapOutput(invocation.output))
  if (!parsed.success) return failure('Scientific Compute status output failed its package schema.')
  const expectedScenarios = ['success', 'blocked', 'rerun', 'human-interaction']
  if (parsed.data.provider !== 'local-fixture' || parsed.data.realScheduler !== false ||
      JSON.stringify(parsed.data.scenarios) !== JSON.stringify(expectedScenarios)) {
    return failure('Scientific Compute status did not report the deterministic local fixture contract.')
  }
  return {
    taskSuccess: true,
    finalState: {
      provider: parsed.data.provider,
      realScheduler: parsed.data.realScheduler,
      scenarios: parsed.data.scenarios
    },
    evidence: ['Independently validated the Scientific Compute status contract and local-fixture declaration.'],
    verifiedActions: [SCIENTIFIC_COMPUTE_CAPABILITY_IDS.status]
  }
}

function inspectBaseline(
  invocations: readonly DomainCapabilityEvalObservedInvocation[],
  expectedScenario: 'success' | 'blocked'
): DomainCapabilityEvalOracleResult {
  const invocation = invocations.find(({ actionId }) => actionId === SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline)
  if (!invocation?.success) return failure(`Scientific Compute ${expectedScenario} baseline did not complete successfully.`)
  const parsedInput = scientificComputeRunBaselineInputSchema.safeParse(invocation.args)
  const parsedOutput = scientificComputeRunBaselineResultSchema.safeParse(unwrapOutput(invocation.output))
  if (!parsedInput.success || !parsedOutput.success) {
    return failure('Scientific Compute baseline input or output failed its package schema.')
  }
  if (parsedInput.data.scenario !== expectedScenario || parsedOutput.data.scenario !== expectedScenario) {
    return failure(`Scientific Compute baseline scenario was not ${expectedScenario}.`)
  }
  const events = parseJsonl(parsedOutput.data.jsonl)
  const validation = validateScientificTraceClosure(events as never)
  const expectedState = expectedScenario === 'success' ? 'finished' : 'blocked'
  if (!parsedOutput.data.validationOk || !validation.ok || parsedOutput.data.state !== expectedState ||
      events.length !== parsedOutput.data.eventCount || parsedOutput.data.jobId.length === 0 ||
      parsedOutput.data.artifacts.length === 0) {
    return failure('Scientific Compute baseline trace, closure, state, or artifact summary failed independent verification.')
  }
  return {
    taskSuccess: true,
    finalState: {
      scenario: parsedOutput.data.scenario,
      state: parsedOutput.data.state,
      traceId: parsedOutput.data.traceId,
      jobId: parsedOutput.data.jobId,
      eventCount: events.length,
      artifactCount: parsedOutput.data.artifacts.length,
      validationOk: validation.ok
    },
    evidence: [
      `Independently parsed ${events.length} Scientific Compute trace events for ${expectedScenario}.`,
      `Validated trace closure, terminal state ${parsedOutput.data.state}, and ${parsedOutput.data.artifacts.length} artifact summary.`
    ],
    verifiedActions: [SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline]
  }
}

function unwrapOutput(output: unknown): unknown {
  if (!isRecord(output)) return output
  for (const key of ['scientificCompute', 'scientific-compute', 'result']) {
    const nested = output[key]
    if (isRecord(nested)) return nested
  }
  return output
}

function parseJsonl(value: string): unknown[] {
  return value.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as unknown)
}

function failure(message: string): DomainCapabilityEvalOracleResult {
  return { taskSuccess: false, evidence: [message], verifiedActions: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
