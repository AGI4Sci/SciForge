import { readFile, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { checkPluginCompatibility, checkPluginPermissions, manifestClientEntry, manifestMainEntry, parsePluginManifest, pluginAdapterDeclarationSchema, type PluginAdapterContract, type PluginAdapterDeclaration, type PluginCompatibility, type PluginPermissionCheck, type PluginManifest } from './manifest.js'
import { PluginLifecycle, PluginLifecycleHooks, PluginLifecycleRegistry } from './lifecycle.js'

export type DshPluginLayout = Readonly<{ mainEntry?: string; clientEntry?: string; rendererEntry?: string; patchFiles: readonly string[]; patchIds: readonly string[]; contributionKinds: readonly string[] }>
export type DiscoveredPlugin = Readonly<{ directory: string; manifestPath: string; manifest: PluginManifest; adapter?: PluginAdapterDeclaration; layout: DshPluginLayout; compatibility: PluginCompatibility; permissions: PluginPermissionCheck }>
export type PluginAdapterContracts = ReadonlyMap<string, PluginAdapterContract>
export function resolvePluginAdapterContract(contracts: PluginAdapterContracts | undefined, packageName: string, packageVersion: string): PluginAdapterContract | undefined { return contracts?.get(`${packageName}@${packageVersion}`) ?? contracts?.get(packageName) }
/** A package with any exact name@version host contract is governed: versions without their own
 * exact approval must still validate against the package's contract entry (and fail closed on a
 * dshAuthorization version mismatch) instead of escaping to the plugin's self-declared adapter. */
export function governedPackageAdapterContract(contracts: PluginAdapterContracts | undefined, packageName: string): PluginAdapterContract | undefined {
  if (!contracts) return undefined
  const prefix = `${packageName}@`
  for (const [key, contract] of contracts) if (key.startsWith(prefix)) return contract
  return undefined
}
export type PluginHostOptions = Readonly<{ root: string; hostApiVersion: string; dshRuntimeVersion?: string; adapterContracts?: PluginAdapterContracts; allowedPermissionIds?: ReadonlySet<string>; resolvePluginDirectory?: (packageName: string, directory: string) => Promise<string>; createLifecycleHooks?: (plugin: DiscoveredPlugin) => PluginLifecycleHooks }>

function asPaths(value: string | readonly string[] | undefined): readonly string[] { return value === undefined ? [] : typeof value === 'string' ? [value] : value }
function patchIds(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) throw new Error('Cordis patch must be an array.')
    for (const row of parsed) if (typeof row !== 'object' || row === null || (typeof (row as Record<string, unknown>).id !== 'string' && !Array.isArray((row as Record<string, unknown>).insert))) throw new Error('Cordis patch rows require id or insert.')
    return parsed.flatMap((row) => typeof row === 'object' && row !== null && typeof (row as Record<string, unknown>).id === 'string' ? [(row as Record<string, unknown>).id as string] : [])
  } catch (error) {
    if (error instanceof SyntaxError) { /* official YAML remains accepted below */ } else throw error
  }
  if (text.trim() && !/\b(?:insert|id):/u.test(text)) throw new Error('Cordis patch rows require insert or id semantics.')
  return [...text.matchAll(/^\s*-\s*id:\s*([^\s#]+)/gmu)].map((m) => m[1]!)
}
function safeRelative(root: string, value: string): string | undefined { const candidate = resolve(root, value); const escaped = relative(root, candidate); return escaped.startsWith('..') || isAbsolute(escaped) ? undefined : candidate }

/** Full, non-executing directory validation shared by discovery and candidate activation.
 * Structural failures throw so callers can retain a useful diagnostic.
 */
export async function validatePluginDirectory(directory: string, options: PluginHostOptions, expectedPackageName?: string): Promise<DiscoveredPlugin> {
    const manifestPath = join(directory, 'package.json')
    const manifest = parsePluginManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
    if (expectedPackageName && manifest.name !== expectedPackageName) throw new Error(`Candidate identity mismatch: candidate declares "${manifest.name}" but target is "${expectedPackageName}".`)
    const patchFiles: string[] = []
    for (const patch of asPaths(manifest.dsh.bundle?.patch)) {
      const path = safeRelative(directory, patch); if (!path) throw new Error(`DSH patch escapes plugin directory: ${patch}`)
      await readFile(path, 'utf8'); patchFiles.push(path)
    }
    const clientEntry = manifestClientEntry(manifest)
    if (manifest.dsh.client && !clientEntry) throw new Error('DSH client declaration requires exports["./client"].')
    if (clientEntry) {
      const clientPath = safeRelative(directory, clientEntry); if (!clientPath) throw new Error('DSH client entry escapes plugin directory.')
      await readFile(clientPath)
    }
    const mainEntry = manifestMainEntry(manifest)
    if (mainEntry) {
      const mainPath = safeRelative(directory, mainEntry); if (!mainPath) throw new Error('DSH main entry escapes plugin directory.')
      const escaped = relative(await realpath(directory), await realpath(mainPath))
      if (escaped.startsWith('..') || isAbsolute(escaped)) throw new Error('DSH main entry escapes plugin directory (symlink or path escape).')
      await readFile(mainPath)
    }
    const ids: string[] = []
    for (const path of patchFiles) ids.push(...patchIds(await readFile(path, 'utf8')))
    const adapterPath = join(directory, 'sciforge.adapter.json')
    const declaration = await readFile(adapterPath, 'utf8')
      .then((text) => pluginAdapterDeclarationSchema.parse(JSON.parse(text)))
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      })
    const rendererEntry = declaration?.kind === 'renderer' ? declaration.ui?.entry : undefined
    if (declaration?.kind === 'renderer' && !rendererEntry) throw new Error('Renderer adapter declaration requires ui.entry.')
    if (rendererEntry) {
      const rendererPath = safeRelative(directory, rendererEntry)
      if (!rendererPath) throw new Error('Renderer UI entry escapes plugin directory.')
      const escaped = relative(await realpath(directory), await realpath(rendererPath))
      if (escaped.startsWith('..') || isAbsolute(escaped)) throw new Error('Renderer UI entry escapes plugin directory (symlink or path escape).')
      await readFile(rendererPath)
    }
    const override = resolvePluginAdapterContract(options.adapterContracts, manifest.name, manifest.version)
      ?? governedPackageAdapterContract(options.adapterContracts, manifest.name)
    const adapter: PluginAdapterContract | undefined = override ?? (declaration
      ? { hostApiRange: declaration.hostApiRange, permissions: declaration.permissions, approved: declaration.permissions.length === 0 }
      : undefined)
    return Object.freeze({ directory, manifestPath, manifest, ...(declaration ? { adapter: declaration } : {}), layout: Object.freeze({ mainEntry, clientEntry, rendererEntry, patchFiles: Object.freeze(patchFiles), patchIds: Object.freeze(ids), contributionKinds: Object.freeze([...(mainEntry ? ['bundle'] : []), ...(clientEntry ? ['client'] : []), ...(rendererEntry ? ['renderer'] : []), ...(manifest.dsh.profile ? ['profile'] : [])]) }), compatibility: checkPluginCompatibility(manifest, { dshRuntimeVersion: options.dshRuntimeVersion, hostApiVersion: options.hostApiVersion, adapter }), permissions: checkPluginPermissions(manifest, adapter, options.allowedPermissionIds) })
}

async function discoverOne(sourceDirectory: string, options: PluginHostOptions): Promise<DiscoveredPlugin | undefined> {
  try {
    const sourceManifest = parsePluginManifest(JSON.parse(await readFile(join(sourceDirectory, 'package.json'), 'utf8')))
    const directory = await options.resolvePluginDirectory?.(sourceManifest.name, sourceDirectory) ?? sourceDirectory
    return await validatePluginDirectory(directory, options, sourceManifest.name)
  } catch { return undefined }
}

export async function discoverPlugins(root: string, options: PluginHostOptions): Promise<readonly DiscoveredPlugin[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const discovered: DiscoveredPlugin[] = []
  for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.')) { const plugin = await discoverOne(join(root, entry.name), options); if (plugin) discovered.push(plugin) }
  return Object.freeze(discovered.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)))
}

/** Combines directory discovery with host-owned lifecycle registration. */
export class PluginHost {
  readonly #options: PluginHostOptions; readonly #registry = new PluginLifecycleRegistry(); #plugins: readonly DiscoveredPlugin[] = []
  constructor(options: PluginHostOptions) { this.#options = options }
  get registry(): PluginLifecycleRegistry { return this.#registry }
  get plugins(): readonly DiscoveredPlugin[] { return this.#plugins }
  async discover(): Promise<readonly DiscoveredPlugin[]> {
    this.#plugins = await discoverPlugins(this.#options.root, this.#options)
    for (const plugin of this.#plugins) { if (!plugin.compatibility.compatible || !plugin.permissions.allowed) continue; const lifecycle = new PluginLifecycle(plugin.manifest, this.#options.createLifecycleHooks?.(plugin)); lifecycle.markVerified(); if (!this.#registry.get(plugin.manifest.name)) this.#registry.register(lifecycle) }
    return this.#plugins
  }
}
