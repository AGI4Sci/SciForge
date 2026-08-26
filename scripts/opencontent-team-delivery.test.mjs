import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import JSZip from 'jszip'

import { packInternalOverlay } from './internal-overlay-package.mjs'
import {
  installOpenContentTeamDelivery,
  verifyOpenContentTeamDelivery
} from './opencontent-team-delivery.mjs'

const DELIVERY_DOCUMENTS = [
  'README-install.zh-CN.md',
  'opencontent-attachment-distribution.md',
  'opencontent-private-attachment-runbook.zh-CN.md',
  'opencontent-skill-capability-matrix.md'
]

test('verifies, installs, and idempotently reinstalls a trusted team delivery', async (context) => {
  const fixture = await createDeliveryFixture(context)

  const verified = await verifyOpenContentTeamDelivery({
    deliveryPath: fixture.deliveryPath,
    targetRoot: fixture.targetRoot
  })
  assert.deepEqual(verified, {
    contractVersion: 1,
    deliveryFileName: fixture.deliveryFileName,
    deliveryId: 'fixture-team-delivery',
    deliverySha256: fixture.deliverySha256,
    deployment: {
      providerInstanceRef: 'opencontent-fixture',
      sha256: fixture.deploymentSha256
    },
    overlay: {
      archiveSha256: fixture.overlaySha256,
      fileCount: 1,
      overlayId: 'opencontent-fixture-assets',
      version: '1.2.3'
    },
    status: 'verified'
  })
  assert.equal('origin' in verified.deployment, false)

  const installed = await installOpenContentTeamDelivery({
    deliveryPath: fixture.deliveryPath,
    targetRoot: fixture.targetRoot
  })
  assert.equal(installed.overlayStatus, 'installed')
  assert.equal(installed.deploymentStatus, 'installed')
  assert.equal(
    await readFile(fixture.deploymentTarget, 'utf8'),
    fixture.deploymentConfiguration
  )
  assert.equal((await stat(fixture.deploymentTarget)).mode & 0o777, 0o600)
  assert.equal(
    await readFile(
      path.join(fixture.targetRoot, 'internal', 'opencontent-fixture', 'runtime.txt'),
      'utf8'
    ),
    'trusted fixture runtime\n'
  )

  const second = await installOpenContentTeamDelivery({
    deliveryPath: fixture.deliveryPath,
    targetRoot: fixture.targetRoot
  })
  assert.equal(second.overlayStatus, 'already-installed')
  assert.equal(second.deploymentStatus, 'already-installed')
  assert.equal(second.receiptPath, installed.receiptPath)
})

test('rejects a byte-drifted outer delivery before archive extraction', async (context) => {
  const fixture = await createDeliveryFixture(context)
  const tamperedDirectory = path.join(fixture.root, 'tampered')
  const tamperedPath = path.join(tamperedDirectory, fixture.deliveryFileName)
  const tampered = Buffer.from(await readFile(fixture.deliveryPath))
  tampered[tampered.length - 1] ^= 0x01
  await mkdir(tamperedDirectory)
  await writeFile(tamperedPath, tampered)

  await assert.rejects(
    verifyOpenContentTeamDelivery({
      deliveryPath: tamperedPath,
      targetRoot: fixture.targetRoot
    }),
    /not present in this checkout's package-owned trust set/u
  )
})

test('requires the immutable delivery to retain its trusted file name', async (context) => {
  const fixture = await createDeliveryFixture(context)
  const renamedPath = path.join(fixture.root, 'renamed-delivery.zip')
  await writeFile(renamedPath, await readFile(fixture.deliveryPath))

  await assert.rejects(
    verifyOpenContentTeamDelivery({
      deliveryPath: renamedPath,
      targetRoot: fixture.targetRoot
    }),
    /must retain its trusted file name/u
  )
})

test('refuses a different deployment configuration before installing the overlay', async (context) => {
  const fixture = await createDeliveryFixture(context)
  await mkdir(path.dirname(fixture.deploymentTarget), { recursive: true })
  await writeFile(
    fixture.deploymentTarget,
    '{"contractVersion":1,"origin":"https://conflict.invalid",' +
      '"providerInstanceRef":"opencontent-fixture"}\n',
    { mode: 0o600 }
  )

  await assert.rejects(
    installOpenContentTeamDelivery({
      deliveryPath: fixture.deliveryPath,
      targetRoot: fixture.targetRoot
    }),
    /never overwrites a different deployment/u
  )
  await assert.rejects(
    access(path.join(fixture.targetRoot, 'internal', 'opencontent-fixture')),
    /ENOENT/u
  )
  await assert.rejects(
    access(path.join(
      fixture.targetRoot,
      '.sciforge',
      'internal-overlays',
      'opencontent-fixture-assets.json'
    )),
    /ENOENT/u
  )
})

test('repairs permissions on an identical pre-existing deployment', async (context) => {
  const fixture = await createDeliveryFixture(context)
  await mkdir(path.dirname(fixture.deploymentTarget), { recursive: true })
  await writeFile(
    fixture.deploymentTarget,
    fixture.deploymentConfiguration,
    { mode: 0o644 }
  )

  const installed = await installOpenContentTeamDelivery({
    deliveryPath: fixture.deliveryPath,
    targetRoot: fixture.targetRoot
  })
  assert.equal(installed.overlayStatus, 'installed')
  assert.equal(
    installed.deploymentStatus,
    process.platform === 'win32' ? 'already-installed' : 'permissions-repaired'
  )
  if (process.platform !== 'win32') {
    assert.equal((await stat(fixture.deploymentTarget)).mode & 0o777, 0o600)
  }
  assert.equal(
    await readFile(fixture.deploymentTarget, 'utf8'),
    fixture.deploymentConfiguration
  )
})

async function createDeliveryFixture(context) {
  const root = await realpath(await mkdtemp(
    path.join(os.tmpdir(), 'sciforge-opencontent-team-delivery-')
  ))
  context.after(() => rm(root, { recursive: true, force: true }))
  const targetRoot = path.join(root, 'checkout')
  const sourceDir = path.join(root, 'overlay-source')
  await mkdir(targetRoot)
  await mkdir(sourceDir)
  await writeFile(path.join(sourceDir, 'runtime.txt'), 'trusted fixture runtime\n')

  const overlayId = 'opencontent-fixture-assets'
  const overlayVersion = '1.2.3'
  const overlayFileName = `sciforge-${overlayId}-${overlayVersion}.zip`
  const overlayPath = path.join(root, overlayFileName)
  const packed = await packInternalOverlay({
    outputFile: overlayPath,
    overlayId,
    payloadPrefix: 'internal/opencontent-fixture',
    sourceDir,
    version: overlayVersion
  })
  const overlayBytes = await readFile(overlayPath)
  const overlaySidecar = await readFile(`${overlayPath}.sha256`)
  const deploymentConfiguration =
    '{"contractVersion":1,"origin":"https://fixture.invalid",' +
    '"providerInstanceRef":"opencontent-fixture"}\n'
  const deploymentBytes = Buffer.from(deploymentConfiguration)
  const deploymentSha256 = sha256(deploymentBytes)
  const deliveryFileName = 'SciForge-OpenContent-fixture-team-delivery.zip'
  const deliveryPath = path.join(root, deliveryFileName)
  const deliveryArchive = new JSZip()
  for (const document of DELIVERY_DOCUMENTS) {
    deliveryArchive.file(document, `# Fixture ${document}\n`)
  }
  deliveryArchive.file('opencontent-connector.json', deploymentBytes)
  deliveryArchive.file(overlayFileName, overlayBytes)
  deliveryArchive.file(`${overlayFileName}.sha256`, overlaySidecar)
  const deliveryBytes = await deliveryArchive.generateAsync({
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    type: 'nodebuffer'
  })
  await writeFile(deliveryPath, deliveryBytes)
  const deliverySha256 = sha256(deliveryBytes)

  const packageRoot = path.join(
    targetRoot,
    'packages',
    'domains',
    'opencontent-connector'
  )
  await mkdir(packageRoot, { recursive: true })
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: '@sciforge/domain-opencontent-connector',
    sciforgeDeploymentConfiguration: {
      contractVersion: 1,
      maxBytes: 4096,
      packagedResourcesRelativePath: 'domain-deployments/opencontent-connector.json',
      publicRelease: 'forbidden',
      sourceRelativePath: '.sciforge/private/deployments/opencontent-connector.json'
    },
    sciforgeInternalRuntimeTrust: {
      contractVersion: 1,
      installations: [{
        archiveSha256: packed.sha256,
        overlayId,
        overlayRoot: 'internal/opencontent-fixture',
        version: overlayVersion
      }]
    },
    sciforgeTeamDeliveryTrust: {
      contractVersion: 1,
      deliveries: [{
        deliveryFileName,
        deliveryId: 'fixture-team-delivery',
        deliverySha256,
        deploymentConfigurationFileName: 'opencontent-connector.json',
        deploymentConfigurationSha256: deploymentSha256,
        overlayArchiveSha256: packed.sha256,
        overlayId,
        overlayVersion
      }]
    }
  }, null, 2))
  await writeFile(path.join(packageRoot, 'sciforge.domain.json'), JSON.stringify({
    contributionContracts: {
      'opencontent-connector.provider-instance': {
        location: 'main.provider-instance-directory-entry',
        providerInstanceRef: 'opencontent-fixture'
      }
    },
    packageName: '@sciforge/domain-opencontent-connector'
  }, null, 2))

  return Object.freeze({
    deliveryFileName,
    deliveryPath,
    deliverySha256,
    deploymentConfiguration,
    deploymentSha256,
    deploymentTarget: path.join(
      targetRoot,
      '.sciforge',
      'private',
      'deployments',
      'opencontent-connector.json'
    ),
    overlaySha256: packed.sha256,
    root,
    targetRoot
  })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
