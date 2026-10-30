import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

import {
  PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'

test('manifest composes independent main and renderer entrypoints', () => {
  assert.equal(domainPackageDefinition.packageName, '@sciforge/domain-collaboration')
  assert.equal(domainPackageDefinition.module.id, 'sciforge.collaboration')
  assert.deepEqual(domainPackageDefinition.module.hostApi, {
    minimum: '1.13.0',
    maximumExclusive: '2.0.0'
  })
  assert.deepEqual(
    domainPackageDefinition.entrypoints.map(({ process, export: entryExport }) => [process, entryExport]),
    [['main', './main'], ['renderer', './renderer']]
  )
  assert.deepEqual(
    domainPackageDefinition.entrypoints.flatMap((entrypoint) =>
      entrypoint.contributions.map(({ id }) => id)
    ),
    [
      'collaboration.capabilities',
      'collaboration.runtime-lifecycle',
      'collaboration.coordinator-cloud-command',
      'collaboration.worker-session-projection',
      PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRIBUTION.id,
      'collaboration.translations',
      'collaboration.workbench-main-area',
      'collaboration.composer-context',
      'collaboration.chat-message'
    ]
  )
  assert.deepEqual(domainPackageDefinition.packaging, {
    bundled: true,
    runtime: {
      requiredPaths: [],
      dependencies: []
    }
  })
  assert.deepEqual(
    domainPackageDefinition.contributionContracts[
      PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRIBUTION.id
    ],
    {
      requestedSystemCapabilityGrants: []
    }
  )
  assert.deepEqual(
    domainPackageDefinition.contributionContracts['collaboration.workbench-main-area'],
    {
      location: 'workbench.main-area',
      contractVersion: '1.0.0',
      label: 'collaborationTitle',
      preferredHostSidebar: 'collapsed'
    }
  )
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
  assert.deepEqual([...new Set(collaborationImports)], [])
})

test('publishable dependencies target the frozen Host and domain contract majors', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8')
  ) as { dependencies: Record<string, string> }
  assert.equal(packageJson.dependencies['@sciforge/collaboration-contracts'], '8.0.0')
  assert.equal(packageJson.dependencies['@sciforge/domain-collaboration'], undefined)
  assert.equal(packageJson.dependencies['@sciforge/domain-content-space'], undefined)
  assert.equal(packageJson.dependencies['@sciforge/domain-identity-access'], '5.0.2')
  assert.equal(packageJson.dependencies['@sciforge/domain-sdk'], '^0.2.24')
})
