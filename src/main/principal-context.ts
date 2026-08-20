import {
  MAIN_PRINCIPAL_PROVIDER_CONTRIBUTION_KIND,
  definePrincipalContextSnapshot,
  definePrincipalSnapshot,
  isDomainMainPrincipalProvider,
  samePrincipalSnapshot,
  type DomainMainPrincipalProvider,
  type PrincipalContextListener,
  type PrincipalContextSnapshot,
  type PrincipalSnapshot,
  type PrincipalSubscriptionDisposer
} from '@sciforge/domain-sdk/principal'
import type { DomainModuleCatalog } from './modules/catalog.js'

const EMPTY_PRINCIPAL_CONTEXT = definePrincipalContextSnapshot({
  identityVersion: 0,
  principal: null
})

/**
 * The Host-owned selection point for the one installed Principal authority.
 * Domain packages contribute providers through the generic module catalog;
 * callers never select a provider or recover through a default.
 */
export class HostPrincipalContext {
  readonly #provider: DomainMainPrincipalProvider | undefined

  constructor(catalog: DomainModuleCatalog) {
    const contributions = catalog.listContributions(
      MAIN_PRINCIPAL_PROVIDER_CONTRIBUTION_KIND,
      isDomainMainPrincipalProvider
    )
    if (contributions.length > 1) {
      throw new Error(
        `Application composition has ${contributions.length} Principal providers; expected zero or one.`
      )
    }
    this.#provider = contributions[0]?.value
  }

  current(): PrincipalSnapshot | undefined {
    if (this.#provider === undefined) return undefined
    const rawPrincipal = this.#provider.current()
    const principal = rawPrincipal === undefined
      ? undefined
      : definePrincipalSnapshot(rawPrincipal)
    const snapshotPrincipal = this.snapshot().principal ?? undefined
    if (!samePrincipalSnapshot(principal, snapshotPrincipal)) {
      throw new Error('Principal provider current() and snapshot() are inconsistent.')
    }
    return snapshotPrincipal
  }

  snapshot(): PrincipalContextSnapshot {
    return this.#provider === undefined
      ? EMPTY_PRINCIPAL_CONTEXT
      : definePrincipalContextSnapshot(this.#provider.snapshot())
  }

  subscribe(listener: PrincipalContextListener): PrincipalSubscriptionDisposer {
    if (this.#provider === undefined) return () => undefined

    let latestVersion = this.snapshot().identityVersion
    const dispose = this.#provider.subscribe((rawSnapshot) => {
      const snapshot = definePrincipalContextSnapshot(rawSnapshot)
      if (snapshot.identityVersion <= latestVersion) return
      latestVersion = snapshot.identityVersion
      listener(snapshot)
    })
    if (typeof dispose !== 'function') {
      throw new Error('Principal provider subscribe() must return a disposer.')
    }
    return dispose
  }
}
