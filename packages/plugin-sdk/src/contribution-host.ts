export type PluginContributionKind =
  | 'capability'
  | 'renderer'
  | 'managed-runtime'
  | 'workflow'
  | 'workspace-preview'

export type PluginContribution = Readonly<{
  pluginId: string
  generation: number
  kind: PluginContributionKind
  id: string
  value: unknown
  unregister: () => void | Promise<void>
}>

/**
 * Host-owned contribution registry shared by every external plugin adapter.
 * Registration is generation-scoped so stale instances cannot leave resources
 * behind when a plugin is disabled or replaced.
 */
export class ContributionHost {
  #contributions = new Map<string, PluginContribution>()
  #staging: Map<string, PluginContribution> | undefined
  #expectedRegistration: Omit<PluginContribution, 'unregister'> & { unregister?: () => void | Promise<void> } | undefined

  #assertNotPublishing(): void {
    if (this.#staging) throw new Error('Reentrant contribution mutation during owner transfer is not allowed.')
  }

  register(input: Omit<PluginContribution, 'unregister'> & {
    unregister?: () => void | Promise<void>
  }): PluginContribution {
    if (this.#staging) {
      if (this.#expectedRegistration !== input) this.#assertNotPublishing()
      this.#expectedRegistration = undefined
    }
    const target = this.#staging ?? this.#contributions
    const key = `${input.pluginId}:${input.kind}:${input.id}`
    const existing = target.get(key)
    if (existing) {
      if (existing.generation === input.generation) {
        throw new Error(`Duplicate plugin contribution: ${key}`)
      }
      throw new Error(`Stale plugin contribution generation: ${key}`)
    }
    const contribution: PluginContribution = Object.freeze({
      ...input,
      unregister: input.unregister ?? (() => undefined)
    })
    target.set(key, contribution)
    return contribution
  }

  /** Transfer exact Host-held owners synchronously. Policy overrides run through
   * register against detached state; reads see all old owners until commit.
   * Policy must call base register exactly once with the supplied input; every
   * other mutation is rejected until publication completes. Disposers do not run
   * inside policy validation, so an aborted transfer retains usable old leases.
   * Failure preserves exact previous objects and disposers. Successful callers
   * retire old resources after their external publication has committed.
   */
  /** Prepare exact owner replacement without publishing it. The returned commit is
   * assignment-only and must be called only at the final transaction boundary. */
  prepareOwned(previous: readonly PluginContribution[], inputs: readonly Parameters<ContributionHost['register']>[0][]): () => void {
    this.#assertNotPublishing()
    const staged = new Map(this.#contributions)
    for (const contribution of previous) {
      const key = `${contribution.pluginId}:${contribution.kind}:${contribution.id}`
      if (staged.get(key) !== contribution) throw new Error(`Contribution ownership changed: ${key}`)
      staged.delete(key)
    }
    this.#staging = staged
    try {
      for (const input of inputs) {
        this.#expectedRegistration = input
        this.register(input)
        if (this.#expectedRegistration) throw new Error('Contribution policy did not register the candidate.')
      }
    } finally {
      this.#expectedRegistration = undefined
      this.#staging = undefined
    }
    let committed = false
    return () => {
      if (committed) return
      committed = true
      this.#contributions = staged
    }
  }

  replaceOwned(previous: readonly PluginContribution[], inputs: readonly Parameters<ContributionHost['register']>[0][]): void {
    this.prepareOwned(previous, inputs)()
  }

  list(pluginId?: string): readonly PluginContribution[] {
    const values = [...this.#contributions.values()]
    return Object.freeze(pluginId
      ? values.filter((contribution) => contribution.pluginId === pluginId)
      : values)
  }

  async unregisterPlugin(pluginId: string, generation?: number): Promise<void> {
    this.#assertNotPublishing()
    const owned = this.list(pluginId).filter((contribution) =>
      generation === undefined || contribution.generation === generation)
    const errors: unknown[] = []
    for (const contribution of owned.reverse()) {
      try {
        await this.unregisterContribution(contribution.pluginId, contribution.kind, contribution.id, contribution.generation)
      } catch (error) { errors.push(error) }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'Plugin contribution cleanup failed.')
  }

  async unregisterContribution(pluginId: string, kind: PluginContributionKind, id: string, generation: number): Promise<void> {
    this.#assertNotPublishing()
    const key = `${pluginId}:${kind}:${id}`
    const contribution = this.#contributions.get(key)
    if (!contribution || contribution.generation !== generation) return
    // Remove ownership before yielding; a concurrent replacement cannot be deleted by this disposer.
    this.#contributions.delete(key)
    try {
      await contribution.unregister()
    } catch (error) {
      // Preserve failed cleanup for retry without overwriting concurrent ownership.
      if (!this.#contributions.has(key)) this.#contributions.set(key, contribution)
      throw error
    }
  }

  has(pluginId: string, kind: PluginContributionKind, id: string, generation?: number): boolean {
    const contribution = this.#contributions.get(`${pluginId}:${kind}:${id}`)
    return contribution !== undefined && (generation === undefined || contribution.generation === generation)
  }
}
