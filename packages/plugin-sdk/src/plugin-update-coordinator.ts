import { isAbsolute, relative, resolve } from 'node:path'
import { manifestMainEntry } from './manifest.js'
import { ProcessExtensionHost, type HostPortsRequest, type HostPortsResult, type ProcessExtensionSnapshot } from './process-extension-host.js'
import { PluginVersionStore, type ActivePluginPointer, type StagedPluginVersion } from './plugin-version-store.js'

/** Host-bound runtime hooks that must survive a generation change (candidate apply,
 * rollback, restart-pending activation). Keyed by the identity the coordinator stages. */
export type PluginUpdateRuntimeHooks = (identity: Readonly<{ packageName: string; version: string }>) => Readonly<{
  onPortsRequest?: (request: HostPortsRequest, boundWorkspace: string | undefined) => Promise<HostPortsResult>
  onPortsCancel?: (requestId: string) => Promise<void>
}>

export type PluginUpdateResult = Readonly<{
  staged: StagedPluginVersion
  active: ActivePluginPointer
  runtime: ProcessExtensionSnapshot
}>

export type PluginUpdateHooks = Readonly<{
  /** Register candidate contributions while the previous runtime is still active. */
  beforeCommit?: (staged: StagedPluginVersion, runtime: ProcessExtensionSnapshot) => Promise<void>
  /** Publish contributions only after the candidate becomes the current runtime. */
  afterCommit?: (staged: StagedPluginVersion, runtime: ProcessExtensionSnapshot) => Promise<void>
  /** Restore old contributions after a failed candidate transaction. */
  afterRollback?: (staged: StagedPluginVersion, runtime: ProcessExtensionSnapshot | undefined) => Promise<void>
}>

/** Coordinates version facts and runtime replacement without building or downloading plugin code. */
export class PluginUpdateCoordinator {
  readonly #store: PluginVersionStore
  readonly #host: ProcessExtensionHost
  readonly #runtimeHooks: PluginUpdateRuntimeHooks | undefined

  constructor(store: PluginVersionStore, host: ProcessExtensionHost, runtimeHooks?: PluginUpdateRuntimeHooks) {
    this.#store = store
    this.#host = host
    this.#runtimeHooks = runtimeHooks
  }

  async stageAndActivate(sourceDirectory: string, hooks: PluginUpdateHooks = {}): Promise<PluginUpdateResult> {
    const staged = await this.#store.stage(sourceDirectory)
    const previous = await this.#store.active(staged.packageName)
    const entry = manifestMainEntry(staged.manifest)
    if (!entry) throw new Error(`Plugin ${staged.packageName} has no DSH main entrypoint.`)
    const entryPath = resolve(staged.directory, entry)
    const escaped = relative(staged.directory, entryPath)
    if (escaped.startsWith('..') || isAbsolute(escaped)) {
      throw new Error(`Plugin ${staged.packageName} entrypoint escapes its version directory.`)
    }

    await this.#host.prepare({
      pluginId: staged.manifest.name,
      packageName: staged.packageName,
      version: staged.version,
      entryPath,
      ...this.#runtimeHooks?.({ packageName: staged.packageName, version: staged.version })
    })
    let committed = false
    try {
      const prepared = this.#host.snapshot(staged.packageName)
      const candidate = this.#host.pending(staged.packageName)?.snapshot ?? prepared
      if (!candidate) throw new Error(`Plugin ${staged.packageName} candidate runtime failed to start.`)
      await hooks.beforeCommit?.(staged, candidate)
      const active = await this.#store.activate(staged)
      const runtime = await this.#host.commit(staged.packageName)
      committed = true
      await hooks.afterCommit?.(staged, runtime)
      await this.#host.finalizeCommit(staged.packageName)
      return Object.freeze({ staged, active, runtime })
    } catch (error) {
      if (committed) await this.#host.rollbackCommitted(staged.packageName).catch(() => undefined)
      else await this.#host.rollbackPrepared(staged.packageName).catch(() => undefined)
      if (previous) await this.#store.restore(staged.packageName, previous).catch(() => undefined)
      else await this.#store.clearActive(staged.packageName).catch(() => undefined)
      await hooks.afterRollback?.(staged, this.#host.snapshot(staged.packageName))
      throw error
    }
  }
}
