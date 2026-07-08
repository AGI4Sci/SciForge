import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type {
  VisibleContextComponentSnapshot,
  VisibleContextResource
} from '@shared/visible-context'
import {
  isDeferredNonLifeScienceExtension,
  isFirstPartyTabularShellPreviewPath,
  isLifeSciencePreviewExtension,
  type WorkspaceObservation
} from '@shared/workspace-preview'
import { FolderOpen, PanelRightClose } from 'lucide-react'
import {
  useEffect,
  useMemo,
  type ReactElement
} from 'react'
import {
  WorkspacePreviewPanelShell,
  WorkspacePreviewPluginOutlet,
  type WorkspacePreviewLastEditSummary,
  type WorkspacePreviewPanelShellContext,
  type WorkspacePreviewPluginOutletRouteReason
} from '../workspace-preview'
import { registerVisibleContextComponent } from '../lib/visible-context'
import { WorkspaceFilePreviewPanel } from './WorkspaceFilePreviewPanel'

export type WorkspaceFilePreviewPanelBridgeRoute =
  | {
      kind: 'legacy-panel'
    }
  | {
      kind: 'workspace-preview-shell'
      reason: WorkspacePreviewPluginOutletRouteReason
    }

export type WorkspaceFilePreviewPanelBridgeProps = {
  target: WorkspaceFileTarget | null
  workspaceRoot: string
  className?: string
  onClose: () => void
  onOpenDirectory?: (target: { workspaceRoot: string; path: string }) => void
}

export function resolveWorkspaceFilePreviewPanelBridgeRoute(
  target: WorkspaceFileTarget | null
): WorkspaceFilePreviewPanelBridgeRoute {
  if (!target) return { kind: 'legacy-panel' }
  if (isFirstPartyTextPreviewExtension(target.path)) {
    return {
      kind: 'workspace-preview-shell',
      reason: 'text-first-party'
    }
  }
  if (isFirstPartyTabularPreviewExtension(target.path)) {
    return {
      kind: 'workspace-preview-shell',
      reason: 'tabular-first-party'
    }
  }
  if (isFirstPartyDeckPreviewExtension(target.path)) {
    return {
      kind: 'workspace-preview-shell',
      reason: 'deck-first-party'
    }
  }
  if (isLifeSciencePreviewExtension(target.path)) {
    return {
      kind: 'workspace-preview-shell',
      reason: 'life-science'
    }
  }
  if (isDeferredNonLifeScienceExtension(target.path)) {
    return {
      kind: 'workspace-preview-shell',
      reason: 'deferred-non-life-science'
    }
  }
  return { kind: 'legacy-panel' }
}

function isFirstPartyTextPreviewExtension(path: string): boolean {
  return /\.(?:txt|text|log)$/i.test(path.trim())
}

function isFirstPartyTabularPreviewExtension(path: string): boolean {
  return isFirstPartyTabularShellPreviewPath(path.trim())
}

function isFirstPartyDeckPreviewExtension(path: string): boolean {
  return /\.pptx$/i.test(path.trim())
}

export function WorkspaceFilePreviewPanelBridge({
  target,
  workspaceRoot,
  className,
  onClose,
  onOpenDirectory
}: WorkspaceFilePreviewPanelBridgeProps): ReactElement {
  const route = resolveWorkspaceFilePreviewPanelBridgeRoute(target)

  if (route.kind === 'legacy-panel') {
    return (
      <WorkspaceFilePreviewPanel
        target={target}
        workspaceRoot={workspaceRoot}
        className={className}
        onClose={onClose}
        onOpenDirectory={onOpenDirectory}
      />
    )
  }

  return (
    <WorkspacePreviewPanelShell
      target={target}
      workspaceRoot={workspaceRoot}
      className={className}
    >
      {(context) => (
        <WorkspacePreviewShellBody
          context={context}
          target={target}
          route={route}
          workspaceRoot={workspaceRoot}
          onClose={onClose}
          onOpenDirectory={onOpenDirectory}
        />
      )}
    </WorkspacePreviewPanelShell>
  )
}

export function buildWorkspacePreviewVisibleContextComponent(input: {
  context: Pick<WorkspacePreviewPanelShellContext, 'state' | 'asset' | 'assetStatus' | 'assetError'>
  target: WorkspaceFileTarget | null
  route: Extract<WorkspaceFilePreviewPanelBridgeRoute, { kind: 'workspace-preview-shell' }>
  workspaceRoot: string
  updatedAt: string
}): VisibleContextComponentSnapshot | null {
  const path = input.context.state.observation?.file.path ??
    input.context.state.file?.path ??
    input.context.state.session?.path ??
    input.target?.path
  if (!path) return null

  const resolvedWorkspaceRoot = input.context.state.observation?.file.workspaceRoot ??
    input.context.state.file?.workspaceRoot ??
    input.context.state.session?.workspaceRoot ??
    input.target?.workspaceRoot?.trim() ??
    input.workspaceRoot
  const relativePath = relativePathForVisibleContext(path, resolvedWorkspaceRoot)
  const observation = input.context.state.observation
  const modality = observation?.view.modality ?? input.context.state.session?.modality ?? 'unknown'
  const pluginId = observation?.view.pluginId ?? input.context.state.session?.pluginId
  const mode = observation?.view.mode ?? input.context.state.session?.mode
  const selectionKind = observation?.selection?.kind ?? input.context.state.session?.selection?.kind
  const actionCount = observation?.actions.length ?? 0
  const summary = observation
    ? `Workspace preview observation for ${formatLabel(modality)} file ${fileNameFromPath(path)} with ${actionCount} actions.`
    : input.context.assetError
      ? `Workspace preview for ${fileNameFromPath(path)} has an asset error: ${input.context.assetError}.`
      : `Workspace preview for ${fileNameFromPath(path)} is ${input.context.assetStatus}.`
  const resources: VisibleContextResource[] = [{
    kind: 'workspaceFile',
    role: 'preview-target',
    title: fileNameFromPath(path),
    accessHint: 'Use workspacePreview.observe for structured state and workspacePreview.readRange for bounded asset bytes.',
    workspaceRoot: resolvedWorkspaceRoot,
    path,
    relativePath,
    resourceUri: workspaceFileResourceUriForVisibleContext(relativePath),
    name: fileNameFromPath(path),
    fileKind: modality,
    mimeType: observation?.file.mimeType ?? input.context.state.file?.mimeType,
    size: observation?.file.size ?? input.context.state.file?.size,
    mtimeMs: observation?.file.mtimeMs ?? input.context.state.file?.mtimeMs,
    annotationCount: observation?.annotations?.length,
    metadata: {
      pluginId,
      modality,
      mode,
      routeReason: input.route.reason,
      assetPrimary: input.context.asset?.primary,
      assetStatus: input.context.assetStatus,
      assetStrategies: input.context.asset?.strategies.map((strategy) => ({
        kind: strategy.kind,
        status: strategy.status
      })),
      selectionKind,
      actionCount
    }
  }]

  return {
    id: 'right-sidebar.file-preview',
    region: 'right-sidebar',
    component: 'workspace-preview',
    title: observation?.view.title || fileNameFromPath(path),
    visible: true,
    priority: 20,
    updatedAt: input.updatedAt,
    summary,
    resources,
    state: {
      path,
      workspaceRoot: resolvedWorkspaceRoot,
      pluginId,
      modality,
      mode,
      routeReason: input.route.reason,
      assetStatus: input.context.assetStatus,
      assetPrimary: input.context.asset?.primary ?? null,
      assetStrategies: input.context.asset?.strategies.map((strategy) => ({
        kind: strategy.kind,
        status: strategy.status
      })) ?? [],
      selectionKind: selectionKind ?? null,
      actionCount,
      error: input.context.state.error ?? input.context.assetError,
      workspaceObservation: observation ?? null
    }
  }
}

function WorkspacePreviewShellBody({
  context,
  target,
  route,
  workspaceRoot,
  onClose,
  onOpenDirectory
}: {
  context: WorkspacePreviewPanelShellContext
  target: WorkspaceFileTarget | null
  route: Extract<WorkspaceFilePreviewPanelBridgeRoute, { kind: 'workspace-preview-shell' }>
  workspaceRoot: string
  onClose: () => void
  onOpenDirectory?: (target: { workspaceRoot: string; path: string }) => void
}): ReactElement {
  const lastEditSummary = context.state.lastEditSummary
  const canOpenDirectory = Boolean(target && onOpenDirectory)
  const visibleContextComponent = useMemo(
    () => buildWorkspacePreviewVisibleContextComponent({
      context,
      target,
      route,
      workspaceRoot,
      updatedAt: new Date().toISOString()
    }),
    [context, route, target, workspaceRoot]
  )

  useEffect(() => {
    if (!visibleContextComponent) return undefined
    return registerVisibleContextComponent(visibleContextComponent)
  }, [visibleContextComponent])

  return (
    <div
      className="relative h-full min-h-0"
      data-workspace-file-preview-panel-bridge
      data-route={route.kind}
      data-route-reason={route.reason}
      data-asset-status={context.assetStatus}
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        {canOpenDirectory ? (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover hover:text-ds-text"
            title="Open containing directory"
            aria-label="Open containing directory"
            onClick={() => {
              if (!target || !onOpenDirectory) return
              onOpenDirectory({
                workspaceRoot: target.workspaceRoot?.trim() || workspaceRoot,
                path: parentDirectoryPath(target.path)
              })
            }}
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover hover:text-ds-text"
          title="Close preview"
          aria-label="Close preview"
          onClick={onClose}
        >
          <PanelRightClose className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {lastEditSummary ? (
        <WorkspacePreviewEditSummaryStatus summary={lastEditSummary} />
      ) : null}

	      <WorkspacePreviewPluginOutlet
	        context={context}
	        routeReason={route.reason}
	      />
	    </div>
	  )
	}

function WorkspacePreviewEditSummaryStatus({
  summary
}: {
  summary: WorkspacePreviewLastEditSummary
}): ReactElement {
  return (
    <div
      className="pointer-events-none absolute right-3 top-12 z-10 max-w-[min(22rem,calc(100%-1.5rem))] rounded-md border border-ds-border bg-ds-panel/95 px-3 py-2 text-xs shadow-lg"
      role="status"
      aria-live="polite"
      data-workspace-preview-edit-summary
    >
      <p className="font-medium text-ds-text">{summary.summary}</p>
      <p className="mt-1 text-ds-muted">{summary.undo.hint}</p>
    </div>
  )
}

function parentDirectoryPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '')
  const slash = normalized.lastIndexOf('/')
  return slash > 0 ? normalized.slice(0, slash) : ''
}

function relativePathForVisibleContext(path: string, workspaceRoot: string): string | undefined {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedRoot = workspaceRoot.replaceAll('\\', '/').replace(/\/+$/, '')
  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) return path.replaceAll('\\', '/')
  return undefined
}

function workspaceFileResourceUriForVisibleContext(relativePath: string | undefined): string | undefined {
  if (relativePath === undefined) return undefined
  return `workspace://file/${relativePath.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function formatLabel(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
