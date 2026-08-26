const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  EXPECTED_BRANCH,
  EXPECTED_ORIGIN,
  assertAcceptanceComposition,
  canonicalBuildCommand,
  readStage4ArtifactReceipt,
  stage4ArtifactReceiptPath,
  summarizePrivateComposition,
  verifyStage4ArtifactReceipt
} = require('./stage4-artifact-receipt.cjs')

const SOURCE_COMMIT = 'a'.repeat(40)
const ARTIFACT_NAME = 'SciForge-0.1.0-mac-arm64.zip'

test('private acceptance composition requires all three generic trust layers', () => {
  const composition = summarizePrivateComposition({
    internalRuntimeComposition: {
      packagedRuntimes: [{
        packageName: '@internal/runtime',
        installationEvidence: {
          archiveSha256: 'b'.repeat(64),
          overlayId: 'runtime',
          overlayRoot: 'internal/runtime',
          version: '1.0.0'
        },
        assets: [{ packagedResourcesPath: 'runtime/assets', inventory: [] }]
      }]
    },
    deploymentConfigurationComposition: {
      activeDeploymentConfigurationReceipts: [{
        packageName: '@example/domain',
        packagedResourcesRelativePath: 'domain-deployments/example.json',
        publicRelease: 'forbidden',
        sha256: 'c'.repeat(64),
        size: 64
      }]
    },
    privateContributions: [{
      contractLocation: 'main.content-space-verification-profile',
      contractSha256: 'd'.repeat(64),
      id: 'example.profile',
      kind: 'main.extension',
      packageName: '@example/profile',
      process: 'main',
      version: '2.0.0'
    }]
  })
  assert.doesNotThrow(() => assertAcceptanceComposition(composition))
  assert.throws(
    () => assertAcceptanceComposition({ ...composition, privateContributions: [] }),
    /Content Space verification-profile contribution/u
  )
  assert.throws(
    () => assertAcceptanceComposition({
      ...composition,
      privateContributions: composition.privateContributions.map((contribution) => ({
        ...contribution,
        contractLocation: 'main.unrelated-private-contribution'
      }))
    }),
    /Content Space verification-profile contribution/u
  )
  assert.throws(
    () => assertAcceptanceComposition({ ...composition, internalRuntimes: [] }),
    /receipted internal runtime/u
  )
  assert.throws(
    () => assertAcceptanceComposition({ ...composition, deploymentConfigurations: [] }),
    /private deployment configuration/u
  )
})

test('Stage 4 receipt holds and verifies the exact archive bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sciforge-stage4-receipt-test-'))
  try {
    const artifactPath = join(directory, ARTIFACT_NAME)
    const bytes = Buffer.from('stage4-artifact-bytes')
    writeFileSync(artifactPath, bytes)
    const source = sourceIdentity()
    const receipt = receiptFixture({
      artifactSha256: createHash('sha256').update(bytes).digest('hex'),
      artifactSize: bytes.byteLength,
      source
    })
    const receiptPath = stage4ArtifactReceiptPath(directory, 'mac', 'arm64')
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)

    assert.equal(readStage4ArtifactReceipt(receiptPath).receipt.source.commit, SOURCE_COMMIT)
    const handle = verifyStage4ArtifactReceipt({ artifactPath, receiptPath, source })
    try {
      assert.equal(handle.artifact.fileName, ARTIFACT_NAME)
      assert.doesNotThrow(() => handle.assertUnchanged())
    } finally {
      handle.close()
    }

    writeFileSync(artifactPath, 'changed')
    assert.throws(
      () => verifyStage4ArtifactReceipt({ artifactPath, receiptPath, source }),
      /do not match the sealed receipt/u
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Stage 4 receipt rejects source drift and non-canonical receipt paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sciforge-stage4-receipt-test-'))
  try {
    const artifactPath = join(directory, ARTIFACT_NAME)
    const bytes = Buffer.from('stage4-artifact-bytes')
    writeFileSync(artifactPath, bytes)
    const source = sourceIdentity()
    const receipt = receiptFixture({
      artifactSha256: createHash('sha256').update(bytes).digest('hex'),
      artifactSize: bytes.byteLength,
      source
    })
    const wrongReceiptPath = join(directory, 'receipt.json')
    writeFileSync(wrongReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
    assert.throws(
      () => readStage4ArtifactReceipt(wrongReceiptPath),
      /not canonical/u
    )

    const receiptPath = stage4ArtifactReceiptPath(directory, 'mac', 'arm64')
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
    assert.throws(
      () => verifyStage4ArtifactReceipt({
        artifactPath,
        receiptPath,
        source: { ...source, commit: 'e'.repeat(40), remoteCommit: 'e'.repeat(40) }
      }),
      /source identity does not match/u
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('canonical builder wiring keeps public and Stage 4 receipt modes separate', () => {
  const builder = readFileSync(join(__dirname, '..', 'electron-builder.config.cjs'), 'utf8')
  const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
  assert.match(builder, /createPublicReleaseArtifactHooks/u)
  assert.match(builder, /createStage4ArtifactHooks/u)
  assert.match(builder, /afterPack: stage4ArtifactHooks\.afterPack/u)
  assert.match(builder, /publicReleaseArtifactHooks\.afterAllArtifactBuild/u)
  assert.match(builder, /stage4ArtifactHooks\.afterAllArtifactBuild/u)
  assert.match(builder, /sciforgeStage4Build: stage4BuildIdentity/u)
  assert.equal(
    packageJson.scripts['stage4:artifact:mac:arm64'],
    'node ./scripts/stage4-artifact-build.mjs --platform mac --architecture arm64'
  )
})

function sourceIdentity() {
  return {
    branch: EXPECTED_BRANCH,
    clean: true,
    commit: SOURCE_COMMIT,
    origin: EXPECTED_ORIGIN,
    remoteCommit: SOURCE_COMMIT,
    remoteRef: `origin/${EXPECTED_BRANCH}`
  }
}

function receiptFixture({ artifactSha256, artifactSize, source }) {
  return {
    contractVersion: 1,
    kind: 'sciforge-stage4-artifact-receipt',
    source,
    build: {
      startedAt: '2026-08-26T00:00:00.000Z',
      completedAt: '2026-08-26T00:01:00.000Z',
      command: canonicalBuildCommand('mac', 'arm64'),
      host: { architecture: 'arm64', platform: 'darwin', release: 'test' },
      target: { architecture: 'arm64', platform: 'mac' },
      toolchain: {
        electron: '42.7.0',
        electronBuilder: '26.8.1',
        node: 'v22.22.1',
        npm: '10.9.4'
      }
    },
    composition: {
      deploymentConfigurations: [{
        packageName: '@example/domain',
        packagedResourcesRelativePath: 'domain-deployments/example.json',
        publicRelease: 'forbidden',
        sha256: 'c'.repeat(64),
        size: 64
      }],
      internalRuntimes: [{
        packageName: '@internal/runtime',
        installationEvidence: {
          archiveSha256: 'b'.repeat(64),
          overlayId: 'runtime',
          overlayRoot: 'internal/runtime',
          version: '1.0.0'
        },
        assets: [{
          inventorySha256: 'f'.repeat(64),
          packagedResourcesPath: 'runtime/assets'
        }]
      }],
      privateContributions: [{
        contractLocation: 'main.content-space-verification-profile',
        contractSha256: 'd'.repeat(64),
        id: 'example.profile',
        kind: 'main.extension',
        packageName: '@example/profile',
        process: 'main',
        version: '2.0.0'
      }]
    },
    artifacts: [{
      architecture: 'arm64',
      fileName: ARTIFACT_NAME,
      platform: 'mac',
      role: 'archive',
      sha256: artifactSha256,
      size: artifactSize
    }]
  }
}
