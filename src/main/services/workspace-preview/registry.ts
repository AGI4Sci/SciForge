import {
  FIRST_PARTY_DOCUMENT_WORKSPACE_PREVIEW_MANIFESTS,
  FIRST_PARTY_WORKSPACE_PREVIEW_MANIFESTS,
  TEXT_WORKSPACE_PREVIEW_PLUGIN_ID,
  normalizePreviewManifest,
  resolveWorkspacePreviewPlugin,
  type WorkspacePreviewPluginManifest
} from '../../../shared/workspace-preview'

export {
  FIRST_PARTY_DOCUMENT_WORKSPACE_PREVIEW_MANIFESTS,
  FIRST_PARTY_WORKSPACE_PREVIEW_MANIFESTS
}

export const WORKSPACE_PREVIEW_CORE_MANIFEST_OWNER_ID = 'sciforge.workspace-preview'

export type WorkspacePreviewManifestRegistrationInput = Readonly<{
  ownerId: string
  manifest: WorkspacePreviewPluginManifest
}>

export type WorkspacePreviewManifestRegistration = Readonly<{
  ownerId: string
  manifest: WorkspacePreviewPluginManifest
}>

export type WorkspacePreviewManifestRegistrationDisposable = Readonly<{
  dispose(): void
}>

type InternalManifestRegistration = WorkspacePreviewManifestRegistration & {
  token: symbol
}

export type WorkspacePreviewRoute =
  | {
      status: 'matched'
      manifest: WorkspacePreviewPluginManifest
    }
  | {
      status: 'fallback'
      manifest: WorkspacePreviewPluginManifest
      reason: 'text-compatible'
    }
  | {
      status: 'unsupported'
      path: string
      mimeType?: string
    }

export class WorkspacePreviewRegistry {
  private readonly registrationsByManifestId = new Map<string, InternalManifestRegistration>()

  constructor(
    registrations: readonly WorkspacePreviewManifestRegistrationInput[]
  ) {
    this.registerMany(registrations)
  }

  register(
    ownerId: string,
    manifest: WorkspacePreviewPluginManifest
  ): WorkspacePreviewManifestRegistrationDisposable {
    return this.registerMany([{ ownerId, manifest }])
  }

  registerMany(
    registrations: readonly WorkspacePreviewManifestRegistrationInput[]
  ): WorkspacePreviewManifestRegistrationDisposable {
    const prepared = prepareManifestRegistrations(registrations, this.registrationsByManifestId)

    for (const registration of prepared) {
      this.registrationsByManifestId.set(registration.manifest.id, registration)
    }

    let disposed = false
    return Object.freeze({
      dispose: () => {
        if (disposed) return
        disposed = true
        for (const registration of prepared) {
          const current = this.registrationsByManifestId.get(registration.manifest.id)
          if (current?.token === registration.token) {
            this.registrationsByManifestId.delete(registration.manifest.id)
          }
        }
      }
    })
  }

  list(): readonly WorkspacePreviewManifestRegistration[] {
    return Object.freeze(
      [...this.registrationsByManifestId.values()]
        .sort(compareManifestRegistrations)
        .map(toPublicManifestRegistration)
    )
  }

  get(id: string): WorkspacePreviewPluginManifest | undefined {
    return this.registrationsByManifestId.get(id)?.manifest
  }

  resolve(input: { path: string; mimeType?: string; fallbackToText?: boolean }): WorkspacePreviewRoute {
    const matched = resolveWorkspacePreviewPlugin({
      path: input.path,
      mimeType: input.mimeType,
      manifests: this.list().map(({ manifest }) => manifest)
    })
    if (matched) return { status: 'matched', manifest: matched }

    if (input.fallbackToText ?? true) {
      const text = this.get(TEXT_WORKSPACE_PREVIEW_PLUGIN_ID)
      if (text) {
        return {
          status: 'fallback',
          manifest: text,
          reason: 'text-compatible'
        }
      }
    }

    return {
      status: 'unsupported',
      path: input.path,
      ...(input.mimeType ? { mimeType: input.mimeType } : {})
    }
  }
}

function prepareManifestRegistrations(
  registrations: readonly WorkspacePreviewManifestRegistrationInput[],
  existing: ReadonlyMap<string, InternalManifestRegistration>
): InternalManifestRegistration[] {
  const manifestIds = new Set<string>()

  return registrations.map((registration) => {
    const ownerId = requireManifestOwnerId(registration.ownerId)
    const manifest = Object.freeze(normalizePreviewManifest(registration.manifest))
    if (existing.has(manifest.id) || manifestIds.has(manifest.id)) {
      throw new Error(`Workspace preview manifest ${manifest.id} is already registered.`)
    }
    manifestIds.add(manifest.id)

    return {
      ownerId,
      manifest,
      token: Symbol(manifest.id)
    }
  })
}

function requireManifestOwnerId(value: string): string {
  const ownerId = value.trim()
  if (!ownerId) {
    throw new Error('Workspace preview manifests require an owner ID.')
  }
  return ownerId
}

function compareManifestRegistrations(
  left: InternalManifestRegistration,
  right: InternalManifestRegistration
): number {
  return right.manifest.priority - left.manifest.priority ||
    left.manifest.id.localeCompare(right.manifest.id) ||
    left.ownerId.localeCompare(right.ownerId)
}

function toPublicManifestRegistration(
  registration: InternalManifestRegistration
): WorkspacePreviewManifestRegistration {
  return Object.freeze({
    ownerId: registration.ownerId,
    manifest: registration.manifest
  })
}
