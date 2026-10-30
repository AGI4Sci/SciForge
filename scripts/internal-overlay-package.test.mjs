import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
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
import { promisify } from 'node:util'
import test from 'node:test'

import JSZip from 'jszip'

import {
  canonicalJson,
  installInternalOverlay,
  packInternalOverlay,
  verifyInstalledInternalOverlay,
  verifyInternalOverlay
} from './internal-overlay-package.mjs'

const execFileAsync = promisify(execFile)
const cliPath = path.resolve('scripts/internal-overlay-package.mjs')

test('packs a deterministic overlay with a canonical, complete integrity manifest', async (context) => {
  const fixture = await createFixture(context)
  const firstArchive = path.join(fixture.root, 'first.zip')
  const secondArchive = path.join(fixture.root, 'second.zip')

  const first = await packInternalOverlay({
    sourceDir: fixture.sourceDir,
    payloadPrefix: 'internal/provider-fixture',
    outputFile: firstArchive,
    overlayId: 'provider-fixture',
    version: '1.2.3'
  })
  const second = await packInternalOverlay({
    sourceDir: fixture.sourceDir,
    payloadPrefix: 'internal/provider-fixture',
    outputFile: secondArchive,
    overlayId: 'provider-fixture',
    version: '1.2.3'
  })

  assert.equal(first.sha256, second.sha256)
  assert.deepEqual(await readFile(firstArchive), await readFile(secondArchive))
  assert.equal(
    await readFile(`${firstArchive}.sha256`, 'utf8'),
    `${first.sha256}  first.zip\n`
  )

  const archive = await JSZip.loadAsync(await readFile(firstArchive))
  const manifestPath = `${first.archiveRoot}/MANIFEST.json`
  const manifestBytes = await archive.file(manifestPath).async('nodebuffer')
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  assert.equal(manifestBytes.toString('utf8'), canonicalJson(manifest))
  assert.equal(manifest.schemaVersion, 2)
  assert.equal(manifest.overlayRoot, 'internal/provider-fixture')
  assert.deepEqual(manifest.files.map((file) => file.path), [
    'internal/provider-fixture/docs/README.md',
    'internal/provider-fixture/internal/provider-fixture/package.json'
  ])
  assert.equal(
    manifest.files[0].sha256,
    sha256(Buffer.from('# Internal overlay\n'))
  )

  const verified = await verifyInternalOverlay({ archivePath: firstArchive })
  assert.deepEqual({
    overlayId: verified.overlayId,
    version: verified.version,
    archiveRoot: verified.archiveRoot,
    overlayRoot: verified.overlayRoot,
    files: verified.files,
    sha256: verified.sha256
  }, {
    overlayId: 'provider-fixture',
    version: '1.2.3',
    archiveRoot: first.archiveRoot,
    overlayRoot: 'internal/provider-fixture',
    files: [
      'internal/provider-fixture/docs/README.md',
      'internal/provider-fixture/internal/provider-fixture/package.json'
    ],
    sha256: first.sha256
  })
})

test('requires every overlay payload root to remain beneath internal', async (context) => {
  const fixture = await createFixture(context)
  await assert.rejects(
    packInternalOverlay({
      sourceDir: fixture.sourceDir,
      payloadPrefix: 'packages/private-fixture',
      outputFile: path.join(fixture.root, 'unsafe.zip'),
      overlayId: 'provider-fixture',
      version: '1.2.3'
    }),
    /must remain beneath internal/u
  )
})

test('preserves a repo-relative payload prefix and excludes disposable source residue', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-private-assets-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const sourceDir = path.join(root, 'internal', 'opencontent')
  const assetDir = path.join(sourceDir, 'packages', 'opencontent-skill-assets')
  await mkdir(assetDir, { recursive: true })
  await writeFile(path.join(sourceDir, 'README.md'), '# Private attachment assets\n')
  await writeFile(path.join(assetDir, 'package.json'), '{"private":true}\n')
  await writeFile(path.join(sourceDir, '.DS_Store'), 'Finder residue')
  for (const ignoredDir of ['node_modules', 'dist', '.vite', 'cache']) {
    await mkdir(path.join(sourceDir, ignoredDir), { recursive: true })
    await writeFile(path.join(sourceDir, ignoredDir, 'ignored.txt'), 'ignore me')
  }
  const archivePath = path.join(root, 'assets.zip')

  await packInternalOverlay({
    sourceDir,
    payloadPrefix: 'internal/opencontent',
    outputFile: archivePath,
    overlayId: 'opencontent-attachment-assets',
    version: '1.0.1'
  })

  const verified = await verifyInternalOverlay({ archivePath })
  assert.deepEqual(verified.files, [
    'internal/opencontent/README.md',
    'internal/opencontent/packages/opencontent-skill-assets/package.json'
  ])
  assert.equal(
    verified.files.every((file) => file.startsWith('internal/opencontent/')),
    true
  )

  const targetRoot = path.join(root, 'checkout')
  await mkdir(targetRoot)
  const installed = await installInternalOverlay({
    archivePath,
    expectedSha256: (await verifyInternalOverlay({ archivePath })).sha256,
    targetRoot
  })
  assert.equal(installed.status, 'installed')
  assert.equal(
    await readFile(path.join(targetRoot, 'internal', 'opencontent', 'README.md'), 'utf8'),
    '# Private attachment assets\n'
  )
  assert.equal(
    await readFile(
      path.join(
        targetRoot,
        'internal',
        'opencontent',
        'packages',
        'opencontent-skill-assets',
        'package.json'
      ),
      'utf8'
    ),
    '{"private":true}\n'
  )
})

test('rejects source symlinks instead of silently omitting them from inventory', async (context) => {
  const fixture = await createFixture(context)
  await symlink(
    path.join(fixture.sourceDir, 'docs', 'README.md'),
    path.join(fixture.sourceDir, 'linked-readme.md')
  )

  await assert.rejects(
    packInternalOverlay({
      sourceDir: fixture.sourceDir,
      payloadPrefix: 'internal/provider-fixture',
      outputFile: path.join(fixture.root, 'symlink.zip'),
      overlayId: 'provider-fixture',
      version: '1.2.3'
    }),
    /source contains symbolic link linked-readme\.md/u
  )
})

test('installs a verified overlay with a receipt and treats the same digest as idempotent', async (context) => {
  const fixture = await createFixture(context)
  const archivePath = path.join(fixture.root, 'overlay.zip')
  const targetRoot = path.join(fixture.root, 'checkout')
  await mkdir(targetRoot)
  const packed = await packInternalOverlay({
    sourceDir: fixture.sourceDir,
    payloadPrefix: 'internal/provider-fixture',
    outputFile: archivePath,
    overlayId: 'provider-fixture',
    version: '1.2.3'
  })
  await rm(`${archivePath}.sha256`)

  await assert.rejects(
    installInternalOverlay({ archivePath, targetRoot }),
    /explicit trusted expectedSha256/
  )
  const installed = await installInternalOverlay({
    archivePath,
    expectedSha256: packed.sha256,
    targetRoot
  })
  assert.equal(installed.status, 'installed')
  assert.equal(installed.changed, true)
  assert.equal(
    await readFile(
      path.join(targetRoot, 'internal', 'provider-fixture', 'docs', 'README.md'),
      'utf8'
    ),
    '# Internal overlay\n'
  )
  const receiptBytes = await readFile(installed.receiptPath)
  const receipt = JSON.parse(receiptBytes.toString('utf8'))
  assert.equal(receiptBytes.toString('utf8'), canonicalJson(receipt))
  assert.equal(receipt.schemaVersion, 2)
  assert.equal(receipt.archiveRoot, packed.archiveRoot)
  assert.equal(receipt.archiveSha256, packed.sha256)
  assert.equal(receipt.overlayRoot, 'internal/provider-fixture')
  assert.match(receipt.inventorySha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(receipt.files.map((file) => file.path), [
    'internal/provider-fixture/docs/README.md',
    'internal/provider-fixture/internal/provider-fixture/package.json'
  ])

  const verifiedInstallation = await verifyInstalledInternalOverlay({
    overlayId: 'provider-fixture',
    overlayRoot: 'internal/provider-fixture',
    targetRoot
  })
  assert.equal(verifiedInstallation.inventorySha256, receipt.inventorySha256)
  assert.equal(verifiedInstallation.fileCount, 2)

  const second = await installInternalOverlay({
    archivePath,
    expectedSha256: packed.sha256,
    targetRoot
  })
  assert.equal(second.status, 'already-installed')
  assert.equal(second.changed, false)
  assert.equal(second.receiptPath, installed.receiptPath)
})

test('refuses to overwrite a conflicting checkout file', async (context) => {
  const fixture = await createFixture(context)
  const archivePath = path.join(fixture.root, 'overlay.zip')
  const targetRoot = path.join(fixture.root, 'checkout')
  await mkdir(
    path.join(targetRoot, 'internal', 'provider-fixture', 'docs'),
    { recursive: true }
  )
  await writeFile(
    path.join(targetRoot, 'internal', 'provider-fixture', 'docs', 'README.md'),
    '# User-owned content\n'
  )
  await packInternalOverlay({
    sourceDir: fixture.sourceDir,
    payloadPrefix: 'internal/provider-fixture',
    outputFile: archivePath,
    overlayId: 'provider-fixture',
    version: '1.2.3'
  })

  await assert.rejects(
    installInternalOverlay({
      archivePath,
      expectedSha256: (await verifyInternalOverlay({ archivePath })).sha256,
      targetRoot
    }),
    /install conflict at internal\/provider-fixture\/docs\/README\.md/
  )
  assert.equal(
    await readFile(path.join(targetRoot, 'internal', 'provider-fixture', 'docs', 'README.md'), 'utf8'),
    '# User-owned content\n'
  )
  await assert.rejects(
    readFile(path.join(targetRoot, '.sciforge', 'internal-overlays', 'provider-fixture.json')),
    { code: 'ENOENT' }
  )
})

test('serializes overlay installation with a repository-owned lock', async (context) => {
  const fixture = await createFixture(context)
  const archivePath = path.join(fixture.root, 'overlay.zip')
  const targetRoot = path.join(fixture.root, 'checkout')
  const lockPath = path.join(
    targetRoot,
    '.sciforge',
    'internal-overlays',
    '.install.lock'
  )
  await mkdir(path.dirname(lockPath), { recursive: true })
  await writeFile(lockPath, 'another installer\n')
  const packed = await packInternalOverlay({
    sourceDir: fixture.sourceDir,
    payloadPrefix: 'internal/provider-fixture',
    outputFile: archivePath,
    overlayId: 'provider-fixture',
    version: '1.2.3'
  })

  await assert.rejects(
    installInternalOverlay({
      archivePath,
      expectedSha256: packed.sha256,
      targetRoot
    }),
    /installation is already in progress/u
  )
  assert.equal(await readFile(lockPath, 'utf8'), 'another installer\n')
  await assert.rejects(
    readFile(path.join(targetRoot, 'internal', 'provider-fixture', 'docs', 'README.md')),
    { code: 'ENOENT' }
  )
})

test('exposes pack, verify, and install as a group-distribution CLI', async (context) => {
  const fixture = await createFixture(context)
  const archivePath = path.join(fixture.root, 'overlay.zip')
  const targetRoot = path.join(fixture.root, 'checkout')
  await mkdir(targetRoot)

  const packed = await runCli([
    'pack',
    '--source', fixture.sourceDir,
    '--prefix', 'internal/opencontent',
    '--output', archivePath,
    '--id', 'provider-fixture',
    '--version', '1.2.3'
  ])
  assert.equal(packed.fileCount, 2)
  assert.equal(packed.outputFile, archivePath)

  const verified = await runCli(['verify', '--archive', archivePath])
  assert.deepEqual(verified.files, [
    'internal/opencontent/docs/README.md',
    'internal/opencontent/internal/provider-fixture/package.json'
  ])

  const installed = await runCli([
    'install',
    '--archive', archivePath,
    '--sha256', packed.sha256,
    '--target', targetRoot
  ])
  assert.equal(installed.status, 'installed')
  assert.equal(
    await readFile(
      path.join(targetRoot, 'internal', 'opencontent', 'docs', 'README.md'),
      'utf8'
    ),
    '# Internal overlay\n'
  )

  const installation = await runCli([
    'verify-installation',
    '--id', 'provider-fixture',
    '--root', 'internal/opencontent',
    '--target', targetRoot
  ])
  assert.equal(installation.fileCount, 2)
})

test('static installation verification rejects unreceipted and mismatched overlay roots', async (context) => {
  const fixture = await createFixture(context)
  const targetRoot = path.join(fixture.root, 'checkout')
  await mkdir(path.join(targetRoot, 'internal', 'provider-fixture'), { recursive: true })

  await assert.rejects(
    verifyInstalledInternalOverlay({
      overlayId: 'provider-fixture',
      overlayRoot: 'internal/provider-fixture',
      targetRoot
    }),
    /receipt is missing/
  )

  const installed = await installFixture(fixture, targetRoot)
  await assert.rejects(
    verifyInstalledInternalOverlay({
      overlayId: 'provider-fixture',
      overlayRoot: 'internal/another-root',
      targetRoot
    }),
    /overlay root does not match/
  )
  assert.equal(installed.overlayId, 'provider-fixture')
})

test('static installation verification rejects a self-inconsistent receipt digest', async (context) => {
  const fixture = await createFixture(context)
  const targetRoot = path.join(fixture.root, 'checkout')
  await mkdir(targetRoot)
  const installed = await installFixture(fixture, targetRoot)
  const receipt = JSON.parse(await readFile(installed.receiptPath, 'utf8'))
  receipt.inventorySha256 = 'b'.repeat(64)
  await writeFile(installed.receiptPath, canonicalJson(receipt))

  await assert.rejects(
    verifyInstalledInternalOverlay({
      overlayId: 'provider-fixture',
      overlayRoot: 'internal/provider-fixture',
      targetRoot
    }),
    /inventory digest is invalid/u
  )
})

for (const corruption of [
  {
    label: 'changed files',
    expected: /changed file/,
    apply: (targetRoot) => writeFile(
      path.join(targetRoot, 'internal', 'provider-fixture', 'docs', 'README.md'),
      '# Changed\n'
    )
  },
  {
    label: 'missing files',
    expected: /missing file/,
    apply: (targetRoot) => rm(
      path.join(targetRoot, 'internal', 'provider-fixture', 'docs', 'README.md')
    )
  },
  {
    label: 'extra files',
    expected: /unreceipted file/,
    apply: (targetRoot) => writeFile(
      path.join(targetRoot, 'internal', 'provider-fixture', 'EXTRA.txt'),
      'unreceipted'
    )
  },
  {
    label: 'symlink escapes',
    expected: /symbolic link/,
    apply: async (targetRoot, fixture) => {
      const overlayRoot = path.join(targetRoot, 'internal', 'provider-fixture')
      await rm(overlayRoot, { recursive: true })
      await symlink(fixture.sourceDir, overlayRoot, 'dir')
    }
  }
]) {
  test(`static installation verification rejects ${corruption.label}`, async (context) => {
    const fixture = await createFixture(context)
    const targetRoot = path.join(fixture.root, 'checkout')
    await mkdir(targetRoot)
    await installFixture(fixture, targetRoot)
    await corruption.apply(targetRoot, fixture)

    await assert.rejects(
      verifyInstalledInternalOverlay({
        overlayId: 'provider-fixture',
        overlayRoot: 'internal/provider-fixture',
        targetRoot
      }),
      corruption.expected
    )
  })
}

async function createFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-internal-overlay-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const sourceDir = path.join(root, 'source')
  await mkdir(path.join(sourceDir, 'docs'), { recursive: true })
  await mkdir(path.join(sourceDir, 'internal', 'provider-fixture'), {
    recursive: true
  })
  await writeFile(path.join(sourceDir, 'docs', 'README.md'), '# Internal overlay\n')
  await writeFile(
    path.join(sourceDir, 'internal', 'provider-fixture', 'package.json'),
    '{"name":"@internal/provider-fixture","private":true}\n'
  )
  return { root, sourceDir }
}

async function installFixture(fixture, targetRoot) {
  const archivePath = path.join(fixture.root, `overlay-${path.basename(targetRoot)}.zip`)
  const packed = await packInternalOverlay({
    sourceDir: fixture.sourceDir,
    payloadPrefix: 'internal/provider-fixture',
    outputFile: archivePath,
    overlayId: 'provider-fixture',
    version: '1.2.3'
  })
  return installInternalOverlay({
    archivePath,
    expectedSha256: packed.sha256,
    targetRoot
  })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function runCli(args) {
  const result = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: path.resolve('.'),
    encoding: 'utf8'
  })
  return JSON.parse(result.stdout)
}
