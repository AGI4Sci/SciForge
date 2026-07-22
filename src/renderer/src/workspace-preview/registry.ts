import type { ReactElement } from 'react'
import type { RendererWorkspacePreviewPluginSlotContribution } from '@sciforge/domain-sdk/workspace-preview'
import type {
  WorkspacePreviewApplyEditResult,
  WorkspacePreviewExportResult,
  WorkspacePreviewInvokeActionResult
} from '@shared/sciforge-api'
import {
  resolveWorkspacePreviewPlugin,
  workspacePreviewPluginManifestSchema,
  type WorkspaceObservation,
  type WorkspacePreviewEditOperation,
  type WorkspacePreviewPluginManifest,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import type { DocumentAnnotationQuestionBridge } from './DocumentAnnotationPanelController'
import type { WorkspacePreviewPanelShellContext } from './WorkspacePreviewPanelShell'
import type { WorkspacePreviewPresentationStateChangeHandler } from './presentation-state'

export {
  DECK_WORKSPACE_PREVIEW_PLUGIN_ID,
  DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
  HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
  IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
  MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
  PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
  TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID,
  TEXT_WORKSPACE_PREVIEW_PLUGIN_ID
} from '@shared/workspace-preview'

export type WorkspacePreviewPluginOutletRouteReason =
  | 'empty'
  | 'registered-plugin'
  | 'unregistered-format'

export type WorkspacePreviewPluginRendererInput = {
  context: WorkspacePreviewPanelShellContext
  routeReason: WorkspacePreviewPluginOutletRouteReason
  observation: WorkspaceObservation | null
  asset: WorkspacePreviewPanelShellContext['asset']
  transport: WorkspacePreviewPanelShellContext['transport']
  applyEdit: (operation: WorkspacePreviewEditOperation) => Promise<void>
  annotationQuestionBridge?: DocumentAnnotationQuestionBridge
  visualContextComponentId?: string
  onPresentationStateChange?: WorkspacePreviewPresentationStateChangeHandler
}

export type WorkspacePreviewInspectorRow = {
  id: string
  label: string
  value: string
  description?: string
}

export type WorkspacePreviewInspectorSection = {
  id: string
  title: string
  summary?: string
  rows: WorkspacePreviewInspectorRow[]
}

export type WorkspacePreviewActionContribution = {
  id: string
  label: string
  requiresExplicitUi?: boolean
  run: (context: WorkspacePreviewPanelShellContext) => Promise<WorkspacePreviewActionRunResult>
}

export type WorkspacePreviewChromeActionSource = 'manifest' | 'observation' | 'manifest+observation'

export type WorkspacePreviewToolbarAction = {
  id: string
  label: string
  source: WorkspacePreviewChromeActionSource
  enabled: boolean
  reason?: string
  format?: string
  contribution: WorkspacePreviewActionContribution
}

export type WorkspacePreviewActionRunResult =
  | { ok: true; kind: 'ui'; actionId: string }
  | { ok: true; kind: 'set-selection'; actionId: string; result: WorkspacePreviewApplyEditResult }
  | { ok: true; kind: 'export'; actionId: string; result: WorkspacePreviewExportResult }
  | {
      ok: true
      kind: 'invoke-action'
      actionId: string
      result: WorkspacePreviewInvokeActionResult
      selectionResult?: WorkspacePreviewApplyEditResult
    }
  | {
      ok: false
      actionId: string
      reason: 'missing-session' | 'missing-observation' | 'missing-selection' | 'unsupported' | 'bridge'
      message: string
    }

export type RendererWorkspacePreviewPluginContribution =
  RendererWorkspacePreviewPluginSlotContribution<
    (input: WorkspacePreviewPluginRendererInput) => ReactElement,
    WorkspacePreviewActionContribution,
    (observation: WorkspaceObservation) => readonly WorkspacePreviewInspectorSection[],
    WorkspaceStructuredSelection['kind'],
    (selection: WorkspaceStructuredSelection) => WorkspacePreviewInspectorSection
  >

export type RendererWorkspacePreviewPluginRegistrationInput = {
  ownerId: string
  contribution: RendererWorkspacePreviewPluginContribution
}

export type RendererWorkspacePreviewPluginDescriptor = Readonly<{
  ownerId: string
  contribution: RendererWorkspacePreviewPluginContribution
  manifest: WorkspacePreviewPluginManifest
}>

export type RendererWorkspacePreviewResolveInput = {
  path: string
  mimeType?: string
}

export type RendererWorkspacePreviewPluginRegistrationDisposable = {
  dispose: () => void
}

export type RendererWorkspacePreviewRegistry = {
  register: (
    ownerId: string,
    contribution: RendererWorkspacePreviewPluginContribution
  ) => RendererWorkspacePreviewPluginRegistrationDisposable
  registerMany: (
    registrations: readonly RendererWorkspacePreviewPluginRegistrationInput[]
  ) => RendererWorkspacePreviewPluginRegistrationDisposable
  list: () => readonly RendererWorkspacePreviewPluginDescriptor[]
  manifests: () => readonly WorkspacePreviewPluginManifest[]
  get: (pluginId: string) => RendererWorkspacePreviewPluginDescriptor | null
  getAction: (pluginId: string, actionId: string) => WorkspacePreviewActionContribution | null
  resolve: (input: RendererWorkspacePreviewResolveInput) => RendererWorkspacePreviewPluginDescriptor | null
  dispose: () => void
}

export type CreateRendererWorkspacePreviewRegistryOptions = {
  registrations?: readonly RendererWorkspacePreviewPluginRegistrationInput[]
}

export function createRendererWorkspacePreviewRegistry(
  options: CreateRendererWorkspacePreviewRegistryOptions = {}
): RendererWorkspacePreviewRegistry {
  const descriptorsById = new Map<string, RendererWorkspacePreviewPluginDescriptor>()

  const registerMany = (
    registrations: readonly RendererWorkspacePreviewPluginRegistrationInput[]
  ): RendererWorkspacePreviewPluginRegistrationDisposable => {
    const prepared = prepareRegistrations(registrations, descriptorsById)

    for (const descriptor of prepared) {
      descriptorsById.set(descriptor.manifest.id, descriptor)
    }

    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        for (let index = prepared.length - 1; index >= 0; index -= 1) {
          const descriptor = prepared[index]
          if (descriptorsById.get(descriptor.manifest.id) === descriptor) {
            descriptorsById.delete(descriptor.manifest.id)
          }
        }
      }
    }
  }

  const registry: RendererWorkspacePreviewRegistry = {
    register: (ownerId, contribution) => registerMany([{
      ownerId,
      contribution
    }]),
    registerMany,
    list: () => Object.freeze([...descriptorsById.values()].sort(compareDescriptors)),
    manifests: () => registry.list().map((descriptor) => descriptor.manifest),
    get: (pluginId) => descriptorsById.get(pluginId) ?? null,
    getAction: (pluginId, actionId) =>
      descriptorsById.get(pluginId)?.contribution.actions?.find((action) => action.id === actionId) ?? null,
    resolve: (input) => {
      const manifest = resolveWorkspacePreviewPlugin({
        path: input.path,
        mimeType: input.mimeType,
        manifests: registry.manifests()
      })
      if (manifest) return registry.get(manifest.id)
      return null
    },
    dispose: () => descriptorsById.clear()
  }

  registry.registerMany(options.registrations ?? [])
  return registry
}

function prepareRegistrations(
  registrations: readonly RendererWorkspacePreviewPluginRegistrationInput[],
  existingDescriptors: ReadonlyMap<string, RendererWorkspacePreviewPluginDescriptor>
): RendererWorkspacePreviewPluginDescriptor[] {
  const pluginIds = new Set<string>()

  return registrations.map((registration) => {
    const ownerId = requireIdentifier(registration.ownerId, 'owner id')
    workspacePreviewPluginManifestSchema.parse(registration.contribution.manifest)
    const manifest = registration.contribution.manifest
    const manifestId = requireIdentifier(manifest.id, 'manifest id')
    if (existingDescriptors.has(manifestId) || pluginIds.has(manifestId)) {
      throw new Error(`Workspace preview renderer contribution "${manifestId}" is already registered.`)
    }
    pluginIds.add(manifestId)

    const actionIds = new Set<string>()
    for (const action of registration.contribution.actions ?? []) {
      const actionId = requireIdentifier(action.id, 'action id')
      if (actionIds.has(actionId)) {
        throw new Error(`Workspace preview action contribution "${actionId}" is already registered.`)
      }
      actionIds.add(actionId)
    }

    return Object.freeze({ ownerId, contribution: registration.contribution, manifest })
  })
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Workspace preview renderer ${label} must not be empty.`)
  if (normalized !== value) throw new Error(`Workspace preview renderer ${label} must not contain surrounding whitespace.`)
  return normalized
}

function compareDescriptors(
  left: RendererWorkspacePreviewPluginDescriptor,
  right: RendererWorkspacePreviewPluginDescriptor
): number {
  return right.manifest.priority - left.manifest.priority ||
    left.manifest.id.localeCompare(right.manifest.id) ||
    left.ownerId.localeCompare(right.ownerId)
}
