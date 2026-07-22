import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  discoverDomainPackages,
  renderGeneratedDomainPackageFiles
} from './domain-packages.mjs'

test('sorts packages by packageName and omits undeclared process imports', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createFixture(root, 'z-main-only', {
    packageName: '@fixture/z-main-only',
    process: 'main'
  })
  await createFixture(root, 'a-renderer-only', {
    packageName: '@fixture/a-renderer-only',
    process: 'renderer'
  })

  const packages = await discoverDomainPackages(root, {
    parseDefinition: (definition) => definition
  })
  const generated = renderGeneratedDomainPackageFiles(packages)

  assert.deepEqual(packages.map(({ packageName }) => packageName), [
    '@fixture/a-renderer-only',
    '@fixture/z-main-only'
  ])
  assert.match(generated['src/main/modules/installed-domain-main.ts'], /@fixture\/z-main-only\/main/)
  assert.doesNotMatch(generated['src/main/modules/installed-domain-main.ts'], /a-renderer-only/)
  assert.match(generated['src/renderer/src/domain-modules/installed-domain-renderer.ts'], /@fixture\/a-renderer-only\/renderer/)
  assert.doesNotMatch(generated['src/renderer/src/domain-modules/installed-domain-renderer.ts'], /z-main-only/)
})

test('fails closed when a process entry does not export its conventional factory', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createFixture(root, 'broken', {
    packageName: '@fixture/broken',
    process: 'main',
    factoryName: 'createSomethingElse'
  })

  await assert.rejects(
    discoverDomainPackages(root, { parseDefinition: (definition) => definition }),
    /must export createDomainMainEntry/
  )
})

test('fails closed when a preview contribution has no canonical contract', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createFixture(root, 'preview-without-contract', {
    packageName: '@fixture/preview-without-contract',
    process: 'main',
    contributions: [{
      id: 'fixture.preview-without-contract',
      kind: 'main.workspace-preview-plugin'
    }]
  })

  await assert.rejects(
    discoverDomainPackages(root, { parseDefinition: (definition) => definition }),
    /requires one canonical contributionContracts entry/
  )
})

test('fails closed when main and renderer preview slots do not share one contribution identity', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createFixture(root, 'drifted-preview', {
    packageName: '@fixture/drifted-preview',
    processes: ['main', 'renderer'],
    contributionContracts: {
      'fixture.drifted-preview.main': { id: 'fixture-preview' },
      'fixture.drifted-preview.renderer': { id: 'fixture-preview' }
    },
    contributionsByProcess: {
      main: [{
        id: 'fixture.drifted-preview.main',
        kind: 'main.workspace-preview-plugin'
      }],
      renderer: [{
        id: 'fixture.drifted-preview.renderer',
        kind: 'renderer.workspace-preview-plugin'
      }]
    }
  })

  await assert.rejects(
    discoverDomainPackages(root, { parseDefinition: (definition) => definition }),
    /must declare identical workspace preview contribution IDs in main and renderer/
  )
})

async function createFixture(root, directoryName, options) {
  const packageRoot = path.join(root, 'packages/domains', directoryName)
  await mkdir(path.join(packageRoot, 'src'), { recursive: true })
  const processes = options.processes ?? [options.process]
  const entrypoints = processes.map((processName) => ({
    process: processName,
    export: `./${processName}`,
    contributions: options.contributionsByProcess?.[processName] ?? options.contributions ?? []
  }))
  const manifest = {
    contractVersion: 1,
    kind: 'trusted-compile-time',
    packageName: options.packageName,
    module: {
      id: `fixture.${directoryName}`,
      displayName: directoryName,
      version: '1.0.0',
      hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
      priority: 100
    },
    contributionContracts: options.contributionContracts ?? {},
    entrypoints
  }
  await writeFile(path.join(packageRoot, 'sciforge.domain.json'), JSON.stringify(manifest))
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: options.packageName,
    type: 'module',
    exports: {
      './definition': './src/definition.ts',
      ...Object.fromEntries(processes.map((processName) => [
        `./${processName}`,
        `./src/${processName}.ts`
      ]))
    },
    scripts: { test: 'node --test', typecheck: 'tsc --noEmit' }
  }))
  await writeFile(
    path.join(packageRoot, 'src/definition.ts'),
    'export const domainPackageDefinition = {}\n'
  )
  for (const processName of processes) {
    const factoryName = options.factoryName ??
      (processName === 'main' ? 'createDomainMainEntry' : 'createDomainRendererEntry')
    await writeFile(
      path.join(packageRoot, `src/${processName}.ts`),
      `export function ${factoryName}() { return {} }\n`
    )
  }
}
