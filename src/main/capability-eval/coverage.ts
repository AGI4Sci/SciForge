import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CapabilityReference } from './reference'
import type { EvalCase } from './schema'

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
  coveredCount: number
  dimensions: Readonly<Record<CoverageDimension, boolean>>
}>

export type CapabilityCoverageDomain = Readonly<{
  totalActions: number
  agentVisibleActions: number
  coveredActions: number
  agentVisibleCoveredActions: number
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
  coveredActions: number
  agentVisibleCoveredActions: number
  actionCoverageRate: number
  agentVisibleActionCoverageRate: number
  caseCount: number
  caseTypeCounts: Readonly<Record<CoverageDimension, number>>
  domains: Readonly<Record<string, CapabilityCoverageDomain>>
  actions: readonly CapabilityCoverageAction[]
  uncoveredActions: readonly string[]
  onlyHappyPath: readonly string[]
  noAuthorizationCoverage: readonly string[]
  noFailureCoverage: readonly string[]
}>

type CaseDimensions = Record<CoverageDimension, boolean>

export function createCapabilityCoverageReport(
  cases: readonly EvalCase[],
  reference: CapabilityReference,
  options: Readonly<{ generatedAt?: string }> = {}
): CapabilityCoverageReport {
  const classifiedCases = cases.map((evalCase) => ({ evalCase, dimensions: classifyCase(evalCase) }))
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
    return {
      actionId: entry.id,
      domain: entry.domain,
      agentVisible: entry.audiences.includes('agent'),
      approval: entry.approval,
      effect: entry.effect,
      coveredCount: coveredCases.length,
      dimensions: Object.fromEntries(COVERAGE_DIMENSIONS.map((dimension) => [
        dimension,
        coveredCases.some(({ dimensions }) => dimensions[dimension])
      ])) as Record<CoverageDimension, boolean>
    } satisfies CapabilityCoverageAction
  })
  const domains = buildDomainBreakdown(reference, actions, classifiedCases)
  const caseTypeCounts = countDimensions(classifiedCases.map(({ dimensions }) => dimensions))
  const agentVisibleActions = actions.filter((action) => action.agentVisible)
  const coveredActions = actions.filter((action) => action.coveredCount > 0)
  const coveredAgentActions = agentVisibleActions.filter((action) => action.coveredCount > 0)

  return {
    schemaVersion: 'sciforge.capability-eval.v1',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    capabilityReference: reference.source,
    totalDomains: Object.keys(domains).length,
    coveredDomains: Object.values(domains).filter((domain) => domain.coveredActions > 0).length,
    totalActions: actions.length,
    agentVisibleActions: agentVisibleActions.length,
    coveredActions: coveredActions.length,
    agentVisibleCoveredActions: coveredAgentActions.length,
    actionCoverageRate: actions.length === 0 ? 0 : coveredActions.length / actions.length,
    agentVisibleActionCoverageRate: agentVisibleActions.length === 0 ? 0 : coveredAgentActions.length / agentVisibleActions.length,
    caseCount: cases.length,
    caseTypeCounts,
    domains,
    actions,
    uncoveredActions: actions.filter((action) => action.coveredCount === 0).map((action) => action.actionId),
    onlyHappyPath: actions.filter((action) => action.coveredCount > 0 && action.dimensions.happyPath &&
      !COVERAGE_DIMENSIONS.filter((dimension) => dimension !== 'happyPath').some((dimension) => action.dimensions[dimension])).map((action) => action.actionId),
    noAuthorizationCoverage: actions.filter((action) => action.approval !== 'none' && !action.dimensions.authorization).map((action) => action.actionId),
    noFailureCoverage: actions.filter((action) => !action.dimensions.expectedFailure).map((action) => action.actionId)
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
    `| ${domain} | ${value.totalActions} | ${value.agentVisibleActions} | ${value.coveredActions} | ${value.agentVisibleCoveredActions} | ${value.caseCount} |`
  )).join('\n')
  const actionRows = report.actions.map((action) => (
    `| ${action.actionId} | ${action.domain} | ${action.agentVisible ? 'yes' : 'no'} | ${dimensionsFor(action).join(', ') || '—'} | ${action.coveredCount} |`
  )).join('\n')
  return `# Capability Coverage

Generated: ${report.generatedAt}

Reference: ${report.capabilityReference}

## Summary

- Cases: ${report.caseCount}
- Domains: ${report.coveredDomains}/${report.totalDomains} covered
- Actions: ${report.coveredActions}/${report.totalActions} covered (${percent(report.actionCoverageRate)})
- Agent-visible actions: ${report.agentVisibleCoveredActions}/${report.agentVisibleActions} covered (${percent(report.agentVisibleActionCoverageRate)})

## Case-type coverage

| Dimension | Cases |
| --- | ---: |
${COVERAGE_DIMENSIONS.map((dimension) => `| ${dimension} | ${report.caseTypeCounts[dimension]} |`).join('\n')}

## Domain coverage

| Domain | Registry actions | Agent-visible | Covered | Agent-visible covered | Cases |
| --- | ---: | ---: | ---: | ---: | ---: |
${domainRows}

## Action coverage matrix

| Action | Domain | Agent-visible | Covered dimensions | Covered count |
| --- | --- | :---: | --- | ---: |
${actionRows}

## Gaps

### Uncovered actions

${report.uncoveredActions.map((actionId) => `- ${actionId}`).join('\n') || '- None'}

### Only happy-path coverage

${report.onlyHappyPath.map((actionId) => `- ${actionId}`).join('\n') || '- None'}

### Confirmation actions without authorization coverage

${report.noAuthorizationCoverage.map((actionId) => `- ${actionId}`).join('\n') || '- None'}

### Actions without expected-failure coverage

${report.noFailureCoverage.map((actionId) => `- ${actionId}`).join('\n') || '- None'}
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
      coveredActions: domainActions.filter((action) => action.coveredCount > 0).length,
      agentVisibleCoveredActions: domainActions.filter((action) => action.agentVisible && action.coveredCount > 0).length,
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
