import {
  DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS,
  workspacePreviewPluginManifestSchema,
  type WorkspacePreviewPluginManifest
} from '../../../shared/workspace-preview'
import {
  createBuiltInWorkspacePreviewProviderRegistrations,
  type WorkspacePreviewBuiltInProviderAdapters
} from './built-in-providers'
import {
  WorkspacePreviewProviderRegistry,
  type WorkspacePreviewProvider,
  type WorkspacePreviewProviderRegistrationInput
} from './provider-registry'
import {
  WorkspacePreviewRegistry,
  type WorkspacePreviewManifestRegistrationInput
} from './registry'

export type WorkspacePreviewPluginRegistrationInput = Readonly<{
  ownerId: string
  manifest: WorkspacePreviewPluginManifest
  provider: WorkspacePreviewProvider
  order?: number
}>

export type ComposedWorkspacePreviewRuntime = Readonly<{
  manifests: WorkspacePreviewRegistry
  providers: WorkspacePreviewProviderRegistry
}>

export function createComposedWorkspacePreviewRuntime(
  adapters: WorkspacePreviewBuiltInProviderAdapters,
  domainPlugins: readonly WorkspacePreviewPluginRegistrationInput[] = []
): ComposedWorkspacePreviewRuntime {
  return composeWorkspacePreviewPlugins([
    ...createBuiltInWorkspacePreviewPluginRegistrations(adapters),
    ...domainPlugins
  ])
}

/** Validates the complete batch before either registry becomes observable. */
export function composeWorkspacePreviewPlugins(
  inputs: readonly WorkspacePreviewPluginRegistrationInput[]
): ComposedWorkspacePreviewRuntime {
  const prepared = preparePluginRegistrations(inputs)
  const manifests: WorkspacePreviewManifestRegistrationInput[] = prepared.map((plugin) => ({
    ownerId: plugin.ownerId,
    manifest: plugin.manifest
  }))
  const providers: WorkspacePreviewProviderRegistrationInput[] = prepared.map((plugin) => ({
    ownerId: plugin.ownerId,
    provider: plugin.provider,
    order: plugin.order
  }))

  return Object.freeze({
    manifests: new WorkspacePreviewRegistry(manifests),
    providers: new WorkspacePreviewProviderRegistry(providers)
  })
}

function createBuiltInWorkspacePreviewPluginRegistrations(
  adapters: WorkspacePreviewBuiltInProviderAdapters
): readonly WorkspacePreviewPluginRegistrationInput[] {
  const manifestsById = new Map(
    DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => [manifest.id, manifest])
  )
  const providers = createBuiltInWorkspacePreviewProviderRegistrations(adapters)
  const plugins = providers.map((registration) => {
    const manifest = manifestsById.get(registration.provider.pluginId)
    if (!manifest) {
      throw new Error(`Built-in workspace preview provider ${registration.provider.pluginId} has no manifest.`)
    }
    manifestsById.delete(manifest.id)
    return {
      ownerId: registration.ownerId,
      order: registration.order,
      manifest,
      provider: registration.provider
    }
  })
  if (manifestsById.size > 0) {
    throw new Error(
      `Built-in workspace preview manifests have no provider: ${[...manifestsById.keys()].join(', ')}.`
    )
  }
  return plugins
}

function preparePluginRegistrations(
  inputs: readonly WorkspacePreviewPluginRegistrationInput[]
): WorkspacePreviewPluginRegistrationInput[] {
  const pluginIds = new Set<string>()
  return inputs.map((input) => {
    const ownerId = input.ownerId.trim()
    if (!ownerId) throw new Error('Workspace preview plugins require an owner ID.')
    const manifest = Object.freeze(workspacePreviewPluginManifestSchema.parse(input.manifest))
    if (manifest.id !== input.provider.pluginId) {
      throw new Error(
        `Workspace preview plugin ${manifest.id} does not match provider ${input.provider.pluginId}.`
      )
    }
    if (pluginIds.has(manifest.id)) {
      throw new Error(`Workspace preview plugin ${manifest.id} is already registered.`)
    }
    pluginIds.add(manifest.id)
    return Object.freeze({
      ownerId,
      manifest,
      provider: input.provider,
      order: input.order ?? 0
    })
  })
}
