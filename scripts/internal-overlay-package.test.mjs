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
    outputFile: firstArchive,
    overlayId: 'provider-fixture',
    version: '1.2.3'
  })
  const second = await packInternalOverlay({
    sourceDir: fixture.sourceDir,
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
  assert.deepEqual(manifest.files.map((file) => file.path), [
    'docs/README.md',
    'internal/provider-fixture/package.json'
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
    files: verified.files,
    sha256: verified.sha256
  }, {
    overlayId: 'provider-fixture',
    version: '1.2.3',
    archiveRoot: first.archiveRoot,
    files: [
      'docs/README.md',
      'internal/provider-fixture/package.json'
    ],
    sha256: first.sha256
  })
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
  await symlink(
    path.join(sourceDir, 'README.md'),
    path.join(sourceDir, 'linked-readme.md')
  )
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
  const installed = await installInternalOverlay({ archivePath, targetRoot })
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

test('installs a verified overlay with a receipt and treats the same digest as idempotent', async (context) => {
  const fixture = await createFixture(context)
  const archivePath = path.join(fixture.root, 'overlay.zip')
  const targetRoot = path.join(fixture.root, 'checkout')
  await mkdir(targetRoot)
  const packed = await packInternalOverlay({
    sourceDir: fixture.sourceDir,
    outputFile: archivePath,
    overlayId: 'provider-fixture',
    version: '1.2.3'
  })

  const installed = await installInternalOverlay({ archivePath, targetRoot })
  assert.equal(installed.status, 'installed')
  assert.equal(installed.changed, true)
  assert.equal(
    await readFile(path.join(targetRoot, 'docs', 'README.md'), 'utf8'),
    '# Internal overlay\n'
  )
  const receiptBytes = await readFile(installed.receiptPath)
  const receipt = JSON.parse(receiptBytes.toString('utf8'))
  assert.equal(receiptBytes.toString('utf8'), canonicalJson(receipt))
  assert.equal(receipt.archiveSha256, packed.sha256)
  assert.deepEqual(receipt.files.map((file) => file.path), [
    'docs/README.md',
    'internal/provider-fixture/package.json'
  ])

  const second = await installInternalOverlay({ archivePath, targetRoot })
  assert.equal(second.status, 'already-installed')
  assert.equal(second.changed, false)
  assert.equal(second.receiptPath, installed.receiptPath)
})

test('refuses to overwrite a conflicting checkout file', async (context) => {
  const fixture = await createFixture(context)
  const archivePath = path.join(fixture.root, 'overlay.zip')
  const targetRoot = path.join(fixture.root, 'checkout')
  await mkdir(path.join(targetRoot, 'docs'), { recursive: true })
  await writeFile(path.join(targetRoot, 'docs', 'README.md'), '# User-owned content\n')
  await packInternalOverlay({
    sourceDir: fixture.sourceDir,
    outputFile: archivePath,
    overlayId: 'provider-fixture',
    version: '1.2.3'
  })

  await assert.rejects(
    installInternalOverlay({ archivePath, targetRoot }),
    /install conflict at docs\/README\.md/
  )
  assert.equal(
    await readFile(path.join(targetRoot, 'docs', 'README.md'), 'utf8'),
    '# User-owned content\n'
  )
  await assert.rejects(
    readFile(path.join(targetRoot, '.sciforge', 'internal-overlays', 'provider-fixture.json')),
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
})

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
