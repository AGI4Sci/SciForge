import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

const require = createRequire(import.meta.url)
const publicReleaseGuardPath = require.resolve('./public-release-guard.cjs')
const publicReleaseGuardModule = require(publicReleaseGuardPath)
const canonicalRunPublicReleaseGuard = publicReleaseGuardModule.runPublicReleaseGuard
const cachedPublicReleaseGuardModule = require.cache[publicReleaseGuardPath]
let activePublicReleaseGuard = canonicalRunPublicReleaseGuard

require.cache[publicReleaseGuardPath] = {
  ...cachedPublicReleaseGuardModule,
  exports: {
    ...publicReleaseGuardModule,
    runPublicReleaseGuard: (argv) => activePublicReleaseGuard(argv)
  }
}
const {
  runPublishR2Command,
  uploadPlatform: actualUploadPlatform
} = await import('./publish-r2.mjs?publish-r2-test')
require.cache[publicReleaseGuardPath] = cachedPublicReleaseGuardModule
const {
  createPublicReleaseArtifactBuildEvidence,
  createPublicReleaseArtifactHooks,
  createPublicReleaseArtifactReceipt,
  publicReleaseArtifactReceiptPath,
  sealConfiguredPublicReleaseArtifactReceipt
} = require('./public-release-artifact-receipt.cjs')

const SOURCE_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8'
}).trim()

function safeDeploymentComposition() {
  return {
    extraResources: [],
    deploymentConfigurationDeclarations: [],
    activeDeploymentConfigurationReceipts: []
  }
}

function guardOptionsWithPrivateComposition() {
  return {
    createComposition: () => ({
      extraResources: [{ from: 'internal/fixture', to: 'fixture' }],
      packagedRuntimes: [{ packageName: '@fixture/private-runtime' }]
    }),
    createDeploymentConfigurationComposition: safeDeploymentComposition,
    discoverDomainPackages: async () => [],
    loadTrackedPrivatePayloadPaths: () => [],
    projectRoot: '/trusted/repository'
  }
}

function guardOptionsWithForbiddenDeployment() {
  const sourceRelativePath = 'private/deployment.json'
  const packagedResourcesRelativePath = 'deployment/fixture.json'
  return {
    createComposition: () => ({ extraResources: [], packagedRuntimes: [] }),
    createDeploymentConfigurationComposition: () => ({
      extraResources: [{
        from: sourceRelativePath,
        to: packagedResourcesRelativePath
      }],
      deploymentConfigurationDeclarations: [{
        contractVersion: 1,
        packageName: '@fixture/private-deployment',
        sourceRelativePath,
        packagedResourcesRelativePath,
        maxBytes: 1024,
        publicRelease: 'forbidden'
      }],
      activeDeploymentConfigurationReceipts: [{
        packageName: '@fixture/private-deployment',
        sourceRelativePath,
        packagedResourcesRelativePath,
        maxBytes: 1024,
        size: 64,
        sha256: 'a'.repeat(64),
        publicRelease: 'forbidden'
      }]
    }),
    discoverDomainPackages: async () => [],
    loadTrackedPrivatePayloadPaths: () => [],
    projectRoot: '/trusted/repository'
  }
}

function cleanGuardOptions() {
  return {
    createComposition: () => ({ extraResources: [], packagedRuntimes: [] }),
    createDeploymentConfigurationComposition: safeDeploymentComposition,
    discoverDomainPackages: async () => [],
    loadTrackedPrivatePayloadPaths: () => [],
    projectRoot: '/trusted/repository'
  }
}

function writeSyntheticLinuxReceipt(distDir, { includeBlockmap = false } = {}) {
  const artifactBytes = Buffer.from('public-linux-artifact')
  const fileName = 'SciForge-1.2.3-linux-x86_64.AppImage'
  const blockmapFileName = `${fileName}.blockmap`
  const blockmapBytes = Buffer.from('public-linux-blockmap')
  const updateMetadataFileName = 'latest-linux.yml'
  const artifactPath = join(distDir, fileName)
  const sha512 = createHash('sha512').update(artifactBytes).digest('base64')
  const updateMetadata = [
    'version: 1.2.3',
    'files:',
    `  - url: ${fileName}`,
    `    sha512: ${sha512}`,
    `    size: ${artifactBytes.length}`,
    `path: ${fileName}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-08-23T00:00:00.000Z'",
    ''
  ].join('\n')
  writeFileSync(artifactPath, artifactBytes)
  if (includeBlockmap) writeFileSync(join(distDir, blockmapFileName), blockmapBytes)
  writeFileSync(join(distDir, updateMetadataFileName), updateMetadata)

  const files = [
    {
      buildEvidenceSha256: 'b'.repeat(64),
      fileName,
      role: 'update-package',
      size: artifactBytes.length,
      sha256: createHash('sha256').update(artifactBytes).digest('hex'),
      sha512
    },
    ...(includeBlockmap
      ? [{
          buildEvidenceSha256: 'c'.repeat(64),
          fileName: blockmapFileName,
          role: 'blockmap',
          size: blockmapBytes.length,
          sha256: createHash('sha256').update(blockmapBytes).digest('hex'),
          sha512: createHash('sha512').update(blockmapBytes).digest('base64')
        }]
      : []),
    {
      buildEvidenceSha256: null,
      fileName: updateMetadataFileName,
      role: 'update-metadata',
      size: Buffer.byteLength(updateMetadata),
      sha256: createHash('sha256').update(updateMetadata).digest('hex'),
      sha512: createHash('sha512').update(updateMetadata).digest('base64')
    }
  ].sort((left, right) => left.fileName.localeCompare(right.fileName))
  const receipt = {
    schemaVersion: 1,
    kind: 'sciforge-public-release-artifact-receipt',
    productName: 'SciForge',
    version: '1.2.3',
    tag: 'v1.2.3',
    channel: 'frontier',
    platform: 'linux',
    sourceCommit: SOURCE_COMMIT,
    releaseDate: '2026-08-23T00:00:00.000Z',
    updateMetadataFileName,
    publicReleaseGuard: {
      internalRuntimeCount: 0,
      publicReleaseForbiddenDeploymentConfigurationCount: 0,
      publicReleaseForbiddenContributionCount: 0,
      trackedPrivatePayloadCount: 0
    },
    composition: {
      internalRuntime: { extraResources: [], packagedRuntimes: [] },
      deploymentConfigurations: {
        extraResources: [],
        activeDeploymentConfigurationReceipts: []
      }
    },
    files,
    inventorySha256: createHash('sha256').update(JSON.stringify(files)).digest('hex')
  }
  const receiptPath = publicReleaseArtifactReceiptPath(distDir, 'linux')
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  return { artifactPath, receipt }
}

const COMMANDS = [
  {
    name: 'upload',
    argv: ['upload', '--platform', 'mac', '--tag', 'v1.2.3'],
    mutation: 'uploadPlatform'
  },
  {
    name: 'promote',
    argv: ['promote', '--tag', 'v1.2.3'],
    mutation: 'promoteRelease'
  }
]

const FORBIDDEN_COMPOSITIONS = [
  {
    name: 'private runtime composition',
    guardOptions: guardOptionsWithPrivateComposition,
    error: /internal extra resource composition is non-empty/u
  },
  {
    name: 'forbidden deployment composition',
    guardOptions: guardOptionsWithForbiddenDeployment,
    error: /@fixture\/private-deployment/u
  }
]

async function withPublicReleaseModeUnset(action) {
  const previousMode = process.env.SCIFORGE_PUBLIC_RELEASE
  delete process.env.SCIFORGE_PUBLIC_RELEASE
  try {
    return await action()
  } finally {
    if (previousMode === undefined) delete process.env.SCIFORGE_PUBLIC_RELEASE
    else process.env.SCIFORGE_PUBLIC_RELEASE = previousMode
  }
}

async function withCanonicalGuard(calls, guardOptions, action) {
  const previousGuard = activePublicReleaseGuard
  activePublicReleaseGuard = async (argv) => {
    calls.guard += 1
    return canonicalRunPublicReleaseGuard(argv, guardOptions())
  }
  try {
    return await action()
  } finally {
    activePublicReleaseGuard = previousGuard
  }
}

function commandDependencies(command, calls) {
  const mutate = async () => {
    assert.equal(calls.guard, 1)
    calls.r2Client += 1
    calls.r2Write += 1
  }
  const unexpectedMutation = async () => {
    throw new Error(`unexpected R2 command for ${command.name}`)
  }
  return {
    uploadPlatform: command.mutation === 'uploadPlatform' ? mutate : unexpectedMutation,
    promoteRelease: command.mutation === 'promoteRelease' ? mutate : unexpectedMutation
  }
}

function dryRunDependencies(command, calls) {
  const readOnlyOperation = async ({ dryRun }) => {
    assert.equal(dryRun, true)
    calls.r2Read += 1
  }
  const unexpectedMutation = async () => {
    throw new Error(`unexpected R2 command for ${command.name}`)
  }
  return {
    uploadPlatform: command.mutation === 'uploadPlatform'
      ? readOnlyOperation
      : unexpectedMutation,
    promoteRelease: command.mutation === 'promoteRelease'
      ? readOnlyOperation
      : unexpectedMutation
  }
}

function receiptBoundCommandArgs(command, distDir, dryRun = false) {
  const common = [
    '--tag', 'v1.2.3',
    '--channel', 'frontier',
    '--dist', distDir
  ]
  const argv = command.name === 'upload'
    ? ['upload', '--platform', 'linux', ...common]
    : ['promote', '--platforms', 'linux', ...common]
  return dryRun ? [...argv, '--dry-run'] : argv
}

function objectSnapshot(bytes, etag = '"fixture-etag"') {
  return {
    bytes,
    etag,
    versionId: 'fixture-version',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sha512: createHash('sha512').update(bytes).digest('base64')
  }
}

for (const command of COMMANDS) {
  for (const composition of FORBIDDEN_COMPOSITIONS) {
    test(`${command.name} rejects ${composition.name} with public release mode unset before reaching R2`, async () => {
      const calls = { guard: 0, r2Client: 0, r2Write: 0 }

      await withCanonicalGuard(calls, composition.guardOptions, () =>
        withPublicReleaseModeUnset(async () => {
          await assert.rejects(
            runPublishR2Command(command.argv, commandDependencies(command, calls)),
            composition.error
          )
        }))

      assert.deepEqual(calls, { guard: 1, r2Client: 0, r2Write: 0 })
    })
  }

  test(`${command.name} runs the mandatory guard exactly once before an allowed R2 mutation`, async () => {
    const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
    const calls = { guard: 0, r2Client: 0, r2Write: 0 }

    try {
      writeSyntheticLinuxReceipt(distDir)
      await withCanonicalGuard(calls, cleanGuardOptions, () =>
        withPublicReleaseModeUnset(() => runPublishR2Command(
          receiptBoundCommandArgs(command, distDir),
          commandDependencies(command, calls)
        )))

      assert.deepEqual(calls, { guard: 1, r2Client: 1, r2Write: 1 })
    } finally {
      rmSync(distDir, { recursive: true, force: true })
    }
  })

  test(`${command.name} dry-run remains read-only and does not require the public release guard`, async () => {
    const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
    const calls = { guard: 0, r2Read: 0, r2Write: 0 }

    try {
      writeSyntheticLinuxReceipt(distDir)
      await withCanonicalGuard(calls, cleanGuardOptions, () =>
        withPublicReleaseModeUnset(() => runPublishR2Command(
          receiptBoundCommandArgs(command, distDir, true),
          dryRunDependencies(command, calls)
        )))

      assert.deepEqual(calls, { guard: 0, r2Read: 1, r2Write: 0 })
    } finally {
      rmSync(distDir, { recursive: true, force: true })
    }
  })
}

test('upload rejects a missing public release artifact receipt before reaching R2', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const calls = { guard: 0, r2Client: 0, r2Write: 0 }

  try {
    await withCanonicalGuard(calls, cleanGuardOptions, () =>
      withPublicReleaseModeUnset(async () => {
        await assert.rejects(
          runPublishR2Command(
            [
              'upload',
              '--platform', 'mac',
              '--tag', 'v1.2.3',
              '--dist', distDir
            ],
            commandDependencies(COMMANDS[0], calls)
          ),
          /public release artifact receipt/u
        )
      }))

    assert.deepEqual(calls, { guard: 1, r2Client: 0, r2Write: 0 })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('upload rejects artifact bytes changed after the public release receipt before reaching R2', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const calls = { guard: 0, r2Client: 0, r2Write: 0 }

  try {
    const { artifactPath } = writeSyntheticLinuxReceipt(distDir)
    writeFileSync(artifactPath, 'tampered-linux-artifact')

    await withCanonicalGuard(calls, cleanGuardOptions, () =>
      withPublicReleaseModeUnset(async () => {
        await assert.rejects(
          runPublishR2Command(
            [
              'upload',
              '--platform', 'linux',
              '--tag', 'v1.2.3',
              '--channel', 'frontier',
              '--dist', distDir
            ],
            commandDependencies(COMMANDS[0], calls)
          ),
          /changed after the public release artifact receipt/u
        )
      }))

    assert.deepEqual(calls, { guard: 1, r2Client: 0, r2Write: 0 })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('upload publishes only receipt-bound files and writes the exact receipt last', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const calls = { guard: 0, r2Client: 0, r2Write: 0 }
  const writes = []

  try {
    writeSyntheticLinuxReceipt(distDir)
    const receiptBytes = readFileSync(publicReleaseArtifactReceiptPath(distDir, 'linux'))
    const dependencies = {
      readConfig: () => {
        calls.r2Client += 1
        return {
          bucket: 'fixture-bucket',
          client: {},
          prefix: 'sciforge',
          publicBaseUrl: 'https://downloads.test.invalid'
        }
      },
      putObject: async ({ body, key }) => {
        calls.r2Write += 1
        writes.push({ body: Buffer.isBuffer(body) ? body : null, key })
        if (!Buffer.isBuffer(body) && body?.[Symbol.asyncIterator]) {
          for await (const _chunk of body) {
            // Consume the synthetic upload stream so the file is closed before cleanup.
          }
        }
      }
    }

    await withCanonicalGuard(calls, cleanGuardOptions, () =>
      withPublicReleaseModeUnset(() => runPublishR2Command(
        receiptBoundCommandArgs(COMMANDS[0], distDir),
        dependencies
      )))

    assert.equal(calls.guard, 1)
    assert.equal(calls.r2Client, 1)
    assert.equal(calls.r2Write, 3)
    assert.match(writes[0].key, /latest-linux\.yml|SciForge-1\.2\.3-linux/u)
    assert.equal(
      writes.at(-1).key,
      'sciforge/channels/frontier/releases/v1.2.3/release-linux.json'
    )
    assert.deepEqual(writes.at(-1).body, receiptBytes)
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('upload rejects a replaced artifact inode before any object or receipt upload', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const calls = { guard: 0, r2Client: 0, r2Write: 0 }

  try {
    const { artifactPath } = writeSyntheticLinuxReceipt(distDir)
    const replacedPath = `${artifactPath}.verified`
    const dependencies = {
      uploadPlatform: async (input) => {
        renameSync(artifactPath, replacedPath)
        writeFileSync(artifactPath, 'public-linux-artifact')
        return actualUploadPlatform(input, {
          readConfig: () => {
            calls.r2Client += 1
            return {
              bucket: 'fixture-bucket',
              client: {},
              prefix: 'sciforge',
              publicBaseUrl: 'https://downloads.test.invalid'
            }
          },
          putObject: async () => { calls.r2Write += 1 }
        })
      }
    }

    await withCanonicalGuard(calls, cleanGuardOptions, () =>
      withPublicReleaseModeUnset(async () => {
        await assert.rejects(
          runPublishR2Command(
            receiptBoundCommandArgs(COMMANDS[0], distDir),
            dependencies
          ),
          /artifact path identity changed/u
        )
      }))

    assert.deepEqual(calls, { guard: 1, r2Client: 0, r2Write: 0 })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('promote rejects a missing public release artifact receipt before reaching R2', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const calls = { guard: 0, r2Client: 0, r2Write: 0 }

  try {
    await withCanonicalGuard(calls, cleanGuardOptions, () =>
      withPublicReleaseModeUnset(async () => {
        await assert.rejects(
          runPublishR2Command(
            [
              'promote',
              '--platforms', 'linux',
              '--tag', 'v1.2.3',
              '--channel', 'frontier',
              '--dist', distDir
            ],
            commandDependencies(COMMANDS[1], calls)
          ),
          /public release artifact receipt/u
        )
      }))

    assert.deepEqual(calls, { guard: 1, r2Client: 0, r2Write: 0 })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('promote rejects changed artifact bytes before reaching R2', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const calls = { guard: 0, r2Client: 0, r2Write: 0 }

  try {
    const { artifactPath } = writeSyntheticLinuxReceipt(distDir)
    writeFileSync(artifactPath, 'tampered-linux-artifact')

    await withCanonicalGuard(calls, cleanGuardOptions, () =>
      withPublicReleaseModeUnset(async () => {
        await assert.rejects(
          runPublishR2Command(
            receiptBoundCommandArgs(COMMANDS[1], distDir),
            commandDependencies(COMMANDS[1], calls)
          ),
          /changed after the public release artifact receipt/u
        )
      }))

    assert.deepEqual(calls, { guard: 1, r2Client: 0, r2Write: 0 })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('promote rejects a mismatched archived receipt before the first R2 write', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const calls = { guard: 0, r2Client: 0, r2Read: 0, r2Write: 0 }

  try {
    writeSyntheticLinuxReceipt(distDir)
    const releaseReceiptKey =
      'sciforge/channels/frontier/releases/v1.2.3/release-linux.json'
    const dependencies = {
      readConfig: () => {
        calls.r2Client += 1
        return {
          bucket: 'fixture-bucket',
          client: {},
          prefix: 'sciforge',
          publicBaseUrl: 'https://downloads.test.invalid'
        }
      },
      listReleaseKeys: async () => {
        calls.r2Read += 1
        return [releaseReceiptKey]
      },
      getObjectSnapshot: async () => {
        calls.r2Read += 1
        return objectSnapshot(Buffer.from('{"forged":true}\n'))
      },
      copyObject: async () => { calls.r2Write += 1 },
      putObject: async () => { calls.r2Write += 1 }
    }

    await withCanonicalGuard(calls, cleanGuardOptions, () =>
      withPublicReleaseModeUnset(async () => {
        await assert.rejects(
          runPublishR2Command(
            receiptBoundCommandArgs(COMMANDS[1], distDir),
            dependencies
          ),
          /Archived receipt does not match local build receipt/u
        )
      }))

    assert.deepEqual(calls, {
      guard: 1,
      r2Client: 1,
      r2Read: 2,
      r2Write: 0
    })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('promote rejects a missing archived artifact before the first R2 write', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const calls = { guard: 0, r2Client: 0, r2Read: 0, r2Write: 0 }

  try {
    writeSyntheticLinuxReceipt(distDir)
    const releaseReceiptKey =
      'sciforge/channels/frontier/releases/v1.2.3/release-linux.json'
    const dependencies = {
      readConfig: () => {
        calls.r2Client += 1
        return {
          bucket: 'fixture-bucket',
          client: {},
          prefix: 'sciforge',
          publicBaseUrl: 'https://downloads.test.invalid'
        }
      },
      listReleaseKeys: async () => {
        calls.r2Read += 1
        return [releaseReceiptKey]
      },
      getObjectSnapshot: async () => {
        calls.r2Read += 1
        return objectSnapshot(
          readFileSync(publicReleaseArtifactReceiptPath(distDir, 'linux'))
        )
      },
      copyObject: async () => { calls.r2Write += 1 },
      putObject: async () => { calls.r2Write += 1 }
    }

    await withCanonicalGuard(calls, cleanGuardOptions, () =>
      withPublicReleaseModeUnset(async () => {
        await assert.rejects(
          runPublishR2Command(
            receiptBoundCommandArgs(COMMANDS[1], distDir),
            dependencies
          ),
          /Archived release artifact is missing/u
        )
      }))

    assert.deepEqual(calls, {
      guard: 1,
      r2Client: 1,
      r2Read: 2,
      r2Write: 0
    })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('promote rejects tampered archived artifact bytes before the first R2 write', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const calls = { guard: 0, r2Client: 0, r2Read: 0, r2Write: 0 }

  try {
    const { receipt } = writeSyntheticLinuxReceipt(distDir)
    const releaseBase = 'sciforge/channels/frontier/releases/v1.2.3'
    const receiptBytes = readFileSync(publicReleaseArtifactReceiptPath(distDir, 'linux'))
    const releaseKeys = [
      `${releaseBase}/release-linux.json`,
      ...receipt.files.map((file) => `${releaseBase}/${file.fileName}`)
    ]
    const dependencies = {
      readConfig: () => {
        calls.r2Client += 1
        return {
          bucket: 'fixture-bucket',
          client: {
            send: async (command) => {
              calls.r2Read += 1
              const key = command.input.Key
              const fileName = key.slice(key.lastIndexOf('/') + 1)
              const bytes = fileName === 'release-linux.json'
                ? receiptBytes
                : fileName.endsWith('.AppImage')
                  ? Buffer.from('tampered-archive-object')
                  : readFileSync(join(distDir, fileName))
              return {
                Body: Readable.from([bytes]),
                ContentLength: bytes.length,
                ETag: `"${fileName}"`,
                VersionId: 'fixture-version'
              }
            }
          },
          prefix: 'sciforge',
          publicBaseUrl: 'https://downloads.test.invalid'
        }
      },
      listReleaseKeys: async () => {
        calls.r2Read += 1
        return releaseKeys
      },
      copyObject: async () => { calls.r2Write += 1 },
      putObject: async () => { calls.r2Write += 1 }
    }

    await withCanonicalGuard(calls, cleanGuardOptions, () =>
      withPublicReleaseModeUnset(async () => {
        await assert.rejects(
          runPublishR2Command(
            receiptBoundCommandArgs(COMMANDS[1], distDir),
            dependencies
          ),
          /Archived release artifact integrity does not match/u
        )
      }))

    assert.deepEqual(calls, {
      guard: 1,
      r2Client: 1,
      r2Read: 4,
      r2Write: 0
    })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('promote conditionally copies verified packages before metadata and latest manifest', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const calls = { guard: 0, r2Client: 0, r2Read: 0, r2Write: 0 }
  const operations = []

  try {
    const { receipt } = writeSyntheticLinuxReceipt(distDir, { includeBlockmap: true })
    const releaseBase = 'sciforge/channels/frontier/releases/v1.2.3'
    const receiptBytes = readFileSync(publicReleaseArtifactReceiptPath(distDir, 'linux'))
    const releaseKeys = [
      `${releaseBase}/release-linux.json`,
      ...receipt.files.map((file) => `${releaseBase}/${file.fileName}`)
    ]
    const dependencies = {
      readConfig: () => {
        calls.r2Client += 1
        return {
          bucket: 'fixture-bucket',
          client: {
            send: async (command) => {
              if (command.input.CopySource) {
                calls.r2Write += 1
                operations.push({ type: 'copy', input: command.input })
                return {}
              }
              if (Object.hasOwn(command.input, 'Body')) {
                calls.r2Write += 1
                operations.push({ type: 'put', input: command.input })
                return {}
              }
              calls.r2Read += 1
              const key = command.input.Key
              const fileName = key.slice(key.lastIndexOf('/') + 1)
              const bytes = fileName === 'release-linux.json'
                ? receiptBytes
                : readFileSync(join(distDir, fileName))
              return {
                Body: Readable.from([bytes]),
                ContentLength: bytes.length,
                ETag: `"${fileName}"`,
                VersionId: 'fixture-version'
              }
            }
          },
          prefix: 'sciforge',
          publicBaseUrl: 'https://downloads.test.invalid'
        }
      },
      listReleaseKeys: async () => {
        calls.r2Read += 1
        return releaseKeys
      }
    }

    await withCanonicalGuard(calls, cleanGuardOptions, () =>
      withPublicReleaseModeUnset(() => runPublishR2Command(
        receiptBoundCommandArgs(COMMANDS[1], distDir),
        dependencies
      )))

    assert.deepEqual(calls, {
      guard: 1,
      r2Client: 1,
      r2Read: 5,
      r2Write: 4
    })
    assert.match(operations[0].input.CopySource, /\.AppImage\?versionId=fixture-version$/u)
    assert.equal(
      operations[0].input.CopySourceIfMatch,
      '"SciForge-1.2.3-linux-x86_64.AppImage"'
    )
    assert.match(operations[1].input.CopySource, /\.AppImage\.blockmap\?versionId=/u)
    assert.match(operations[2].input.CopySource, /latest-linux\.yml\?versionId=/u)
    assert.equal(operations[3].type, 'put')
    assert.match(operations[3].input.Key, /latest\/latest\.json$/u)
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('dry-run reports a missing receipt without guard, credentials, or R2 access', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const calls = { guard: 0, r2Read: 0, r2Write: 0 }

  try {
    await withCanonicalGuard(calls, cleanGuardOptions, () =>
      withPublicReleaseModeUnset(async () => {
        await assert.rejects(
          runPublishR2Command(
            receiptBoundCommandArgs(COMMANDS[1], distDir, true),
            dryRunDependencies(COMMANDS[1], calls)
          ),
          /public release artifact receipt/u
        )
      }))

    assert.deepEqual(calls, { guard: 0, r2Read: 0, r2Write: 0 })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('public-mode packaging seals the exact final artifact set with clean build evidence', () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))

  try {
    const { receipt } = writeSyntheticLinuxReceipt(distDir)
    rmSync(publicReleaseArtifactReceiptPath(distDir, 'linux'))

    const evidence = createPublicReleaseArtifactBuildEvidence({
      distDir,
      platform: 'linux',
      tag: 'v1.2.3',
      channel: 'frontier',
      sourceCommit: SOURCE_COMMIT,
      publicReleaseGuard: receipt.publicReleaseGuard,
      internalRuntimeComposition: receipt.composition.internalRuntime,
      deploymentConfigurationComposition: {
        ...receipt.composition.deploymentConfigurations,
        deploymentConfigurationDeclarations: []
      },
      artifactFileNames: ['SciForge-1.2.3-linux-x86_64.AppImage']
    })

    const created = createPublicReleaseArtifactReceipt({
      distDir,
      platform: 'linux',
      tag: 'v1.2.3',
      channel: 'frontier',
      sourceCommit: SOURCE_COMMIT,
      publicReleaseGuard: receipt.publicReleaseGuard,
      internalRuntimeComposition: receipt.composition.internalRuntime,
      deploymentConfigurationComposition: {
        ...receipt.composition.deploymentConfigurations,
        deploymentConfigurationDeclarations: []
      }
    })

    assert.equal(created.receipt.sourceCommit, SOURCE_COMMIT)
    assert.equal(
      created.receipt.files.find((file) => file.role !== 'update-metadata')
        ?.buildEvidenceSha256,
      evidence[0].sha256
    )
    assert.deepEqual(
      created.receipt.files.map(({ buildEvidenceSha256: _evidence, ...file }) => file),
      receipt.files.map(({ buildEvidenceSha256: _evidence, ...file }) => file)
    )
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('canonical four-field guard output survives build evidence and configured seal', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  let guardCalls = 0

  try {
    const { receipt } = writeSyntheticLinuxReceipt(distDir)
    const canonicalGuardResult = await canonicalRunPublicReleaseGuard(
      [],
      cleanGuardOptions()
    )
    assert.deepEqual(canonicalGuardResult, {
      internalRuntimeCount: 0,
      publicReleaseForbiddenDeploymentConfigurationCount: 0,
      publicReleaseForbiddenContributionCount: 0,
      trackedPrivatePayloadCount: 0
    })
    rmSync(publicReleaseArtifactReceiptPath(distDir, 'linux'))
    const buildEvidence = createPublicReleaseArtifactBuildEvidence({
      distDir,
      platform: 'linux',
      tag: 'v1.2.3',
      channel: 'frontier',
      sourceCommit: SOURCE_COMMIT,
      publicReleaseGuard: canonicalGuardResult,
      internalRuntimeComposition: receipt.composition.internalRuntime,
      deploymentConfigurationComposition: safeDeploymentComposition(),
      artifactFileNames: ['SciForge-1.2.3-linux-x86_64.AppImage']
    })
    assert.deepEqual(
      buildEvidence[0].evidence.publicReleaseGuard,
      canonicalGuardResult
    )

    const sealed = await sealConfiguredPublicReleaseArtifactReceipt(
      { distDir, platform: 'linux' },
      {
        environment: {
          RELEASE_CHANNEL: 'frontier',
          SCIFORGE_APP_VERSION: '1.2.3',
          SCIFORGE_PUBLIC_RELEASE: '1',
          SCIFORGE_RELEASE_SOURCE_COMMIT: SOURCE_COMMIT
        },
        projectRoot: new URL('..', import.meta.url).pathname,
        runPublicReleaseGuard: async (argv) => {
          guardCalls += 1
          assert.deepEqual(argv, [])
          return canonicalGuardResult
        },
        createInternalRuntimeComposition: () =>
          receipt.composition.internalRuntime,
        createDeploymentConfigurationComposition: safeDeploymentComposition
      }
    )

    assert.equal(guardCalls, 1)
    assert.equal(sealed.receipt.sourceCommit, SOURCE_COMMIT)
    assert.deepEqual(sealed.receipt.publicReleaseGuard, canonicalGuardResult)
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('public release receipt refuses artifacts without build-issued evidence', () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))

  try {
    const { receipt } = writeSyntheticLinuxReceipt(distDir)
    rmSync(publicReleaseArtifactReceiptPath(distDir, 'linux'))

    assert.throws(
      () => createPublicReleaseArtifactReceipt({
        distDir,
        platform: 'linux',
        tag: 'v1.2.3',
        channel: 'frontier',
        sourceCommit: SOURCE_COMMIT,
        publicReleaseGuard: receipt.publicReleaseGuard,
        internalRuntimeComposition: receipt.composition.internalRuntime,
        deploymentConfigurationComposition: {
          ...receipt.composition.deploymentConfigurations,
          deploymentConfigurationDeclarations: []
        }
      }),
      /build-issued evidence/u
    )
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('public artifact hook refuses build evidence before canonical afterPack succeeds', async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'sciforge-public-release-dist-'))
  const previousMode = process.env.SCIFORGE_PUBLIC_RELEASE
  process.env.SCIFORGE_PUBLIC_RELEASE = '1'

  try {
    const hooks = createPublicReleaseArtifactHooks({
      afterPack: async () => {},
      projectRoot: new URL('..', import.meta.url).pathname,
      internalRuntimeComposition: { extraResources: [], packagedRuntimes: [] },
      deploymentConfigurationComposition: safeDeploymentComposition()
    })
    await assert.rejects(
      hooks.afterAllArtifactBuild({ artifactPaths: [], outDir: distDir }),
      /without a successful public afterPack/u
    )
  } finally {
    if (previousMode === undefined) delete process.env.SCIFORGE_PUBLIC_RELEASE
    else process.env.SCIFORGE_PUBLIC_RELEASE = previousMode
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('official packaging and publication paths produce and pass platform receipts', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  for (const [scriptName, platform] of [
    ['dist:mac', 'mac'],
    ['dist:mac:signed', 'mac'],
    ['dist:win', 'win'],
    ['dist:linux', 'linux']
  ]) {
    const script = packageJson.scripts[scriptName]
    const clear = script.indexOf(`clear --platform ${platform}`)
    const seal = script.lastIndexOf(`seal --platform ${platform}`)
    assert.notEqual(clear, -1, `${scriptName} must clear stale receipt evidence`)
    assert.notEqual(seal, -1, `${scriptName} must seal its final artifact receipt`)
    assert.ok(clear < seal, `${scriptName} must clear before sealing`)
  }

  const builderConfig = readFileSync(
    new URL('../electron-builder.config.cjs', import.meta.url),
    'utf8'
  )
  assert.match(builderConfig, /createPublicReleaseArtifactHooks/u)
  assert.match(builderConfig, /afterPack: publicReleaseArtifactHooks\.afterPack/u)

  const workflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8'
  )
  for (const platform of ['mac', 'win', 'linux']) {
    assert.match(workflow, new RegExp(`dist/release-${platform}\\.json`, 'u'))
  }
  assert.match(
    workflow,
    /promote[\s\S]*--dist release-artifacts[\s\S]*--platforms mac,win,linux/u
  )

  for (const [fileName, platform] of [
    ['release-mac.sh', 'mac'],
    ['release-win.sh', 'win'],
    ['release-win.ps1', 'win']
  ]) {
    const source = readFileSync(new URL(fileName, import.meta.url), 'utf8')
    assert.match(source, new RegExp(`release-${platform}\\.json`, 'u'))
    assert.match(source, new RegExp(`--platforms ${platform}`, 'u'))
  }
})
