import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  generateLocalContentSpaceAuthorizationPackage,
  renderLocalContentSpaceAuthorizationPackageFiles
} from './content-space-local-authorization-package.mjs'
import {
  composeStage4PrivateDomainPackages,
  resealStage4PrivateDomainPackageStaging,
  verifyStage4PrivateDomainPackage
} from './stage4-private-domain-package.mjs'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEST_NOW = new Date('2099-01-01T00:30:00.000Z')

test('composes an external private verification package through the standard generated path', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(join(stagingProjectRoot, 'packages', 'domains'), {
      recursive: true,
      mode: 0o700
    })
    await writeFile(
      join(stagingProjectRoot, 'package.json'),
      `${JSON.stringify({
        name: '@fixture/stage4-build-workspace',
        private: true,
        workspaces: ['packages/domains/*']
      }, null, 2)}\n`,
      { mode: 0o600 }
    )

    const composition = await composeStage4PrivateDomainPackages({
      repositoryRoot: REPOSITORY_ROOT,
      stagingProjectRoot,
      privateDomainPackagePaths: [packageRoot],
      now: TEST_NOW
    })

    assert.deepEqual(composition.privateDomainPackages, [{
      packageName: '@sciforge-local/content-space-authorization-stage4-external-test',
      packageVersion: '1.0.0',
      provenance: 'external-local-package',
      sha256: composition.privateDomainPackages[0]?.sha256,
      verificationStatus: 'verification-profile-verified'
    }])
    assert.match(composition.privateDomainPackages[0]?.sha256 ?? '', /^[a-f0-9]{64}$/u)
    assert.equal(composition.domainPackages.length, 1)
    assert.equal(
      composition.domainPackages[0]?.packageName,
      '@sciforge-local/content-space-authorization-stage4-external-test'
    )

    const generatedDefinitions = await readFile(
      join(stagingProjectRoot, 'src', 'shared', 'installed-domain-packages.ts'),
      'utf8'
    )
    const generatedMain = await readFile(
      join(stagingProjectRoot, 'src', 'main', 'modules', 'installed-domain-main.ts'),
      'utf8'
    )
    assert.match(
      generatedDefinitions,
      /@sciforge-local\/content-space-authorization-stage4-external-test\/definition/u
    )
    assert.match(
      generatedMain,
      /@sciforge-local\/content-space-authorization-stage4-external-test\/main/u
    )

    const publicSummary = JSON.stringify(composition.privateDomainPackages)
    assert.doesNotMatch(publicSummary, /stage4-user|stage4-device|provider-instance-a/u)
    assert.doesNotMatch(publicSummary, new RegExp(escapeRegExp(packageRoot), 'u'))
  })
})

test('reseals only the staged package copy after a workspace installer changes modes', async () => {
  if (process.platform === 'win32') return
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(join(stagingProjectRoot, 'packages', 'domains'), {
      recursive: true,
      mode: 0o700
    })
    await writeFile(
      join(stagingProjectRoot, 'package.json'),
      `${JSON.stringify({
        name: '@fixture/stage4-build-workspace',
        private: true,
        workspaces: ['packages/domains/*']
      }, null, 2)}\n`,
      { mode: 0o600 }
    )
    const composition = await composeStage4PrivateDomainPackages({
      repositoryRoot: REPOSITORY_ROOT,
      stagingProjectRoot,
      privateDomainPackagePaths: [packageRoot],
      now: TEST_NOW
    })
    const [summary] = composition.privateDomainPackages
    assert.ok(summary)
    const stagedPackageRoot = join(
      stagingProjectRoot,
      'packages',
      'domains',
      `private-${summary.sha256.slice(0, 24)}`
    )
    await chmod(stagedPackageRoot, 0o755)
    await chmod(join(stagedPackageRoot, 'src'), 0o755)
    const outsideInstallerState = join(root, 'outside-installer-state')
    const outsideMarker = join(outsideInstallerState, 'must-remain.txt')
    await mkdir(outsideInstallerState, { mode: 0o700 })
    await writeFile(outsideMarker, 'preserved\n', { mode: 0o600 })
    const stagedNodeModules = join(stagedPackageRoot, 'node_modules')
    await symlink(outsideInstallerState, stagedNodeModules, 'dir')
    await assert.rejects(
      resealStage4PrivateDomainPackageStaging({
        stagingProjectRoot,
        privateDomainPackages: composition.privateDomainPackages
      }),
      /Staged installer state is unsafe/u
    )
    assert.equal(await readFile(outsideMarker, 'utf8'), 'preserved\n')
    await unlink(stagedNodeModules)
    const installerState = join(
      stagedNodeModules,
      'installer-only-dependency',
      'package.json'
    )
    await mkdir(dirname(installerState), { recursive: true, mode: 0o755 })
    await writeFile(installerState, '{"private":true}\n', { mode: 0o644 })

    await resealStage4PrivateDomainPackageStaging({
      stagingProjectRoot,
      privateDomainPackages: composition.privateDomainPackages
    })
    await assert.rejects(readFile(installerState), { code: 'ENOENT' })
    const verified = await verifyStage4PrivateDomainPackage({
      repositoryRoot: REPOSITORY_ROOT,
      packagePath: stagedPackageRoot,
      now: TEST_NOW
    })
    assert.deepEqual(verified.privateDomainPackage, summary)
  })
})

test('fails closed when no private verification package is provided', async () => {
  await withTemporaryRoot(async (root) => {
    const stagingProjectRoot = join(root, 'build-workspace')
    await mkdir(join(stagingProjectRoot, 'packages', 'domains'), {
      recursive: true,
      mode: 0o700
    })

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [],
        now: TEST_NOW
      }),
      /requires a reviewed private Content Space verification-profile contribution/u
    )
  })
})

test('does not echo a sensitive nonexistent package path', async () => {
  const privateMarker = 'principal-device-binding-must-not-leak'
  const packagePath = join(await realpath(tmpdir()), privateMarker)
  await assert.rejects(
    verifyStage4PrivateDomainPackage({
      repositoryRoot: REPOSITORY_ROOT,
      packagePath,
      now: TEST_NOW
    }),
    (error) => {
      assert.match(error.message, /Private domain package must be a canonical real directory/u)
      assert.doesNotMatch(error.message, new RegExp(privateMarker, 'u'))
      return true
    }
  )
})

test('rejects an authorization package whose main runtime was replaced', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(join(stagingProjectRoot, 'packages', 'domains'), {
      recursive: true,
      mode: 0o700
    })
    await writeFile(
      join(stagingProjectRoot, 'package.json'),
      `${JSON.stringify({
        name: '@fixture/stage4-build-workspace',
        private: true,
        workspaces: ['packages/domains/*']
      }, null, 2)}\n`,
      { mode: 0o600 }
    )

    const mainPath = join(packageRoot, 'src', 'main.ts')
    const tamperedMain = `${await readFile(mainPath, 'utf8')}\nexport const hiddenBusinessRuntime = true\n`
    await writeFile(mainPath, tamperedMain, { mode: 0o600 })
    const receiptPath = join(packageRoot, 'authorization-package-receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    const inventoryEntry = receipt.inventory.find((entry) => entry.path === 'src/main.ts')
    inventoryEntry.size = Buffer.byteLength(tamperedMain)
    inventoryEntry.sha256 = createHash('sha256').update(tamperedMain).digest('hex')
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: TEST_NOW
      }),
      /main runtime source is not canonical/u
    )
  })
})

test('rejects extra package payload even when self-reported by the inventory', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(join(stagingProjectRoot, 'packages', 'domains'), {
      recursive: true,
      mode: 0o700
    })
    await writeFile(
      join(stagingProjectRoot, 'package.json'),
      `${JSON.stringify({
        name: '@fixture/stage4-build-workspace',
        private: true,
        workspaces: ['packages/domains/*']
      }, null, 2)}\n`,
      { mode: 0o600 }
    )

    const extraPath = join(packageRoot, 'unexpected-payload.json')
    const extraBytes = Buffer.from('{"kind":"unexpected"}\n')
    await writeFile(extraPath, extraBytes, { mode: 0o600 })
    const receiptPath = join(packageRoot, 'authorization-package-receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipt.inventory.push({
      path: 'unexpected-payload.json',
      sha256: createHash('sha256').update(extraBytes).digest('hex'),
      size: extraBytes.byteLength
    })
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: TEST_NOW
      }),
      /Private package structure is unexpected/u
    )
  })
})

test('rejects an inventory path that attempts to escape the package root', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(stagingProjectRoot, { mode: 0o700 })

    const receiptPath = join(packageRoot, 'authorization-package-receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipt.inventory[0].path = '../outside-private-package'
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: TEST_NOW
      }),
      /Authorization package inventory is invalid/u
    )
  })
})

test('rejects a private package containing a symbolic link', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(join(stagingProjectRoot, 'packages', 'domains'), {
      recursive: true,
      mode: 0o700
    })

    const mainPath = join(packageRoot, 'src', 'main.ts')
    await unlink(mainPath)
    await symlink(join(packageRoot, 'README.md'), mainPath)

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: TEST_NOW
      }),
      /contains a symbolic link/u
    )
  })
})

test('rejects a private package path that resolves through a symbolic link', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const linkedPackageRoot = join(root, 'linked-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(stagingProjectRoot, { mode: 0o700 })
    await symlink(packageRoot, linkedPackageRoot, 'dir')

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [linkedPackageRoot],
        now: TEST_NOW
      }),
      /must be a canonical real directory/u
    )
  })
})

test('rejects a private package root that is not owner-only', async (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX owner-only modes are unavailable on Windows.')
    return
  }
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(join(stagingProjectRoot, 'packages', 'domains'), {
      recursive: true,
      mode: 0o700
    })
    await chmod(packageRoot, 0o755)

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: TEST_NOW
      }),
      /root is not owner-only/u
    )
  })
})

test('rejects a private package file with another hard-link name', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(join(stagingProjectRoot, 'packages', 'domains'), {
      recursive: true,
      mode: 0o700
    })
    await link(join(packageRoot, 'src', 'main.ts'), join(root, 'private-main-hard-link.ts'))

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: TEST_NOW
      }),
      /file is hard-linked/u
    )
  })
})

test('rejects a schema-valid verification profile at its expiry boundary', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(stagingProjectRoot, { mode: 0o700 })

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: new Date('2099-01-01T01:00:00.000Z')
      }),
      /verification profile is not currently valid/u
    )
  })
})

test('rejects verification profiles that form an invalid canonical policy', async () => {
  await withTemporaryRoot(async (root) => {
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    const firstProfile = validRequest().profiles[0]
    const secondProfile = {
      ...firstProfile,
      audience: 'ui'
    }
    await writeRenderedAuthorizationPackage({
      packageRoot,
      packageId: 'stage4-invalid-policy-test',
      profiles: [firstProfile, secondProfile]
    })
    await mkdir(stagingProjectRoot, { mode: 0o700 })

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: TEST_NOW
      }),
      /verification policy is invalid/u
    )
  })
})

test('rejects a manifest whose verification profile fails the canonical schema', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(stagingProjectRoot, { mode: 0o700 })

    const manifestPath = join(packageRoot, 'sciforge.domain.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const contributionId = manifest.entrypoints[0].contributions[0].id
    const contract = manifest.contributionContracts[contributionId]
    delete contract.profile.principal.deviceId
    const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`
    await writeFile(manifestPath, manifestSource, { mode: 0o600 })
    await updateInventoryEntry(
      packageRoot,
      'sciforge.domain.json',
      Buffer.from(manifestSource)
    )
    const receiptPath = join(packageRoot, 'authorization-package-receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipt.profiles[0].contractSha256 = createHash('sha256')
      .update(canonicalJson(contract))
      .digest('hex')
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: TEST_NOW
      }),
      /not an allowed verification profile/u
    )
  })
})

test('rejects a verification package with a renderer entrypoint', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(stagingProjectRoot, { mode: 0o700 })

    const manifestPath = join(packageRoot, 'sciforge.domain.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.entrypoints[0].process = 'renderer'
    manifest.entrypoints[0].export = './renderer'
    const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`
    await writeFile(manifestPath, manifestSource, { mode: 0o600 })
    await updateInventoryEntry(
      packageRoot,
      'sciforge.domain.json',
      Buffer.from(manifestSource)
    )

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: TEST_NOW
      }),
      /must be main-only/u
    )
  })
})

test('rejects a private domain package with no verification profile', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(stagingProjectRoot, { mode: 0o700 })

    const manifestPath = join(packageRoot, 'sciforge.domain.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.entrypoints[0].contributions = []
    manifest.contributionContracts = {}
    const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`
    await writeFile(manifestPath, manifestSource, { mode: 0o600 })
    await updateInventoryEntry(
      packageRoot,
      'sciforge.domain.json',
      Buffer.from(manifestSource)
    )
    const receiptPath = join(packageRoot, 'authorization-package-receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipt.profileCount = 0
    receipt.profiles = []
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: TEST_NOW
      }),
      /has no contribution/u
    )
  })
})

test('redacts invalid manifest values from the composition failure', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const packageRoot = join(root, 'external-authorization-package')
    const stagingProjectRoot = join(root, 'build-workspace')
    const privateMarker = 'credential-private-marker-must-not-leak'
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, {
      mode: 0o600
    })
    await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: packageRoot,
      now: TEST_NOW
    })
    await mkdir(stagingProjectRoot, { mode: 0o700 })

    const manifestPath = join(packageRoot, 'sciforge.domain.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.composition = privateMarker
    const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`
    await writeFile(manifestPath, manifestSource, { mode: 0o600 })
    await updateInventoryEntry(
      packageRoot,
      'sciforge.domain.json',
      Buffer.from(manifestSource)
    )

    await assert.rejects(
      composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths: [packageRoot],
        now: TEST_NOW
      }),
      (error) => {
        assert.match(error.message, /Private domain package manifest is invalid/u)
        assert.doesNotMatch(error.message, new RegExp(privateMarker, 'u'))
        return true
      }
    )
  })
})

function validRequest() {
  return {
    contractVersion: 1,
    packageId: 'stage4-external-test',
    profiles: [{
      profileId: 'stage4.external.list-containers',
      providerInstanceRef: 'provider-instance-a',
      principal: {
        authority: 'sciforge.identity-access',
        subject: 'stage4-user',
        assurance: 'cloud-authenticated',
        deviceId: 'stage4-device',
        identityVersion: 1
      },
      audience: 'agent',
      authority: {
        kind: 'provider-instance',
        providerInstanceRef: 'provider-instance-a'
      },
      operation: { family: 'ordinary', operation: 'list-containers' },
      transferLimits: { maxUploadBytes: 0, maxDownloadBytes: 0 },
      validFrom: '2099-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T01:00:00.000Z'
    }]
  }
}

async function withTemporaryRoot(run) {
  const parent = await realpath(tmpdir())
  const root = await mkdtemp(join(parent, 'sciforge-stage4-private-package-test-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`
}

async function updateInventoryEntry(packageRoot, path, bytes) {
  const receiptPath = join(packageRoot, 'authorization-package-receipt.json')
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  const entry = receipt.inventory.find((candidate) => candidate.path === path)
  assert.ok(entry)
  entry.sha256 = createHash('sha256').update(bytes).digest('hex')
  entry.size = bytes.byteLength
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
}

async function writeRenderedAuthorizationPackage({ packageRoot, packageId, profiles }) {
  const sourceRequestSha256 = 'f'.repeat(64)
  const files = await renderLocalContentSpaceAuthorizationPackageFiles({
    repositoryRoot: REPOSITORY_ROOT,
    packageId,
    profiles,
    sourceRequestSha256
  })
  await mkdir(packageRoot, { mode: 0o700 })
  for (const [path, source] of Object.entries(files)) {
    const target = join(packageRoot, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, source, { mode: 0o600 })
  }
  const manifest = JSON.parse(files['sciforge.domain.json'])
  const packageJson = JSON.parse(files['package.json'])
  const declarations = manifest.entrypoints[0].contributions
  const receipt = {
    contractVersion: 1,
    kind: 'sciforge-local-content-space-authorization-package',
    packageId,
    packageName: packageJson.name,
    moduleId: manifest.module.id,
    sourceRequestSha256,
    profileCount: declarations.length,
    profiles: declarations.map((declaration) => {
      const contract = manifest.contributionContracts[declaration.id]
      return {
        contributionId: declaration.id,
        contractSha256: createHash('sha256')
          .update(canonicalJson(contract))
          .digest('hex'),
        profileId: contract.profile.profileId
      }
    }),
    inventory: Object.entries(files).sort(([left], [right]) => left.localeCompare(right))
      .map(([path, source]) => ({
        path,
        sha256: createHash('sha256').update(source).digest('hex'),
        size: Buffer.byteLength(source)
      }))
  }
  await writeFile(
    join(packageRoot, 'authorization-package-receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { mode: 0o600 }
  )
}
