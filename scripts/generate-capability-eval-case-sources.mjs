#!/usr/bin/env node

import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const capabilityDir = path.join(root, 'eval-cases', 'capability')
const legacyPath = path.join(capabilityDir, 'golden.jsonl')
const integrationPath = path.join(capabilityDir, 'integration-golden.jsonl')
const sourceIndexPath = path.join(capabilityDir, 'case-source-index.json')

const integrationRelativePath = 'eval-cases/capability/integration-golden.jsonl'
const integrationRows = await readJsonl(integrationPath)
const sourceEntries = []
const rowsById = new Map()
const sourceByCaseId = new Map()

for (const row of integrationRows) {
  registerRow(row, integrationRelativePath)
}
const integrationEntry = {
  kind: 'integration',
  owner: 'sciforge-eval',
  path: integrationRelativePath,
  caseIds: integrationRows.map((row) => row.id),
  count: integrationRows.length
}

const domainEntries = await readdir(path.join(root, 'packages', 'domains'), { withFileTypes: true })
for (const domainEntry of domainEntries.filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
  const relativePath = `packages/domains/${domainEntry.name}/eval-cases/capability-golden.jsonl`
  const absolutePath = path.join(root, relativePath)
  if (!(await exists(absolutePath))) continue
  const rows = await readJsonl(absolutePath)
  for (const row of rows) registerRow(row, relativePath)
  sourceEntries.push({
    kind: 'domain-package',
    owner: domainEntry.name,
    path: relativePath,
    caseIds: rows.map((row) => row.id),
    count: rows.length
  })
}
sourceEntries.push(integrationEntry)

const previousAggregate = await readJsonl(legacyPath)
const aggregate = []
const seen = new Set()
for (const row of previousAggregate) {
  if (!rowsById.has(row.id) || seen.has(row.id)) continue
  aggregate.push(rowsById.get(row.id))
  seen.add(row.id)
}
for (const id of [...rowsById.keys()].sort()) {
  if (seen.has(id)) continue
  aggregate.push(rowsById.get(id))
}

assertExecutableProjection(aggregate, rowsById)

await writeOrCheck(legacyPath, encodeJsonl(aggregate))
const sourceIndex = {
  schemaVersion: 'sciforge.capability-eval.case-sources.v1',
  authoritativeSourceGlobs: [
    'packages/domains/*/eval-cases/capability-golden.jsonl',
    'eval-cases/capability/integration-golden.jsonl'
  ],
  executableProjection: {
    path: 'eval-cases/capability/golden.jsonl',
    generated: true,
    rule: 'exactly one row per authoritative case_id; never an independent authoring surface'
  },
  sources: sourceEntries,
  totalCases: aggregate.length,
  packageOwnedCases: aggregate.length - integrationRows.length,
  integrationCases: integrationRows.length
}
await writeOrCheck(sourceIndexPath, `${JSON.stringify(sourceIndex, null, 2)}\n`)

if (checkOnly) {
  console.log(`Verified ${aggregate.length} capability cases across ${sourceEntries.length} authoritative sources.`)
} else {
  console.log(`Generated ${aggregate.length} capability cases across ${sourceEntries.length} authoritative sources.`)
}

function registerRow(row, source) {
  if (!row || typeof row.id !== 'string' || row.id.length === 0) {
    throw new Error(`Capability case source ${source} contains a row without a valid id.`)
  }
  if (rowsById.has(row.id)) {
    throw new Error(`Duplicate capability case ${row.id} in ${source} and ${sourceByCaseId.get(row.id)}.`)
  }
  rowsById.set(row.id, row)
  sourceByCaseId.set(row.id, source)
}

function assertExecutableProjection(aggregateRows, authoritativeRowsById) {
  const projectionIds = aggregateRows.map((row) => row.id)
  if (new Set(projectionIds).size !== projectionIds.length) {
    throw new Error('Capability executable projection contains duplicate case IDs.')
  }
  if (projectionIds.length !== authoritativeRowsById.size) {
    throw new Error('Capability executable projection is missing an authoritative case.')
  }
  for (const row of aggregateRows) {
    if (authoritativeRowsById.get(row.id) !== row) {
      throw new Error(`Capability executable projection row ${row.id} is not the authoritative source row.`)
    }
  }
}

async function readJsonl(filePath) {
  const content = await readFile(filePath, 'utf8')
  return content.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function encodeJsonl(values) {
  return values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : '')
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function writeOrCheck(filePath, content) {
  if (checkOnly) {
    let current
    try {
      current = await readFile(filePath, 'utf8')
    } catch {
      throw new Error(`Generated capability case source is missing: ${path.relative(root, filePath)}`)
    }
    if (current !== content) {
      throw new Error(`Generated capability case source is stale: ${path.relative(root, filePath)}`)
    }
    return
  }
  await writeFile(filePath, content, 'utf8')
}
