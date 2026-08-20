const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { resolve } = require('node:path')
const test = require('node:test')

const {
  assertPublicReleaseCompositionEmpty,
  runPublicReleaseGuard
} = require('./public-release-guard.cjs')
const afterPack = require('./after-pack.cjs')

test('public release guard accepts only an empty internal runtime composition', () => {
  assert.deepEqual(
    assertPublicReleaseCompositionEmpty({ packagedRuntimes: [] }),
    { internalRuntimeCount: 0 }
  )
  assert.throws(
    () => assertPublicReleaseCompositionEmpty({
      packagedRuntimes: [
        { packageName: '@private/zeta' },
        { packageName: '@private/alpha' }
      ]
    }),
    /@private\/alpha, @private\/zeta/
  )
})

test('public release guard discovers composition through the canonical generator', () => {
  let discoveredRoot
  const result = runPublicReleaseGuard([], {
    createComposition(root) {
      discoveredRoot = root
      return { packagedRuntimes: [] }
    },
    projectRoot: '/trusted/repository'
  })
  assert.equal(discoveredRoot, '/trusted/repository')
  assert.deepEqual(result, { internalRuntimeCount: 0 })
})

test('public release guard rejects arguments that could weaken the official policy', () => {
  assert.throws(
    () => runPublicReleaseGuard(['--allow-internal'], {
      createComposition: () => ({ packagedRuntimes: [] }),
      projectRoot: '/trusted/repository'
    }),
    /does not accept arguments/
  )
})

test('official Mac and Windows release entrypoints guard before build, signing, and upload', async () => {
  const checks = [
    {
      file: 'scripts/release-mac.sh',
      after: [
        'release_apply_signing_env',
        'build_macos',
        'gh release create',
        'gh release upload'
      ]
    },
    {
      file: 'scripts/release-win.sh',
      after: [
        'npm run dist:win',
        'gh release upload',
        'gh release edit'
      ]
    },
    {
      file: 'scripts/release-win.ps1',
      after: [
        '& npm run dist:win',
        '& gh release upload',
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
  assert.match(source, /SCIFORGE_PUBLIC_RELEASE must be exactly 1/u)
  assert.match(source, /assertPublicReleaseCompositionEmpty/u)
})

test('after-pack rejects malformed public release mode instead of treating it as disabled', () => {
  const previous = process.env.SCIFORGE_PUBLIC_RELEASE
  process.env.SCIFORGE_PUBLIC_RELEASE = 'true'
  try {
    assert.throws(
      () => afterPack._internals.verifyOfficialPublicReleaseComposition(),
      /must be exactly 1/u
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
    ['publish:', null, ['gh release create', 'gh release upload', 'gh release edit']]
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
