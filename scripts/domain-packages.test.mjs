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

test('discovers package-owned bundled runtime metadata and installed dependencies', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createFixture(root, 'foundation', {
    packageName: '@fixture/foundation',
    process: 'main',
    packaging: {
      bundled: true,
      runtime: {
        requiredPaths: ['python/foundation/server.py'],
        dependencies: []
      }
    }
  })
  await createFixture(root, 'consumer', {
    packageName: '@fixture/consumer',
    process: 'main',
    packaging: {
      bundled: true,
      runtime: {
        requiredPaths: ['python/consumer/server.py', 'ui/index.html'],
        dependencies: ['@fixture/foundation']
      }
    }
  })

  const packages = await discoverDomainPackages(root, {
    parseDefinition: (definition) => definition
  })
  const consumer = packages.find(({ packageName }) => packageName === '@fixture/consumer')

  assert.deepEqual(consumer?.definition.packaging, {
    bundled: true,
    runtime: {
      requiredPaths: ['python/consumer/server.py', 'ui/index.html'],
      dependencies: ['@fixture/foundation']
    }
  })
})

test('fails closed for escaping or missing packaged runtime paths', async (context) => {
  const escapingRoot = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  const missingRoot = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  const implicitRoot = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => Promise.all([
    rm(escapingRoot, { recursive: true, force: true }),
    rm(missingRoot, { recursive: true, force: true }),
    rm(implicitRoot, { recursive: true, force: true })
  ]))
  await createFixture(escapingRoot, 'escaping', {
    packageName: '@fixture/escaping',
    process: 'main',
    packaging: {
      bundled: true,
      runtime: {
        requiredPaths: ['python/../outside.py'],
        dependencies: []
      }
    },
    createRequiredPaths: false
  })
  await createFixture(implicitRoot, 'implicit', {
    packageName: '@fixture/implicit',
    process: 'main',
    packaging: {
      bundled: true,
      runtime: {
        requiredPaths: ['package.json'],
        dependencies: []
      }
    },
    createRequiredPaths: false
  })
  await createFixture(missingRoot, 'missing', {
    packageName: '@fixture/missing',
    process: 'main',
    packaging: {
      bundled: true,
      runtime: {
        requiredPaths: ['python/missing/server.py'],
        dependencies: []
      }
    },
    createRequiredPaths: false
  })

  await assert.rejects(
    discoverDomainPackages(escapingRoot, { parseDefinition: (definition) => definition }),
    /runtime path must be package-relative/
  )
  await assert.rejects(
    discoverDomainPackages(missingRoot, { parseDefinition: (definition) => definition }),
    /is missing runtime path python\/missing\/server\.py/
  )
  await assert.rejects(
    discoverDomainPackages(implicitRoot, { parseDefinition: (definition) => definition }),
    /must not repeat implicit runtime path package\.json/
  )
})

test('fails closed for uninstalled, non-bundled, and cyclic runtime dependencies', async (context) => {
  const uninstalledRoot = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  const nonBundledRoot = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  const cyclicRoot = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => Promise.all([
    rm(uninstalledRoot, { recursive: true, force: true }),
    rm(nonBundledRoot, { recursive: true, force: true }),
    rm(cyclicRoot, { recursive: true, force: true })
  ]))
  await createFixture(uninstalledRoot, 'consumer', {
    packageName: '@fixture/consumer',
    process: 'main',
    packaging: {
      bundled: true,
      runtime: { dependencies: ['@fixture/missing'] }
    }
  })
  await createFixture(nonBundledRoot, 'foundation', {
    packageName: '@fixture/foundation',
    process: 'main',
    packaging: { bundled: false }
  })
  await createFixture(nonBundledRoot, 'consumer', {
    packageName: '@fixture/consumer',
    process: 'main',
    packaging: {
      bundled: true,
      runtime: { dependencies: ['@fixture/foundation'] }
    }
  })
  await createFixture(cyclicRoot, 'a', {
    packageName: '@fixture/domain-a',
    process: 'main',
    packaging: {
      bundled: true,
      runtime: { dependencies: ['@fixture/domain-b'] }
    }
  })
  await createFixture(cyclicRoot, 'b', {
    packageName: '@fixture/domain-b',
    process: 'main',
    packaging: {
      bundled: true,
      runtime: { dependencies: ['@fixture/domain-a'] }
    }
  })

  await assert.rejects(
    discoverDomainPackages(uninstalledRoot, { parseDefinition: (definition) => definition }),
    /depends on uninstalled domain @fixture\/missing/
  )
  await assert.rejects(
    discoverDomainPackages(nonBundledRoot, { parseDefinition: (definition) => definition }),
    /depends on non-bundled domain @fixture\/foundation/
  )
  await assert.rejects(
    discoverDomainPackages(cyclicRoot, { parseDefinition: (definition) => definition }),
    /Cyclic bundled domain runtime dependency/
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
    ...(options.packaging ? { packaging: options.packaging } : {}),
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
  if (options.createRequiredPaths !== false) {
    for (const requiredPath of options.packaging?.runtime?.requiredPaths ?? []) {
      const target = path.join(packageRoot, ...requiredPath.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, '')
    }
  }
}
