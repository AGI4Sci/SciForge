import type { InstalledDomainContribution } from '@sciforge/domain-sdk'
import {
  RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
  workspacePreviewManifestsEqual,
  workspacePreviewPluginManifestSchema
} from '@sciforge/domain-sdk/workspace-preview'
import type {
  RendererWorkspacePreviewPluginContribution,
  RendererWorkspacePreviewPluginRegistrationInput
} from '../workspace-preview/registry'

export { RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND } from '@sciforge/domain-sdk/workspace-preview'

export function isRendererWorkspacePreviewPluginContribution(
  value: unknown,
  metadata: InstalledDomainContribution<'renderer'>
): value is RendererWorkspacePreviewPluginContribution {
  if (!isRecord(value)) return false
  const manifest = workspacePreviewPluginManifestSchema.safeParse(value.manifest)
  const canonicalManifest = workspacePreviewPluginManifestSchema.safeParse(metadata.contract)
  if (!manifest.success || !canonicalManifest.success ||
      !workspacePreviewManifestsEqual(manifest.data, canonicalManifest.data)) return false
  if (typeof value.render !== 'function') return false
  if (value.actions !== undefined && (!Array.isArray(value.actions) || value.actions.some((action) =>
    !isRecord(action) || typeof action.id !== 'string' || typeof action.label !== 'string' ||
      typeof action.run !== 'function'
  ))) return false
  if (value.inspectObservation !== undefined && typeof value.inspectObservation !== 'function') return false
  if (value.inspectSelection !== undefined && typeof value.inspectSelection !== 'function') return false
  return true
}

export function rendererWorkspacePreviewPluginRegistration(
  ownerId: string,
  contribution: RendererWorkspacePreviewPluginContribution
): RendererWorkspacePreviewPluginRegistrationInput {
  return Object.freeze({ ownerId, contribution })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
