import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

import {
  PROJECT_COORDINATOR_CAPABILITY_FACTORY_CONTRIBUTION,
  PROJECT_COORDINATOR_I18N_CONTRIBUTION,
  PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION,
  PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION,
  PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'

test('manifest composes independent main and renderer entrypoints', () => {
  assert.equal(domainPackageDefinition.packageName, '@sciforge/domain-project-coordinator')
  assert.equal(domainPackageDefinition.module.id, 'sciforge.project-coordinator')
  assert.deepEqual(
    domainPackageDefinition.entrypoints.map(({ process, export: entryExport }) => [process, entryExport]),
    [['main', './main'], ['renderer', './renderer']]
  )
  assert.deepEqual(
    domainPackageDefinition.entrypoints.flatMap((entrypoint) =>
      entrypoint.contributions.map(({ id }) => id)
    ),
    [
      PROJECT_COORDINATOR_CAPABILITY_FACTORY_CONTRIBUTION.id,
      PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION.id,
      PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION.id,
      PROJECT_COORDINATOR_I18N_CONTRIBUTION.id
    ]
  )
  // Internal-service discovery is governed by service descriptors, not by
  // release packaging dependencies between source-composed domains.
  assert.equal(domainPackageDefinition.packaging, undefined)
})

test('package sources keep Host-private implementations and sibling domain internals outside the boundary', async () => {
  const sourceRoot = new URL('./', import.meta.url)
  const files = (await readdir(sourceRoot, { recursive: true }))
    .filter((file) => /\.(?:ts|tsx)$/u.test(file) && !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))
  const sources = await Promise.all(
    files.map((file) => readFile(new URL(file, sourceRoot), 'utf8'))
  )
  const forbidden = [
    ['@', 'shared'].join(''),
    ['@', 'renderer'].join(''),
    ['window', '.sciforge'].join(''),
    ['src', '/shared'].join(''),
    ['src', '/renderer'].join(''),
    ['src', '/main'].join(''),
    'productionMockContentSpace',
    'accessToken',
    'refreshToken'
  ]
  for (const pattern of forbidden) {
    assert.equal(
      sources.some((source) => source.includes(pattern)),
      false,
      `forbidden package-boundary pattern: ${pattern}`
    )
  }
  const collaborationImports = sources.flatMap((source) => (
    [...source.matchAll(/from ['"](@sciforge\/domain-collaboration[^'"]*)['"]/gu)]
      .map((match) => match[1])
  ))
  assert.deepEqual([...new Set(collaborationImports)], [
    '@sciforge/domain-collaboration/coordinator-cloud-command'
  ])
})
