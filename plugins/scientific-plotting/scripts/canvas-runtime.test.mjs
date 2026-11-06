import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath, readFile, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyCanvasRuntime, selectCanvasBinding } from './canvas-runtime.mjs'

async function fixture(t, variant = 'win32-x64-msvc') {
  const root = await realpath(await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), 'canvas fixture ')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const [platform, arch] = variant.split('-')
  const nativeName = `@napi-rs/canvas-${variant}`
  const canvasRoot = join(root, 'canvas'), nativeRoot = join(root, variant)
  await mkdir(canvasRoot); await mkdir(nativeRoot)
  const binding = join(nativeRoot, 'binding.node')
  const nativeManifest = { name: nativeName, version: '0.1.100', os: [platform], cpu: [arch], main: 'binding.node' }
  await writeFile(binding, 'fixture only; not an executable native binary')
  await writeFile(join(nativeRoot, 'package.json'), JSON.stringify(nativeManifest))
  const canvasManifest = { name: '@napi-rs/canvas', version: '0.1.100', optionalDependencies: { [nativeName]: '0.1.100' } }
  await writeFile(join(canvasRoot, 'package.json'), JSON.stringify(canvasManifest))
  const canvasModule = { filename: join(canvasRoot, 'index.js'), children: [{ filename: binding, children: [] }] }
  const args = { canvasRoot, canvasManifest, canvasModule, platform, arch, canvasRequire: { resolve: name => {
    if (name === nativeName) return binding
    if (name === `${nativeName}/package.json`) return join(nativeRoot, 'package.json')
    throw new Error('Unexpected package resolution')
  } } }
  return { root, args, nativeRoot, binding, nativeManifest, select: () => selectCanvasBinding(args) }
}

for (const variant of ['win32-x64-msvc', 'linux-x64-gnu', 'linux-x64-musl', 'darwin-x64', 'darwin-arm64']) {
  test(`selects actual ${variant} binding and copies physical packages with spaces`, async t => {
    const f = await fixture(t, variant), runtime = await f.select()
    assert.equal(runtime.nativeName, `@napi-rs/canvas-${variant}`)
    const destination = join(f.root, 'packaged dependencies')
    await copyCanvasRuntime(runtime, destination)
    assert.equal(await readFile(join(destination, runtime.nativeName, 'binding.node'), 'utf8'), await readFile(f.binding, 'utf8'))
    assert.equal(JSON.parse(await readFile(join(destination, '@napi-rs/canvas/package.json'), 'utf8')).version, '0.1.100')
  })
}
test('rejects missing and ambiguous bindings, including unrelated native descendants', async t => {
  const f = await fixture(t)
  f.args.canvasModule.children = []
  await assert.rejects(f.select(), /Missing or ambiguous/)
  f.args.canvasModule.children = [{ filename: f.binding }, { filename: join(f.root, 'other.node') }]
  await assert.rejects(f.select(), /Missing or ambiguous/)
})
for (const mutation of ['version', 'name', 'os', 'cpu']) {
  test(`rejects wrong native ${mutation}`, async t => {
    const f = await fixture(t)
    f.nativeManifest[mutation] = ['os', 'cpu'].includes(mutation) ? ['wrong'] : 'wrong'
    await writeFile(join(f.nativeRoot, 'package.json'), JSON.stringify(f.nativeManifest))
    await assert.rejects(f.select(), /identity or version|platform\/architecture/)
  })
}
test('rejects binding outside its declared package and mispointed package resolution', async t => {
  const f = await fixture(t)
  const outside = join(f.root, 'outside.node')
  await writeFile(outside, 'unrelated')
  f.args.canvasRequire.resolve = name => name.endsWith('package.json') ? join(f.nativeRoot, 'package.json') : outside
  await assert.rejects(f.select(), /Mispointed or escaping/)
  f.args.canvasModule.children = [{ filename: outside }]
  await assert.rejects(f.select(), /identity|ENOENT/)
})
test('rejects real-path escapes and package-copy links', async t => {
  const f = await fixture(t)
  const external = join(f.root, 'external')
  await mkdir(external)
  await writeFile(join(external, 'binding.node'), 'external')
  await symlink(external, join(f.nativeRoot, 'escape'), 'junction')
  f.args.canvasModule.children = [{ filename: join(f.nativeRoot, 'escape/binding.node') }]
  await assert.rejects(f.select(), /Mispointed or escaping/)
  f.args.canvasModule.children = [{ filename: f.binding }]
  await assert.rejects(copyCanvasRuntime(await f.select(), join(f.root, 'copy')), /escapes|physical files/)
})
test('rejects a missing binding on disk', async t => {
  const f = await fixture(t)
  await rm(f.binding)
  await assert.rejects(f.select(), /ENOENT/)
})
test('rejects an undeclared native package', async t => {
  const f = await fixture(t)
  f.args.canvasManifest.optionalDependencies = {}
  await assert.rejects(f.select(), /identity or version/)
})
test('rejects a loaded binding from a different installation of the declared package', async t => {
  const f = await fixture(t)
  const other = join(f.root, 'other installation')
  await mkdir(other)
  await writeFile(join(other, 'package.json'), JSON.stringify(f.nativeManifest))
  f.args.canvasRequire.resolve = name => name.endsWith('package.json') ? join(other, 'package.json') : f.binding
  await assert.rejects(f.select(), /Mispointed or escaping/)
})
