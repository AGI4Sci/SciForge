import type {
  WorkspacePreviewProvider,
  WorkspacePreviewProviderRegistration,
  WorkspacePreviewProviderRegistrationDisposable,
  WorkspacePreviewProviderRegistrationInput
} from '@sciforge/domain-sdk/workspace-preview'

export type {
  WorkspacePreviewProvider,
  WorkspacePreviewProviderActionInput,
  WorkspacePreviewProviderActionResult,
  WorkspacePreviewProviderApplyEditInput,
  WorkspacePreviewProviderApplyEditResult,
  WorkspacePreviewProviderArtifactInput,
  WorkspacePreviewProviderArtifactResult,
  WorkspacePreviewProviderExportInput,
  WorkspacePreviewProviderExportResult,
  WorkspacePreviewProviderFileValidationInput,
  WorkspacePreviewProviderFileValidationResult,
  WorkspacePreviewProviderInvokeActionResult,
  WorkspacePreviewProviderObservationInput,
  WorkspacePreviewProviderObservationResult,
  WorkspacePreviewProviderVisualInput,
  WorkspacePreviewRenderVisualInput,
  WorkspacePreviewProviderRegistration,
  WorkspacePreviewProviderRegistrationDisposable,
  WorkspacePreviewProviderRegistrationInput
} from '@sciforge/domain-sdk/workspace-preview'

type InternalRegistration = WorkspacePreviewProviderRegistration & {
  token: symbol
}

export class WorkspacePreviewProviderRegistry {
  private readonly registrationsByPluginId = new Map<string, InternalRegistration>()

  constructor(registrations: readonly WorkspacePreviewProviderRegistrationInput[] = []) {
    this.registerMany(registrations)
  }

  register(
    ownerId: string,
    provider: WorkspacePreviewProvider,
    options: Readonly<{ order?: number }> = {}
  ): WorkspacePreviewProviderRegistrationDisposable {
    return this.registerMany([{ ownerId, provider, order: options.order }])
  }

  registerMany(
    registrations: readonly WorkspacePreviewProviderRegistrationInput[]
  ): WorkspacePreviewProviderRegistrationDisposable {
    const prepared = prepareRegistrations(registrations, this.registrationsByPluginId)

    for (const registration of prepared) {
      this.registrationsByPluginId.set(registration.provider.pluginId, registration)
    }

    let disposed = false
    return Object.freeze({
      dispose: () => {
        if (disposed) return
        disposed = true
        for (const registration of prepared) {
          const current = this.registrationsByPluginId.get(registration.provider.pluginId)
          if (current?.token === registration.token) {
            this.registrationsByPluginId.delete(registration.provider.pluginId)
          }
        }
      }
    })
  }

  get(pluginId: string): WorkspacePreviewProvider | undefined {
    return this.registrationsByPluginId.get(pluginId)?.provider
  }

  list(): readonly WorkspacePreviewProviderRegistration[] {
    return Object.freeze(
      [...this.registrationsByPluginId.values()]
        .sort(compareRegistrations)
        .map(toPublicRegistration)
    )
  }
}

function prepareRegistrations(
  registrations: readonly WorkspacePreviewProviderRegistrationInput[],
  existing: ReadonlyMap<string, InternalRegistration>
): InternalRegistration[] {
  const pluginIds = new Set<string>()

  return registrations.map((registration) => {
    const ownerId = requireIdentifier(registration.ownerId, 'owner ID')
    const pluginId = requireIdentifier(registration.provider.pluginId, 'plugin ID')
    const order = registration.order ?? 0
    if (!Number.isFinite(order)) {
      throw new Error(`Workspace preview provider ${pluginId} has a non-finite order.`)
    }
    if (existing.has(pluginId) || pluginIds.has(pluginId)) {
      throw new Error(`Workspace preview provider ${pluginId} is already registered.`)
    }
    pluginIds.add(pluginId)

    return {
      ownerId,
      provider: Object.freeze({ ...registration.provider, pluginId }),
      order,
      token: Symbol(pluginId)
    }
  })
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`Workspace preview providers require an ${label}.`)
  }
  return normalized
}

function compareRegistrations(
  left: InternalRegistration,
  right: InternalRegistration
): number {
  return left.order - right.order ||
    left.ownerId.localeCompare(right.ownerId) ||
    left.provider.pluginId.localeCompare(right.provider.pluginId)
}

function toPublicRegistration(
  registration: InternalRegistration
): WorkspacePreviewProviderRegistration {
  return Object.freeze({
    ownerId: registration.ownerId,
    provider: registration.provider,
    order: registration.order
  })
}
