import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  CLOUD_IDENTITY_SMOKE_CAPABILITY_IDS,
  CONTENT_SPACE_SMOKE_CAPABILITY_IDS,
  IDENTITY_SMOKE_CAPABILITY_IDS,
  REQUIRED_CAPABILITY_IDS,
  cleanupElectronSmoke,
  createElectronSmokeTemporaryDirectory,
  createIdentitySmokeInvocationId,
  createSourceSmokeConfiguration,
  electronSmokeRemoveOptions,
  locatePackagedExecutable,
  makeExecutableForTest,
  parseSmokeCliOptions,
  removeElectronSmokeTemporaryDirectory,
  runElectronDomainSmoke,
  validateSmokeResult
} from './electron-domain-smoke-support.mjs'

test('supervised source smoke keeps its profile inside the owned run directory', async () => {
  const runDirectory = await mkdtemp(join(tmpdir(), 'sciforge-electron-supervised-run-'))
  try {
    const profileDirectory = await createElectronSmokeTemporaryDirectory(runDirectory)
    assert.equal(
      profileDirectory,
      join(resolve(runDirectory), 'profiles/electron-domain-smoke')
    )
    await removeElectronSmokeTemporaryDirectory(profileDirectory, runDirectory)
    await assert.doesNotReject(access(profileDirectory))
  } finally {
    await rm(runDirectory, { recursive: true, force: true })
  }
})

test('Windows smoke cleanup uses bounded retries for transient file locks', () => {
  assert.deepEqual(electronSmokeRemoveOptions('win32'), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  })
  assert.deepEqual(electronSmokeRemoveOptions('linux'), {
    recursive: true,
    force: true
  })
})

test('smoke preserves a primary first-window failure when cleanup also fails', async () => {
  const runDirectory = await mkdtemp(join(tmpdir(), 'sciforge-electron-primary-error-'))
  const executable = join(runDirectory, 'sciforge-test')
  const previousRunDirectory = process.env.SCIFORGE_E2E_RUN_DIRECTORY
  const cleanupErrors = []
  await writeFile(executable, '')
  await makeExecutableForTest(executable)
  process.env.SCIFORGE_E2E_RUN_DIRECTORY = runDirectory
  try {
    const child = Object.assign(new EventEmitter(), {
      exitCode: 0,
      signalCode: null,
      kill: () => true
    })
    const primary = new Error('primary first-window failure')
    const electronApp = {
      process: () => child,
      close: async () => undefined,
      on: () => undefined,
      firstWindow: async () => { throw primary }
    }
    await assert.rejects(runElectronDomainSmoke({
      executablePath: executable,
      label: 'test',
      timeoutMs: 1_000,
      loadElectron: async () => ({ launch: async () => electronApp }),
      removeTemporaryDirectory: async () => { throw new Error('cleanup lock failure') },
      reportCleanupError: (error) => cleanupErrors.push(error)
    }), (error) => {
      assert.match(error.message, /primary first-window failure/u)
      assert.doesNotMatch(error.message, /cleanup lock failure/u)
      return true
    })
    assert.equal(cleanupErrors.length, 1)
    assert.match(cleanupErrors[0].message, /Electron smoke cleanup failed/u)
  } finally {
    if (previousRunDirectory === undefined) delete process.env.SCIFORGE_E2E_RUN_DIRECTORY
    else process.env.SCIFORGE_E2E_RUN_DIRECTORY = previousRunDirectory
    await rm(runDirectory, { recursive: true, force: true })
  }
})

test('smoke exposes cleanup failure when no primary failure exists', async () => {
  await assert.rejects(cleanupElectronSmoke({
    temporaryDirectory: '/tmp/sciforge-cleanup-only',
    removeTemporaryDirectory: async () => { throw new Error('cleanup-only failure') }
  }), (error) => {
    assert.equal(error.message, 'Electron smoke cleanup failed.')
    assert.match(String(error.errors?.[0]), /cleanup-only failure/u)
    return true
  })
})

test('domain smoke requires every Identity and Content Space capability exactly once', () => {
  assert.deepEqual(IDENTITY_SMOKE_CAPABILITY_IDS, [
    'identity.local.inspect',
    'identity.local.list-accounts',
    'identity.local.create-account',
    'identity.local.select-account',
    'identity.local.rename-account',
    'identity.local.exit-account',
    'identity.local.dismiss-first-prompt',
    'identity.local.backup-and-reset'
  ])
  assert.deepEqual(CONTENT_SPACE_SMOKE_CAPABILITY_IDS, [
    'content-space.list-provider-instances',
    'content-space.describe-capabilities',
    'content-space.list-containers',
    'content-space.list-entries',
    'content-space.observe-entry',
    'content-space.create-folder',
    'content-space.upload-new',
    'content-space.download',
    'content-space.resolve-portal-target',
    'content-space.open-portal-target',
    'content-space.observe-immutable-version'
  ])
  assert.deepEqual(CLOUD_IDENTITY_SMOKE_CAPABILITY_IDS, [
    'identity.cloud.inspect',
    'identity.cloud.login',
    'identity.cloud.reauthenticate',
    'identity.cloud.logout',
    'identity.cloud.enroll-device',
    'identity.cloud.refresh-devices',
    'identity.cloud.revoke-device'
  ])
  assert.equal(new Set(REQUIRED_CAPABILITY_IDS).size, REQUIRED_CAPABILITY_IDS.length)
  for (const capabilityId of [
    ...IDENTITY_SMOKE_CAPABILITY_IDS,
    ...CLOUD_IDENTITY_SMOKE_CAPABILITY_IDS,
    ...CONTENT_SPACE_SMOKE_CAPABILITY_IDS
  ]) {
    assert.equal(REQUIRED_CAPABILITY_IDS.filter((candidate) => candidate === capabilityId).length, 1)
  }
})

test('Identity smoke account creation receives a fresh bounded invocation identity', () => {
  const first = createIdentitySmokeInvocationId(() => '00000000-0000-4000-8000-000000000001')
  const second = createIdentitySmokeInvocationId(() => '00000000-0000-4000-8000-000000000002')

  assert.equal(first, 'electron-smoke-identity-create-00000000-0000-4000-8000-000000000001')
  assert.equal(second, 'electron-smoke-identity-create-00000000-0000-4000-8000-000000000002')
  assert.notEqual(first, second)
  assert.match(first, /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/u)
})

test('smoke result requires the selected Identity and a composed Content Space Provider', () => {
  const valid = validSmokeResult()
  assert.doesNotThrow(() => validateSmokeResult(valid, { expectedRendererUrl: valid.url }))
  assert.throws(
    () => validateSmokeResult({ ...valid, identityAccountUsername: 'someone_else' }, {
      expectedRendererUrl: valid.url
    }),
    /Identity account/u
  )
  assert.throws(
    () => validateSmokeResult({ ...valid, contentSpaceProviderInstanceCount: 0 }, {
      expectedRendererUrl: valid.url
    }),
    /Content Space Provider Instance/u
  )
})

function validSmokeResult() {
  return {
    url: 'file:///electron-domain-smoke/index.html',
    platform: 'darwin',
    readiness: 'ready',
    datasetLoopCreated: true,
    datasetLoopWorkflowCount: 2,
    paperRadarActionId: 'paper-radar.status',
    workspacePreviewActionId: 'workspace-preview.list',
    previewPluginCount: 1,
    workspacePreviewPluginId: 'markdown',
    workspacePreviewReleased: true,
    artifactVersionsActionId: 'artifact-versions.list',
    evidenceDagActionId: 'evidence-dag.view',
    scientificPlottingActionId: 'scientific-plotting.status',
    visualReviewActionId: 'visual-review.open',
    identityActionId: 'identity.local.create-account',
    identityAccountUsername: 'electron_smoke',
    contentSpaceProviderActionId: 'content-space.list-provider-instances',
    contentSpaceProviderInstanceRef: 'installed-provider',
    contentSpaceProviderInstanceCount: 1,
    nativeVisual: {
      toolNames: ['sciforge_look', 'sciforge_capture'],
      cropped: true,
      nativeImageBindingValidated: true,
      proofChainValidated: true,
      datasetLoopCapabilitiesDiscoverable: true,
      unavailableRouteFailedVisibly: true
    },
    codexPreToolUseHook: {
      denied: true,
      reason: 'sciforge_hook_deny_challenge:validated'
    }
  }
}

test('source smoke requires the app, hook, preload, and renderer outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-smoke-source-test-'))
  try {
    await mkdir(join(root, 'out/main'), { recursive: true })
    await mkdir(join(root, 'out/preload'), { recursive: true })
    await mkdir(join(root, 'out/renderer'), { recursive: true })
    await Promise.all([
      writeFile(join(root, 'out/main/index.js'), ''),
      writeFile(join(root, 'out/main/codex-pre-tool-use-governance-node-entry.js'), ''),
      writeFile(join(root, 'out/preload/index.cjs'), ''),
      writeFile(join(root, 'out/renderer/index.html'), '')
    ])

    const configuration = await createSourceSmokeConfiguration(root)
    assert.equal(configuration.applicationPath, root)
    assert.match(configuration.expectedRendererUrl, /\/out\/renderer\/index\.html$/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('packaged locator selects the current architecture app from multiple mac builds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-smoke-packaged-test-'))
  try {
    const arm = join(root, 'mac-arm64/SciForge.app/Contents/MacOS/SciForge')
    const x64 = join(root, 'mac-x64/SciForge.app/Contents/MacOS/SciForge')
    await mkdir(join(root, 'mac-arm64/SciForge.app/Contents/MacOS'), { recursive: true })
    await mkdir(join(root, 'mac-x64/SciForge.app/Contents/MacOS'), { recursive: true })
    await writeFile(arm, '')
    await writeFile(x64, '')
    await makeExecutableForTest(arm)
    await makeExecutableForTest(x64)

    assert.equal(await locatePackagedExecutable({
      distDirectory: root,
      platform: 'darwin',
      arch: 'arm64',
      productName: 'SciForge'
    }), arm)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('packaged locator does not select archived artifacts nested below the requested dist directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-smoke-packaged-depth-test-'))
  try {
    const current = join(root, 'mac/SciForge.app/Contents/MacOS/SciForge')
    const archived = join(root, 'release-previous/mac-arm64/SciForge.app/Contents/MacOS/SciForge')
    await mkdir(join(root, 'mac/SciForge.app/Contents/MacOS'), { recursive: true })
    await mkdir(join(root, 'release-previous/mac-arm64/SciForge.app/Contents/MacOS'), { recursive: true })
    await writeFile(current, '')
    await writeFile(archived, '')
    await makeExecutableForTest(current)
    await makeExecutableForTest(archived)

    assert.equal(await locatePackagedExecutable({
      distDirectory: root,
      platform: 'darwin',
      arch: 'arm64',
      productName: 'SciForge'
    }), current)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('packaged locator rejects a generic mac artifact with an incompatible binary architecture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-smoke-packaged-arch-test-'))
  try {
    const executable = join(root, 'mac/SciForge.app/Contents/MacOS/SciForge')
    const machOHeader = Buffer.alloc(32)
    machOHeader.writeUInt32LE(0xfeedfacf, 0)
    machOHeader.writeUInt32LE(0x01000007, 4)
    await mkdir(join(root, 'mac/SciForge.app/Contents/MacOS'), { recursive: true })
    await writeFile(executable, machOHeader)
    await makeExecutableForTest(executable)

    await assert.rejects(locatePackagedExecutable({
      distDirectory: root,
      platform: 'darwin',
      arch: 'arm64',
      productName: 'SciForge'
    }), /compatible with darwin\/arm64/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('packaged locator fails closed when several compatible artifacts remain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-smoke-ambiguous-test-'))
  try {
    for (const directory of ['linux-arm64-unpacked', 'linux-arm64-debug-unpacked']) {
      const executable = join(root, directory, 'sciforge')
      await mkdir(join(root, directory), { recursive: true })
      await writeFile(executable, '')
      await makeExecutableForTest(executable)
    }
    await assert.rejects(locatePackagedExecutable({
      distDirectory: root,
      platform: 'linux',
      arch: 'arm64',
      productName: 'SciForge'
    }), /Multiple unpacked/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CLI parser normalizes paths and validates bounded timeouts', () => {
  const parsed = parseSmokeCliOptions([
    '--repository-root', '.',
    '--dist-dir', './dist',
    '--timeout-ms', '60000'
  ])
  assert.equal(parsed.timeoutMs, 60_000)
  assert.equal(parsed.repositoryRoot, resolve('.'))
  assert.equal(parsed.distDirectory, resolve('./dist'))
  assert.throws(() => parseSmokeCliOptions(['--timeout-ms', '1']), /between 1000 and 300000/u)
  assert.throws(() => parseSmokeCliOptions(['--unknown', 'value']), /Unknown/u)
})
