import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { WorkspacePreviewAssetTransportDescriptor } from '@shared/workspace-preview'
import {
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

export type WorkspacePreviewPanelShellContext = {
  state: Readonly<WorkspacePreviewHostState>
  asset: WorkspacePreviewAssetTransportDescriptor | null
  assetStatus: 'idle' | 'loading' | 'ready' | 'error'
  assetError: string | null
  transport: WorkspacePreviewAssetTransportClient
  host: WorkspacePreviewHost
}

export type WorkspacePreviewPanelShellProps = {
  target: WorkspaceFileTarget | null
  workspaceRoot: string
  host?: WorkspacePreviewHost
  initialState?: WorkspacePreviewHostState
  className?: string
  children?: ReactNode | ((context: WorkspacePreviewPanelShellContext) => ReactNode)
  onAction?: (action: WorkspacePreviewToolbarAction, context: WorkspacePreviewPanelShellContext) => void
}

export function workspacePreviewPanelTargetKey(
  target: WorkspaceFileTarget | null,
  workspaceRoot: string
): string {
  if (!target) return ''
  return [
    target.workspaceRoot?.trim() || workspaceRoot,
    target.path,
    target.line ?? '',
    target.column ?? ''
  ].join('\u0000')
}

export function workspacePreviewOpenInputForPanelTarget(
  target: WorkspaceFileTarget,
  workspaceRoot: string
): { path: string; workspaceRoot: string } {
  return {
    path: target.path,
    workspaceRoot: target.workspaceRoot?.trim() || workspaceRoot
  }
}

export function WorkspacePreviewPanelShell({
  target,
  workspaceRoot,
  host: providedHost,
  initialState,
  className,
  children,
  onAction
}: WorkspacePreviewPanelShellProps): ReactElement {
  const [host] = useState(() => providedHost ?? createWorkspacePreviewHost())
  const [state, setState] = useState<WorkspacePreviewHostState>(
    () => initialState ?? createWorkspacePreviewHostState()
  )
  const [assetStatus, setAssetStatus] = useState<WorkspacePreviewPanelShellContext['assetStatus']>('idle')
  const [assetError, setAssetError] = useState<string | null>(null)
  const targetKey = workspacePreviewPanelTargetKey(target, workspaceRoot)

  useEffect(() => host.subscribe((nextState) => setState({ ...nextState })), [host])

  useEffect(() => {
    if (!target) {
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
    const releaseOpenedSession = (): void => {
      if (!openedSessionId || released) return
      released = true
      void host.releaseSession(openedSessionId)
    }
    setState((previous) => ({
      ...previous,
      asset: null
    }))
    setAssetStatus('loading')
    setAssetError(null)

    void host.open(workspacePreviewOpenInputForPanelTarget(target, workspaceRoot))
      .then(async (opened) => {
        if (opened.ok) openedSessionId = opened.session.id
        if (cancelled || !opened.ok) {
          if (opened.ok) releaseOpenedSession()
          if (!opened.ok) {
            setAssetStatus('error')
            setAssetError(opened.message)
          }
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
      releaseOpenedSession()
    }
  }, [host, target, targetKey, workspaceRoot])

  const context = useMemo<WorkspacePreviewPanelShellContext>(() => ({
    state,
    asset: state.asset,
    assetStatus,
    assetError,
    transport: createWorkspacePreviewAssetTransportClient({
      descriptor: state.asset,
      readRange: (range) => host.readRange(range),
      prepareArtifact: (request) => host.prepareArtifact(request),
      readArtifactRange: (request) => host.readArtifactRange(request)
    }),
    host
  }), [assetError, assetStatus, host, state])

  return (
    <WorkspacePreviewChrome
      input={{
        state,
        requestedPath: target?.path
      }}
      className={className}
      onAction={(action) => {
        if (onAction) {
          onAction(action, context)
          return
        }

        void runWorkspacePreviewToolbarAction(action, context)
      }}
    >
      <div
        data-workspace-preview-panel-shell
        data-asset-status={assetStatus}
        data-asset-primary={state.asset?.primary}
      >
        {typeof children === 'function' ? children(context) : children}
      </div>
    </WorkspacePreviewChrome>
  )
}
