import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { WorkspacePreviewOpenInput } from '@shared/sciforge-api'
import type { WorkspacePreviewAssetTransportDescriptor } from '@shared/workspace-preview'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  createWorkspacePreviewHost,
  createWorkspacePreviewAssetTransportClient,
  createWorkspacePreviewHostState,
  type WorkspacePreviewAssetTransportClient,
  type WorkspacePreviewHost,
  type WorkspacePreviewHostState
} from './host'
import {
  WorkspacePreviewChrome
} from './WorkspacePreviewChrome'
import { runWorkspacePreviewToolbarAction } from './action-runner'
import type { WorkspacePreviewToolbarAction } from './chrome-model'
import {
  type RendererWorkspacePreviewRegistry
} from './registry'

export const WORKSPACE_PREVIEW_SESSION_RELEASE_GRACE_MS = 10_000

export type WorkspacePreviewPanelShellContext = {
  state: Readonly<WorkspacePreviewHostState>
  asset: WorkspacePreviewAssetTransportDescriptor | null
  assetStatus: 'idle' | 'loading' | 'ready' | 'error'
  assetError: string | null
  transport: WorkspacePreviewAssetTransportClient
  host: WorkspacePreviewHost
  openFile?: (target: WorkspaceFileTarget) => void
  refresh: () => void
  toggleInspector?: () => void
  refreshing: boolean
}

export type WorkspacePreviewPanelShellProps = {
  target: WorkspaceFileTarget | null
  workspaceRoot: string
  workspaceLocator?: WorkspaceLocator
  host?: WorkspacePreviewHost
  registry: RendererWorkspacePreviewRegistry
  initialState?: WorkspacePreviewHostState
  className?: string
  children?: ReactNode | ((context: WorkspacePreviewPanelShellContext) => ReactNode)
  onAction?: (action: WorkspacePreviewToolbarAction, context: WorkspacePreviewPanelShellContext) => void
  onOpenFile?: (target: WorkspaceFileTarget) => void
}

export function workspacePreviewPanelTargetKey(
  target: WorkspaceFileTarget | null,
  workspaceRoot: string,
  workspaceLocator?: WorkspaceLocator
): string {
  if (!target) return ''
  const parts: Array<string | number> = [
    target.workspaceRoot?.trim() || workspaceRoot,
    target.path,
    target.line ?? '',
    target.column ?? ''
  ]
  if (target.selection) parts.push(JSON.stringify(target.selection))
  if (target.anchor) parts.push(JSON.stringify(target.anchor))
  if (target.integrity) parts.push(JSON.stringify(target.integrity))
  if (workspaceLocator) parts.push(JSON.stringify(workspaceLocator))
  return parts.join('\u0000')
}

export function workspacePreviewOpenInputForPanelTarget(
  target: WorkspaceFileTarget,
  workspaceRoot: string,
  workspaceLocator?: WorkspaceLocator
): WorkspacePreviewOpenInput {
  return {
    path: target.path,
    workspaceRoot: target.workspaceRoot?.trim() || workspaceRoot,
    ...(workspaceLocator ? { workspaceLocator } : {}),
    ...(target.line != null ? { line: target.line } : {}),
    ...(target.column != null ? { column: target.column } : {}),
    ...(target.selection ? { selection: target.selection } : {}),
    ...(target.anchor ? { anchor: target.anchor } : {}),
    ...(target.integrity ? { integrity: target.integrity } : {})
  }
}

export function WorkspacePreviewPanelShell({
  target,
  workspaceRoot,
  workspaceLocator,
  host: providedHost,
  registry: providedRegistry,
  initialState,
  className,
  children,
  onAction,
  onOpenFile
}: WorkspacePreviewPanelShellProps): ReactElement {
  const [registry] = useState(() => providedRegistry)
  const [host] = useState(() => providedHost ?? createWorkspacePreviewHost({ registry }))
  const [state, setState] = useState<WorkspacePreviewHostState>(
    () => initialState ?? createWorkspacePreviewHostState()
  )
  const [assetStatus, setAssetStatus] = useState<WorkspacePreviewPanelShellContext['assetStatus']>('idle')
  const [assetError, setAssetError] = useState<string | null>(null)
  const [showInspector, setShowInspector] = useState(false)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const targetPath = target?.path
  const targetWorkspaceRoot = target?.workspaceRoot
  const targetLine = target?.line
  const targetColumn = target?.column
  const targetSelection = target?.selection
  const targetAnchor = target?.anchor
  const targetIntegrity = target?.integrity
  const openInput = useMemo(() => (
    targetPath
      ? workspacePreviewOpenInputForPanelTarget({
          path: targetPath,
          workspaceRoot: targetWorkspaceRoot,
          line: targetLine,
          column: targetColumn,
          selection: targetSelection,
          anchor: targetAnchor,
          integrity: targetIntegrity
        }, workspaceRoot, workspaceLocator)
      : null
  ), [
    targetAnchor,
    targetColumn,
    targetIntegrity,
    targetLine,
    targetPath,
    targetSelection,
    targetWorkspaceRoot,
    workspaceLocator,
    workspaceRoot
  ])
  const openInputKey = openInput
    ? workspacePreviewPanelTargetKey(openInput, workspaceRoot, workspaceLocator)
    : ''
  const stableTarget = useMemo<WorkspaceFileTarget | null>(() => (
    targetPath
      ? {
          path: targetPath,
          workspaceRoot: targetWorkspaceRoot?.trim() || workspaceRoot,
          line: targetLine,
          column: targetColumn,
          selection: targetSelection,
          anchor: targetAnchor,
          integrity: targetIntegrity
        }
      : null
  ), [
    targetAnchor,
    targetColumn,
    targetIntegrity,
    targetLine,
    targetPath,
    targetSelection,
    targetWorkspaceRoot,
    workspaceRoot
  ])
  const targetKey = workspacePreviewPanelTargetKey(
    stableTarget,
    workspaceRoot,
    workspaceLocator
  )

  useEffect(() => host.subscribe((nextState) => setState({ ...nextState })), [host])

  useEffect(() => {
    if (!openInput) {
      host.cancelPendingOpen()
      const sessionId = host.getState().session?.id
      if (sessionId) void host.releaseSession(sessionId)
      setState(createWorkspacePreviewHostState())
      setAssetStatus('idle')
      setAssetError(null)
      return
    }

    let cancelled = false
    let openedSessionId: string | null = null
    let released = false
    let releaseTimer: ReturnType<typeof setTimeout> | null = null
    const releaseOpenedSession = (delayMs = 0): void => {
      if (!openedSessionId || released) return
      released = true
      const sessionId = openedSessionId
      const release = (): void => {
        releaseTimer = null
        void host.releaseSession(sessionId)
      }
      if (delayMs > 0) {
        releaseTimer = setTimeout(release, delayMs)
        return
      }
      release()
    }
    setState((previous) => ({
      ...previous,
      asset: null
    }))
    setAssetStatus('loading')
    setAssetError(null)

    void host.open(openInput)
      .then(async (opened) => {
        if (opened.ok) openedSessionId = opened.session.id
        if (cancelled) {
          if (opened.ok) releaseOpenedSession()
          return
        }
        if (!opened.ok) {
          setAssetStatus('error')
          setAssetError(opened.message)
          return
        }

        const [observed, described] = await Promise.all([
          host.observe(opened.session.id),
          host.describeAsset(opened.session.id)
        ])
        if (cancelled) {
          releaseOpenedSession()
          return
        }
        if (!observed.ok) {
          setAssetStatus('error')
          setAssetError(observed.message)
          return
        }
        if (!described.ok) {
          setAssetStatus('error')
          setAssetError(described.message)
          return
        }
        const currentState = host.getState()
        if (currentState.session?.id !== opened.session.id) {
          return
        }

        setState({ ...currentState })
        setAssetStatus('ready')
        setAssetError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setAssetStatus('error')
        setAssetError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
      host.cancelPendingOpen()
      if (releaseTimer) clearTimeout(releaseTimer)
      releaseOpenedSession(WORKSPACE_PREVIEW_SESSION_RELEASE_GRACE_MS)
    }
  }, [host, openInput, openInputKey, refreshRevision])

  const refresh = useCallback((): void => {
    if (!openInput) return
    setRefreshRevision((revision) => revision + 1)
  }, [openInput])
  const toggleInspector = useCallback((): void => {
    setShowInspector((current) => !current)
  }, [])

  const context = useMemo<WorkspacePreviewPanelShellContext>(() => ({
    state,
    asset: state.asset,
    assetStatus,
    assetError,
    transport: createWorkspacePreviewAssetTransportClient({
      descriptor: state.asset,
      sourceUrl: state.asset ? host.assetSourceUrl(state.asset.sessionId) : null,
      readRange: (range) => host.readRange(range),
      prepareArtifact: (request) => host.prepareArtifact(request),
      readArtifactRange: (request) => host.readArtifactRange(request)
    }),
    host,
    openFile: onOpenFile,
    refresh,
    toggleInspector,
    refreshing: assetStatus === 'loading'
  }), [assetError, assetStatus, host, onOpenFile, refresh, state, toggleInspector])

  return (
    <WorkspacePreviewChrome
      input={{
        state,
        requestedPath: target?.path,
        registry
      }}
      className={className}
      showInspector={showInspector}
      onAction={(action) => {
        if (onAction) {
          onAction(action, context)
          return
        }

        void runWorkspacePreviewToolbarAction(action, context)
      }}
    >
      <div
        className="h-full min-h-0 overflow-hidden"
        data-workspace-preview-panel-shell
        data-asset-status={assetStatus}
        data-asset-primary={state.asset?.primary}
        data-inspector-open={showInspector ? 'true' : 'false'}
      >
        {typeof children === 'function' ? children(context) : children}
      </div>
    </WorkspacePreviewChrome>
  )
}
