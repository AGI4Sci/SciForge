import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  discoverMainBundlePackageNames,
  discoverDomainPackages,
  generatedDomainPackageContentMatches,
  renderGeneratedDomainPackageFiles
} from './domain-packages.mjs'

test('treats Git CRLF checkout conversion as the same generated composition', () => {
  assert.equal(generatedDomainPackageContentMatches(
    '// generated\r\nexport const value = 1\r\n',
    '// generated\nexport const value = 1\n'
  ), true)
  assert.equal(generatedDomainPackageContentMatches(
    '// generated\r\nexport const value = 2\r\n',
    '// generated\nexport const value = 1\n'
  ), false)
})

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
  assert.match(
    generated['src/main/modules/installed-domain-main.ts'],
    /capabilityInvokerFor,\n {4}packageStorageFor,\n {4}fileTransfersFor,\n {4}externalNavigationFor,\n {4}portableResourcesFor,\n {4}internalServicesFor,\n {4}\.\.\.sharedHost/
  )
  assert.match(
    generated['src/main/modules/installed-domain-main.ts'],
    /const packageStorage = packageStorageFor\(owner\)/
  )
  assert.match(
    generated['src/main/modules/installed-domain-main.ts'],
    /return \{\n {6}\.\.\.sharedHost,\n {6}capabilities: capabilityInvokerFor\(owner\),\n {6}packageSettings: packageStorage\.settings,\n {6}packageSecrets: packageStorage\.secrets,\n {6}\.\.\.\(fileTransfersFor \? \{ fileTransfers: fileTransfersFor\(owner\) \} : \{\}\),\n {6}\.\.\.\(externalNavigationFor \? \{ externalNavigation: externalNavigationFor\(owner\) \} : \{\}\),\n {6}\.\.\.\(portableResourcesFor \? \{ portableResources: portableResourcesFor\(owner\) \} : \{\}\),\n {6}\.\.\.\(internalServicesFor \? \{ internalServices: internalServicesFor\(owner\) \} : \{\}\),/
  )
  assert.doesNotMatch(
    generated['src/main/modules/installed-domain-main.ts'],
    /return \{\n {6}\.\.\.host,/
  )
  assert.match(generated['src/renderer/src/domain-modules/installed-domain-renderer.ts'], /@fixture\/a-renderer-only\/renderer/)
  assert.doesNotMatch(generated['src/renderer/src/domain-modules/installed-domain-renderer.ts'], /z-main-only/)
  assert.match(
    generated['src/renderer/src/domain-modules/installed-domain-renderer.ts'],
    /remoteWorkspace\.attach\(input\)/
  )
  assert.match(
    generated['src/renderer/src/domain-modules/installed-domain-renderer.ts'],
    /createDomainRendererEntry0\(domainHostFor\("@fixture\/a-renderer-only"\)\)/
  )
  assert.match(
    generated['src/renderer/src/domain-modules/installed-domain-renderer.ts'],
    /fileTransfers: rendererFileTransferHostFor\(ownerId\)/
  )
  assert.doesNotMatch(
    generated['packages/workers/workspace-host/src/generated/installed-domain-workspace-server.ts'],
    /@fixture/
  )
})

test('generates the main bundle list from the public workspace source dependency closure', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: '@fixture/host',
    workspaces: [
      'packages/domains/*',
      'packages/runtimes/compiled-leaf',
      'packages/runtimes/compiled-runtime',
      'packages/runtimes/host-runtime',
      'packages/runtimes/renderer-runtime',
      'packages/runtimes/transitive-runtime'
    ],
    dependencies: {
      '@fixture/compiled-leaf': '1.0.0',
      '@fixture/host-runtime': '1.0.0',
      '@fixture/non-workspace-runtime': '1.0.0'
    }
  }))
  await createSourcePackage(root, 'host-runtime', '@fixture/host-runtime')
  await createSourcePackage(root, 'transitive-runtime', '@fixture/transitive-runtime')
  await createSourcePackage(root, 'compiled-leaf', '@fixture/compiled-leaf', {
    entrypoint: './dist/index.js'
  })
  await createSourcePackage(root, 'compiled-runtime', '@fixture/compiled-runtime', {
    entrypoint: './dist/index.js',
    dependencies: { '@fixture/transitive-runtime': '1.0.0' }
  })
  await createFixture(root, 'main-domain', {
    packageName: '@fixture/main-domain',
    process: 'main',
    dependencies: { '@fixture/compiled-runtime': '1.0.0' }
  })
  await createFixture(root, 'renderer-domain', {
    packageName: '@fixture/renderer-domain',
    process: 'renderer',
    dependencies: { '@fixture/renderer-runtime': '1.0.0' }
  })
  await createSourcePackage(root, 'renderer-runtime', '@fixture/renderer-runtime')
  await createSourcePackage(
    root,
    'non-workspace-runtime',
    '@fixture/non-workspace-runtime'
  )

  const packages = await discoverDomainPackages(root, {
    parseDefinition: (definition) => definition
  })
  const mainBundlePackageNames = await discoverMainBundlePackageNames(root, packages)
  const generated = renderGeneratedDomainPackageFiles(packages, { mainBundlePackageNames })[
    'src/main/modules/installed-main-source-packages.ts'
  ]

  assert.deepEqual(mainBundlePackageNames, [
    '@fixture/compiled-runtime',
    '@fixture/host-runtime',
    '@fixture/main-domain',
    '@fixture/transitive-runtime'
  ])
  assert.match(generated, /@fixture\/host-runtime/)
  assert.match(generated, /@fixture\/main-domain/)
  assert.match(generated, /@fixture\/transitive-runtime/)
  assert.match(generated, /@fixture\/compiled-runtime/)
  assert.doesNotMatch(generated, /@fixture\/compiled-leaf/)
  assert.doesNotMatch(generated, /@fixture\/non-workspace-runtime/)
  assert.doesNotMatch(generated, /@fixture\/renderer-runtime/)
  assert.throws(
    () => renderGeneratedDomainPackageFiles(packages, {
      mainBundlePackageNames: ['@fixture/source-runtime.*']
    }),
    /Generated main source package name is invalid/
  )

  await rm(path.join(root, 'packages', 'domains', 'main-domain'), {
    recursive: true,
    force: true
  })
  const withoutMainDomain = await discoverDomainPackages(root, {
    parseDefinition: (definition) => definition
  })
  assert.deepEqual(
    await discoverMainBundlePackageNames(root, withoutMainDomain),
    ['@fixture/host-runtime']
  )

  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: '@fixture/host',
    workspaces: ['./internal/*'],
    dependencies: {}
  }))
  await assert.rejects(
    discoverMainBundlePackageNames(root, withoutMainDomain),
    /must not target an internal overlay/
  )
})

test('validates development fixtures without projecting them into production', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createFixture(root, 'production', {
    packageName: '@fixture/production',
    process: 'main'
  })
  await createFixture(root, 'development-only', {
    packageName: '@fixture/development-only',
    process: 'main',
    composition: 'development-only'
  })

  const packages = await discoverDomainPackages(root, {
    parseDefinition: (definition) => definition
  })
  const generated = renderGeneratedDomainPackageFiles(packages)

  assert.deepEqual(packages.map(({ packageName }) => packageName), [
    '@fixture/development-only',
    '@fixture/production'
  ])
  for (const content of Object.values(generated)) {
    assert.doesNotMatch(content, /@fixture\/development-only/)
  }
  assert.match(
    generated['src/main/modules/installed-domain-main.ts'],
    /@fixture\/production\/main/
  )
})

test('keeps the actual production Content Space path free of mocks and retired transfer entrypoints', async () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const mockPackageName = '@sciforge/domain-content-space-mock-provider'
  const mockPackageRoot = 'packages/domains/content-space-mock-provider/'
  const mockManifest = JSON.parse(await readFile(path.join(
    repositoryRoot,
    mockPackageRoot,
    'sciforge.domain.json'
  ), 'utf8'))
  assert.equal(mockManifest.packageName, mockPackageName)
  assert.equal(mockManifest.composition, 'development-only')

  const generatedProductionFiles = [
    'src/main/modules/installed-domain-main.ts',
    'src/main/modules/installed-main-source-packages.ts',
    'src/renderer/src/domain-modules/installed-domain-renderer.ts',
    'packages/workers/workspace-host/src/generated/installed-domain-workspace-server.ts'
  ]
  for (const relativePath of generatedProductionFiles) {
    const content = await readFile(path.join(repositoryRoot, relativePath), 'utf8')
    assert.doesNotMatch(content, /content-space-mock-provider/u, relativePath)
    assert.doesNotMatch(content, /sciforge\.content-space-mock-provider/u, relativePath)
  }

  const sourceRoots = ['src', 'packages/domains']
  const sourceFiles = (await Promise.all(sourceRoots.map(async (sourceRoot) => {
    const absoluteRoot = path.join(repositoryRoot, sourceRoot)
    return (await readdir(absoluteRoot, { recursive: true }))
      .filter((relativePath) => /\.(?:c|m)?(?:js|ts)x?$/u.test(relativePath))
      .map((relativePath) => path.posix.join(sourceRoot, relativePath.split(path.sep).join('/')))
  }))).flat()
  const sources = await Promise.all(sourceFiles.map(async (relativePath) => ({
    relativePath,
    content: await readFile(path.join(repositoryRoot, relativePath), 'utf8')
  })))
  const externalMockImports = sources
    .filter(({ relativePath }) => !relativePath.startsWith(mockPackageRoot))
    .filter(({ content }) => content.includes(mockPackageName))
    .map(({ relativePath }) => relativePath)
  assert.deepEqual(externalMockImports.sort(), [
    'packages/domains/content-space/src/main/provider-catalog.test.ts',
    'src/main/capabilities/content-space-discovery.test.ts'
  ])
  assert.equal(externalMockImports.every((relativePath) => /\.test\.(?:c|m)?(?:js|ts)x?$/u.test(
    relativePath
  )), true)

  const productionSources = sources.filter(({ relativePath }) => (
    !relativePath.startsWith(mockPackageRoot) &&
    !/\.test\.(?:c|m)?(?:js|ts)x?$/u.test(relativePath)
  ))
  const retiredSymbols = [
    'productionMockContentSpace',
    'MockContentSpacePort',
    'resolveContentSpacePortableInvocationReference',
    'resolveSystemPortableReference',
    'portableResolver',
    'mock-opencontent'
  ]
  for (const symbol of retiredSymbols) {
    assert.deepEqual(
      productionSources
        .filter(({ content }) => content.includes(symbol))
        .map(({ relativePath }) => relativePath),
      [],
      `retired production Content Space symbol: ${symbol}`
    )
  }

  const contentContract = await readFile(path.join(
    repositoryRoot,
    'packages/domains/content-space/src/contract.ts'
  ), 'utf8')
  const contentMain = await readFile(path.join(
    repositoryRoot,
    'packages/domains/content-space/src/main/index.ts'
  ), 'utf8')
  const contentService = await readFile(path.join(
    repositoryRoot,
    'packages/domains/content-space/src/main/service.ts'
  ), 'utf8')
  const collaborationAdapter = await readFile(path.join(
    repositoryRoot,
    'packages/domains/collaboration/src/main/task-adapter.ts'
  ), 'utf8')
  const systemContracts = [
    ['CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT', 'systemTransferPreflight'],
    ['CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT', 'systemDownload'],
    ['CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT', 'systemUploadNew']
  ]
  for (const [contractName, capabilityKey] of systemContracts) {
    assert.equal(count(contentContract, `export const ${contractName}`), 1, contractName)
    assert.equal(count(contentMain, `id: CONTENT_SPACE_CAPABILITY_IDS.${capabilityKey}`), 1, capabilityKey)
    assert.equal(count(collaborationAdapter, contractName) > 0, true, contractName)
  }
  assert.equal(count(contentMain, 'portableResources.materialize(') >= 3, true)
  assert.match(contentService, /provider\.authorizeDownload\(/u)
  assert.match(contentService, /provider\.uploadNewFile\(/u)
})

test('projects only workspace-server process entries into the server composition', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createFixture(root, 'remote-preview', {
    packageName: '@fixture/remote-preview',
    processes: ['main', 'renderer', 'workspace-server'],
    contributionContracts: {
      'fixture.remote-preview': { contractVersion: 1, id: 'fixture-preview' }
    },
    contributionsByProcess: {
      main: [{
        id: 'fixture.remote-preview',
        kind: 'main.workspace-preview-plugin'
      }],
      renderer: [{
        id: 'fixture.remote-preview',
        kind: 'renderer.workspace-preview-plugin'
      }],
      'workspace-server': [{
        id: 'fixture.remote-preview',
        kind: 'workspace-server.workspace-preview-plugin'
      }]
    }
  })
  await createFixture(root, 'desktop-only', {
    packageName: '@fixture/desktop-only',
    process: 'main'
  })

  const packages = await discoverDomainPackages(root, {
    parseDefinition: (definition) => definition
  })
  const server = renderGeneratedDomainPackageFiles(packages)[
    'packages/workers/workspace-host/src/generated/installed-domain-workspace-server.ts'
  ]

  assert.match(server, /@fixture\/remote-preview\/workspace-server/)
  assert.match(server, /createDomainWorkspaceServerEntry/)
  assert.doesNotMatch(server, /@fixture\/desktop-only/)
  assert.doesNotMatch(server, /\/main'/)
  assert.doesNotMatch(server, /\/renderer'/)
})

test('generates one contribution-keyed runtime MCP launcher composition', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createFixture(root, 'runtime-mcp', {
    packageName: '@fixture/runtime-mcp',
    process: 'main',
    contributions: [{
      id: 'fixture.runtime-mcp-server',
      kind: 'main.runtime-mcp-server'
    }]
  })
  await createFixture(root, 'ordinary', {
    packageName: '@fixture/ordinary',
    process: 'main'
  })

  const packages = await discoverDomainPackages(root, {
    parseDefinition: (definition) => definition
  })
  const runtimeMcp = renderGeneratedDomainPackageFiles(packages)[
    'src/main/modules/installed-domain-runtime-mcp.ts'
  ]

  assert.match(runtimeMcp, /@fixture\/runtime-mcp\/runtime-mcp/)
  assert.match(runtimeMcp, /"fixture\.runtime-mcp-server": runDomainRuntimeMcpServer/)
  assert.match(runtimeMcp, /selectedDomainRuntimeMcpContributionId/)
  assert.doesNotMatch(runtimeMcp, /@fixture\/ordinary/)
})

test('fails closed when a runtime MCP contribution omits its conventional runner', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createFixture(root, 'broken-runtime-mcp', {
    packageName: '@fixture/broken-runtime-mcp',
    process: 'main',
    contributions: [{
      id: 'fixture.broken-runtime-mcp-server',
      kind: 'main.runtime-mcp-server'
    }],
    createRuntimeMcpExport: false
  })

  await assert.rejects(
    discoverDomainPackages(root, { parseDefinition: (definition) => definition }),
    /must expose \.\/runtime-mcp exactly when it declares main\.runtime-mcp-server/
  )
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

test('fails closed when package and manifest release versions drift', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createFixture(root, 'version-drift', {
    packageName: '@fixture/version-drift',
    process: 'main',
    packageVersion: '1.0.1'
  })

  await assert.rejects(
    discoverDomainPackages(root, { parseDefinition: (definition) => definition }),
    /package\.json version must equal manifest module\.version 1\.0\.0/
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

test('fails closed when a workspace preview omits its renderer or backend boundary', async (context) => {
  const serverOnlyRoot = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  const rendererOnlyRoot = await mkdtemp(path.join(os.tmpdir(), 'sciforge-domain-generator-'))
  context.after(() => Promise.all([
    rm(serverOnlyRoot, { recursive: true, force: true }),
    rm(rendererOnlyRoot, { recursive: true, force: true })
  ]))
  await createFixture(serverOnlyRoot, 'server-only-preview', {
    packageName: '@fixture/server-only-preview',
    process: 'workspace-server',
    contributionContracts: {
      'fixture.server-only-preview': { contractVersion: 1, id: 'fixture-preview' }
    },
    contributions: [{
      id: 'fixture.server-only-preview',
      kind: 'workspace-server.workspace-preview-plugin'
    }]
  })
  await createFixture(rendererOnlyRoot, 'renderer-only-preview', {
    packageName: '@fixture/renderer-only-preview',
    process: 'renderer',
    contributionContracts: {
      'fixture.renderer-only-preview': { contractVersion: 1, id: 'fixture-preview' }
    },
    contributions: [{
      id: 'fixture.renderer-only-preview',
      kind: 'renderer.workspace-preview-plugin'
    }]
  })

  for (const root of [serverOnlyRoot, rendererOnlyRoot]) {
    await assert.rejects(
      discoverDomainPackages(root, { parseDefinition: (definition) => definition }),
      /require a renderer and at least one backend process/
    )
  }
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
    /must declare identical workspace preview contribution IDs in every declared preview process/
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

function count(content, fragment) {
  return content.split(fragment).length - 1
}

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
    ...(options.composition ? { composition: options.composition } : {}),
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
  const runtimeMcpContributions = entrypoints.flatMap((entrypoint) =>
    entrypoint.process === 'main'
      ? entrypoint.contributions.filter(({ kind }) => kind === 'main.runtime-mcp-server')
      : []
  )
  const createRuntimeMcpExport = runtimeMcpContributions.length > 0 &&
    options.createRuntimeMcpExport !== false
  await writeFile(path.join(packageRoot, 'sciforge.domain.json'), JSON.stringify(manifest))
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: options.packageName,
    version: options.packageVersion ?? '1.0.0',
    type: 'module',
    exports: {
      './definition': './src/definition.ts',
      ...Object.fromEntries(processes.map((processName) => [
        `./${processName}`,
        `./src/${processName}.ts`
      ])),
      ...(createRuntimeMcpExport
        ? { './runtime-mcp': './src/runtime-mcp.ts' }
        : {})
    },
    scripts: { test: 'node --test', typecheck: 'tsc --noEmit' },
    dependencies: options.dependencies ?? {}
  }))
  await writeFile(
    path.join(packageRoot, 'src/definition.ts'),
    'export const domainPackageDefinition = {}\n'
  )
  for (const processName of processes) {
    const factoryName = options.factoryName ??
      (processName === 'main'
        ? 'createDomainMainEntry'
        : processName === 'renderer'
          ? 'createDomainRendererEntry'
          : 'createDomainWorkspaceServerEntry')
    await writeFile(
      path.join(packageRoot, `src/${processName}.ts`),
      `export function ${factoryName}() { return {} }\n`
    )
  }
  if (createRuntimeMcpExport) {
    await writeFile(
      path.join(packageRoot, 'src/runtime-mcp.ts'),
      'export async function runDomainRuntimeMcpServerFromArgv() {}\n'
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

async function createSourcePackage(root, directoryName, packageName, options = {}) {
  const packageRoot = path.join(root, 'packages', 'runtimes', directoryName)
  const entrypoint = options.entrypoint ?? './src/index.ts'
  await mkdir(path.join(packageRoot, path.dirname(entrypoint)), { recursive: true })
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: packageName,
    version: '1.0.0',
    type: 'module',
    exports: { '.': entrypoint },
    dependencies: options.dependencies ?? {}
  }))
  await writeFile(path.join(packageRoot, entrypoint), 'export const fixture = true\n')
}
