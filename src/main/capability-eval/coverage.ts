import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CapabilityReference } from './reference'
import type { EvalCase, EvalCaseResult, EvalExecutionMode } from './schema'

export const COVERAGE_DIMENSIONS = [
  'happyPath', 'distractor', 'multiStep', 'authorization', 'expectedFailure',
  'retry', 'finalState', 'noCall', 'ambiguous', 'rubric'
] as const

export type CoverageDimension = typeof COVERAGE_DIMENSIONS[number]

export type CapabilityCoverageAction = Readonly<{
  actionId: string
  domain: string
  agentVisible: boolean
  approval: string
  effect: string
  /** Any appearance in a case contract, including forbidden/allowed lists. */
  referencedCaseCount: number
  /** Explicit positive task target; requiredActions is the current target field. */
  positiveDesignedCaseCount: number
  /** Observed in the selected execution scope with a resolved capability ID. */
  invokedCaseCount: number
  invocationSucceededCaseCount: number
  /** Independently verified by a task oracle and correlated to this action. */
  outcomeVerifiedCaseCount: number
  /** A declared boundary was actually exercised and the contract passed. */
  boundaryVerifiedCaseCount: number
  dimensions: Readonly<Record<CoverageDimension, boolean>>
}>

export type CapabilityCoverageDomain = Readonly<{
  totalActions: number
  agentVisibleActions: number
  referencedActions: number
  positiveDesignedActions: number
  invokedActions: number
  outcomeVerifiedActions: number
  caseCount: number
  caseTypeCounts: Readonly<Record<CoverageDimension, number>>
}>

export type CapabilityCoverageReport = Readonly<{
  schemaVersion: 'sciforge.capability-eval.v1'
  generatedAt: string
  capabilityReference: string
  totalDomains: number
  coveredDomains: number
  totalActions: number
  agentVisibleActions: number
  referencedActions: number
  positiveDesignedActions: number
  invokedActions: number
  invocationSucceededActions: number
  outcomeVerifiedActions: number
  boundaryVerifiedActions: number
  agentVisibleReferencedActions: number
  agentVisiblePositiveDesignedActions: number
  agentVisibleInvokedActions: number
  agentVisibleInvocationSucceededActions: number
  agentVisibleOutcomeVerifiedActions: number
  agentVisibleBoundaryVerifiedActions: number
  actionCoverageRate: number
  agentVisibleActionCoverageRate: number
  caseCount: number
  caseTypeCounts: Readonly<Record<CoverageDimension, number>>
  domains: Readonly<Record<string, CapabilityCoverageDomain>>
  actions: readonly CapabilityCoverageAction[]
  unreferencedActions: readonly string[]
  noPositiveTaskActions: readonly string[]
  positiveDesignedOnlyHappyPath: readonly string[]
  confirmationWithoutAuthorizationCoverage: readonly string[]
  withoutExpectedFailureCoverage: readonly string[]
  executionMode?: EvalExecutionMode
}>

type CaseDimensions = Record<CoverageDimension, boolean>

export function createCapabilityCoverageReport(
  cases: readonly EvalCase[],
  reference: CapabilityReference,
  options: Readonly<{
    generatedAt?: string
    executionMode?: EvalExecutionMode
    results?: readonly EvalCaseResult[]
  }> = {}
): CapabilityCoverageReport {
  const classifiedCases = cases.map((evalCase) => ({ evalCase, dimensions: classifyCase(evalCase) }))
  const resultsByCaseId = new Map((options.results ?? []).map((result) => [result.caseId, result] as const))
  const actionCases = new Map<string, Array<{ evalCase: EvalCase; dimensions: CaseDimensions }>>()
  for (const entry of classifiedCases) {
    for (const actionId of actionIdsForCoverage(entry.evalCase)) {
      const group = actionCases.get(actionId) ?? []
      group.push(entry)
      actionCases.set(actionId, group)
    }
  }

  const actions = reference.entries.map((entry) => {
    const coveredCases = actionCases.get(entry.id) ?? []
    const positiveDesignedCases = classifiedCases.filter(({ evalCase }) => positiveActionIdsForCoverage(evalCase).includes(entry.id))
    const invocationResults = [...resultsByCaseId.values()].filter((result) => (
      result.actual.invocations.some((invocation) => invocation.actionId === entry.id)
    ))
    const successfulInvocationResults = invocationResults.filter((result) => (
      result.actual.invocations.some((invocation) => invocation.actionId === entry.id && invocation.success)
    ))
    const outcomeVerifiedResults = invocationResults.filter((result) => (
      result.actual.verifiedActionIds?.includes(entry.id) === true
    ))
    const boundaryResults = classifiedCases
      .filter(({ evalCase }) => boundaryActionIdsForCoverage(evalCase).includes(entry.id))
      .map(({ evalCase }) => resultsByCaseId.get(evalCase.id))
      .filter((result): result is EvalCaseResult => result !== undefined)
      .filter((result) => result.outcome === 'PASS')
      .filter((result) => !result.tags.includes('requires-provider-fault') ||
        result.actual.faultMatches?.some((match) => match.actionId === entry.id && match.injected) === true)
    return {
      actionId: entry.id,
      domain: entry.domain,
      agentVisible: entry.audiences.includes('agent'),
      approval: entry.approval,
      effect: entry.effect,
      referencedCaseCount: coveredCases.length,
      positiveDesignedCaseCount: positiveDesignedCases.length,
      invokedCaseCount: invocationResults.length,
      invocationSucceededCaseCount: successfulInvocationResults.length,
      outcomeVerifiedCaseCount: outcomeVerifiedResults.length,
      boundaryVerifiedCaseCount: boundaryResults.length,
      dimensions: Object.fromEntries(COVERAGE_DIMENSIONS.map((dimension) => [
        dimension,
        coveredCases.some(({ dimensions }) => dimensions[dimension])
      ])) as Record<CoverageDimension, boolean>
    } satisfies CapabilityCoverageAction
  })
  const domains = buildDomainBreakdown(reference, actions, classifiedCases)
  const caseTypeCounts = countDimensions(classifiedCases.map(({ dimensions }) => dimensions))
  const agentVisibleActions = actions.filter((action) => action.agentVisible)
  const countActions = (field: keyof Pick<CapabilityCoverageAction,
    'referencedCaseCount' | 'positiveDesignedCaseCount' | 'invokedCaseCount' |
    'invocationSucceededCaseCount' | 'outcomeVerifiedCaseCount' | 'boundaryVerifiedCaseCount'>): number => (
    actions.filter((action) => action[field] > 0).length
  )
  const countAgentActions = (field: keyof Pick<CapabilityCoverageAction,
    'referencedCaseCount' | 'positiveDesignedCaseCount' | 'invokedCaseCount' |
    'invocationSucceededCaseCount' | 'outcomeVerifiedCaseCount' | 'boundaryVerifiedCaseCount'>): number => (
    agentVisibleActions.filter((action) => action[field] > 0).length
  )

  return {
    schemaVersion: 'sciforge.capability-eval.v1',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    capabilityReference: reference.source,
    totalDomains: Object.keys(domains).length,
    coveredDomains: Object.values(domains).filter((domain) => domain.referencedActions > 0).length,
    totalActions: actions.length,
    agentVisibleActions: agentVisibleActions.length,
    referencedActions: countActions('referencedCaseCount'),
    positiveDesignedActions: countActions('positiveDesignedCaseCount'),
    invokedActions: countActions('invokedCaseCount'),
    invocationSucceededActions: countActions('invocationSucceededCaseCount'),
    outcomeVerifiedActions: countActions('outcomeVerifiedCaseCount'),
    boundaryVerifiedActions: countActions('boundaryVerifiedCaseCount'),
    agentVisibleReferencedActions: countAgentActions('referencedCaseCount'),
    agentVisiblePositiveDesignedActions: countAgentActions('positiveDesignedCaseCount'),
    agentVisibleInvokedActions: countAgentActions('invokedCaseCount'),
    agentVisibleInvocationSucceededActions: countAgentActions('invocationSucceededCaseCount'),
    agentVisibleOutcomeVerifiedActions: countAgentActions('outcomeVerifiedCaseCount'),
    agentVisibleBoundaryVerifiedActions: countAgentActions('boundaryVerifiedCaseCount'),
    actionCoverageRate: actions.length === 0 ? 0 : countActions('positiveDesignedCaseCount') / actions.length,
    agentVisibleActionCoverageRate: agentVisibleActions.length === 0 ? 0 : countAgentActions('positiveDesignedCaseCount') / agentVisibleActions.length,
    caseCount: cases.length,
    caseTypeCounts,
    domains,
    actions,
    unreferencedActions: actions.filter((action) => action.referencedCaseCount === 0).map((action) => action.actionId),
    noPositiveTaskActions: actions.filter((action) => action.positiveDesignedCaseCount === 0).map((action) => action.actionId),
    positiveDesignedOnlyHappyPath: actions.filter((action) => action.positiveDesignedCaseCount > 0 && action.dimensions.happyPath &&
      !COVERAGE_DIMENSIONS.filter((dimension) => dimension !== 'happyPath').some((dimension) => action.dimensions[dimension])).map((action) => action.actionId),
    confirmationWithoutAuthorizationCoverage: actions.filter((action) => action.approval !== 'none' && !action.dimensions.authorization).map((action) => action.actionId),
    withoutExpectedFailureCoverage: actions.filter((action) => !action.dimensions.expectedFailure).map((action) => action.actionId),
    ...(options.executionMode ? { executionMode: options.executionMode } : {})
  }
}

export async function writeCapabilityCoverageReport(
  report: CapabilityCoverageReport,
  outputDirectory: string
): Promise<Readonly<{ jsonPath: string; markdownPath: string }>> {
  const directory = resolve(outputDirectory)
  await mkdir(directory, { recursive: true })
  const jsonPath = resolve(directory, 'coverage.json')
  const markdownPath = resolve(directory, 'coverage.md')
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, renderCapabilityCoverageMarkdown(report), 'utf8')
  return { jsonPath, markdownPath }
}

export function renderCapabilityCoverageMarkdown(report: CapabilityCoverageReport): string {
  const domainRows = Object.entries(report.domains).map(([domain, value]) => (
    `| ${domain} | ${value.totalActions} | ${value.agentVisibleActions} | ${value.positiveDesignedActions} | ${value.invokedActions} | ${value.outcomeVerifiedActions} | ${value.caseCount} |`
  )).join('\n')
  const actionRows = report.actions.map((action) => (
    `| ${action.actionId} | ${action.domain} | ${action.agentVisible ? 'yes' : 'no'} | ${action.referencedCaseCount} | ${action.positiveDesignedCaseCount} | ${action.invokedCaseCount} | ${action.invocationSucceededCaseCount} | ${action.outcomeVerifiedCaseCount} | ${action.boundaryVerifiedCaseCount} | ${dimensionsFor(action).join(', ') || '—'} |`
  )).join('\n')
  return `# Capability Coverage

Generated: ${report.generatedAt}

Reference: ${report.capabilityReference}

## Summary

- Cases: ${report.caseCount}
- Domains: ${report.coveredDomains}/${report.totalDomains} covered
- Registry actions: ${report.totalActions}
- Agent-visible actions: ${report.agentVisibleActions}
- Referenced actions: ${report.referencedActions}/${report.totalActions}
- Positive task design: ${report.positiveDesignedActions}/${report.totalActions} (${percent(report.actionCoverageRate)})
- Observed invocations: ${report.invokedActions}/${report.totalActions}
- Successful invocations: ${report.invocationSucceededActions}/${report.totalActions}
- Independently verified outcomes: ${report.outcomeVerifiedActions}/${report.totalActions}
- Verified boundaries: ${report.boundaryVerifiedActions}/${report.totalActions}
- Agent-visible positive task design: ${report.agentVisiblePositiveDesignedActions}/${report.agentVisibleActions} (${percent(report.agentVisibleActionCoverageRate)})
- Agent-visible observed invocations: ${report.agentVisibleInvokedActions}/${report.agentVisibleActions}
- Agent-visible independently verified outcomes: ${report.agentVisibleOutcomeVerifiedActions}/${report.agentVisibleActions}

## Case-type coverage

| Dimension | Cases |
| --- | ---: |
${COVERAGE_DIMENSIONS.map((dimension) => `| ${dimension} | ${report.caseTypeCounts[dimension]} |`).join('\n')}

## Domain coverage

| Domain | Registry actions | Agent-visible | Positive design | Invoked | Outcome verified | Cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${domainRows}

## Action coverage matrix

| Action | Domain | Agent-visible | Referenced | Positive design | Invoked | Invocation success | Outcome verified | Boundary verified | Dimensions |
| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${actionRows}

## Gaps

### Unreferenced actions

${report.unreferencedActions.map((actionId) => `- ${actionId}`).join('\n') || '- None'}

### Actions without positive task design

${report.noPositiveTaskActions.map((actionId) => `- ${actionId}`).join('\n') || '- None'}

### Positive tasks with happy-path-only coverage

${report.positiveDesignedOnlyHappyPath.map((actionId) => `- ${actionId}`).join('\n') || '- None'}

### Confirmation actions without authorization coverage

${report.confirmationWithoutAuthorizationCoverage.map((actionId) => `- ${actionId}`).join('\n') || '- None'}

### Actions without expected-failure coverage

${report.withoutExpectedFailureCoverage.map((actionId) => `- ${actionId}`).join('\n') || '- None'}
`
}

function classifyCase(evalCase: EvalCase): CaseDimensions {
  const tags = new Set(evalCase.tags.map((tag) => tag.toLowerCase()))
  const hasTag = (...values: string[]) => values.some((value) => tags.has(value))
  const hasNonHappyDimension = [
    hasTag('distractor'),
    hasTag('multi-step', 'multi_step'),
    hasTag('authorization', 'approval'),
    Boolean(evalCase.expectedFailure) || hasTag('expected-failure', 'expected_failure', 'invocation-failure'),
    hasTag('retry') || evalCase.simulation?.calls.some((call) => call.retryCount > 0) === true,
    Boolean(evalCase.expectedFinalState) || hasTag('final-state', 'final_state'),
    hasTag('no-call', 'no_call', 'no-unnecessary-action'),
    hasTag('ambiguous'),
    evalCase.rubric.length > 0 || hasTag('rubric')
  ].some(Boolean)
  return {
    happyPath: hasTag('happy-path', 'happy_path') || !hasNonHappyDimension,
    distractor: hasTag('distractor'),
    multiStep: hasTag('multi-step', 'multi_step') || new Set(evalCase.expected.requiredActions).size > 1 ||
      new Set(evalCase.simulation?.calls.map((call) => call.actionId) ?? []).size > 1,
    authorization: hasTag('authorization', 'approval') || Object.values(evalCase.expected.authorization).some((value) => value !== 'allow'),
    expectedFailure: Boolean(evalCase.expectedFailure) || hasTag('expected-failure', 'expected_failure', 'invocation-failure') ||
      Object.values(evalCase.expected.invocation).some((invocation) => !invocation.success),
    retry: hasTag('retry') || evalCase.simulation?.calls.some((call) => call.retryCount > 0) === true,
    finalState: Boolean(evalCase.expectedFinalState) || hasTag('final-state', 'final_state'),
    noCall: evalCase.expected.noCapabilityCalls === true || hasTag('no-call', 'no_call', 'no-unnecessary-action') ||
      (evalCase.expected.requiredActions.length === 0 && (evalCase.simulation?.calls.length ?? 0) === 0),
    ambiguous: hasTag('ambiguous'),
    rubric: evalCase.rubric.length > 0 || hasTag('rubric')
  }
}

function actionIdsForCoverage(evalCase: EvalCase): readonly string[] {
  return [...new Set([
    ...evalCase.expected.mustDiscover,
    ...evalCase.expected.requiredActions,
    ...evalCase.expected.expectedActions,
    ...evalCase.expected.acceptableActions,
    ...evalCase.expected.alternativeActionGroups.flat(),
    ...evalCase.expected.allowedActions,
    ...evalCase.expected.forbiddenActions,
    ...Object.keys(evalCase.expected.authorization),
    ...Object.keys(evalCase.expected.invocation),
    ...Object.keys(evalCase.expected.arguments),
    ...evalCase.expected.ordering.flatMap((constraint) => [constraint.before, constraint.after]),
    ...(evalCase.expectedFailure ? [evalCase.expectedFailure.actionId] : []),
    ...(evalCase.simulation?.discoveries.flatMap((entry) => entry.actions) ?? []),
    ...(evalCase.simulation?.authorizationEvents.map((entry) => entry.actionId) ?? []),
    ...(evalCase.simulation?.calls.map((call) => call.actionId) ?? [])
  ])]
}

function positiveActionIdsForCoverage(evalCase: EvalCase): readonly string[] {
  return [...new Set([
    ...evalCase.expected.requiredActions,
    ...evalCase.expected.expectedActions,
    ...evalCase.expected.acceptableActions
  ])]
}

function boundaryActionIdsForCoverage(evalCase: EvalCase): readonly string[] {
  const boundaryActions = [
    ...(evalCase.expectedFailure ? [evalCase.expectedFailure.actionId] : []),
    ...Object.entries(evalCase.expected.authorization)
      .filter(([, authorization]) => authorization === 'deny')
      .map(([actionId]) => actionId),
    ...Object.entries(evalCase.expected.invocation)
      .filter(([, invocation]) => !invocation.success)
      .map(([actionId]) => actionId)
  ]
  return [...new Set(boundaryActions)]
}

function buildDomainBreakdown(
  reference: CapabilityReference,
  actions: readonly CapabilityCoverageAction[],
  classifiedCases: readonly { evalCase: EvalCase; dimensions: CaseDimensions }[]
): Readonly<Record<string, CapabilityCoverageDomain>> {
  const domains = new Set(reference.entries.map((entry) => entry.domain))
  return Object.fromEntries([...domains].sort().map((domain) => {
    const domainActions = actions.filter((action) => action.domain === domain)
    const domainCases = classifiedCases.filter(({ evalCase }) => actionIdsForCoverage(evalCase).some((actionId) => actionId.startsWith(`${domain}.`)))
    return [domain, {
      totalActions: domainActions.length,
      agentVisibleActions: domainActions.filter((action) => action.agentVisible).length,
      referencedActions: domainActions.filter((action) => action.referencedCaseCount > 0).length,
      positiveDesignedActions: domainActions.filter((action) => action.positiveDesignedCaseCount > 0).length,
      invokedActions: domainActions.filter((action) => action.invokedCaseCount > 0).length,
      outcomeVerifiedActions: domainActions.filter((action) => action.outcomeVerifiedCaseCount > 0).length,
      caseCount: domainCases.length,
      caseTypeCounts: countDimensions(domainCases.map(({ dimensions }) => dimensions))
    } satisfies CapabilityCoverageDomain]
  }))
}

function countDimensions(dimensions: readonly CaseDimensions[]): Record<CoverageDimension, number> {
  return Object.fromEntries(COVERAGE_DIMENSIONS.map((dimension) => [
    dimension,
    dimensions.filter((entry) => entry[dimension]).length
  ])) as Record<CoverageDimension, number>
}

function dimensionsFor(action: CapabilityCoverageAction): string[] {
  return COVERAGE_DIMENSIONS.filter((dimension) => action.dimensions[dimension])
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
