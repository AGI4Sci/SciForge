import type { PluginManifest } from './manifest.js'

export type PluginLifecycleState =
  | 'discovered'
  | 'verified'
  | 'enabled'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'disabled'
  | 'failed'
  | 'disposed'

export type PluginLifecycleHooks = Readonly<{
  activate?: () => void | Promise<void>
  deactivate?: () => void | Promise<void>
  /** Remove all contributions before the runtime is disposed. */
  unregister?: () => void | Promise<void>
  dispose?: () => void | Promise<void>
}>

export type PluginLifecycleSnapshot = Readonly<{
  pluginId: string
  packageName: string
  version: string
  /** Monotonic activation generation reserved for stale-instance rejection. */
  generation: number
  state: PluginLifecycleState
  error?: string
}>

export class PluginLifecycleError extends Error {
  readonly code: 'activation_failed' | 'deactivation_failed' | 'dispose_failed'

  constructor(
    code: PluginLifecycleError['code'],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'PluginLifecycleError'
    this.code = code
  }
}

/** A small, host-independent state machine used by all external contribution types. */
export class PluginLifecycle {
  readonly #manifest: PluginManifest
  readonly #hooks: PluginLifecycleHooks
  #state: PluginLifecycleState = 'discovered'
  #error: string | undefined
  #generation = 0
  #unregistered = false

  constructor(manifest: PluginManifest, hooks: PluginLifecycleHooks = {}) {
    this.#manifest = manifest
    this.#hooks = hooks
  }

  get snapshot(): PluginLifecycleSnapshot {
    return Object.freeze({
      pluginId: this.#manifest.name,
      packageName: this.#manifest.name,
      version: this.#manifest.version,
      generation: this.#generation,
      state: this.#state,
      ...(this.#error ? { error: this.#error } : {})
    })
  }

  markVerified(): PluginLifecycleSnapshot {
    if (this.#state === 'discovered') this.#state = 'verified'
    return this.snapshot
  }

  async enable(): Promise<PluginLifecycleSnapshot> {
    if (this.#state === 'verified' || this.#state === 'disabled') this.#state = 'enabled'
    return this.snapshot
  }

  async disable(): Promise<PluginLifecycleSnapshot> {
    if (this.#state === 'active' || this.#state === 'activating') await this.deactivate()
    if (this.#state === 'enabled' || this.#state === 'failed') this.#state = 'disabled'
    return this.snapshot
  }

  async activate(): Promise<PluginLifecycleSnapshot> {
    if (this.#state === 'active') return this.snapshot
    if (this.#state === 'verified' || this.#state === 'disabled') await this.enable()
    if (this.#state !== 'enabled') return this.snapshot
    this.#state = 'activating'
    this.#error = undefined
    this.#generation += 1
    this.#unregistered = false
    try {
      await this.#hooks.activate?.()
      this.#state = 'active'
    } catch (error) {
      this.#state = 'failed'
      this.#error = error instanceof Error ? error.message : String(error)
      throw new PluginLifecycleError(
        'activation_failed',
        `Plugin ${this.#manifest.name} activation failed: ${this.#error}`,
        { cause: error }
      )
    }
    return this.snapshot
  }

  async deactivate(): Promise<PluginLifecycleSnapshot> {
    if (this.#state !== 'active' && this.#state !== 'activating') return this.snapshot
    this.#state = 'deactivating'
    try {
      await this.#hooks.deactivate?.()
      this.#state = 'enabled'
    } catch (error) {
      this.#state = 'failed'
      this.#error = error instanceof Error ? error.message : String(error)
      throw new PluginLifecycleError(
        'deactivation_failed',
        `Plugin ${this.#manifest.name} deactivation failed: ${this.#error}`,
        { cause: error }
      )
    }
    return this.snapshot
  }

  async dispose(): Promise<PluginLifecycleSnapshot> {
    if (this.#state === 'disposed') return this.snapshot
    if (this.#state === 'active' || this.#state === 'activating') await this.deactivate()
    try {
      await this.unregister()
      await this.#hooks.dispose?.()
      this.#state = 'disposed'
    } catch (error) {
      this.#state = 'failed'
      this.#error = error instanceof Error ? error.message : String(error)
      throw new PluginLifecycleError(
        'dispose_failed',
        `Plugin ${this.#manifest.name} dispose failed: ${this.#error}`,
        { cause: error }
      )
    }
    return this.snapshot
  }

  /**
   * Idempotently unregister contributions owned by this activation generation.
   * PR-1 does not reload code; this hook defines the boundary needed by later
   * Extension Host versions to reject stale registrations before disposal.
   */
  async unregister(): Promise<PluginLifecycleSnapshot> {
    if (this.#unregistered) return this.snapshot
    await this.#hooks.unregister?.()
    this.#unregistered = true
    return this.snapshot
  }

  isCurrentGeneration(generation: number): boolean {
    return generation === this.#generation && this.#state === 'active'
  }
}

/** Host-owned registry for lifecycle instances; it never loads plugin code itself. */
export class PluginLifecycleRegistry {
  readonly #lifecycles = new Map<string, PluginLifecycle>()

  register(lifecycle: PluginLifecycle): void {
    const key = lifecycle.snapshot.packageName
    if (this.#lifecycles.has(key)) throw new Error(`Plugin lifecycle already registered: ${key}`)
    this.#lifecycles.set(key, lifecycle)
  }

  get(packageName: string): PluginLifecycle | undefined {
    return this.#lifecycles.get(packageName)
  }

  async activate(packageName: string): Promise<PluginLifecycleSnapshot | undefined> {
    return this.#lifecycles.get(packageName)?.activate()
  }

  async deactivate(packageName: string): Promise<PluginLifecycleSnapshot | undefined> {
    return this.#lifecycles.get(packageName)?.deactivate()
  }

  async dispose(packageName: string): Promise<PluginLifecycleSnapshot | undefined> {
    return this.#lifecycles.get(packageName)?.dispose()
  }

  async unregister(packageName: string): Promise<PluginLifecycleSnapshot | undefined> {
    return this.#lifecycles.get(packageName)?.unregister()
  }

  /** Remove a disposed lifecycle from the host registry before replacement. */
  remove(packageName: string): boolean {
    const lifecycle = this.#lifecycles.get(packageName)
    if (!lifecycle || lifecycle.snapshot.state !== 'disposed') return false
    return this.#lifecycles.delete(packageName)
  }

  snapshots(): readonly PluginLifecycleSnapshot[] {
    return Object.freeze([...this.#lifecycles.values()].map((lifecycle) => lifecycle.snapshot))
  }
}
