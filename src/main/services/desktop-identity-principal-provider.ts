import {
  definePrincipalContextSnapshot,
  principalDeviceIdSchema,
  type DomainMainPrincipalProvider,
  type PrincipalContextListener,
  type PrincipalContextSnapshot,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import type { DesktopIdentityStatus } from '../../shared/desktop-identity'
import type { DesktopIdentityService } from './desktop-identity-service'

type DesktopIdentitySource = Pick<DesktopIdentityService, 'getStatus' | 'subscribe'>

/** Bridges the verified Desktop OIDC session into the Host authorization Principal. */
export class DesktopIdentityPrincipalProvider implements DomainMainPrincipalProvider {
  readonly #deviceId: string
  readonly #listeners = new Set<PrincipalContextListener>()
  readonly #disposeSourceSubscription: () => void
  #status: DesktopIdentityStatus
  #identityVersion = 0

  constructor(
    private readonly source: DesktopIdentitySource,
    deviceId: string
  ) {
    this.#deviceId = principalDeviceIdSchema.parse(deviceId)
    this.#status = source.getStatus()
    this.#disposeSourceSubscription = source.subscribe((status) => {
      this.#applyStatus(status, true)
    })
  }

  current(): PrincipalSnapshot | undefined {
    return this.snapshot().principal ?? undefined
  }

  snapshot(): PrincipalContextSnapshot {
    this.#applyStatus(this.source.getStatus(), false)
    return contextFor(this.#status, this.#deviceId, this.#identityVersion)
  }

  subscribe(listener: PrincipalContextListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  close(): void {
    this.#disposeSourceSubscription()
    this.#listeners.clear()
  }

  #applyStatus(status: DesktopIdentityStatus, authenticatedTransition: boolean): void {
    if (!authenticatedTransition && sameStatus(this.#status, status)) return
    if (this.#identityVersion >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Desktop identity authorization revision is exhausted.')
    }
    this.#status = status
    this.#identityVersion += 1
    const snapshot = contextFor(status, this.#deviceId, this.#identityVersion)
    for (const listener of this.#listeners) {
      try {
        listener(snapshot)
      } catch {
        // Authorization observers cannot interrupt a completed identity transition.
      }
    }
  }
}

function contextFor(
  status: DesktopIdentityStatus,
  deviceId: string,
  identityVersion: number
): PrincipalContextSnapshot {
  return definePrincipalContextSnapshot({
    identityVersion,
    principal: status.state === 'signed-in'
      ? {
          authority: 'sciforge-cloud',
          subject: status.user.userId,
          assurance: 'cloud-authenticated',
          deviceId,
          identityVersion
        }
      : null
  })
}

function sameStatus(left: DesktopIdentityStatus, right: DesktopIdentityStatus): boolean {
  if (left.state !== right.state) return false
  if (left.state === 'signed-out' || right.state === 'signed-out') return true
  return left.user.issuer === right.user.issuer &&
    left.user.subject === right.user.subject &&
    left.user.userId === right.user.userId &&
    left.accessTokenExpiresAt === right.accessTokenExpiresAt
}
