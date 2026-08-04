import assert from 'node:assert/strict'
import {
  generateKeyPairSync,
  verify as verifyBytes
} from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import JSZip from 'jszip'

import {
  INTEGRITY_PATH,
  SIGNATURE_PATH,
  canonicalJson,
  packExtensionPackage,
  verifyExtensionPackage
} from './extension-package.mjs'

test('packs a deterministic complete payload and verifies its Ed25519 signature', async (context) => {
  const fixture = await createFixture(context)
  const firstArchive = path.join(fixture.root, 'first.sciforge-plugin')
  const secondArchive = path.join(fixture.root, 'second.sciforge-plugin')

  const first = await packExtensionPackage({
    sourceDir: fixture.sourceDir,
    outputFile: firstArchive,
    publisherId: 'sciforge',
    keyId: 'official-2026',
    privateKey: fixture.privateKey
  })
  const second = await packExtensionPackage({
    sourceDir: fixture.sourceDir,
    outputFile: secondArchive,
    publisherId: 'sciforge',
    keyId: 'official-2026',
    privateKey: fixture.privateKey
  })

  assert.equal(first.sha256, second.sha256)
  assert.deepEqual(await readFile(firstArchive), await readFile(secondArchive))
  assert.equal(first.fileCount, 4)

  const archive = await JSZip.loadAsync(await readFile(firstArchive))
  assert.deepEqual(Object.keys(archive.files), [
    'README.md',
    'dist/main.js',
    'package.json',
    'sciforge.domain.json',
    INTEGRITY_PATH,
    SIGNATURE_PATH
  ])
  assert.equal(archive.file('node_modules/untrusted/index.js'), null)
  const integrityBytes = await archive.file(INTEGRITY_PATH).async('nodebuffer')
  const integrity = JSON.parse(integrityBytes.toString('utf8'))
  const signature = JSON.parse(
    await archive.file(SIGNATURE_PATH).async('string')
  )
  assert.equal(integrityBytes.toString('utf8'), canonicalJson(integrity))
  assert.deepEqual(Object.keys(integrity.files), [
    'README.md',
    'dist/main.js',
    'package.json',
    'sciforge.domain.json'
  ])
  assert.equal(
    verifyBytes(
      null,
      integrityBytes,
      fixture.publicKey,
      Buffer.from(signature.signature, 'base64')
    ),
    true
  )

  const verified = await verifyExtensionPackage({
    archivePath: firstArchive,
    publicKey: fixture.publicKey,
    expectedPublisherId: 'sciforge',
    expectedKeyId: 'official-2026'
  })
  assert.deepEqual({
    packageName: verified.packageName,
    version: verified.version,
    publisherId: verified.publisherId,
    keyId: verified.keyId,
    files: verified.files
  }, {
    packageName: '@sciforge/domain-fixture',
    version: '1.2.3',
    publisherId: 'sciforge',
    keyId: 'official-2026',
    files: [
      'README.md',
      'dist/main.js',
      'package.json',
      'sciforge.domain.json'
    ]
  })
})

test('fails closed for altered, extra, and incorrectly signed payloads', async (context) => {
  const fixture = await createFixture(context)
  const sourceArchive = path.join(fixture.root, 'source.sciforge-plugin')
  await packExtensionPackage({
    sourceDir: fixture.sourceDir,
    outputFile: sourceArchive,
    publisherId: 'sciforge',
    keyId: 'official-2026',
    privateKey: fixture.privateKey
  })
  const sourceBytes = await readFile(sourceArchive)

  const alteredArchive = await JSZip.loadAsync(sourceBytes)
  alteredArchive.file('dist/main.js', 'export const altered = true\n', {
    createFolders: false
  })
  await assert.rejects(
    verifyExtensionPackage({
      archiveBytes: await alteredArchive.generateAsync({ type: 'nodebuffer' }),
      publicKey: fixture.publicKey
    }),
    /payload integrity mismatch for dist\/main\.js/
  )

  const extraArchive = await JSZip.loadAsync(sourceBytes)
  extraArchive.file('dist/undeclared.js', 'extra\n', { createFolders: false })
  await assert.rejects(
    verifyExtensionPackage({
      archiveBytes: await extraArchive.generateAsync({ type: 'nodebuffer' }),
      publicKey: fixture.publicKey
    }),
    /must list every payload file exactly once/
  )

  const unrelatedKeys = generateKeyPairSync('ed25519')
  await assert.rejects(
    verifyExtensionPackage({
      archiveBytes: sourceBytes,
      publicKey: unrelatedKeys.publicKey
    }),
    /signature verification failed/
  )
})

test('rejects install hooks, selected symlinks, and private key material', async (context) => {
  const installHookFixture = await createFixture(context, {
    scripts: { postinstall: 'node steal-secrets.js' }
  })
  await assert.rejects(
    packFixture(installHookFixture, 'postinstall.sciforge-plugin'),
    /must not declare install lifecycle scripts: postinstall/
  )

  const nestedHookFixture = await createFixture(context)
  await writeFile(
    path.join(nestedHookFixture.sourceDir, 'dist', 'package.json'),
    JSON.stringify({ scripts: { prepare: 'node build.js' } })
  )
  await assert.rejects(
    packFixture(nestedHookFixture, 'nested-install-hook.sciforge-plugin'),
    /must not declare install lifecycle scripts: prepare/
  )

  const symlinkFixture = await createFixture(context)
  await symlink(
    path.join(symlinkFixture.sourceDir, 'README.md'),
    path.join(symlinkFixture.sourceDir, 'dist', 'linked.js')
  )
  await assert.rejects(
    packFixture(symlinkFixture, 'symlink.sciforge-plugin'),
    /must not contain symlink dist\/linked\.js/
  )

  const privateKeyFixture = await createFixture(context, {
    files: ['dist', 'README.md', 'secrets']
  })
  await mkdir(path.join(privateKeyFixture.sourceDir, 'secrets'))
  await writeFile(
    path.join(privateKeyFixture.sourceDir, 'secrets', 'credentials.txt'),
    '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n'
  )
  await assert.rejects(
    packFixture(privateKeyFixture, 'private-key.sciforge-plugin'),
    /must not contain private key material/
  )
})

test('requires an explicit package files allowlist and matching package identity', async (context) => {
  const missingFilesFixture = await createFixture(context, { files: null })
  await assert.rejects(
    packFixture(missingFilesFixture, 'missing-files.sciforge-plugin'),
    /non-empty files array/
  )

  const mismatchedFixture = await createFixture(context, {
    manifestPackageName: '@sciforge/something-else'
  })
  await assert.rejects(
    packFixture(mismatchedFixture, 'mismatch.sciforge-plugin'),
    /packageName must match package\.json name/
  )
})

test('binds sandboxed runtime identity and entrypoints to the signed package', async (context) => {
  const publisherFixture = await createFixture(context, {
    publisherId: 'another-publisher'
  })
  await assert.rejects(
    packFixture(publisherFixture, 'publisher-mismatch.sciforge-plugin'),
    /publisher\.id must match the signed integrity publisherId/
  )

  const versionFixture = await createFixture(context, {
    manifestVersion: '1.2.4'
  })
  await assert.rejects(
    packFixture(versionFixture, 'version-mismatch.sciforge-plugin'),
    /module\.version must match package\.json version/
  )

  const trustedFixture = await createFixture(context, {
    kind: 'trusted-compile-time'
  })
  await assert.rejects(
    packFixture(trustedFixture, 'trusted-compile-time.sciforge-plugin'),
    /kind must be sandboxed-runtime/
  )

  const missingEntrypointFixture = await createFixture(context, {
    entrypoint: 'dist/missing.js'
  })
  await assert.rejects(
    packFixture(missingEntrypointFixture, 'missing-entrypoint.sciforge-plugin'),
    /runtime entrypoint dist\/missing\.js is not selected/
  )
})

async function createFixture(context, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-plugin-package-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const sourceDir = path.join(root, 'package')
  await mkdir(path.join(sourceDir, 'dist'), { recursive: true })
  await mkdir(path.join(sourceDir, 'node_modules', 'untrusted'), { recursive: true })
  const packageJson = {
    name: '@sciforge/domain-fixture',
    version: '1.2.3',
    type: 'module',
    exports: {
      './main': './dist/main.js'
    },
    files: options.files === null
      ? undefined
      : options.files ?? ['dist', 'README.md'],
    scripts: options.scripts ?? {
      test: 'node --test'
    }
  }
  if (packageJson.files === undefined) delete packageJson.files
  await writeFile(
    path.join(sourceDir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  )
  const manifestBase = {
    contractVersion: 1,
    kind: options.kind ?? 'sandboxed-runtime',
    packageName: options.manifestPackageName ?? packageJson.name,
    module: {
      id: 'sciforge.fixture',
      displayName: 'Fixture',
      version: options.manifestVersion ?? packageJson.version,
      hostApi: {
        minimum: '1.0.0',
        maximumExclusive: '2.0.0'
      }
    }
  }
  const domainManifest = manifestBase.kind === 'sandboxed-runtime'
    ? {
      ...manifestBase,
      publisher: {
        id: options.publisherId ?? 'sciforge',
        displayName: 'SciForge'
      },
      requestedPermissions: [],
      entrypoints: [{
        process: 'main',
        isolation: 'extension-host',
        entry: options.entrypoint ?? 'dist/main.js',
        format: 'module',
        contributions: [{
          kind: 'main.capability-factory',
          id: 'fixture.capabilities'
        }]
      }]
    }
    : {
      ...manifestBase,
      entrypoints: [{
        process: 'main',
        export: './main',
        contributions: [{
          kind: 'main.capability-factory',
          id: 'fixture.capabilities'
        }]
      }]
    }
  await writeFile(
    path.join(sourceDir, 'sciforge.domain.json'),
    `${JSON.stringify(domainManifest, null, 2)}\n`
  )
  await writeFile(
    path.join(sourceDir, 'dist', 'main.js'),
    'export const fixture = true\n'
  )
  await writeFile(path.join(sourceDir, 'README.md'), '# Fixture\n')
  await writeFile(
    path.join(sourceDir, 'node_modules', 'untrusted', 'index.js'),
    'throw new Error("must never be packaged")\n'
  )
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { root, sourceDir, privateKey, publicKey }
}

function packFixture(fixture, archiveName) {
  return packExtensionPackage({
    sourceDir: fixture.sourceDir,
    outputFile: path.join(fixture.root, archiveName),
    publisherId: 'sciforge',
    keyId: 'official-2026',
    privateKey: fixture.privateKey
  })
}
