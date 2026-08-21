const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { resolve } = require('node:path')
const test = require('node:test')

const {
  assertPublicReleaseCompositionSafe,
  findContentSpaceVerificationProfileContributions,
  runConfiguredPublicReleaseGuard,
  runPublicReleaseGuard
} = require('./public-release-guard.cjs')
const afterPack = require('./after-pack.cjs')

test('public release guard accepts only an empty internal runtime composition', () => {
  assert.deepEqual(
    assertPublicReleaseCompositionSafe({ packagedRuntimes: [], domainPackages: [] }),
    { internalRuntimeCount: 0, verificationProfileCount: 0 }
  )
  assert.throws(
    () => assertPublicReleaseCompositionSafe({
      packagedRuntimes: [
        { packageName: '@private/zeta' },
        { packageName: '@private/alpha' }
      ],
      domainPackages: []
    }),
    /@private\/alpha, @private\/zeta/
  )
})

test('public release guard rejects an active trusted verification profile from canonical main composition', () => {
  assert.throws(
    () => assertPublicReleaseCompositionSafe({
      packagedRuntimes: [],
      domainPackages: [trustedDomainDefinition({
        contract: verificationProfileContract()
      })]
    }),
    /Refusing to build or publish.*@fixture\/content-space-verification/u
  )
})

test('profile discovery requires the manifest contract and matching main runtime contribution', () => {
  const developmentOnly = trustedDomainDefinition({
    composition: 'development-only',
    contract: verificationProfileContract()
  })
  const rendererOnly = trustedDomainDefinition({
    contract: verificationProfileContract(),
    process: 'renderer',
    contributionKind: 'renderer.extension'
  })
  const unrelatedMainExtension = trustedDomainDefinition({
    contract: {
      location: 'main.unrelated-fixture',
      principal: 'fixture-principal',
      externalBinding: 'fixture-external-binding',
      root: 'fixture-root'
    }
  })
  const contractWithoutRuntimeDeclaration = trustedDomainDefinition({
    contract: verificationProfileContract(),
    contributions: []
  })
  const runtimeDeclarationWithoutContract = trustedDomainDefinition({ contract: undefined })

  assert.deepEqual(
    assertPublicReleaseCompositionSafe({
      packagedRuntimes: [],
      domainPackages: [
        developmentOnly,
        rendererOnly,
        unrelatedMainExtension,
        contractWithoutRuntimeDeclaration,
        runtimeDeclarationWithoutContract
      ]
    }),
    { internalRuntimeCount: 0, verificationProfileCount: 0 }
  )
  assert.deepEqual(
    findContentSpaceVerificationProfileContributions(
      [developmentOnly],
      { includeDevelopmentOnly: true }
    ),
    [{
      packageName: '@fixture/content-space-verification',
      contributionId: 'fixture.content-space-verification'
    }]
  )
})

test('profile rejection never echoes Principal, external binding, or root contract contents', () => {
  const contract = verificationProfileContract()
  contract.profile.principal.subject = 'SENSITIVE-PRINCIPAL-SENTINEL'
  contract.profile.externalBinding.externalSubject = 'SENSITIVE-BINDING-SENTINEL'
  contract.profile.authority.root.containerId = 'SENSITIVE-ROOT-SENTINEL'

  let diagnostic = ''
  assert.throws(
    () => assertPublicReleaseCompositionSafe({
      packagedRuntimes: [],
      domainPackages: [trustedDomainDefinition({ contract })]
    }),
    (error) => {
      diagnostic = error.message
      return true
    }
  )
  assert.match(diagnostic, /@fixture\/content-space-verification:fixture\.content-space-verification/u)
  assert.doesNotMatch(diagnostic, /SENSITIVE-/u)
})

test('public release guard accepts canonical composition without active verification profiles', async () => {
  let discoveredRoot
  const result = await runPublicReleaseGuard([], {
    createComposition(root) {
      discoveredRoot = root
      return { packagedRuntimes: [] }
    },
    loadDomainPackages: async () => [],
    projectRoot: '/trusted/repository'
  })
  assert.equal(discoveredRoot, '/trusted/repository')
  assert.deepEqual(result, {
    internalRuntimeCount: 0,
    verificationProfileCount: 0
  })
})

test('public release guard rejects a verification profile loaded by canonical domain discovery', async () => {
  const discoveredRoots = []
  await assert.rejects(
    runPublicReleaseGuard([], {
      createComposition(root) {
        discoveredRoots.push(root)
        return { packagedRuntimes: [] }
      },
      loadDomainPackages: async (root) => {
        discoveredRoots.push(root)
        return [trustedDomainDefinition({ contract: verificationProfileContract() })]
      },
      projectRoot: '/trusted/repository'
    }),
    /Refusing to build or publish.*@fixture\/content-space-verification/u
  )
  assert.deepEqual(discoveredRoots, [
    '/trusted/repository',
    '/trusted/repository'
  ])
})

test('public release guard rejects arguments that could weaken the official policy', async () => {
  await assert.rejects(
    runPublicReleaseGuard(['--allow-internal'], {
      createComposition: () => ({ packagedRuntimes: [] }),
      loadDomainPackages: async () => [],
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
      return { packagedRuntimes: [{ packageName: '@fixture/internal-runtime' }] }
    },
    loadDomainPackages: async () => {
      compositionLoads += 1
      return [trustedDomainDefinition({ contract: verificationProfileContract() })]
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
      createComposition: () => ({ packagedRuntimes: [] }),
      loadDomainPackages: async () => [],
      projectRoot: '/trusted/repository'
    }),
    /must be exactly 1/u
  )
  await assert.rejects(
    runConfiguredPublicReleaseGuard({
      environment: { SCIFORGE_PUBLIC_RELEASE: '1' },
      createComposition: () => ({ packagedRuntimes: [] }),
      loadDomainPackages: async () => [
        trustedDomainDefinition({ contract: verificationProfileContract() })
      ],
      projectRoot: '/trusted/repository'
    }),
    /@fixture\/content-space-verification/u
  )
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
  const afterPackStart = source.indexOf('async function afterPack(context)')
  const afterPackBody = source.slice(afterPackStart, source.indexOf('\n}', afterPackStart))
  const publicCheck = afterPackBody.indexOf('verifyOfficialPublicReleaseComposition()')
  const internalValidation = afterPackBody.indexOf('verifyPackagedInternalRuntimes(context)')
  assert.notEqual(publicCheck, -1)
  assert.notEqual(internalValidation, -1)
  assert.ok(publicCheck < internalValidation)
  assert.match(afterPackBody, /await verifyOfficialPublicReleaseComposition/u)
  assert.match(source, /await publicReleaseGuard\.runConfiguredPublicReleaseGuard/u)
  assert.match(source, /createComposition:\s*\(\)\s*=>\s*\n?\s*internalRuntimePackaging\.internalRuntimeComposition/u)
})

test('after-pack rejects malformed public release mode instead of treating it as disabled', async () => {
  const previous = process.env.SCIFORGE_PUBLIC_RELEASE
  process.env.SCIFORGE_PUBLIC_RELEASE = 'true'
  try {
    await assert.rejects(
      afterPack._internals.verifyOfficialPublicReleaseComposition(),
      /must be exactly 1/u
    )
  } finally {
    if (previous === undefined) delete process.env.SCIFORGE_PUBLIC_RELEASE
    else process.env.SCIFORGE_PUBLIC_RELEASE = previous
  }
})

test('after-pack leaves ordinary local internal acceptance mode unchanged', async () => {
  const previous = process.env.SCIFORGE_PUBLIC_RELEASE
  delete process.env.SCIFORGE_PUBLIC_RELEASE
  try {
    await afterPack._internals.verifyOfficialPublicReleaseComposition()
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

function trustedDomainDefinition({
  composition = 'production',
  contract,
  process = 'main',
  contributionKind = 'main.extension',
  contributions
}) {
  const contributionId = 'fixture.content-space-verification'
  return {
    contractVersion: 1,
    kind: 'trusted-compile-time',
    composition,
    packageName: '@fixture/content-space-verification',
    module: {
      id: 'fixture.content-space-verification',
      displayName: 'Fixture Content Space Verification',
      version: '1.0.0',
      hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
      priority: 100
    },
    ...(contract === undefined ? {} : {
      contributionContracts: { [contributionId]: contract }
    }),
    entrypoints: [{
      process,
      export: process === 'renderer' ? './renderer' : './main',
      contributions: contributions ?? [{
        id: contributionId,
        kind: contributionKind,
        version: '2.0.0',
        priority: 100
      }]
    }]
  }
}

function verificationProfileContract() {
  return {
    location: 'main.content-space-verification-profile',
    contractVersion: '2.0.0',
    profile: {
      profileId: 'fixture-profile',
      providerInstanceRef: 'provider-instance-fixture',
      principal: {
        authority: 'fixture.identity',
        subject: 'fixture-subject',
        assurance: 'local-selection',
        deviceId: 'fixture-device',
        identityVersion: 1
      },
      audience: 'agent',
      authority: {
        kind: 'content-root',
        root: {
          providerInstanceRef: 'provider-instance-fixture',
          containerId: 'fixture-root'
        }
      },
      operation: { family: 'ordinary', operation: 'upload-new-file' },
      transferLimits: { maxUploadBytes: 16 * 1024 * 1024, maxDownloadBytes: 0 },
      externalBinding: {
        externalSubject: 'fixture-external-subject',
        bindingRevision: 'fixture-binding-revision'
      },
      validFrom: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-21T01:00:00.000Z'
    }
  }
}
