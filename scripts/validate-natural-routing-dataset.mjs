#!/usr/bin/env node

/** Structural and leakage gate for the scenario-first routing dataset. */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseEvalCasesJsonl } from '../src/main/capability-eval/loader.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const datasetPath = path.resolve(root, process.argv.find((value) => value.startsWith('--dataset='))?.slice('--dataset='.length) ??
  'eval-cases/capability/natural-routing-v2.jsonl')
const reportPath = path.resolve(root, process.argv.find((value) => value.startsWith('--report='))?.slice('--report='.length) ??
  'eval-cases/capability/natural-routing-v2.validation.json')
const checkOnly = process.argv.includes('--check')

const registry = parseRegistry(await readFile(path.resolve(root, 'docs/generated/capabilities.md'), 'utf8'))
const registryActionIds = new Set(registry.actionIds)
const content = await readFile(datasetPath, 'utf8')
const cases = parseEvalCasesJsonl(content, path.relative(root, datasetPath))
const errors = []
const warnings = []
const scenarios = new Map()
const seenIds = new Set()
const leakage = []
const internalParameterNames = collectInternalParameterNames(cases)

for (const evalCase of cases) {
  if (seenIds.has(evalCase.id)) errors.push(`duplicate case id: ${evalCase.id}`)
  seenIds.add(evalCase.id)
  if (evalCase.semanticsVersion !== 'semantics-v2' || evalCase.taskType !== 'routing') {
    errors.push(`${evalCase.id}: natural routing cases must use semantics-v2 and taskType=routing`)
  }
  if (!evalCase.scenarioId || !evalCase.split || !evalCase.queryStyle || !evalCase.difficulty || !evalCase.source) {
    errors.push(`${evalCase.id}: scenarioId, split, queryStyle, difficulty and source are required`)
  }
  if (evalCase.simulation) errors.push(`${evalCase.id}: routing-v2 must not use deterministic simulation`)
  if (evalCase.expected.expectedActions.length === 0 && evalCase.expected.acceptableActions.length === 0) {
    errors.push(`${evalCase.id}: routing-v2 requires expectedActions or acceptableActions`)
  }
  for (const actionId of referencedActionIds(evalCase)) {
    if (!registryActionIds.has(actionId)) errors.push(`${evalCase.id}: hidden gold references unknown registry action ${actionId}`)
  }
  const priorSplit = scenarios.get(evalCase.scenarioId)
  if (priorSplit && priorSplit !== evalCase.split) {
    errors.push(`scenario ${evalCase.scenarioId} crosses development/holdout split`)
  }
  scenarios.set(evalCase.scenarioId, evalCase.split)

  const actionIds = registry.actionIds.filter((actionId) => includesToken(evalCase.query, actionId))
  const capabilityIds = registry.capabilityIds.filter((capabilityId) => includesToken(evalCase.query, capabilityId))
  const functionNames = registry.functionNames.filter((functionName) => includesToken(evalCase.query, functionName))
  const toolNames = ['sciforge_discover', 'sciforge_observe', 'sciforge_invoke', 'sciforge_events']
    .filter((toolName) => includesToken(evalCase.query, toolName))
  const internalTerms = findInternalTerms(evalCase.query)
  const internalParameterTerms = findInternalParameterTerms(evalCase.query, internalParameterNames, functionNames)
  const visibleFixtureTerms = findVisibleFixtureLeakage(evalCase)
  const signals = { actionIds, capabilityIds, functionNames, toolNames, internalTerms, internalParameterTerms, visibleFixtureTerms }
  const hasLeakage = Object.values(signals).some((values) => values.length > 0)
  if (hasLeakage) leakage.push({ caseId: evalCase.id, ...signals })
  if (visibleFixtureTerms.length > 0) errors.push(`${evalCase.id}: hidden gold or internal fixture terminology is visible to the Agent`)
}

const crossSplitNearDuplicates = findCrossSplitNearDuplicates(cases)
for (const duplicate of crossSplitNearDuplicates) {
  errors.push(
    `cross-split scenario leakage: ${duplicate.leftCaseId} (${duplicate.leftSplit}) and ` +
    `${duplicate.rightCaseId} (${duplicate.rightSplit}) share the same routing fixture/action and ` +
    `distinctive query terms: ${duplicate.sharedTerms.join(', ')}`
  )
}

const actionNameLeakageCases = leakage.filter((item) => item.actionIds.length > 0)
const capabilityNameLeakageCases = leakage.filter((item) => item.capabilityIds.length > 0)
const functionNameLeakageCases = leakage.filter((item) => item.functionNames.length > 0)
const internalToolNameLeakageCases = leakage.filter((item) => item.toolNames.length > 0)
const internalTerminologyLeakageCases = leakage.filter((item) => item.internalTerms.length > 0)
const internalParameterLeakageCases = leakage.filter((item) => item.internalParameterTerms.length > 0)
const report = {
  schemaVersion: 'sciforge.natural-routing-v2.validation.v1',
  dataset: path.relative(root, datasetPath),
  totalCases: cases.length,
  scenarioCount: scenarios.size,
  developmentCases: cases.filter((item) => item.split === 'development').length,
  holdoutCases: cases.filter((item) => item.split === 'holdout').length,
  actionNameLeakage: { cases: actionNameLeakageCases.length, rate: rate(actionNameLeakageCases.length, cases.length) },
  capabilityNameLeakage: { cases: capabilityNameLeakageCases.length, rate: rate(capabilityNameLeakageCases.length, cases.length) },
  internalFunctionNameLeakage: { cases: functionNameLeakageCases.length, rate: rate(functionNameLeakageCases.length, cases.length) },
  internalToolNameLeakage: { cases: internalToolNameLeakageCases.length, rate: rate(internalToolNameLeakageCases.length, cases.length) },
  internalParameterLeakage: { cases: internalParameterLeakageCases.length, rate: rate(internalParameterLeakageCases.length, cases.length) },
  internalTerminologyLeakage: { cases: internalTerminologyLeakageCases.length, rate: rate(internalTerminologyLeakageCases.length, cases.length) },
  directLeakage: { cases: leakage.length, rate: rate(leakage.length, cases.length) },
  crossSplitNearDuplicates,
  queryStyles: countBy(cases, (item) => item.queryStyle),
  difficulties: countBy(cases, (item) => item.difficulty),
  actionCoverage: countActions(cases),
  actionExpectations: {
    expectedActionCases: cases.filter((item) => item.expected.expectedActions.length > 0).length,
    acceptableActionCases: cases.filter((item) => item.expected.acceptableActions.length > 0).length,
    requiredActionCases: cases.filter((item) => item.expected.requiredActions.length > 0).length,
    expectedActions: countActionField(cases, 'expectedActions'),
    acceptableActions: countActionField(cases, 'acceptableActions'),
    requiredActions: countActionField(cases, 'requiredActions')
  },
  leakage,
  errors,
  warnings
}

if (checkOnly) {
  const expected = `${JSON.stringify(report, null, 2)}\n`
  let current
  try { current = await readFile(reportPath, 'utf8') } catch { current = undefined }
  if (current !== expected) throw new Error(`Natural routing validation report is stale. Run npm run capability:eval:natural-routing.`)
} else {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}
console.log(JSON.stringify(report, null, 2))
if (errors.length > 0 || leakage.length > 0) process.exitCode = 1

function parseRegistry(markdown) {
  const actionIds = []
  for (const line of markdown.split(/\r?\n/u)) {
    const match = /^\| `([^`]+)` \|/u.exec(line.trim())
    if (match) actionIds.push(match[1])
  }
  const capabilityIds = [...new Set(actionIds.flatMap((actionId) => {
    const segments = actionId.split('.')
    return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join('.')).filter((value) => value.includes('-'))
  }))]
  const functionNames = [...new Set(actionIds.map((actionId) => {
    const operation = actionId.split('.').at(-1) ?? ''
    const parts = operation.split('-')
    return parts.length > 1
      ? parts[0] + parts.slice(1).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
      : ''
  }).filter((value) => value.length > 0))]
  return { actionIds, capabilityIds, functionNames }
}

function includesToken(text, token) {
  return text.toLocaleLowerCase().includes(token.toLocaleLowerCase())
}

function findInternalTerms(query) {
  const terms = [
    'operationRef', 'idempotencyKey', 'runtimeId', 'requiredActions', 'acceptableActions',
    'mustDiscover', 'expectedActions', 'capability id', 'action id', 'function name',
    'sciforge_invoke', 'sciforge_discover', 'operation ref'
  ]
  const found = terms.filter((term) => includesToken(query, term))
  if (/(?:调用|使用|通过|执行|直接|call|invoke|use|execute|run).{0,80}(?:action|capability|tool|function|operation|能力|工具|函数|操作|接口)/iu.test(query)) {
    found.push('explicit-internal-invocation-cue')
  }
  return [...new Set(found)]
}

function findInternalParameterTerms(query, internalParameterNames, functionNames) {
  const terms = [
    'operationRef', 'idempotencyKey', 'runtimeId', 'requiredActions',
    'acceptableActions', 'mustDiscover', 'expectedActions', 'capability id',
    'action id', 'function name', 'operation ref'
  ]
  return [...new Set([
    ...terms.filter((term) => includesToken(query, term)),
    ...internalParameterNames.filter((term) => includesToken(query, term)),
    ...(query.match(/\b[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/gu) ?? [])
      .filter((term) => !functionNames.includes(term) && /(?:Id|Artifact|File|Path|Ref|Plan|Operation|Field|Key|Hint|Records|Count|Format|Output|K)$/u.test(term))
  ])]
}

function collectInternalParameterNames(values) {
  const contractNames = values.flatMap((evalCase) => Object.values(evalCase.expected.arguments).flatMap((expectation) => [
    ...expectation.required,
    ...Object.keys(expectation.types),
    ...Object.keys(expectation.values)
  ]))
  return [...new Set(contractNames)].filter((name) => /(?:Id|Artifact|File|Path|Ref|Plan|Operation|Field|Key|Hint|Records|Count|Format|Output|K)$/u.test(name))
}

function findVisibleFixtureLeakage(evalCase) {
  const visible = [
    ...(evalCase.fixtures?.files ?? []).map((fixture) => `${fixture.path}\n${fixture.content}`),
    evalCase.initialState === undefined ? '' : JSON.stringify(evalCase.initialState)
  ].join('\n')
  const terms = [
    ...registry.actionIds,
    'expectedActions', 'acceptableActions', 'requiredActions', 'mustDiscover',
    'operationRef', 'sciforge_invoke'
  ]
  return terms.filter((term) => includesToken(visible, term))
}

function countBy(values, selector) {
  return values.reduce((result, value) => {
    const key = selector(value) ?? 'unset'
    result[key] = (result[key] ?? 0) + 1
    return result
  }, {})
}

function countActions(values) {
  const counts = {}
  for (const item of values) {
    for (const actionId of [...item.expected.expectedActions, ...item.expected.acceptableActions]) {
      counts[actionId] = (counts[actionId] ?? 0) + 1
    }
  }
  return counts
}

function referencedActionIds(evalCase) {
  return new Set([
    ...evalCase.expected.mustDiscover,
    ...evalCase.expected.requiredActions,
    ...evalCase.expected.expectedActions,
    ...evalCase.expected.acceptableActions,
    ...evalCase.expected.alternativeActionGroups.flat(),
    ...evalCase.expected.allowedActions,
    ...evalCase.expected.forbiddenActions,
    ...Object.keys(evalCase.expected.invocation),
    ...Object.keys(evalCase.expected.arguments),
    ...Object.keys(evalCase.expected.authorization)
  ])
}

function countActionField(values, field) {
  const counts = {}
  for (const item of values) {
    for (const actionId of item.expected[field]) counts[actionId] = (counts[actionId] ?? 0) + 1
  }
  return counts
}

function findCrossSplitNearDuplicates(values) {
  const duplicates = []
  for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
    const left = values[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
      const right = values[rightIndex]
      if (!left.split || !right.split || left.split === right.split || left.scenarioId === right.scenarioId) continue
      if (left.fixtureProfile !== right.fixtureProfile) continue
      if (!sameActionTargets(left, right)) continue
      const sharedTerms = [...distinctiveQueryTerms(left.query)].filter((term) => distinctiveQueryTerms(right.query).has(term))
      if (sharedTerms.length < 2) continue
      duplicates.push({
        leftCaseId: left.id,
        leftSplit: left.split,
        rightCaseId: right.id,
        rightSplit: right.split,
        sharedTerms: sharedTerms.sort()
      })
    }
  }
  return duplicates
}

function sameActionTargets(left, right) {
  return actionTargetKey(left) === actionTargetKey(right)
}

function actionTargetKey(evalCase) {
  return JSON.stringify([...new Set([
    ...evalCase.expected.expectedActions,
    ...evalCase.expected.acceptableActions
  ])].sort())
}

function distinctiveQueryTerms(query) {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'please', 'help',
    'find', 'one', 'paper', 'record', 'research', 'look', 'want', 'give', 'tell',
    '请', '帮我', '找一篇', '找一条', '先给我', '告诉我', '相关', '方向', '工作', '研究'
  ])
  const terms = query.toLocaleLowerCase().match(/[a-z0-9-]{3,}|\d{4,}/gu) ?? []
  return new Set(terms.filter((term) => !stopWords.has(term)))
}

function rate(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4))
}
