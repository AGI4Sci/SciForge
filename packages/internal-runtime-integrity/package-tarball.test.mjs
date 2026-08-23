import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const run = promisify(execFile)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packageName = '@sciforge/internal-runtime-integrity'
const packageRoot = import.meta.dirname
const typescript = resolve(packageRoot, '../../node_modules/typescript/bin/tsc')

test('the installed tarball exposes the integrity API to ESM and CommonJS consumers', {
  timeout: 60_000
}, async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-integrity-tarball-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const tarballs = join(root, 'tarballs')
  const consumer = join(root, 'consumer')
  await mkdir(tarballs)
  await mkdir(consumer)
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    name: 'integrity-tarball-consumer',
    private: true,
    type: 'module'
  }))

  const { stdout } = await run(npm, [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    tarballs
  ], { cwd: packageRoot })
  const packed = JSON.parse(stdout)
  assert.equal(packed.length, 1)
  const archive = join(tarballs, packed[0].filename)

  await run(npm, [
    'install',
    '--ignore-scripts',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    archive
  ], { cwd: consumer })

  const installedRoot = join(consumer, 'node_modules', packageName)
  assert.equal((await lstat(installedRoot)).isSymbolicLink(), false)
  assert.equal((await realpath(installedRoot)).startsWith(await realpath(packageRoot)), false)
  const installedPackage = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
  assert.equal(installedPackage.name, packageName)
  assert.equal(installedPackage.exports['.'].import, installedPackage.exports['.'].require)

  const expected = '{"a":1,"z":2}'
  const esm = await run(process.execPath, [
    '--input-type=module',
    '--eval',
    `import { canonicalJson } from ${JSON.stringify(packageName)}; process.stdout.write(canonicalJson({ z: 2, a: 1 }))`
  ], { cwd: consumer })
  assert.equal(esm.stdout, expected)

  const commonjs = await run(process.execPath, [
    '--input-type=commonjs',
    '--eval',
    `const { canonicalJson } = require(${JSON.stringify(packageName)}); process.stdout.write(canonicalJson({ z: 2, a: 1 }))`
  ], { cwd: consumer })
  assert.equal(commonjs.stdout, expected)

  await writeFile(join(consumer, 'consumer.mts'), `
    import { canonicalJson, type InternalRuntimeIntegrityManifest } from ${JSON.stringify(packageName)}
    const manifest: InternalRuntimeIntegrityManifest = {
      files: [], overlayId: 'fixture', overlayRoot: 'internal/fixture', version: '1.0.0'
    }
    const serialized: string = canonicalJson(manifest)
    void serialized
  `)
  await writeFile(join(consumer, 'consumer.cts'), `
    import integrity = require(${JSON.stringify(packageName)})
    const serialized: string = integrity.canonicalJson({ fixture: true })
    void serialized
  `)
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: 'ES2023'
    },
    include: ['consumer.mts', 'consumer.cts']
  }))
  await run(process.execPath, [typescript, '--project', 'tsconfig.json'], { cwd: consumer })
})
