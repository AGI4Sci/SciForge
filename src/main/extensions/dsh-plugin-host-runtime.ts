import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Host-side runtime facts for installed DSH plugins.
 *
 * Two things an installed plugin needs from the host rather than from its own
 * artifact:
 *
 * 1. **The DSH runtime version the host actually runs.** Approval contracts bind
 *    an exact `dshRuntimeVersion`, so it must come from the official runtime the
 *    host ships (the pinned `@deepseek-ai/dsh-*` packages), never from an
 *    environment variable a build could forget. Unknown means "no DSH
 *    authorization can be honoured", which fails closed.
 * 2. **The dependency deployment root.** Bare dependencies that stay external in
 *    an artifact (native addons) are resolved from a host-owned deployment, so an
 *    installed plugin does not have to carry platform binaries.
 */

const DSH_RUNTIME_PACKAGE = '@deepseek-ai/dsh-tools'

export type DshRuntimeManifestResolver = (specifier: string) => string | undefined

const defaultManifestResolver: DshRuntimeManifestResolver = (specifier) =>
  import.meta.resolve(specifier) as string | undefined

export async function resolveDshRuntimeVersion(
  resolveManifest: DshRuntimeManifestResolver = defaultManifestResolver
): Promise<string | undefined> {
  try {
    // Read the host-pinned DSH runtime version. import.meta.resolve only
    // *locates* the manifest — no plugin code is loaded in this process
    // (plugins run in the runner child process).
    const resolved = resolveManifest(`${DSH_RUNTIME_PACKAGE}/package.json`)
    if (!resolved) return undefined
    const parsed = JSON.parse(await readFile(fileURLToPath(resolved), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : undefined
  } catch {
    return undefined
  }
}

export type PluginRuntimeEnvResult = Readonly<Record<string, string>> | undefined

/**
 * Host packages an installed plugin may require at runtime without carrying them
 * in its artifact. This is host policy: a plugin that asks for anything else is
 * refused at install time rather than silently resolving from the app's own
 * dependency tree.
 */
export const HOST_PROVIDED_PLUGIN_DEPENDENCIES: ReadonlySet<string> = Object.freeze(
  new Set(['@deepseek-ai/dsh-tools', '@napi-rs/canvas'])
)

/**
 * The host-approved environment for plugin child processes. The child is spawned
 * with no ambient environment, so every entry here is an explicit host decision
 * about a runtime prerequisite — currently the interpreter a scientific engine
 * should call. Absent means the plugin runs with the platform default.
 */
export function resolvePluginRuntimeEnv(
  env: Readonly<Record<string, string | undefined>>
): PluginRuntimeEnvResult {
  const python = env.SCIFORGE_PYTHON?.trim()
  if (!python) return undefined
  if (!isAbsolute(python)) throw new Error('SCIFORGE_PYTHON must be an absolute path.')
  return Object.freeze({ SCIFORGE_PYTHON: python })
}

export type PluginDependencyRootOptions = Readonly<{
  appPath: string
  resourcesPath: string
  isPackaged: boolean
  env: Readonly<Record<string, string | undefined>>
  /** Bare package names the host vendors for plugins. */
  packages: readonly string[]
}>

export type PluginDependencyRootResult = Readonly<{
  packages: readonly string[]
  baseUrl: string
}> | undefined

/**
 * The deployment base for host-vendored plugin dependencies. Development resolves
 * from the repository the app runs out of; a packaged build must supply its
 * approved dependency directory explicitly (there is no implicit guess, and no
 * fallback that would silently widen what a plugin can import).
 */
export function resolvePluginDependencyRoot(
  options: PluginDependencyRootOptions
): PluginDependencyRootResult {
  if (options.packages.length === 0) return undefined
  const explicit = options.env.SCIFORGE_PLUGIN_DEPENDENCY_ROOT?.trim()
  if (explicit) {
    if (!isAbsolute(explicit)) throw new Error('SCIFORGE_PLUGIN_DEPENDENCY_ROOT must be an absolute path.')
    return Object.freeze({ packages: options.packages, baseUrl: pathToFileURL(resolve(explicit, 'package.json')).href })
  }
  if (options.isPackaged) return undefined
  return Object.freeze({
    packages: options.packages,
    baseUrl: pathToFileURL(resolve(options.appPath, 'package.json')).href
  })
}