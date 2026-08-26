import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { generateLocalContentSpaceAuthorizationPackage } from './content-space-local-authorization-package.mjs'

const execFileAsync = promisify(execFile)
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEST_NOW = new Date('2099-01-01T00:00:00.000Z')

test('generates one deterministic main-only static authorization package', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const firstOutput = join(root, 'authorization-a')
    const secondOutput = join(root, 'authorization-b')
    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, { mode: 0o600 })

    const first = await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: firstOutput,
      now: TEST_NOW
    })
    const second = await generateLocalContentSpaceAuthorizationPackage({
      requestPath,
      outputDirectory: secondOutput,
      now: TEST_NOW
    })

    assert.equal(first.packageName, '@sciforge-local/content-space-authorization-stage4-run0')
    assert.equal(first.profileCount, 2)
    assert.equal(first.receiptSha256, second.receiptSha256)
    assert.equal(Object.hasOwn(first, 'profiles'), false)
    assert.deepEqual(
      await packageFileSnapshot(firstOutput),
      await packageFileSnapshot(secondOutput)
    )

    const manifest = JSON.parse(await readFile(
      join(firstOutput, 'sciforge.domain.json'),
      'utf8'
    ))
    assert.equal(manifest.entrypoints.length, 1)
    assert.equal(manifest.entrypoints[0].process, 'main')
    assert.equal(manifest.entrypoints[0].contributions.length, 2)
    for (const contribution of manifest.entrypoints[0].contributions) {
      assert.equal(contribution.kind, 'main.extension')
      assert.equal(contribution.version, '2.0.0')
      assert.equal(contribution.publicRelease, 'forbidden')
      assert.equal(
        manifest.contributionContracts[contribution.id].location,
        'main.content-space-verification-profile'
      )
    }

    await execFileAsync(
      resolve(REPOSITORY_ROOT, 'node_modules/.bin/tsc'),
      ['--noEmit', '-p', join(firstOutput, 'tsconfig.json')],
      { cwd: firstOutput }
    )
    await execFileAsync(
      process.execPath,
      ['--import', 'tsx', '--test', join(firstOutput, 'src/main.test.ts')],
      { cwd: firstOutput }
    )

    if (process.platform !== 'win32') {
      assert.equal((await lstat(firstOutput)).mode & 0o777, 0o700)
      assert.equal((await lstat(join(firstOutput, 'sciforge.domain.json'))).mode & 0o777, 0o600)
    }
  })
})

test('preserves the binding requirement for writes and transfer limits', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const outputDirectory = join(root, 'authorization')
    const request = validRequest()
    request.profiles = [{
      ...request.profiles[1],
      externalBinding: undefined
    }]
    await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600 })

    await assert.rejects(
      generateLocalContentSpaceAuthorizationPackage({
        requestPath,
        outputDirectory,
        now: TEST_NOW
      }),
      /requires a trusted Provider binding attestation/u
    )
    await assert.rejects(access(outputDirectory))
  })
})

test('rejects expired profiles, symlink requests, and an existing output', async () => {
  await withTemporaryRoot(async (root) => {
    const requestPath = join(root, 'request.json')
    const requestLink = join(root, 'request-link.json')
    const outputDirectory = join(root, 'authorization')
    const expired = validRequest()
    const invalidPackage = validRequest()
    invalidPackage.packageId = 'invalid--package'
    await writeFile(
      requestPath,
      `${JSON.stringify(invalidPackage, null, 2)}\n`,
      { mode: 0o600 }
    )
    await assert.rejects(
      generateLocalContentSpaceAuthorizationPackage({
        requestPath,
        outputDirectory,
        now: TEST_NOW
      }),
      /request contract is invalid/u
    )

    expired.profiles = [{
      ...expired.profiles[0],
      validFrom: '2098-12-31T22:00:00.000Z',
      expiresAt: '2098-12-31T23:00:00.000Z'
    }]
    await writeFile(requestPath, `${JSON.stringify(expired, null, 2)}\n`, { mode: 0o600 })

    await assert.rejects(
      generateLocalContentSpaceAuthorizationPackage({
        requestPath,
        outputDirectory,
        now: TEST_NOW
      }),
      /already expired/u
    )
    await symlink(requestPath, requestLink)
    await assert.rejects(
      generateLocalContentSpaceAuthorizationPackage({
        requestPath: requestLink,
        outputDirectory,
        now: TEST_NOW
      }),
      /bounded regular file/u
    )

    await writeFile(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, { mode: 0o600 })
    if (process.platform !== 'win32') {
      await chmod(requestPath, 0o644)
      await assert.rejects(
        generateLocalContentSpaceAuthorizationPackage({
          requestPath,
          outputDirectory,
          now: TEST_NOW
        }),
        /owner-only/u
      )
      await chmod(requestPath, 0o600)
    }
    await mkdir(outputDirectory, { mode: 0o700 })
    await assert.rejects(
      generateLocalContentSpaceAuthorizationPackage({
        requestPath,
        outputDirectory,
        now: TEST_NOW
      }),
      /already exists/u
    )
  })
})

function validRequest() {
  const principal = {
    authority: 'sciforge.identity-access',
    subject: 'stage4-user',
    assurance: 'cloud-authenticated',
    deviceId: 'stage4-device',
    identityVersion: 7
  }
  return {
    contractVersion: 1,
    packageId: 'stage4-run0',
    profiles: [
      {
        profileId: 'stage4.list-containers',
        providerInstanceRef: 'provider-instance-a',
        principal,
        audience: 'agent',
        authority: {
          kind: 'provider-instance',
          providerInstanceRef: 'provider-instance-a'
        },
        operation: { family: 'ordinary', operation: 'list-containers' },
        transferLimits: { maxUploadBytes: 0, maxDownloadBytes: 0 },
        validFrom: '2099-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T01:00:00.000Z'
      },
      {
        profileId: 'stage4.upload-new',
        providerInstanceRef: 'provider-instance-a',
        principal,
        audience: 'system',
        authority: {
          kind: 'content-root',
          root: {
            providerInstanceRef: 'provider-instance-a',
            containerId: 'opaque-root-a'
          }
        },
        operation: { family: 'ordinary', operation: 'upload-new' },
        transferLimits: { maxUploadBytes: 4096, maxDownloadBytes: 0 },
        externalBinding: {
          externalSubject: 'a'.repeat(64),
          bindingRevision: 'b'.repeat(64)
        },
        validFrom: '2099-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T01:00:00.000Z'
      }
    ]
  }
}

async function packageFileSnapshot(root) {
  const receipt = JSON.parse(await readFile(
    join(root, 'authorization-package-receipt.json'),
    'utf8'
  ))
  const paths = [
    ...receipt.inventory.map((entry) => entry.path),
    'authorization-package-receipt.json'
  ].sort()
  return Promise.all(paths.map(async (path) => [path, await readFile(join(root, path), 'utf8')]))
}

async function withTemporaryRoot(run) {
  const parent = resolve(REPOSITORY_ROOT, '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'content-space-authorization-test-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
