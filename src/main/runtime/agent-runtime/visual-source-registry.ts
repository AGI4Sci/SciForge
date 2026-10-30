import {
  defineVisualSourceProvider,
  type VisualSourceProvider,
  type VisualSourceRegistration,
  type VisualSourceRegistrationDisposable,
  type VisualSourceRegistrationInput
} from '@sciforge/domain-sdk/visual-source'

export type VisualSourceRegistryErrorCode =
  | 'invalid_owner'
  | 'duplicate_provider'
  | 'duplicate_resource_kind'

export class VisualSourceRegistryError extends Error {
  readonly code: VisualSourceRegistryErrorCode

  constructor(code: VisualSourceRegistryErrorCode, message: string) {
    super(message)
    this.name = 'VisualSourceRegistryError'
    this.code = code
  }
}

type InternalRegistration = VisualSourceRegistration & Readonly<{
  token: symbol
}>

export class VisualSourceRegistry {
  readonly #registrationsByProviderId = new Map<string, InternalRegistration>()
  readonly #registrationsByResourceKind = new Map<string, InternalRegistration>()

  constructor(registrations: readonly VisualSourceRegistrationInput[] = []) {
    this.registerMany(registrations)
  }

  register(
    ownerId: string,
    provider: VisualSourceRegistrationInput['provider']
  ): VisualSourceRegistrationDisposable {
    return this.registerMany([{ ownerId, provider }])
  }

  registerMany(
    registrations: readonly VisualSourceRegistrationInput[]
  ): VisualSourceRegistrationDisposable {
    const prepared = this.#prepareRegistrations(registrations)

    for (const registration of prepared) {
      this.#registrationsByProviderId.set(registration.provider.contract.id, registration)
      for (const resourceKind of registration.provider.contract.resourceKinds) {
        this.#registrationsByResourceKind.set(resourceKind, registration)
      }
    }

    let disposed = false
    return Object.freeze({
      dispose: () => {
        if (disposed) return
        disposed = true
        for (const registration of prepared) {
          const providerId = registration.provider.contract.id
          if (this.#registrationsByProviderId.get(providerId)?.token === registration.token) {
            this.#registrationsByProviderId.delete(providerId)
          }
          for (const resourceKind of registration.provider.contract.resourceKinds) {
            if (this.#registrationsByResourceKind.get(resourceKind)?.token === registration.token) {
              this.#registrationsByResourceKind.delete(resourceKind)
            }
          }
        }
      }
    })
  }

  resolve(resourceKind: string): VisualSourceProvider | undefined {
    return this.#registrationsByResourceKind.get(normalizeResourceKind(resourceKind))?.provider
  }

  list(): readonly VisualSourceRegistration[] {
    return Object.freeze(
      [...this.#registrationsByProviderId.values()]
        .sort(compareRegistrations)
        .map(({ ownerId, provider }) => Object.freeze({ ownerId, provider }))
    )
  }

  #prepareRegistrations(
    registrations: readonly VisualSourceRegistrationInput[]
  ): InternalRegistration[] {
    const providerIds = new Set<string>()
    const resourceKinds = new Set<string>()
    const prepared: InternalRegistration[] = []

    for (const input of registrations) {
      const ownerId = normalizeOwnerId(input.ownerId)
      const provider = defineVisualSourceProvider(input.provider)
      const providerId = provider.contract.id
      if (this.#registrationsByProviderId.has(providerId) || providerIds.has(providerId)) {
        throw new VisualSourceRegistryError(
          'duplicate_provider',
          `Visual source provider ${providerId} is already registered.`
        )
      }
      providerIds.add(providerId)

      for (const resourceKind of provider.contract.resourceKinds) {
        const existing = this.#registrationsByResourceKind.get(resourceKind)
        if (existing || resourceKinds.has(resourceKind)) {
          const existingProviderId = existing?.provider.contract.id ??
            prepared.find((registration) =>
              registration.provider.contract.resourceKinds.includes(resourceKind)
            )?.provider.contract.id
          throw new VisualSourceRegistryError(
            'duplicate_resource_kind',
            `Visual source resource kind ${resourceKind} is already owned by ` +
            `${existingProviderId ?? 'another provider'}.`
          )
        }
        resourceKinds.add(resourceKind)
      }

      prepared.push(Object.freeze({
        ownerId,
        provider,
        token: Symbol(providerId)
      }))
    }

    return prepared
  }
}

function normalizeOwnerId(value: string): string {
  const ownerId = value.trim()
  if (!ownerId) {
    throw new VisualSourceRegistryError(
      'invalid_owner',
      'Visual source registrations require an owner ID.'
    )
  }
  return ownerId
}

function normalizeResourceKind(value: string): string {
  const resourceKind = value.trim()
  if (!resourceKind) return ''
  return resourceKind
}

function compareRegistrations(
  left: InternalRegistration,
  right: InternalRegistration
): number {
  return left.ownerId.localeCompare(right.ownerId) ||
    left.provider.contract.id.localeCompare(right.provider.contract.id)
}
