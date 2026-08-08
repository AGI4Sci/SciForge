import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  createSourceSmokeConfiguration,
  locatePackagedExecutable,
  makeExecutableForTest,
  parseSmokeCliOptions
} from './electron-domain-smoke-support.mjs'

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
