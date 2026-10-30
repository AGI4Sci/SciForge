#!/usr/bin/env node

/** Validate conversation-context cases without exposing hidden evaluator gold. */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parseEvalCasesJsonl } from '../src/main/capability-eval/loader.ts'

const root = process.cwd()
const datasetPath = path.resolve(root, 'eval-cases/capability/contextual-scenarios-v1.jsonl')
const cases = parseEvalCasesJsonl(await readFile(datasetPath, 'utf8'), path.relative(root, datasetPath))
const errors = []
const actionIds = new Set()

for (const evalCase of cases) {
  for (const actionId of [
    ...evalCase.expected.mustDiscover,
    ...evalCase.expected.requiredActions,
    ...evalCase.expected.expectedActions,
    ...evalCase.expected.acceptableActions
  ]) actionIds.add(actionId)
  if (evalCase.queryLanguage !== 'zh-CN') errors.push(`${evalCase.id}: queryLanguage must be zh-CN`)
  if (evalCase.split !== 'development') errors.push(`${evalCase.id}: contextual cases must be development cases before live baseline`) 
  if (evalCase.simulation) errors.push(`${evalCase.id}: contextual cases must not use simulation`)
  if (evalCase.contextContract?.mode !== 'conversation') errors.push(`${evalCase.id}: contextContract.mode must be conversation`)
  if ((evalCase.priorTurns?.length ?? 0) < 1) errors.push(`${evalCase.id}: at least one prior turn is required`)
  if (evalCase.contextContract?.requiredTurns !== (evalCase.priorTurns?.length ?? 0) + 1) {
    errors.push(`${evalCase.id}: requiredTurns must equal priorTurns.length + 1`)
  }
  const forbiddenTerms = [
    ...[...actionIds],
    'expectedFinalState', 'requiredActions', 'mustDiscover', 'operationRef', 'idempotencyKey',
    'sciforge_invoke', 'sciforge_discover', 'capability id', 'action id'
  ].filter((term) => evalCase.query.toLocaleLowerCase().includes(term.toLocaleLowerCase()))
  if (forbiddenTerms.length > 0) {
    errors.push(`${evalCase.id}: target query exposes internal evaluator/tool terms: ${[...new Set(forbiddenTerms)].join(', ')}`)
  }
}

if (cases.length === 0) errors.push('contextual dataset must contain at least one case')
if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Contextual capability eval dataset is valid: ${cases.length} conversation cases; no simulation declared.`)
}
