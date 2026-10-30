import type { PluginManifest } from './manifest.js'
import { checkPluginCompatibility, checkPluginPermissions, type PluginAdapterContract } from './manifest.js'

export type ExtensionContribution<T = unknown> = Readonly<{
  pluginId: string
  generation: number
  id: string
  invoke: () => T
}>

export type ExtensionActivationContext = Readonly<{
  pluginId: string
  packageName: string
  generation: number
  register: <T>(id: string, value: T) => ExtensionContribution<T>
  isCurrent: () => boolean
  assertCurrent: () => void
}>

export type ExtensionModule = Readonly<{
  manifest: PluginManifest
  activate: (context: ExtensionActivationContext) => void | Promise<void>
  deactivate?: () => void | Promise<void>
  unregister?: () => void | Promise<void>
  dispose?: () => void | Promise<void>
}>

export type ExtensionHostOptions = Readonly<{
  hostApiVersion: string
  dshRuntimeVersion?: string
  adapterContract?: PluginAdapterContract
  allowedPermissionIds?: ReadonlySet<string>
}>

export type ExtensionInstanceSnapshot = Readonly<{
  pluginId: string
  packageName: string
  version: string
  generation: number
  state: 'activating' | 'active' | 'deactivating' | 'disabled' | 'disposed' | 'failed'
  contributionIds: readonly string[]
  error?: string
}>

export class ExtensionHostError extends Error {
  readonly code: 'incompatible' | 'permission_denied' | 'activation_failed' | 'stale_generation'

  constructor(code: ExtensionHostError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ExtensionHostError'
    this.code = code
  }
}

type MutableInstance = {
  readonly module: ExtensionModule
  readonly generation: number
  readonly contributions: Map<string, ExtensionContribution>
  state: ExtensionInstanceSnapshot['state']
  error?: string
}

export class ExtensionHost {
  readonly #options: ExtensionHostOptions
  readonly #instances = new Map<string, MutableInstance>()
  readonly #generations = new Map<string, number>()

  constructor(options: ExtensionHostOptions) {
    this.#options = options
  }

  snapshot(packageName: string): ExtensionInstanceSnapshot | undefined {
    const instance = this.#instances.get(packageName)
    return instance === undefined ? undefined : this.#snapshot(instance)
  }

  snapshots(): readonly ExtensionInstanceSnapshot[] {
    return Object.freeze([...this.#instances.values()].map((instance) => this.#snapshot(instance)))
  }

  contribution<T>(packageName: string, id: string): ExtensionContribution<T> | undefined {
    return this.#instances.get(packageName)?.contributions.get(id) as ExtensionContribution<T> | undefined
  }

  /** Activate a module, replacing its current version only after activation succeeds. */
  async activate(module: ExtensionModule): Promise<ExtensionInstanceSnapshot> {
    const { manifest } = module
    const compatibility = checkPluginCompatibility(manifest, { hostApiVersion: this.#options.hostApiVersion, dshRuntimeVersion: this.#options.dshRuntimeVersion, adapter: this.#options.adapterContract })
    if (!compatibility.compatible) {
      throw new ExtensionHostError('incompatible', compatibility.reason ?? 'Extension host API mismatch.')
    }
    const permissions = checkPluginPermissions(manifest, this.#options.adapterContract, this.#options.allowedPermissionIds ?? new Set())
    if (!permissions.allowed) {
      throw new ExtensionHostError('permission_denied', permissions.reason ?? 'Extension permissions denied.')
    }

    const packageName = manifest.name
    const previous = this.#instances.get(packageName)
    const generation = (this.#generations.get(packageName) ?? 0) + 1
    this.#generations.set(packageName, generation)
    const instance: MutableInstance = {
      module,
      state: 'activating',
      generation,
      contributions: new Map(),
    }
    const context: ExtensionActivationContext = Object.freeze({
      pluginId: manifest.name,
      packageName,
      generation,
      register: <T>(id: string, value: T): ExtensionContribution<T> => {
        if (instance.state !== 'activating' && instance.state !== 'active') {
          throw new ExtensionHostError('stale_generation', `Extension ${packageName} is not active.`)
        }
        if (instance.contributions.has(id)) throw new Error(`Duplicate extension contribution: ${id}`)
        const contribution: ExtensionContribution<T> = Object.freeze({
          pluginId: manifest.name,
          generation,
          id,
          invoke: () => {
            this.#assertCurrent(instance)
            return value
          }
        })
        instance.contributions.set(id, contribution)
        return contribution
      },
      isCurrent: () => this.#isCurrent(instance),
      assertCurrent: () => this.#assertCurrent(instance)
    })

    try {
      await module.activate(context)
      instance.state = 'active'
      this.#instances.set(packageName, instance)
    } catch (error) {
      instance.state = 'failed'
      instance.error = error instanceof Error ? error.message : String(error)
      await this.#cleanup(instance)
      // The previous instance was never removed, so activation failure rolls back atomically.
      throw new ExtensionHostError(
        'activation_failed',
        `Extension ${manifest.name}@${manifest.version} activation failed: ${instance.error}`,
        { cause: error }
      )
    }

    if (previous !== undefined && previous !== instance) await this.#disposePrevious(previous)
    return this.#snapshot(instance)
  }

  async deactivate(packageName: string): Promise<ExtensionInstanceSnapshot | undefined> {
    const instance = this.#instances.get(packageName)
    if (instance === undefined || instance.state === 'disposed' || instance.state === 'disabled') {
      return instance === undefined ? undefined : this.#snapshot(instance)
    }
    this.#assertCurrent(instance)
    instance.state = 'deactivating'
    await instance.module.deactivate?.()
    instance.state = 'disabled'
    return this.#snapshot(instance)
  }

  async unregister(packageName: string): Promise<ExtensionInstanceSnapshot | undefined> {
    const instance = this.#instances.get(packageName)
    if (instance === undefined) return undefined
    this.#assertInstalled(instance)
    await instance.module.unregister?.()
    instance.contributions.clear()
    return this.#snapshot(instance)
  }

  async dispose(packageName: string): Promise<ExtensionInstanceSnapshot | undefined> {
    const instance = this.#instances.get(packageName)
    if (instance === undefined) return undefined
    this.#assertInstalled(instance)
    if (instance.state === 'active' || instance.state === 'activating') await this.deactivate(packageName)
    await this.unregister(packageName)
    await instance.module.dispose?.()
    instance.state = 'disposed'
    this.#instances.delete(packageName)
    return this.#snapshot(instance)
  }

  #isCurrent(instance: MutableInstance): boolean {
    return this.#instances.get(instance.module.manifest.name) === instance && instance.state === 'active'
  }

  #assertCurrent(instance: MutableInstance): void {
    if (!this.#isCurrent(instance)) {
      throw new ExtensionHostError(
        'stale_generation',
        `Extension ${instance.module.manifest.name} generation ${instance.generation} is stale.`
      )
    }
  }

  #assertInstalled(instance: MutableInstance): void {
    if (this.#instances.get(instance.module.manifest.name) !== instance || instance.state === 'disposed') {
      throw new ExtensionHostError(
        'stale_generation',
        `Extension ${instance.module.manifest.name} generation ${instance.generation} is stale.`
      )
    }
  }

  async #cleanup(instance: MutableInstance): Promise<void> {
    instance.contributions.clear()
    try { await instance.module.unregister?.() } catch { /* activation rollback is best effort */ }
    try { await instance.module.dispose?.() } catch { /* activation rollback is best effort */ }
  }

  async #disposePrevious(instance: MutableInstance): Promise<void> {
    if (instance.state === 'active' || instance.state === 'activating') {
      instance.state = 'deactivating'
      await instance.module.deactivate?.()
    }
    await instance.module.unregister?.()
    instance.contributions.clear()
    await instance.module.dispose?.()
    instance.state = 'disposed'
  }

  #snapshot(instance: MutableInstance): ExtensionInstanceSnapshot {
    return Object.freeze({
      pluginId: instance.module.manifest.name,
      packageName: instance.module.manifest.name,
      version: instance.module.manifest.version,
      generation: instance.generation,
      state: instance.state,
      contributionIds: Object.freeze([...instance.contributions.keys()]),
      ...(instance.error === undefined ? {} : { error: instance.error })
    })
  }
}
