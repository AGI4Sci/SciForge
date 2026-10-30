#!/usr/bin/env node

/** Validate the Chinese core user-task dataset and its agent-visible boundary. */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parseEvalCasesJsonl } from '../src/main/capability-eval/loader.ts'

const root = process.cwd()
const datasetPath = path.resolve(root, 'eval-cases/capability/core-scenarios-v1.jsonl')
const cases = parseEvalCasesJsonl(await readFile(datasetPath, 'utf8'), path.relative(root, datasetPath))
const errors = []
const actionIds = new Set()
const blockedContextCases = []

for (const evalCase of cases) {
  for (const actionId of [
    ...evalCase.expected.mustDiscover,
    ...evalCase.expected.requiredActions,
    ...evalCase.expected.expectedActions,
    ...evalCase.expected.acceptableActions,
    ...evalCase.expected.allowedActions,
    ...evalCase.expected.forbiddenActions,
    ...Object.keys(evalCase.expected.authorization),
    ...Object.keys(evalCase.expected.invocation),
    ...Object.keys(evalCase.expected.arguments)
  ]) actionIds.add(actionId)
}

for (const evalCase of cases) {
  if (evalCase.queryLanguage !== 'zh-CN') {
    errors.push(`${evalCase.id}: core cases must declare queryLanguage=zh-CN`)
  }
  if (!/[\u3400-\u9fff]/u.test(evalCase.query)) {
    errors.push(`${evalCase.id}: query must contain Chinese user-facing language`)
  }
  const contextContract = evalCase.contextContract
  if (!contextContract) {
    errors.push(`${evalCase.id}: contextContract is required`)
  } else {
    if (!contextContract.visibleInputs.includes('query')) {
      errors.push(`${evalCase.id}: contextContract.visibleInputs must include query`)
    }
    if (contextContract.mode === 'clarification' && evalCase.expectedBehavior !== 'clarify') {
      errors.push(`${evalCase.id}: clarification context must expect clarify behavior`)
    }
    if (contextContract.mode === 'workspace' && !hasDeclaredContextSource(evalCase)) {
      if (contextContract.missingContextBehavior !== 'blocked') {
        errors.push(`${evalCase.id}: workspace case without fixture/profile/state must declare missingContextBehavior=blocked`)
      } else {
        blockedContextCases.push(evalCase.id)
      }
    }
  }

  const internalTerms = [
    ...[...actionIds].filter((actionId) => includesToken(evalCase.query, actionId)),
    ...['expectedFinalState', 'requiredActions', 'acceptableActions', 'mustDiscover', 'operationRef',
      'idempotencyKey', 'sciforge_invoke', 'sciforge_discover', 'capability id', 'action id']
      .filter((term) => includesToken(evalCase.query, term))
  ]
  if (internalTerms.length > 0) {
    errors.push(`${evalCase.id}: query exposes evaluator/tool terminology: ${[...new Set(internalTerms)].join(', ')}`)
  }

  const goldStrings = collectGoldStrings(evalCase.expectedFinalState)
  const leakedGoldStrings = goldStrings.filter((value) => includesToken(evalCase.query, value))
  if (leakedGoldStrings.length > 0) {
    errors.push(`${evalCase.id}: query contains final-state gold values: ${leakedGoldStrings.join(', ')}`)
  }
}

if (cases.length !== 24) errors.push(`expected 24 core cases, found ${cases.length}`)
if (new Set(cases.map((evalCase) => evalCase.id)).size !== cases.length) errors.push('core case IDs must be unique')

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Core capability eval dataset is valid: ${cases.length} Chinese cases; ${blockedContextCases.length} cases explicitly block when workspace context is unavailable; hidden final-state assertions remain evaluator-side.`)
}

function includesToken(text, token) {
  return text.toLocaleLowerCase().includes(token.toLocaleLowerCase())
}

function collectGoldStrings(finalState) {
  if (!finalState) return []
  const values = []
  for (const assertion of finalState.assertions ?? []) {
    if (typeof assertion.value === 'string' && assertion.value.trim().length >= 4) values.push(assertion.value)
  }
  return [...new Set(values)]
}

function hasDeclaredContextSource(evalCase) {
  return Boolean(
    evalCase.fixtureProfile
    || evalCase.initialState !== undefined
    || (evalCase.fixtures?.files?.length ?? 0) > 0
    || (evalCase.priorTurns?.length ?? 0) > 0
  )
}
