import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import type {
  VisibleContextComponentSnapshot,
  VisibleContextResource
} from '@shared/visible-context'
import type { WorkspaceObservation } from '@shared/workspace-preview'
import { FolderOpen, PanelRightClose, RefreshCw } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import {
  WorkspacePreviewPanelShell,
  WorkspacePreviewPluginOutlet,
  type DocumentAnnotationQuestionBridge,
  type WorkspacePreviewLastEditSummary,
  type WorkspacePreviewPanelShellContext,
  type WorkspacePreviewPluginOutletRouteReason,
  type RendererWorkspacePreviewPluginDescriptor
} from '../workspace-preview'
import { installedRendererContributions } from '../domain-modules/installed-renderer-contributions'
import {
  boundWorkspacePreviewPresentationState,
  workspacePreviewPresentationStatesEqual,
  type WorkspacePreviewPresentationState
} from '../workspace-preview/presentation-state'
import {
  registerVisibleContextComponent,
  registerVisibleContextVisualTarget
} from '../lib/visible-context'
import { useChatStore } from '../store/chat-store'

const WORKSPACE_PREVIEW_EVENT_REFRESH_DEBOUNCE_MS = 80
const workspacePreviewRegistry = installedRendererContributions.workspacePreviews

export type WorkspaceFilePreviewPanelBridgeRoute = {
  kind: 'workspace-preview-shell'
  reason: WorkspacePreviewPluginOutletRouteReason
  pluginId?: string
  modality?: RendererWorkspacePreviewPluginDescriptor['manifest']['modality']
}

export type WorkspaceFilePreviewPanelBridgeProps = {
  target: WorkspaceFileTarget | null
  workspaceRoot: string
  sessionId?: string
  active?: boolean
  className?: string
  annotationQuestionBridge?: DocumentAnnotationQuestionBridge
  onClose: () => void
  onOpenDirectory?: (target: { workspaceRoot: string; path: string }) => void
  onOpenFile?: (target: WorkspaceFileTarget) => void
}

export type WorkspacePreviewIntegrityNotice =
  | { kind: 'verified'; message: '证据版本已验证' }
  | { kind: 'mismatch'; message: '当前文件与 Snapshot 证据版本不一致，未打开' }

export function resolveWorkspacePreviewWorkspaceLocator(input: Readonly<{
  sessionId?: string
  activeThreadId: string | null
  threads: readonly Readonly<{ id: string; workspaceLocator?: WorkspaceLocator }>[]
  workspaceLocator: WorkspaceLocator | null
}>): WorkspaceLocator | undefined {
  const ownerThreadId = input.sessionId ?? input.activeThreadId
  const ownerThread = ownerThreadId
    ? input.threads.find((thread) => thread.id === ownerThreadId)
    : undefined
  return ownerThread?.workspaceLocator ?? (
    ownerThreadId === input.activeThreadId
      ? input.workspaceLocator ?? undefined
      : undefined
  )
}

function normalizedSha256(value?: string): string {
  return value?.trim().toLowerCase().replace(/^sha256:/u, '') ?? ''
}

export function workspacePreviewIntegrityNotice(input: {
  target: WorkspaceFileTarget | null
  state: Pick<WorkspacePreviewPanelShellContext['state'], 'file' | 'error'>
  assetError: string | null
}): WorkspacePreviewIntegrityNotice | null {
  const expected = input.target?.integrity?.expectedDigest
  if (!expected) return null
  const errors = [input.state.error, input.assetError].filter((value): value is string => Boolean(value))
  if (errors.some((error) => /integrity\s+mismatch/iu.test(error))) {
    return { kind: 'mismatch', message: '当前文件与 Snapshot 证据版本不一致，未打开' }
  }
  const actual = input.state.file?.sha256
  const normalizedExpected = normalizedSha256(expected)
  if (actual && /^[a-f0-9]{64}$/u.test(normalizedExpected) &&
      normalizedSha256(actual) === normalizedExpected) {
    return { kind: 'verified', message: '证据版本已验证' }
  }
  return null
}

export function resolveWorkspaceFilePreviewPanelBridgeRoute(
  target: WorkspaceFileTarget | null
): WorkspaceFilePreviewPanelBridgeRoute {
  if (!target) {
    return {
      kind: 'workspace-preview-shell',
      reason: 'empty'
    }
  }
  const descriptor = workspacePreviewRegistry.resolve({
    path: target.path
  })
  if (descriptor) {
    return {
      kind: 'workspace-preview-shell',
      reason: 'registered-plugin',
      pluginId: descriptor.manifest.id,
      modality: descriptor.manifest.modality
    }
  }
  return {
    kind: 'workspace-preview-shell',
    reason: 'unregistered-format'
  }
}

export function WorkspaceFilePreviewPanelBridge({
  target,
  workspaceRoot,
  sessionId,
  active = true,
  className,
  annotationQuestionBridge,
  onClose,
  onOpenDirectory,
  onOpenFile
}: WorkspaceFilePreviewPanelBridgeProps): ReactElement {
  const workspaceLocator = useChatStore((state) =>
    resolveWorkspacePreviewWorkspaceLocator({
      ...(sessionId ? { sessionId } : {}),
      activeThreadId: state.activeThreadId,
      threads: state.threads,
      workspaceLocator: state.workspaceLocator
    })
  )
  const targetPath = target?.path
  const route = useMemo(
    () => resolveWorkspaceFilePreviewPanelBridgeRoute(targetPath ? { path: targetPath } : null),
    [targetPath]
  )

  return (
    <WorkspacePreviewPanelShell
      target={target}
      workspaceRoot={workspaceRoot}
      workspaceLocator={workspaceLocator}
      registry={workspacePreviewRegistry}
      className={compactClassName('ds-no-drag', className)}
      onOpenFile={onOpenFile}
    >
      {(context) => (
        <WorkspacePreviewShellBody
          context={context}
          target={target}
          route={route}
          workspaceRoot={workspaceRoot}
          sessionId={sessionId}
          active={active}
          annotationQuestionBridge={annotationQuestionBridge}
          onClose={onClose}
          onOpenDirectory={onOpenDirectory}
        />
      )}
    </WorkspacePreviewPanelShell>
  )
}

function compactClassName(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function buildWorkspacePreviewVisibleContextComponent(input: {
  context: Pick<WorkspacePreviewPanelShellContext, 'state' | 'asset' | 'assetStatus' | 'assetError'>
  target: WorkspaceFileTarget | null
  route: WorkspaceFilePreviewPanelBridgeRoute
  workspaceRoot: string
  updatedAt: string
  presentationState?: WorkspacePreviewPresentationState | null
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
  const modality = observation?.view.modality ??
    input.context.state.session?.modality ??
    input.route.modality ??
    'unknown'
  const pluginId = observation?.view.pluginId ??
    input.context.state.session?.pluginId ??
    input.route.pluginId
  const mode = observation?.view.mode ?? input.context.state.session?.mode
  const selectionKind = observation?.selection?.kind ?? input.context.state.session?.selection?.kind
  const compactCapability = compactVisibleContextCapability(input.context.state.capability)
  const documentAnnotations = observation?.documentAnnotations
  const presentationState = boundWorkspacePreviewPresentationState(input.presentationState)
  const presentationSummary = formatPresentationSummary(presentationState)
  const baseSummary = observation
    ? `Workspace preview observation for ${formatLabel(modality)} file ${fileNameFromPath(path)}.`
    : input.context.assetError
      ? `Workspace preview for ${fileNameFromPath(path)} has an asset error: ${input.context.assetError}.`
      : `Workspace preview for ${fileNameFromPath(path)} is ${input.context.assetStatus}.`
  const summary = presentationSummary ? `${baseSummary} ${presentationSummary}` : baseSummary
  const resources: VisibleContextResource[] = [{
    kind: 'workspaceFile',
    role: 'preview-target',
    title: fileNameFromPath(path),
    workspaceRoot: resolvedWorkspaceRoot,
    path,
    relativePath,
    resourceUri: workspaceFileResourceUriForVisibleContext(relativePath),
    name: fileNameFromPath(path),
    fileKind: modality,
    mimeType: observation?.file.mimeType ?? input.context.state.file?.mimeType,
    size: observation?.file.size ?? input.context.state.file?.size,
    mtimeMs: observation?.file.mtimeMs ?? input.context.state.file?.mtimeMs,
    annotationCount: documentAnnotations?.annotationCount,
    threadCount: documentAnnotations?.threadCount,
    openThreadCount: documentAnnotations?.openThreadCount,
    capability: compactCapability,
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
      presentationKind: presentationState?.kind,
      presentationPosition: presentationState?.position
    }
  }]

  return {
    id: 'right-sidebar.file-preview',
    region: 'right-sidebar',
    component: 'workspace-preview',
    title: presentationState?.title || observation?.view.title || fileNameFromPath(path),
    visible: true,
    priority: 20,
    updatedAt: input.updatedAt,
    summary,
    resources,
    state: {
      currentPreview: compactCapability
        ? {
            resourceRef: compactCapability.resourceRef,
            operationRefs: compactCapability.operations.map((operation) => operation.operationRef)
          }
        : null,
      documentAnnotations: documentAnnotations ?? null,
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
      presentation: presentationState,
      error: input.context.state.error ?? input.context.assetError,
      workspaceObservation: observation ?? null
    }
  }
}

function compactVisibleContextCapability(
  binding: WorkspacePreviewPanelShellContext['state']['capability']
): {
  resourceRef: string
  operations: Array<{ operationRef: string; schemaRef: string }>
} | undefined {
  if (!binding?.resourceRef) return undefined
  return {
    resourceRef: binding.resourceRef,
    operations: binding.operations.map((operation) => ({
      operationRef: operation.id,
      schemaRef: `sciforge://capability-schema/${encodeURIComponent(operation.id)}?version=${encodeURIComponent(operation.version)}`
    }))
  }
}

function formatPresentationSummary(
  presentation: WorkspacePreviewPresentationState | null
): string {
  if (!presentation) return ''
  const title = presentation.title ? `Showing ${presentation.title}.` : ''
  const position = presentation.position?.label
    ? `Current position: ${presentation.position.label}.`
    : presentation.position
      ? `Current position: ${presentation.position.index}${presentation.position.count ? ` of ${presentation.position.count}` : ''}.`
      : ''
  const selection = presentation.selection?.summary
    ? `Selection: ${presentation.selection.summary}.`
    : ''
  return [title, position, selection].filter(Boolean).join(' ')
}

function WorkspacePreviewShellBody({
  context,
  target,
  route,
  workspaceRoot,
  sessionId,
  active,
  annotationQuestionBridge,
  onClose,
  onOpenDirectory
}: {
  context: WorkspacePreviewPanelShellContext
  target: WorkspaceFileTarget | null
  route: WorkspaceFilePreviewPanelBridgeRoute
  workspaceRoot: string
  sessionId?: string
  active: boolean
  annotationQuestionBridge?: DocumentAnnotationQuestionBridge
  onClose: () => void
  onOpenDirectory?: (target: { workspaceRoot: string; path: string }) => void
}): ReactElement {
  const previewRef = useRef<HTMLDivElement | null>(null)
  const observeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const presentationOwnerKey = `${context.state.session?.id ?? ''}:${target?.path ?? ''}`
  const [presentationSnapshot, setPresentationSnapshot] = useState<{
    ownerKey: string
    state: WorkspacePreviewPresentationState | null
  }>(() => ({ ownerKey: presentationOwnerKey, state: null }))
  const presentationState = presentationSnapshot.ownerKey === presentationOwnerKey
    ? presentationSnapshot.state
    : null
  const handlePresentationStateChange = useCallback((next: WorkspacePreviewPresentationState | null): void => {
    const bounded = boundWorkspacePreviewPresentationState(next)
    setPresentationSnapshot((current) => current.ownerKey === presentationOwnerKey &&
      workspacePreviewPresentationStatesEqual(current.state, bounded)
      ? current
      : { ownerKey: presentationOwnerKey, state: bounded })
  }, [presentationOwnerKey])
  const capabilityWorkspaceRoot = target?.workspaceRoot?.trim() || workspaceRoot
  const lastEditSummary = context.state.lastEditSummary
  const canOpenDirectory = Boolean(target && onOpenDirectory)
  const integrityNotice = workspacePreviewIntegrityNotice({
    target,
    state: context.state,
    assetError: context.assetError
  })
  const visibleContextComponent = useMemo(() => {
    if (!active) return null
    const component = buildWorkspacePreviewVisibleContextComponent({
      context,
      target,
      route,
      workspaceRoot,
      updatedAt: new Date().toISOString(),
      presentationState
    })
    return component && sessionId
      ? { ...component, id: `${component.id}:${encodeURIComponent(sessionId)}` }
      : component
  }, [active, context, presentationState, route, sessionId, target, workspaceRoot])

  useEffect(() => {
    if (!visibleContextComponent) return undefined
    return registerVisibleContextComponent(visibleContextComponent)
  }, [visibleContextComponent])

  useEffect(() => {
    if (!visibleContextComponent) return undefined
    const observation = context.state.observation
    const modality = observation?.view.modality ?? context.state.session?.modality ?? route.modality ?? 'unknown'
    const slideId = observation?.selection?.kind === 'deck'
      ? observation.selection.slideIds[0]
      : observation?.slides?.[0]?.id
    return registerVisibleContextVisualTarget({
      componentId: visibleContextComponent.id,
      target: {
        id: 'preview.current',
        kind: 'component',
        contentType: workspacePreviewVisualContentType({
          modality,
          mimeType: observation?.file.mimeType ?? context.state.file?.mimeType ?? context.asset?.file.mimeType,
          assetPrimary: context.asset?.primary,
          assetStrategies: context.asset?.strategies
        }),
        active: true,
        metadata: {
          path: visibleContextComponent.state?.path,
          modality,
          pluginId: visibleContextComponent.state?.pluginId,
          selectionKind: visibleContextComponent.state?.selectionKind,
          ...(slideId ? { slideId } : {})
        }
      },
      element: () => previewRef.current
    })
  }, [
    context.asset?.file.mimeType,
    context.asset?.primary,
    context.asset?.strategies,
    context.state.file?.mimeType,
    context.state.observation,
    context.state.session?.modality,
    route.modality,
    visibleContextComponent
  ])

  useEffect(() => {
    const capabilities = window.sciforge?.capabilities
    if (!capabilities) return undefined

    let active = true
    let subscriptionId: string | null = null
    const offEvent = capabilities.onEvent((payload) => {
      if (!active || payload.subscriptionId !== subscriptionId) return
      if (payload.event.resourceKind !== 'workspace-preview') return
      const resourceRef = context.state.capability?.resourceRef
      if (resourceRef && payload.event.resourceRef !== resourceRef) return
      const sessionId = context.state.session?.id
      if (!sessionId) return
      if (observeTimerRef.current !== null) window.clearTimeout(observeTimerRef.current)
      observeTimerRef.current = window.setTimeout(() => {
        observeTimerRef.current = null
        void context.host.observe(sessionId)
      }, WORKSPACE_PREVIEW_EVENT_REFRESH_DEBOUNCE_MS)
    })

    void capabilities.subscribe(capabilityWorkspaceRoot)
      .then((subscription) => {
        if (!active) {
          void capabilities.unsubscribe(subscription.subscriptionId)
          return
        }
        subscriptionId = subscription.subscriptionId
      })
      .catch(() => undefined)

    return () => {
      active = false
      offEvent()
      if (observeTimerRef.current !== null) {
        window.clearTimeout(observeTimerRef.current)
        observeTimerRef.current = null
      }
      if (subscriptionId) void capabilities.unsubscribe(subscriptionId)
    }
  }, [capabilityWorkspaceRoot, context.host, context.state.capability?.resourceRef, context.state.session?.id])

  return (
    <div
      ref={previewRef}
      className="relative h-full min-h-0 overflow-hidden"
      data-workspace-file-preview-panel-bridge
      data-route={route.kind}
      data-route-reason={route.reason}
      data-asset-status={context.assetStatus}
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover hover:text-ds-text disabled:cursor-not-allowed disabled:opacity-45"
          title="刷新文件预览"
          aria-label="刷新文件预览"
          disabled={!context.state.session || context.refreshing}
          onClick={context.refresh}
        >
          <RefreshCw className={compactClassName('h-4 w-4', context.refreshing ? 'animate-spin' : undefined)} aria-hidden="true" />
        </button>
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

      {integrityNotice ? (
        <WorkspacePreviewIntegrityStatus notice={integrityNotice} />
      ) : null}

      {lastEditSummary ? (
        <WorkspacePreviewEditSummaryStatus summary={lastEditSummary} />
      ) : null}

      <WorkspacePreviewPluginOutlet
        context={context}
        rendererRegistry={workspacePreviewRegistry}
        routeReason={route.reason}
        routePluginId={route.pluginId}
        annotationQuestionBridge={annotationQuestionBridge}
        visualContextComponentId={visibleContextComponent?.id}
        onPresentationStateChange={handlePresentationStateChange}
      />
    </div>
  )
}

export function workspacePreviewVisualContentType(input: Readonly<{
  modality: string
  mimeType?: string
  assetPrimary?: string
  assetStrategies?: readonly Readonly<{ kind: string; status: string }>[]
}>): string {
  if (input.modality === 'deck') return 'slide'
  const mimeType = input.mimeType?.trim().toLowerCase().split(';', 1)[0]
  const hasVisualArtifactTransport = input.assetPrimary === 'tile' || input.assetPrimary === 'thumbnail' ||
    input.assetStrategies?.some((strategy) =>
      (strategy.kind === 'tile' || strategy.kind === 'thumbnail') && strategy.status !== 'deferred')
  if (mimeType?.startsWith('image/') || hasVisualArtifactTransport) return 'image'
  return input.modality
}

function WorkspacePreviewIntegrityStatus({
  notice
}: {
  notice: WorkspacePreviewIntegrityNotice
}): ReactElement {
  const mismatch = notice.kind === 'mismatch'
  return (
    <div
      className={compactClassName(
        'pointer-events-none absolute left-3 top-3 z-10 max-w-[min(28rem,calc(100%-6rem))] rounded-md border px-3 py-2 text-xs font-medium shadow-sm',
        mismatch
          ? 'border-red-300 bg-red-50/95 text-red-800'
          : 'border-emerald-300 bg-emerald-50/95 text-emerald-800'
      )}
      role={mismatch ? 'alert' : 'status'}
      aria-live={mismatch ? 'assertive' : 'polite'}
      data-workspace-preview-integrity-status={notice.kind}
    >
      {notice.message}
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
      className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[min(22rem,calc(100%-1.5rem))] rounded-md border border-ds-border bg-ds-panel/95 px-3 py-2 text-xs shadow-lg"
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
  const leaf = value.split('.').filter(Boolean).at(-1) ?? value
  return leaf
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
