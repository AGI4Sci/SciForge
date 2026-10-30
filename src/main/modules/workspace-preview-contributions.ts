import {
  MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
  workspacePreviewManifestsEqual,
  workspacePreviewPluginManifestSchema,
  type MainWorkspacePreviewPluginSlotContribution
} from '@sciforge/domain-sdk/workspace-preview'
import type {
  WorkspacePreviewPluginRegistrationInput
} from '../services/workspace-preview/composition'
import type { WorkspacePreviewProvider } from '../services/workspace-preview/provider-registry'
import {
  DomainModuleCatalog,
  type DomainContributionRuntimeGuard
} from './catalog'

export { MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND } from '@sciforge/domain-sdk/workspace-preview'

export type MainWorkspacePreviewPluginContribution =
  MainWorkspacePreviewPluginSlotContribution<WorkspacePreviewProvider>

export const isMainWorkspacePreviewPluginContribution: DomainContributionRuntimeGuard<
  MainWorkspacePreviewPluginContribution
> = (value, metadata): value is MainWorkspacePreviewPluginContribution => {
  if (!isRecord(value) || !isRecord(value.provider)) return false
  const parsedManifest = workspacePreviewPluginManifestSchema.safeParse(value.manifest)
  const canonicalManifest = workspacePreviewPluginManifestSchema.safeParse(metadata.contract)
  if (!parsedManifest.success || !canonicalManifest.success) return false
  const manifest = parsedManifest.data
  if (!workspacePreviewManifestsEqual(manifest, canonicalManifest.data)) return false
  if (value.provider.pluginId !== manifest.id) return false
  if (!providerFunctionsAreValid(value.provider)) return false
  if ((manifest.capabilities.preview || manifest.capabilities.inspect) &&
      typeof value.provider.observe !== 'function') return false
  if (manifest.capabilities.edit && typeof value.provider.applyEdit !== 'function') return false
  if (manifest.capabilities.export?.length && typeof value.provider.exportPreview !== 'function') return false
  return true
}

export function listMainWorkspacePreviewPluginContributions(
  catalog: DomainModuleCatalog
): readonly WorkspacePreviewPluginRegistrationInput[] {
  return Object.freeze(catalog.listContributions(
    MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
    isMainWorkspacePreviewPluginContribution
  ).map((installed) => Object.freeze({
    ownerId: installed.owner.moduleId,
    order: -installed.declaration.priority,
    manifest: installed.value.manifest,
    provider: installed.value.provider
  })))
}

function providerFunctionsAreValid(provider: Record<string, unknown>): boolean {
  return [
    'validateFile',
    'observe',
    'invokeAction',
    'prepareArtifact',
    'applyEdit',
    'exportPreview',
    'invokeHostAction'
  ].every((key) => provider[key] === undefined || typeof provider[key] === 'function')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
