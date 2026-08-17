export type StableResourceBindingCommit<Binding extends object> = Readonly<{
  binding: Binding
  created: boolean
  /** Removes only the binding established by this commit. */
  rollback: () => boolean
}>

export type StableResourceBindingReservation<Binding extends object> = Readonly<{
  commit: (
    canonicalKey: string,
    create: () => Binding
  ) => StableResourceBindingCommit<Binding>
  release: () => void
}>

/**
 * Bounded lifecycle registry for provider callbacks that must retain exact
 * identity across repeated Broker registrations. Capacity includes pending
 * provider opens so an async allocation cannot oversubscribe the registry.
 */
export class StableResourceBindingRegistry<Binding extends object> {
  readonly #bindings = new Map<string, Binding>()
  readonly #maximumBindings: number
  readonly #providerLabel: string
  #pendingReservations = 0

  constructor(maximumBindings: number, providerLabel: string) {
    if (!Number.isSafeInteger(maximumBindings) || maximumBindings < 1) {
      throw new Error('Stable resource binding capacity must be a positive safe integer.')
    }
    this.#maximumBindings = maximumBindings
    this.#providerLabel = providerLabel
  }

  reserve(canonicalKey?: string): StableResourceBindingReservation<Binding> {
    const existing = canonicalKey === undefined
      ? undefined
      : this.#bindings.get(canonicalKey)
    let holdsCapacity = existing === undefined
    if (
      holdsCapacity &&
      this.#bindings.size + this.#pendingReservations >= this.#maximumBindings
    ) {
      throw new Error(`${this.#providerLabel} resource registration capacity was reached.`)
    }
    if (holdsCapacity) this.#pendingReservations += 1

    let active = true
    const release = (): void => {
      if (!active) return
      active = false
      if (holdsCapacity) this.#pendingReservations -= 1
    }
    return Object.freeze({
      commit: (actualKey, create) => {
        if (!active) throw new Error('Stable resource binding reservation is no longer active.')
        if (canonicalKey !== undefined && canonicalKey !== actualKey) {
          release()
          throw new Error('Stable resource binding canonical key changed during provider open.')
        }
        const current = this.#bindings.get(actualKey)
        if (current) {
          release()
          return Object.freeze({
            binding: current,
            created: false,
            rollback: () => false
          })
        }
        if (!holdsCapacity) {
          if (this.#bindings.size + this.#pendingReservations >= this.#maximumBindings) {
            release()
            throw new Error(`${this.#providerLabel} resource registration capacity was reached.`)
          }
          holdsCapacity = true
          this.#pendingReservations += 1
        }
        let binding: Binding
        try {
          binding = create()
        } catch (error) {
          release()
          throw error
        }
        this.#bindings.set(actualKey, binding)
        release()
        return Object.freeze({
          binding,
          created: true,
          rollback: () => this.deleteExact(actualKey, binding)
        })
      },
      release
    })
  }

  deleteExact(canonicalKey: string, binding: Binding): boolean {
    if (this.#bindings.get(canonicalKey) !== binding) return false
    return this.#bindings.delete(canonicalKey)
  }
}

export function principalContextBindingKey(
  caller: Pick<CapabilityCallerContext, 'principal' | 'principalContextVersion'>
): string {
  const principal = caller.principal
  return JSON.stringify([
    caller.principalContextVersion ?? principal?.identityVersion ?? 0,
    principal
      ? [
          principal.authority,
          principal.subject,
          principal.assurance,
          principal.deviceId,
          principal.identityVersion
        ]
      : null
  ])
}
import type { CapabilityCallerContext } from '../../shared/capability-broker'
