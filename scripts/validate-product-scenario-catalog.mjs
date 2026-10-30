#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const catalogPath = path.join(root, 'eval-cases/capability/product-scenario-catalog.json')
const casesPath = path.join(root, 'eval-cases/capability/core-scenarios-v1.jsonl')
const referencePath = path.join(root, 'docs/generated/capabilities.md')

const { loadEvalCasesFromJsonl, parseCapabilityReferenceMarkdown } = await import('../src/main/capability-eval/index.ts')

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
const cases = await loadEvalCasesFromJsonl(casesPath)
const reference = parseCapabilityReferenceMarkdown(await readFile(referencePath, 'utf8'), referencePath)
const failures = []
const catalogRows = catalog.scenarios ?? []
const caseById = new Map(cases.map((evalCase) => [evalCase.id, evalCase]))
const referenceIds = new Set(reference.entries.map((entry) => entry.id))

if (catalog.schemaVersion !== 'sciforge.product-scenario-catalog.v1') failures.push('catalog schemaVersion is not v1')
if (catalogRows.length !== 24) failures.push(`expected exactly 24 catalog scenarios, found ${catalogRows.length}`)
if (new Set(catalogRows.map((entry) => entry.scenarioId)).size !== catalogRows.length) failures.push('catalog scenarioId values must be unique')
if (new Set(cases.map((evalCase) => evalCase.id)).size !== cases.length) failures.push('core case IDs must be unique')
if (cases.length !== 24) failures.push(`expected exactly 24 core cases, found ${cases.length}`)

for (const entry of catalogRows) {
  if (!Array.isArray(entry.requiredDimensions) || !entry.requiredDimensions.includes('runtime')) {
    failures.push(`${entry.scenarioId}: requiredDimensions must include runtime`)
  }
  if (!Array.isArray(entry.caseIds) || entry.caseIds.length === 0) {
    failures.push(`${entry.scenarioId}: catalog entry has no caseIds`)
  }
  for (const caseId of entry.caseIds ?? []) {
    const evalCase = caseById.get(caseId)
    if (!evalCase) {
      failures.push(`${entry.scenarioId}: missing core case ${caseId}`)
      continue
    }
    if (evalCase.scenarioId !== entry.scenarioId) failures.push(`${caseId}: scenarioId does not match ${entry.scenarioId}`)
    if (evalCase.simulation) failures.push(`${caseId}: simulation is forbidden for core live acceptance cases`)
    const actionIds = [
      ...evalCase.expected.mustDiscover,
      ...evalCase.expected.requiredActions,
      ...Object.keys(evalCase.expected.authorization),
      ...Object.keys(evalCase.expected.invocation),
      ...evalCase.expected.ordering.flatMap((constraint) => [constraint.before, constraint.after])
    ]
    for (const actionId of new Set(actionIds)) {
      if (!referenceIds.has(actionId)) failures.push(`${caseId}: unknown capability action ${actionId}`)
    }
  }
}

for (const evalCase of cases) {
  if (!catalogRows.some((entry) => entry.caseIds?.includes(evalCase.id))) {
    failures.push(`${evalCase.id}: not referenced by the product scenario catalog`)
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Product scenario catalog is valid: ${catalogRows.length} scenarios, ${cases.length} core cases, ${referenceIds.size} referenced capabilities.`)
}
