/**
 * Stage the installed-plugin runtime into the Electron main output.
 *
 * Two things a packaged app needs but a development checkout hides:
 *
 * 1. **The plugin runner files.** The Host locates the runner next to its own
 *    bundled module (`new URL('./process-extension-runner.mjs', import.meta.url)`),
 *    i.e. `out/main/process-extension-runner.mjs`. In development the fallback
 *    candidate under the working directory hides the gap, so nothing copied the
 *    files into the build output: a packaged app had no runner, installed plugins
 *    could not start, and the market never appeared (the Host only publishes a
 *    market when it can run installed plugins).
 *
 *    The runner is not a single file: it imports siblings (`dsh-storage-root.mjs`,
 *    which imports `plugin-package-identity.mjs`, ...). A hardcoded list is exactly
 *    how a third file goes missing — a packaged app then dies at import time with
 *    `ERR_MODULE_NOT_FOUND` *inside the plugin child*, where nothing logs it, and
 *    the only visible symptom is "Extension process exited before readiness".
 *    So the file list is computed from the imports themselves: every relative
 *    `./x.mjs` reference is followed transitively, and a dangling reference fails
 *    the build instead of the product.
 *
 * The official DSH runtime the runner imports travels as explicit file sets from
 * electron-builder.config.cjs, because the packager prunes `node_modules` to the
 * application's own dependency tree and would otherwise drop them.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** Entry point: everything else is discovered from here. */
export const PLUGIN_RUNTIME_RUNNER_ENTRY = 'process-extension-runner.mjs'

/**
 * Relative module specifiers this file pulls in (`./x.mjs`), including dynamic
 * `import('./x.mjs')` and `export ... from './x.mjs'`.
 */
export function relativeModuleImports(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const found = new Set()
  const patterns = [
    /(?:^|\n)\s*import\s[^'"]*from\s*['"](\.\/[^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[^'"]*from\s*['"](\.\/[^'"]+)['"]/g,
    /import\(\s*['"](\.\/[^'"]+)['"]\s*\)/g,
    /(?:^|\n)\s*import\s*['"](\.\/[^'"]+)['"]/g
  ]
  for (const pattern of patterns) {
    for (const match of withoutComments.matchAll(pattern)) found.add(match[1])
  }
  return [...found]
}

/**
 * The transitive set of files the runner needs, resolved against a source
 * directory. Throws when a referenced file does not exist, so the build stops
 * rather than shipping a package whose plugin host cannot start.
 */
export async function resolvePluginRuntimeFiles(sourceDirectory, entry = PLUGIN_RUNTIME_RUNNER_ENTRY) {
  const resolved = new Set()
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.shift()
    if (resolved.has(file)) continue
    const source = resolve(sourceDirectory, file)
    const contents = await readFile(source, 'utf8').catch((error) => {
      throw new Error(`Plugin runtime file is missing: ${source} (${error.code ?? 'unknown error'})`)
    })
    resolved.add(file)
    for (const specifier of relativeModuleImports(contents)) {
      const next = specifier.replace(/^\.\//, '')
      if (!resolved.has(next)) pending.push(next)
    }
  }
  return [...resolved].sort()
}

/** Files the runner needs next to it, in the build output and in the package. */
export const PLUGIN_RUNTIME_RUNNER_FILES = Object.freeze([
  'process-extension-runner.mjs',
  'dsh-storage-root.mjs',
  'plugin-package-identity.mjs'
])

/** @param {{ repositoryRoot: string, mainOutputDirectory: string }} input */
export async function stagePluginRuntimeRunner(input) {
  const sourceDirectory = resolve(input.repositoryRoot, 'packages/plugin-sdk/src')
  const targetDirectory = resolve(input.mainOutputDirectory)
  await mkdir(targetDirectory, { recursive: true })
  const files = await resolvePluginRuntimeFiles(sourceDirectory)
  const staged = []
  for (const file of files) {
    const contents = await readFile(resolve(sourceDirectory, file))
    await writeFile(resolve(targetDirectory, file), contents)
    staged.push(file)
  }
  return Object.freeze(staged)
}

/**
 * Removes staged copies so a build never ships a source edit that was reverted.
 * @param {{ mainOutputDirectory: string }} input
 */
export async function clearPluginRuntimeRunner(input) {
  for (const file of PLUGIN_RUNTIME_RUNNER_FILES) {
    await rm(resolve(input.mainOutputDirectory, file), { force: true })
  }
}

/** Where a staged file lives once the app is packaged, for tests and docs. */
export function stagedRunnerLocation(mainOutputDirectory, file) {
  return resolve(dirname(resolve(mainOutputDirectory, PLUGIN_RUNTIME_RUNNER_ENTRY)), file)
}