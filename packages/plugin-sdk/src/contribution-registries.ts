export type RendererContribution = Readonly<{
  pluginId: string
  generation: number
  id: string
  kind: 'panel' | 'tab'
  title: string
  open: () => unknown
  dispose: () => void
}>

export type ManagedRuntimeContribution = Readonly<{
  pluginId: string
  generation: number
  id: string
  discover: () => unknown
  invoke: (operation: string, input?: unknown) => Promise<unknown>
  dispose: () => Promise<void>
}>

export type WorkflowLifecycleContribution = Readonly<{
  pluginId: string
  generation: number
  id: string
  start: (input?: unknown) => Promise<unknown>
  status: (input?: unknown) => Promise<unknown>
  advance: (input?: unknown) => Promise<unknown>
  cancel: (input?: unknown) => Promise<unknown>
  dispose: () => Promise<void>
}>

export class OwnedRegistry<T extends { pluginId: string; id: string; generation: number }> {
  readonly #items = new Map<string, { item: T }>()
  register(item: T): () => void {
    const key = `${item.pluginId}:${item.id}`
    if (this.#items.has(key)) throw new Error(`Contribution already registered: ${key}`)
    const registration = { item }
    this.#items.set(key, registration)
    let active = true
    return () => {
      if (!active) return
      active = false
      // Fence by registration, not item identity or generation: both may be reused.
      if (this.#items.get(key) === registration) this.#items.delete(key)
    }
  }
  list(pluginId?: string): readonly T[] {
    return Object.freeze([...this.#items.values()].map(({ item }) => item)
      .filter((item) => !pluginId || item.pluginId === pluginId))
  }
  unregisterPlugin(pluginId: string): void {
    for (const [key, { item }] of this.#items) if (item.pluginId === pluginId) this.#items.delete(key)
  }
}

export class RendererContributionRegistry extends OwnedRegistry<RendererContribution> {}
export class ManagedRuntimeRegistry extends OwnedRegistry<ManagedRuntimeContribution> {}
export class WorkflowLifecycleRegistry extends OwnedRegistry<WorkflowLifecycleContribution> {}
