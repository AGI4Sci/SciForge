import { createRequire } from 'node:module'
import { cp, lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

function inside(root, path) {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
const manifestAt = async root => JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

/** Inspect only descendants of the Canvas instance used by this build. */
export async function inspectCanvasRuntime(require, platform = process.platform, arch = process.arch) {
  const entry = require.resolve('@napi-rs/canvas')
  require('@napi-rs/canvas') // Must actually load successfully before selecting an artifact.
  const canvasRoot = await realpath(dirname(require.resolve('@napi-rs/canvas/package.json')))
  const canvasManifest = await manifestAt(canvasRoot)
  if (canvasManifest.name !== '@napi-rs/canvas' || !inside(canvasRoot, await realpath(entry))) throw new Error('Invalid Canvas package identity.')
  return selectCanvasBinding({ canvasRoot, canvasManifest, canvasModule: require.cache[entry], canvasRequire: createRequire(entry), platform, arch })
}

// Separate filesystem/module-graph validation permits fixtures without loading foreign binaries.
export async function selectCanvasBinding({ canvasRoot, canvasManifest, canvasModule, canvasRequire, platform, arch }) {
  const seen = new Set(), bindings = new Set()
  function visit(module) {
    if (!module || seen.has(module)) return
    seen.add(module)
    if (module.filename?.endsWith('.node')) bindings.add(module.filename)
    for (const child of module.children ?? []) visit(child)
  }
  visit(canvasModule)
  if (bindings.size !== 1) throw new Error('Missing or ambiguous Canvas native binding.')
  const [loadedBinding] = bindings
  const binding = await realpath(loadedBinding)
  let nativeRoot = dirname(loadedBinding)
  while (true) {
    try { await lstat(join(nativeRoot, 'package.json')); break } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const parent = dirname(nativeRoot)
      if (parent === nativeRoot) throw new Error('Missing native package identity.')
      nativeRoot = parent
    }
  }
  nativeRoot = await realpath(nativeRoot)
  const nativeManifest = await manifestAt(nativeRoot)
  const nativeName = nativeManifest.name
  if (typeof nativeName !== 'string' || !/^@[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(nativeName)
    || !Object.hasOwn(canvasManifest.optionalDependencies ?? {}, nativeName)
    || canvasManifest.optionalDependencies[nativeName] !== nativeManifest.version) throw new Error('Invalid native package identity or version.')
  if (!nativeManifest.os?.includes(platform) || !nativeManifest.cpu?.includes(arch)) throw new Error('Native package platform/architecture mismatch.')
  const resolvedRoot = await realpath(dirname(canvasRequire.resolve(`${nativeName}/package.json`)))
  if (resolvedRoot !== nativeRoot || !inside(nativeRoot, binding)
    || await realpath(canvasRequire.resolve(nativeName)) !== binding) throw new Error('Mispointed or escaping Canvas binding.')
  return { canvasRoot, canvasManifest, nativeRoot, nativeName, binding }
}

/** Copy physical package files; reject links escaping either package. */
export async function copyCanvasRuntime(runtime, destination) {
  for (const [root, name] of [[runtime.canvasRoot, '@napi-rs/canvas'], [runtime.nativeRoot, runtime.nativeName]]) {
    async function validate(path) {
      if (!inside(root, await realpath(path))) throw new Error('Package file escapes native runtime.')
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error('Native runtime must contain physical files.')
      if (info.isDirectory()) for (const item of await readdir(path)) {
        if (item !== 'node_modules') await validate(join(path, item))
      }
    }
    await validate(root)
    await cp(root, join(destination, name), {
      recursive: true, dereference: true,
      filter: path => !relative(root, path).split(sep).includes('node_modules')
    })
  }
}
