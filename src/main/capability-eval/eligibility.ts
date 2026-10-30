import type { EvalCase } from './schema'

export const CAPABILITY_EVAL_ELIGIBILITY_SCHEMA_VERSION = 'sciforge.capability-eval.eligibility.v1' as const

export type EvalEligibilityStatus = 'eligible' | 'dataset_issue' | 'environment_blocked'

export type EvalEligibilityReason = Readonly<{
  code: string
  message: string
  evidence?: string
}>

export type EvalEligibilityRecord = Readonly<{
  caseId: string
  scenarioId?: string
  split: EvalCase['split']
  domains: string[]
  status: EvalEligibilityStatus
  reasons: EvalEligibilityReason[]
  oracleSource: 'package-owned-contribution' | 'case-owned-fixture' | 'none'
  livePreflightStatus: 'pending'
}>

export type EvalEligibilityManifest = Readonly<{
  schemaVersion: typeof CAPABILITY_EVAL_ELIGIBILITY_SCHEMA_VERSION
  generatedAt: string
  dataset: Readonly<{
    path: string
    sha256: string
    caseCount: number
  }>
  policy: Readonly<{
    candidateSplit: 'development'
    simulationIsNeverLiveEvidence: true
    selectedCaseIds: string[]
  }>
  cases: EvalEligibilityRecord[]
  counts: Readonly<Record<EvalEligibilityStatus, number>>
}>

export function createCapabilityEvalEligibilityManifest(
  cases: readonly EvalCase[],
  input: Readonly<{
    datasetPath: string
    datasetSha256: string
    selectedCaseIds: readonly string[]
  }>
): EvalEligibilityManifest {
  const records = cases.map((evalCase) => classifyCase(evalCase))
  const byId = new Map(records.map((record) => [record.caseId, record]))
  const selectedCaseIds = [...new Set(input.selectedCaseIds)].filter((caseId) => (
    byId.get(caseId)?.status === 'eligible' && byId.get(caseId)?.split === 'development'
  ))
  const counts = {
    eligible: records.filter((record) => record.status === 'eligible').length,
    dataset_issue: records.filter((record) => record.status === 'dataset_issue').length,
    environment_blocked: records.filter((record) => record.status === 'environment_blocked').length
  } as const
  return {
    schemaVersion: CAPABILITY_EVAL_ELIGIBILITY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    dataset: {
      path: input.datasetPath,
      sha256: input.datasetSha256,
      caseCount: cases.length
    },
    policy: {
      candidateSplit: 'development',
      simulationIsNeverLiveEvidence: true,
      selectedCaseIds
    },
    cases: records,
    counts
  }
}

function classifyCase(evalCase: EvalCase): EvalEligibilityRecord {
  const reasons: EvalEligibilityReason[] = []
  const actionIds = new Set([
    ...evalCase.expected.mustDiscover,
    ...evalCase.expected.expectedActions,
    ...evalCase.expected.acceptableActions,
    ...evalCase.expected.requiredActions
  ])
  const serializedQuery = evalCase.query.toLowerCase()
  const leakedAction = [...actionIds].find((actionId) => serializedQuery.includes(actionId.toLowerCase()))
  if (leakedAction) {
    reasons.push({
      code: 'gold_in_query',
      message: 'The natural-language query contains a gold capability ID.',
      evidence: leakedAction
    })
  }
  if (evalCase.simulation) {
    reasons.push({
      code: 'simulation_declared',
      message: 'The case declares a deterministic simulation; it cannot be used as live evidence.'
    })
  }
  if (evalCase.split !== 'development') {
    reasons.push({
      code: 'not_development_split',
      message: 'Holdout cases are not eligible for G0.'
    })
  }
  if (evalCase.expected.expectedActions.length === 0 && evalCase.expected.acceptableActions.length === 0) {
    reasons.push({
      code: 'missing_action_gold',
      message: 'The case has neither expectedActions nor acceptableActions.'
    })
  }
  const expectedArgumentKeys = Object.values(evalCase.expected.arguments).flatMap((expectation) => Object.keys(expectation.values))
  if (expectedArgumentKeys.includes('planId') && evalCase.fixtureProfile?.includes('.filter')) {
    reasons.push({
      code: 'fixture_plan_leakage',
      message: 'The fixture profile pre-seeds a plan identifier that is also part of the live argument contract.'
    })
  }
  const hasOracle = Boolean(evalCase.fixtureProfile) || Boolean(evalCase.fixtures?.files.length)
  if (!hasOracle) {
    reasons.push({
      code: 'missing_live_oracle_source',
      message: 'No package-owned fixture profile or case-owned workspace fixture is declared.'
    })
  }
  const contextContract = evalCase.contextContract
  const hasDeclaredContextSource = Boolean(
    evalCase.fixtureProfile ||
    evalCase.fixtures?.files.length ||
    evalCase.initialState !== undefined ||
    evalCase.priorTurns?.length
  )
  if (contextContract?.mode === 'workspace' && !hasDeclaredContextSource) {
    reasons.push({
      code: 'missing_context_source',
      message: 'The task refers to workspace state but declares no fixture, initial state, or prior context turns.'
    })
  }
  const datasetIssue = reasons.some((reason) => [
    'gold_in_query',
    'simulation_declared',
    'not_development_split',
    'missing_action_gold',
    'fixture_plan_leakage',
    'missing_live_oracle_source',
    'missing_context_source'
  ].includes(reason.code))
  const environmentBlocked = !datasetIssue && reasons.length > 0
  return {
    caseId: evalCase.id,
    ...(evalCase.scenarioId ? { scenarioId: evalCase.scenarioId } : {}),
    split: evalCase.split,
    domains: evalCase.expected.domain ? [evalCase.expected.domain] : [],
    status: datasetIssue ? 'dataset_issue' : environmentBlocked ? 'environment_blocked' : 'eligible',
    reasons,
    oracleSource: evalCase.fixtureProfile
      ? 'package-owned-contribution'
      : evalCase.fixtures?.files.length
        ? 'case-owned-fixture'
        : 'none',
    livePreflightStatus: 'pending'
  }
}
