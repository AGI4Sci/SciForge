import type { CapabilityDefinition, CapabilityRegistry } from '../capabilities/registry'

export type CapabilityPublication = Readonly<{
  definitions: readonly CapabilityDefinition[]
  release: (id: string) => void
  dispose: () => void
}>

/** Publish only into free slots or exact Host-held leases from the previous generation.
 * No package metadata grants replacement authority. Native retirement belongs to the
 * trusted domain catalog selection, before capabilities are composed, not to disable.
 * transfer must synchronously prepare all contribution owners and return an
 * assignment-only commit for the final publication boundary.
 * Until it returns, neither old registry definitions nor their leases are retired.
 */
export function publishCapabilitySnapshot(
  registry: CapabilityRegistry,
  candidates: readonly CapabilityDefinition[],
  previous: readonly CapabilityDefinition[] = [],
  transfer?: (publication: CapabilityPublication) => (() => void) | undefined
): CapabilityPublication {
  const owned = new Map<string, CapabilityDefinition>()
  const release = (id: string): void => {
    const definition = owned.get(id)
    if (definition && registry.get(id) === definition) registry.unregister(id)
    owned.delete(id)
  }
  let publication: CapabilityPublication | undefined
  try {
    registry.replaceOwned(previous, candidates, { beforePublish: (definitions) => {
      for (const definition of definitions) owned.set(definition.descriptor.id, definition)
      publication = Object.freeze({ definitions, release, dispose: () => { for (const id of owned.keys()) release(id) } })
      return transfer?.(publication)
    } })
    return publication!
  } catch (error) {
    // No new definition is live if policy or transfer fails. Drop all provisional
    // leases (including ones transferred into the discarded contribution write set).
    publication?.dispose()
    throw error
  }
}
