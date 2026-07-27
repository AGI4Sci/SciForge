import type { ReactElement } from 'react'
import {
  workspacePreviewContentKey,
  type WorkspaceObservation,
  type WorkspacePreviewEditOperation
} from '@shared/workspace-preview'
import type {
  DocumentAnnotationQuestionBridge
} from './DocumentAnnotationPanelController'
import type {
  WorkspacePreviewPluginOutletRouteReason,
  WorkspacePreviewPluginRendererInput,
  RendererWorkspacePreviewRegistry
} from './registry'
import type {
  WorkspacePreviewPanelShellContext
} from './WorkspacePreviewPanelShell'
import type {
  WorkspacePreviewPresentationStateChangeHandler
} from './presentation-state'

export type WorkspacePreviewPluginOutletProps = {
  context: WorkspacePreviewPanelShellContext
  routeReason: WorkspacePreviewPluginOutletRouteReason
  routePluginId?: string
  rendererRegistry: RendererWorkspacePreviewRegistry
  annotationQuestionBridge?: DocumentAnnotationQuestionBridge
  visualContextComponentId?: string
  onPresentationStateChange?: WorkspacePreviewPresentationStateChangeHandler
}

export async function applyWorkspacePreviewOutletEdit(
  context: WorkspacePreviewPanelShellContext,
  operation: WorkspacePreviewEditOperation
): Promise<void> {
  const result = await context.host.applyEdit(operation)
  if (result.ok) {
    await context.host.observe(result.session.id)
    return
  }
  throw new Error(result.message)
}

export function WorkspacePreviewPluginOutlet({
  context,
  routeReason,
  routePluginId,
  rendererRegistry,
  annotationQuestionBridge,
  visualContextComponentId,
  onPresentationStateChange
}: WorkspacePreviewPluginOutletProps): ReactElement {
  const observation = context.state.observation
  const pluginId = observation?.view.pluginId ??
    context.state.descriptor?.manifest.id ??
    context.state.session?.pluginId ??
    routePluginId
  const rendererInput: WorkspacePreviewPluginRendererInput = {
    context,
    routeReason,
    observation,
    asset: context.asset,
    transport: context.transport,
    contentKey: workspacePreviewContentKey({
      observation,
      asset: context.asset
    }),
    applyEdit: (operation: WorkspacePreviewEditOperation) =>
      applyWorkspacePreviewOutletEdit(context, operation),
    annotationQuestionBridge,
    visualContextComponentId,
    onPresentationStateChange
  }
  const renderer = pluginId ? rendererRegistry.get(pluginId)?.contribution : undefined

  if (renderer) {
    return renderer.render(rendererInput)
  }

  return (
    <WorkspacePreviewPluginSummaryBody
      context={context}
      observation={observation}
      routeReason={routeReason}
    />
  )
}

export function WorkspacePreviewPluginSummaryBody({
  context,
  observation,
  routeReason
}: {
  context: WorkspacePreviewPanelShellContext
  observation: WorkspaceObservation | null
  routeReason: WorkspacePreviewPluginOutletRouteReason
}): ReactElement {
  const session = context.state.session
  const title = observation?.view.title ?? session?.path ?? 'Workspace preview'
  const modality = observation?.view.modality ?? session?.modality ?? 'unknown'
  const message = fallbackMessageForRoute(routeReason, modality, context.assetError)

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4 pr-20 text-sm text-ds-text"
      data-workspace-preview-plugin-summary
      data-route-reason={routeReason}
    >
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-ds-muted">{message}</p>
      </header>
      <p className="max-w-xl text-xs text-ds-muted">
        Use Inspect for plugin details, asset transport state, and agent-readable observation metadata.
      </p>
    </section>
  )
}

function fallbackMessageForRoute(
  routeReason: WorkspacePreviewPluginOutletRouteReason,
  modality: string,
  assetError: string | null
): string {
  if (assetError) return assetError
  if (routeReason === 'unregistered-format') {
    return 'No inline workspace preview plugin is registered for this file type.'
  }
  return `${formatLabel(modality)} preview is not available in the main viewer yet.`
}

function formatLabel(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
