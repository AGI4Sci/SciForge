#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const datasetPath = path.resolve(root, 'eval-cases/capability/natural-routing-v2.jsonl')
const outputPath = path.resolve(root, 'eval-cases/capability/natural-routing-v2.eligibility.json')
const check = process.argv.includes('--check')
const { loadEvalCasesFromJsonl, createCapabilityEvalEligibilityManifest } = await import('../src/main/capability-eval/index.ts')

const datasetBytes = await readFile(datasetPath)
const cases = await loadEvalCasesFromJsonl(datasetPath)
const selectedCaseIds = [
  'routing-paper-search-protein-easy',
  'routing-paper-search-protein-natural',
  'routing-paper-profile-list-easy',
  'routing-dataset-profile-fields-easy',
  'routing-dataset-catalog-easy',
  'routing-dataset-list-easy',
  'routing-plot-status-easy',
  'routing-plot-map-data-easy',
  'routing-plot-render-natural',
  'routing-artifact-list-easy',
  'routing-artifact-list-natural',
  'routing-artifact-read-natural'
]
const manifest = createCapabilityEvalEligibilityManifest(cases, {
  datasetPath: path.relative(root, datasetPath),
  datasetSha256: createHash('sha256').update(datasetBytes).digest('hex'),
  selectedCaseIds
})

if (check) {
  const existing = JSON.parse(await readFile(outputPath, 'utf8'))
  const normalize = (value) => {
    const copy = structuredClone(value)
    delete copy.generatedAt
    return JSON.stringify(copy)
  }
  if (normalize(existing) !== normalize(manifest)) {
    throw new Error(`Eligibility manifest is stale: ${path.relative(root, outputPath)}`)
  }
  console.log(`Eligibility manifest is current: ${path.relative(root, outputPath)}`)
} else {
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${path.relative(root, outputPath)}`)
}
