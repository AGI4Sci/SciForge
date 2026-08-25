const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { readFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')
const test = require('node:test')

const {
  assertNoTrackedPrivatePayloadPaths,
  assertPublicReleaseDeploymentConfigurationsSafe,
  assertPublicReleaseDomainContributionsSafe,
  assertPublicReleaseCompositionSafe,
  runConfiguredPublicReleaseGuard,
  runPublicReleaseGuard
} = require('./public-release-guard.cjs')
const deploymentConfigurationPackaging = require('./domain-package-deployment-config.cjs')

function loadAfterPack(options = {}) {
  if (!options.internalRuntimePackaging && !options.deploymentConfigurationPackaging) {
    return require('./after-pack.cjs')
  }

  const afterPackPath = require.resolve('./after-pack.cjs')
  const internalRuntimePackagingPath = require.resolve('./internal-runtime-packaging.cjs')
  const deploymentConfigurationPackagingPath = require.resolve(
    './domain-package-deployment-config.cjs'
  )
  const previousAfterPack = require.cache[afterPackPath]
  const previousInternalRuntimePackaging = require.cache[internalRuntimePackagingPath]
  const previousDeploymentConfigurationPackaging =
    require.cache[deploymentConfigurationPackagingPath]
  delete require.cache[afterPackPath]
  require.cache[internalRuntimePackagingPath] = {
    id: internalRuntimePackagingPath,
    filename: internalRuntimePackagingPath,
    loaded: true,
    exports: options.internalRuntimePackaging,
    children: [],
    paths: []
  }
  require.cache[deploymentConfigurationPackagingPath] = {
    id: deploymentConfigurationPackagingPath,
    filename: deploymentConfigurationPackagingPath,
    loaded: true,
    exports: options.deploymentConfigurationPackaging,
    children: [],
    paths: []
  }
  try {
    return require(afterPackPath)
  } finally {
    delete require.cache[afterPackPath]
    if (previousAfterPack) require.cache[afterPackPath] = previousAfterPack
    if (previousInternalRuntimePackaging) {
      require.cache[internalRuntimePackagingPath] = previousInternalRuntimePackaging
    } else {
      delete require.cache[internalRuntimePackagingPath]
    }
    if (previousDeploymentConfigurationPackaging) {
      require.cache[deploymentConfigurationPackagingPath] =
        previousDeploymentConfigurationPackaging
    } else {
      delete require.cache[deploymentConfigurationPackagingPath]
    }
  }
}

function loadAfterPackWithoutInternalRuntimes() {
  return loadAfterPack({
    internalRuntimePackaging: {
      internalRuntimeComposition: { extraResources: [], packagedRuntimes: [] },
      verifyPackagedInternalRuntimes() {}
    },
    deploymentConfigurationPackaging: {
      createDomainPackageDeploymentConfigurationComposition: emptyDeploymentComposition,
      verifyPackagedDomainDeploymentConfigurations() {}
    }
  })
}

function emptyDeploymentComposition() {
  return {
    extraResources: [],
    deploymentConfigurationDeclarations: [],
    activeDeploymentConfigurationReceipts: []
  }
}

function deploymentComposition(publicRelease = 'forbidden') {
  return {
    extraResources: [{
      from: '.private/fixture.json',
      to: 'fixture/deployment.json'
    }],
    deploymentConfigurationDeclarations: [{
      contractVersion: 1,
      packageName: '@fixture/private-deployment',
      sourceRelativePath: '.private/fixture.json',
      packagedResourcesRelativePath: 'fixture/deployment.json',
      maxBytes: 4096,
      publicRelease
    }],
    activeDeploymentConfigurationReceipts: [{
      packageName: '@fixture/private-deployment',
      sourceRelativePath: '.private/fixture.json',
      packagedResourcesRelativePath: 'fixture/deployment.json',
      maxBytes: 4096,
      publicRelease,
      size: 12,
      sha256: '0'.repeat(64)
    }]
  }
}

test('public release guard accepts only an empty internal runtime composition', () => {
  assert.deepEqual(
    assertPublicReleaseCompositionSafe({
      extraResources: [],
      packagedRuntimes: []
    }),
    { internalRuntimeCount: 0 }
  )
  assert.throws(
    () => assertPublicReleaseCompositionSafe({
      extraResources: [],
      packagedRuntimes: [
        { packageName: '@private/zeta' },
        { packageName: '@private/alpha' }
      ]
    }),
    /@private\/alpha, @private\/zeta/
  )
})

test('public release guard rejects internal extra resources without packaged runtimes', () => {
  assert.throws(
    () => assertPublicReleaseCompositionSafe({
      extraResources: [{ from: 'internal/runtime', to: 'internal/runtime' }],
      packagedRuntimes: []
    }),
    /internal extra resource composition is non-empty/u
  )
})

test('public release guard fails closed for malformed internal composition shapes', () => {
  const malformedCompositions = [
    { packagedRuntimes: [] },
    { extraResources: {}, packagedRuntimes: [] },
    { extraResources: [] },
    { extraResources: [], packagedRuntimes: {} }
  ]

  for (const composition of malformedCompositions) {
    assert.throws(
      () => assertPublicReleaseCompositionSafe(composition),
      /requires canonical extraResources and packagedRuntimes composition/u
    )
  }
})

test('public release guard requires every forbidden deployment configuration to be absent', () => {
  assert.deepEqual(
    assertPublicReleaseDeploymentConfigurationsSafe(emptyDeploymentComposition()),
    { publicReleaseForbiddenDeploymentConfigurationCount: 0 }
  )
  assert.throws(
    () => assertPublicReleaseDeploymentConfigurationsSafe(deploymentComposition()),
    /@fixture\/private-deployment/u
  )
  assert.deepEqual(
    assertPublicReleaseDeploymentConfigurationsSafe(deploymentComposition('allowed')),
    { publicReleaseForbiddenDeploymentConfigurationCount: 0 }
  )
})

test('public release guard fails closed for malformed deployment configuration composition', () => {
  for (const composition of [
    undefined,
    { extraResources: [] },
    {
      extraResources: {},
      deploymentConfigurationDeclarations: [],
      activeDeploymentConfigurationReceipts: []
    },
    {
      extraResources: [],
      deploymentConfigurationDeclarations: [],
      activeDeploymentConfigurationReceipts: [{}]
    }
  ]) {
    assert.throws(
      () => assertPublicReleaseDeploymentConfigurationsSafe(composition),
      /deployment configuration composition|deployment configuration entry/u
    )
  }
})

test('public release guard rejects Git-tracked private payloads before loading composition', async () => {
  assert.deepEqual(assertNoTrackedPrivatePayloadPaths([]), {
    trackedPrivatePayloadCount: 0
  })
  assert.throws(
    () => assertNoTrackedPrivatePayloadPaths(['internal/fixture/private.txt']),
    /private payloads are Git-tracked/u
  )
  let compositionLoads = 0
  await assert.rejects(
    runPublicReleaseGuard([], {
      createComposition: () => {
        compositionLoads += 1
        return { extraResources: [], packagedRuntimes: [] }
      },
      loadTrackedPrivatePayloadPaths: () => ['internal/fixture/private.txt'],
      projectRoot: '/trusted/repository'
    }),
    /private payloads are Git-tracked/u
  )
  assert.equal(compositionLoads, 0)
})

test('public release guard rejects Git-tracked meeting records through the canonical Git index', async () => {
  const repository = mkdtempSync(join(tmpdir(), 'sciforge-public-release-'))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: repository })
    const objectId = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repository,
      encoding: 'utf8',
      input: 'private fixture'
    }).trim()
    execFileSync(
      'git',
      [
        'update-index',
        '--add',
        '--cacheinfo',
        '100644',
        objectId,
        'meeting_records/fixture/private.txt'
      ],
      { cwd: repository }
    )

    await assert.rejects(
      runPublicReleaseGuard([], {
        createComposition: () => ({ extraResources: [], packagedRuntimes: [] }),
        createDeploymentConfigurationComposition: emptyDeploymentComposition,
        discoverDomainPackages: async () => [],
        projectRoot: repository
      }),
      /meeting_records\/fixture\/private\.txt/u
    )
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
})

test('public release guard rejects a Git-tracked private payload at the exact protected root', async () => {
  const repository = mkdtempSync(join(tmpdir(), 'sciforge-public-release-root-'))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: repository })
    const objectId = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repository,
      encoding: 'utf8',
      input: 'private fixture'
    }).trim()
    execFileSync(
      'git',
      ['update-index', '--add', '--cacheinfo', '100644', objectId, 'meeting_records'],
      { cwd: repository }
    )

    await assert.rejects(
      runPublicReleaseGuard([], {
        createComposition: () => ({ extraResources: [], packagedRuntimes: [] }),
        createDeploymentConfigurationComposition: emptyDeploymentComposition,
        discoverDomainPackages: async () => [],
        projectRoot: repository
      }),
      /meeting_records/u
    )
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
})

test('public release guard accepts canonical empty internal composition', async () => {
  let discoveredRoot
  const result = await runPublicReleaseGuard([], {
    createComposition(root) {
      discoveredRoot = root
      return { extraResources: [], packagedRuntimes: [] }
    },
    createDeploymentConfigurationComposition: emptyDeploymentComposition,
    discoverDomainPackages: async () => [],
    loadTrackedPrivatePayloadPaths: () => [],
    projectRoot: '/trusted/repository'
  })
  assert.equal(discoveredRoot, '/trusted/repository')
  assert.deepEqual(result, {
    internalRuntimeCount: 0,
    publicReleaseForbiddenDeploymentConfigurationCount: 0,
    publicReleaseForbiddenContributionCount: 0,
    trackedPrivatePayloadCount: 0
  })
})

test('public release guard reads installed manifests through canonical domain discovery', async () => {
  const result = await runPublicReleaseGuard([], {
    createComposition: () => ({ extraResources: [], packagedRuntimes: [] }),
    createDeploymentConfigurationComposition: emptyDeploymentComposition,
    loadTrackedPrivatePayloadPaths: () => [],
    projectRoot: resolve('.')
  })

  assert.deepEqual(result, {
    internalRuntimeCount: 0,
    publicReleaseForbiddenDeploymentConfigurationCount: 0,
    publicReleaseForbiddenContributionCount: 0,
    trackedPrivatePayloadCount: 0
  })
})

test('public release guard rejects arguments that could weaken the official policy', async () => {
  await assert.rejects(
    runPublicReleaseGuard(['--allow-internal'], {
      createComposition: () => ({ extraResources: [], packagedRuntimes: [] }),
      createDeploymentConfigurationComposition: emptyDeploymentComposition,
      loadTrackedPrivatePayloadPaths: () => [],
      projectRoot: '/trusted/repository'
    }),
    /does not accept arguments/
  )
})

test('configured guard preserves local internal acceptance unless public release mode is enabled', async () => {
  let compositionLoads = 0
  const result = await runConfiguredPublicReleaseGuard({
    environment: {},
    createComposition() {
      compositionLoads += 1
      return {
        extraResources: [{ from: 'internal/runtime', to: 'internal/runtime' }],
        packagedRuntimes: [{ packageName: '@fixture/internal-runtime' }]
      }
    },
    loadTrackedPrivatePayloadPaths: () => {
      compositionLoads += 1
      return ['internal/fixture/private.txt']
    },
    projectRoot: '/trusted/repository'
  })

  assert.equal(result, undefined)
  assert.equal(compositionLoads, 0)
})

test('configured guard fails closed for malformed and enabled public release modes', async () => {
  await assert.rejects(
    runConfiguredPublicReleaseGuard({
      environment: { SCIFORGE_PUBLIC_RELEASE: 'true' },
      createComposition: () => ({ extraResources: [], packagedRuntimes: [] }),
      loadTrackedPrivatePayloadPaths: () => [],
      projectRoot: '/trusted/repository'
    }),
    /must be exactly 1/u
  )
  assert.deepEqual(
    await runConfiguredPublicReleaseGuard({
      environment: { SCIFORGE_PUBLIC_RELEASE: '1' },
      createComposition: () => ({ extraResources: [], packagedRuntimes: [] }),
      createDeploymentConfigurationComposition: emptyDeploymentComposition,
      discoverDomainPackages: async () => [],
      loadTrackedPrivatePayloadPaths: () => [],
      projectRoot: '/trusted/repository'
    }),
    {
      internalRuntimeCount: 0,
      publicReleaseForbiddenDeploymentConfigurationCount: 0,
      publicReleaseForbiddenContributionCount: 0,
      trackedPrivatePayloadCount: 0
    }
  )
})

test('configured prebuild guard rejects any active contribution forbidden by its manifest', async () => {
  await assert.rejects(
    runConfiguredPublicReleaseGuard({
      environment: { SCIFORGE_PUBLIC_RELEASE: '1' },
      createComposition: () => ({ extraResources: [], packagedRuntimes: [] }),
      createDeploymentConfigurationComposition: emptyDeploymentComposition,
      discoverDomainPackages: async () => [domainPackageCandidate({
        contributionId: 'fixture.local-acceptance',
        publicRelease: 'forbidden'
      })],
      loadTrackedPrivatePayloadPaths: () => [],
      projectRoot: '/trusted/repository'
    }),
    /@fixture\/release-policy:fixture\.local-acceptance/u
  )
})

test('configured prebuild guard allows ordinary and inactive domain contributions', async () => {
  const result = await runConfiguredPublicReleaseGuard({
    environment: { SCIFORGE_PUBLIC_RELEASE: '1' },
    createComposition: () => ({ extraResources: [], packagedRuntimes: [] }),
    createDeploymentConfigurationComposition: emptyDeploymentComposition,
    discoverDomainPackages: async () => [
      domainPackageCandidate({
        packageName: '@fixture/release-policy-default',
        contributionId: 'fixture.default-allowed'
      }),
      domainPackageCandidate({
        packageName: '@fixture/release-policy-explicit',
        contributionId: 'fixture.explicitly-allowed',
        publicRelease: 'allowed'
      }),
      domainPackageCandidate({
        packageName: '@fixture/release-policy-development',
        composition: 'development-only',
        contributionId: 'fixture.inactive-local-only',
        publicRelease: 'forbidden'
      })
    ],
    loadTrackedPrivatePayloadPaths: () => [],
    projectRoot: '/trusted/repository'
  })

  assert.deepEqual(result, {
    internalRuntimeCount: 0,
    publicReleaseForbiddenDeploymentConfigurationCount: 0,
    publicReleaseForbiddenContributionCount: 0,
    trackedPrivatePayloadCount: 0
  })
})

test('generic contribution rejection does not expose package-owned contract values', () => {
  const sensitive = 'SENSITIVE-PROFILE-CONTRACT-SENTINEL'
  const candidate = domainPackageCandidate({
    contributionId: 'fixture.sanitized-local-acceptance',
    publicRelease: 'forbidden'
  })
  candidate.definition.contributionContracts = {
    'fixture.sanitized-local-acceptance': { opaqueEvidence: sensitive }
  }

  let diagnostic = ''
  assert.throws(
    () => assertPublicReleaseDomainContributionsSafe([candidate]),
    (error) => {
      diagnostic = error.message
      return true
    }
  )
  assert.match(diagnostic, /fixture\.sanitized-local-acceptance/u)
  assert.doesNotMatch(diagnostic, new RegExp(sensitive, 'u'))
})

test('npm prebuild checks configured public release composition before compilation', async () => {
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  const prebuild = packageJson.scripts?.prebuild || ''
  const guard = prebuild.indexOf('scripts/public-release-prebuild.cjs')
  const capabilityCheck = prebuild.indexOf('capability:check')
  assert.notEqual(guard, -1, 'prebuild must invoke the configured public release guard')
  assert.notEqual(capabilityCheck, -1, 'prebuild must retain capability governance')
  assert.ok(guard < capabilityCheck, 'public release guard must run before compilation checks')

  const source = await readFile(resolve('scripts/public-release-prebuild.cjs'), 'utf8')
  assert.match(source, /runConfiguredPublicReleaseGuard/u)
})

test('official Mac and Windows release entrypoints guard before build, signing, and upload', async () => {
  const checks = [
    {
      file: 'scripts/release-mac.sh',
      after: [
        'release_apply_signing_env',
        'build_macos',
        'gh release create',
        'gh release upload',
        'publish-r2.mjs'
      ]
    },
    {
      file: 'scripts/release-win.sh',
      after: [
        'npm run dist:win',
        'gh release upload',
        'publish-r2.mjs',
        'gh release edit'
      ]
    },
    {
      file: 'scripts/release-win.ps1',
      after: [
        '& npm run dist:win',
        '& gh release upload',
        'publish-r2.mjs',
        '& gh release edit'
      ]
    }
  ]

  for (const check of checks) {
    const source = (await readFile(resolve(check.file), 'utf8')).replaceAll('\\', '/')
    const guardIndex = source.indexOf('scripts/public-release-guard.cjs')
    const releaseModeIndex = source.indexOf('SCIFORGE_PUBLIC_RELEASE')
    assert.notEqual(guardIndex, -1, `${check.file} must invoke the public release guard`)
    assert.notEqual(releaseModeIndex, -1, `${check.file} must preserve public mode through after-pack`)
    assert.ok(releaseModeIndex < guardIndex, `${check.file} must set public mode before guarding`)
    for (const marker of check.after) {
      const markerIndex = source.indexOf(marker, guardIndex + 1)
      assert.notEqual(markerIndex, -1, `${check.file} is missing ${marker} after the guard`)
      assert.ok(guardIndex < markerIndex, `${check.file} must guard before ${marker}`)
    }
  }
})

test('after-pack rechecks public release composition immediately before packaged validation', async () => {
  const source = await readFile(resolve('scripts/after-pack.cjs'), 'utf8')
  const builderSource = await readFile(resolve('electron-builder.config.cjs'), 'utf8')
  const afterPackStart = source.indexOf('async function afterPack(context)')
  const afterPackBody = source.slice(afterPackStart, source.indexOf('\n}', afterPackStart))
  const publicCheck = afterPackBody.indexOf(
    'verifyOfficialPublicReleaseComposition(deploymentConfigurationComposition)'
  )
  const deploymentValidation = afterPackBody.indexOf(
    'verifyPackagedDeploymentConfigurations(context, deploymentConfigurationComposition)'
  )
  const internalValidation = afterPackBody.indexOf('verifyPackagedInternalRuntimes(context)')
  assert.notEqual(publicCheck, -1)
  assert.notEqual(deploymentValidation, -1)
  assert.notEqual(internalValidation, -1)
  assert.ok(publicCheck < deploymentValidation)
  assert.ok(publicCheck < internalValidation)
  assert.match(afterPackBody, /await verifyOfficialPublicReleaseComposition/u)
  assert.match(source, /await publicReleaseGuard\.runConfiguredPublicReleaseGuard/u)
  assert.match(source, /createComposition:\s*\(\)\s*=>\s*\n?\s*internalRuntimePackaging\.internalRuntimeComposition/u)
  assert.doesNotMatch(source, /createDomainPackageDeploymentConfigurationComposition/u)
  assert.match(builderSource, /createAfterPackHook\(\{\s*deploymentConfigurationComposition\s*\}\)/u)
  assert.doesNotMatch(builderSource, /afterPack:\s*['"]\.\/scripts\/after-pack\.cjs/u)
})

test('Linux packaging uses a stable unscoped executable name', () => {
  const builderConfig = require(resolve('electron-builder.config.cjs'))
  assert.equal(builderConfig.linux.executableName, 'sciforge')
})

test('after-pack verifies the same generic deployment composition in packaged resources', () => {
  const composition = emptyDeploymentComposition()
  let verified
  const afterPack = loadAfterPack({
    internalRuntimePackaging: {
      internalRuntimeComposition: { extraResources: [], packagedRuntimes: [] },
      verifyPackagedInternalRuntimes() {}
    },
    deploymentConfigurationPackaging: {
      verifyPackagedDomainDeploymentConfigurations(resourcesRoot, received) {
        verified = { resourcesRoot, composition: received }
      }
    }
  })

  afterPack._internals.verifyPackagedDeploymentConfigurations({
    appOutDir: '/packaged/application',
    electronPlatformName: 'linux'
  }, composition)

  assert.deepEqual(verified, {
    resourcesRoot: '/packaged/application/resources',
    composition
  })
})

test('after-pack never recomputes an active receipt after its source is removed', () => {
  const repository = mkdtempSync(join(tmpdir(), 'sciforge-after-pack-deployment-'))
  const appOutDir = join(repository, 'packaged')
  const resourcesRoot = join(appOutDir, 'resources')
  const sourcePath = join(repository, '.private/deployment.json')
  try {
    writeJson(join(repository, 'packages/domains/fixture/package.json'), {
      name: '@fixture/domain',
      version: '1.0.0',
      sciforgeDeploymentConfiguration: {
        contractVersion: 1,
        sourceRelativePath: '.private/deployment.json',
        packagedResourcesRelativePath: 'domain-deployments/fixture.json',
        maxBytes: 4096,
        publicRelease: 'forbidden'
      }
    })
    writeJson(join(repository, 'packages/domains/fixture/sciforge.domain.json'), {
      packageName: '@fixture/domain'
    })
    writeJson(sourcePath, {
      contractVersion: 1,
      providerInstanceRef: 'fixture',
      origin: 'https://tenant.example'
    })
    const captured = deploymentConfigurationPackaging
      .createDomainPackageDeploymentConfigurationComposition(repository)
    rmSync(sourcePath)
    mkdirSync(resourcesRoot, { recursive: true })

    let recompositions = 0
    const afterPack = loadAfterPack({
      internalRuntimePackaging: {
        internalRuntimeComposition: { extraResources: [], packagedRuntimes: [] },
        verifyPackagedInternalRuntimes() {}
      },
      deploymentConfigurationPackaging: {
        createDomainPackageDeploymentConfigurationComposition() {
          recompositions += 1
          return emptyDeploymentComposition()
        },
        verifyPackagedDomainDeploymentConfigurations:
          deploymentConfigurationPackaging.verifyPackagedDomainDeploymentConfigurations
      }
    })
    const context = { appOutDir, electronPlatformName: 'linux' }
    assert.throws(
      () => afterPack._internals.verifyPackagedDeploymentConfigurations(context, captured),
      /missing/u
    )
    writeJson(join(resourcesRoot, 'domain-deployments/fixture.json'), { drift: true })
    assert.throws(
      () => afterPack._internals.verifyPackagedDeploymentConfigurations(context, captured),
      /changed/u
    )
    assert.equal(recompositions, 0)
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
})

test('after-pack rejects an active contribution forbidden by its generic manifest policy', async () => {
  const afterPack = loadAfterPackWithoutInternalRuntimes()
  await assert.rejects(
    afterPack._internals.verifyOfficialPublicReleaseComposition(
      emptyDeploymentComposition(),
      {
        environment: { SCIFORGE_PUBLIC_RELEASE: '1' },
        discoverDomainPackages: async () => [domainPackageCandidate({
          contributionId: 'fixture.packaged-local-acceptance',
          publicRelease: 'forbidden'
        })],
        loadTrackedPrivatePayloadPaths: () => [],
        projectRoot: '/trusted/repository'
      }
    ),
    /@fixture\/release-policy:fixture\.packaged-local-acceptance/u
  )
})

test('after-pack rejects a package-owned deployment configuration forbidden in public builds', async () => {
  const afterPack = loadAfterPack({
    internalRuntimePackaging: {
      internalRuntimeComposition: { extraResources: [], packagedRuntimes: [] },
      verifyPackagedInternalRuntimes() {}
    },
    deploymentConfigurationPackaging: {
      createDomainPackageDeploymentConfigurationComposition: () => deploymentComposition(),
      verifyPackagedDomainDeploymentConfigurations() {}
    }
  })

  await assert.rejects(
    afterPack._internals.verifyOfficialPublicReleaseComposition(
      deploymentComposition(),
      {
        environment: { SCIFORGE_PUBLIC_RELEASE: '1' },
        discoverDomainPackages: async () => [],
        loadTrackedPrivatePayloadPaths: () => [],
        projectRoot: '/trusted/repository'
      }
    ),
    /@fixture\/private-deployment/u
  )
})

test('after-pack allows active contributions that permit public release', async () => {
  const afterPack = loadAfterPackWithoutInternalRuntimes()

  await afterPack._internals.verifyOfficialPublicReleaseComposition(
    emptyDeploymentComposition(),
    {
      environment: { SCIFORGE_PUBLIC_RELEASE: '1' },
      discoverDomainPackages: async () => [domainPackageCandidate({
        contributionId: 'fixture.packaged-public',
        publicRelease: 'allowed'
      })],
      loadTrackedPrivatePayloadPaths: () => [],
      projectRoot: '/trusted/repository'
    }
  )
})

test('after-pack rejects malformed public release mode instead of treating it as disabled', async () => {
  const afterPack = loadAfterPackWithoutInternalRuntimes()
  const previous = process.env.SCIFORGE_PUBLIC_RELEASE
  process.env.SCIFORGE_PUBLIC_RELEASE = 'true'
  try {
    await assert.rejects(
      afterPack._internals.verifyOfficialPublicReleaseComposition(
        emptyDeploymentComposition()
      ),
      /must be exactly 1/u
    )
  } finally {
    if (previous === undefined) delete process.env.SCIFORGE_PUBLIC_RELEASE
    else process.env.SCIFORGE_PUBLIC_RELEASE = previous
  }
})

test('after-pack leaves ordinary local internal acceptance mode unchanged', async () => {
  const afterPack = loadAfterPackWithoutInternalRuntimes()
  const previous = process.env.SCIFORGE_PUBLIC_RELEASE
  delete process.env.SCIFORGE_PUBLIC_RELEASE
  try {
    await afterPack._internals.verifyOfficialPublicReleaseComposition(
      emptyDeploymentComposition()
    )
  } finally {
    if (previous === undefined) delete process.env.SCIFORGE_PUBLIC_RELEASE
    else process.env.SCIFORGE_PUBLIC_RELEASE = previous
  }
})

test('GitHub public release jobs guard before build, signing credentials, and publish', async () => {
  const source = await readFile(resolve('.github/workflows/release.yml'), 'utf8')
  assert.match(source, /SCIFORGE_PUBLIC_RELEASE: "1"/u)
  const checks = [
    ['build-macos:', 'build-windows:', ['Decode Apple signing credentials', 'npm run dist:mac:signed']],
    ['build-windows:', 'build-linux:', ['npm run dist:win']],
    ['build-linux:', 'publish:', ['npm run dist:linux']],
    ['publish:', null, [
      'gh release create',
      'gh release upload',
      'publish-r2.mjs',
      'gh release edit'
    ]]
  ]
  for (const [startMarker, endMarker, after] of checks) {
    const start = source.indexOf(startMarker)
    const end = endMarker === null ? source.length : source.indexOf(endMarker, start + 1)
    const section = source.slice(start, end)
    const guard = section.indexOf('node ./scripts/public-release-guard.cjs')
    assert.notEqual(guard, -1, `${startMarker} must invoke the public release guard`)
    for (const marker of after) {
      const markerIndex = section.indexOf(marker)
      assert.notEqual(markerIndex, -1, `${startMarker} is missing ${marker}`)
      assert.ok(guard < markerIndex, `${startMarker} must guard before ${marker}`)
    }
  }
})

function domainPackageCandidate({
  packageName = '@fixture/release-policy',
  composition = 'production',
  contributionId,
  publicRelease
}) {
  return {
    definition: {
      contractVersion: 1,
      kind: 'trusted-compile-time',
      composition,
      packageName,
      module: {
        id: packageName.replace(/^@fixture\//u, 'fixture.'),
        displayName: 'Fixture Release Policy',
        version: '1.0.0',
        hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
        priority: 100
      },
      contributionContracts: {},
      entrypoints: [{
        process: 'main',
        export: './main',
        contributions: [{
          id: contributionId,
          kind: 'main.extension',
          ...(publicRelease === undefined ? {} : { publicRelease }),
          priority: 100
        }]
      }]
    }
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value), 'utf8')
}
