import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Network, RotateCw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { rendererRemoteWorkspaceClient } from '../../remote-workspace/client'
import {
  safeRemoteWorkspaceSummary
} from '../../remote-workspace/display'
import type {
  RemoteWorkspaceClient,
  RemoteWorkspaceViewPhase,
  RemoteWorkspaceViewSnapshot,
  RemoteWorkspaceViewSummary
} from '../../remote-workspace/types'
import type { WorkspaceHostLifecycleMode } from '@sciforge/domain-sdk/workspace-host'
import { useChatStore } from '../../store/chat-store'

type Translator = (key: string, options?: Record<string, unknown>) => string

const ACTIVE_PHASES = new Set<RemoteWorkspaceViewPhase>([
  'reconnecting'
])

function lifecycleLabel(
  mode: WorkspaceHostLifecycleMode | undefined,
  t: Translator
): string {
  if (!mode) return ''
  return mode === 'persistent-daemon'
    ? t('remoteWorkspaceLifecyclePersistent')
    : t('remoteWorkspaceLifecycleConnection')
}

function phaseLabel(
  workspace: RemoteWorkspaceViewSummary,
  t: Translator
): string {
  const labels: Record<RemoteWorkspaceViewPhase, string> = {
    ready: t('remoteWorkspaceStatusReady'),
    reconnecting: t('remoteWorkspaceStatusReconnecting'),
    offline: t('remoteWorkspaceStatusOffline'),
    degraded: t('remoteWorkspaceStatusDegraded'),
    error: t('remoteWorkspaceStatusError')
  }
  if (workspace.phase !== 'reconnecting' || !workspace.reconnectAttempt) {
    return labels[workspace.phase]
  }
  return t('remoteWorkspaceStatusReconnectingAttempt', {
    attempt: workspace.reconnectAttempt
  })
}

function phaseClassName(phase: RemoteWorkspaceViewPhase): string {
  if (phase === 'ready') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }
  if (ACTIVE_PHASES.has(phase)) {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200'
  }
  if (phase === 'error' || phase === 'offline') {
    return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300'
  }
  return 'border-ds-border-muted bg-ds-subtle text-ds-faint'
}

function connectionAction(
  phase: RemoteWorkspaceViewPhase
): 'reconnect' | null {
  if (phase === 'offline' || phase === 'error' || phase === 'degraded') return 'reconnect'
  return null
}

export function RemoteWorkspaceSelectorView({
  workspaces,
  selectedWorkspaceHostId,
  onWorkspaceChange,
  onReconnect,
  actionBusy = false,
  className = ''
}: {
  workspaces: readonly RemoteWorkspaceViewSummary[]
  selectedWorkspaceHostId: string | null
  onWorkspaceChange: (workspaceHostId: string | null) => void
  onReconnect?: (workspaceHostId: string) => void
  actionBusy?: boolean
  className?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const safeWorkspaces = useMemo(
    () => workspaces.map((workspace, index) => safeRemoteWorkspaceSummary(
      workspace,
      t('remoteWorkspaceDefaultLabel', { index: index + 1 }),
      t('remoteWorkspacePathUnavailable')
    )),
    [t, workspaces]
  )
  const selectedIndex = safeWorkspaces.findIndex(
    (workspace) => workspace.workspaceHostId === selectedWorkspaceHostId
  )
  const selectedWorkspace = selectedIndex >= 0 ? safeWorkspaces[selectedIndex] : null
  const selectedValue = selectedIndex >= 0 ? `workspace-${selectedIndex}` : ''
  const selectedEgressRoute = selectedWorkspace?.egressRoutes.find(
    (route) => route.id === selectedWorkspace?.selectedEgressRouteId
  ) ?? null
  const action = selectedWorkspace ? connectionAction(selectedWorkspace.phase) : null
  const status = selectedWorkspace ? phaseLabel(selectedWorkspace, t) : ''
  const lifecycle = selectedWorkspace
    ? lifecycleLabel(selectedWorkspace.lifecycleMode, t)
    : ''
  const statusTitle = selectedWorkspace
    ? [status, selectedWorkspace.statusDetail, lifecycle].filter(Boolean).join(' · ')
    : ''

  return (
    <div className={`inline-flex min-w-0 flex-wrap items-center justify-end gap-1.5 ${className}`}>
      <Server className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
      <select
        aria-label={t('remoteWorkspaceSelectorLabel')}
        title={t('remoteWorkspaceSelectorLabel')}
        className="min-h-8 max-w-[245px] rounded-lg border border-ds-border-muted bg-ds-card px-2 py-1 text-[12px] font-medium text-ds-muted outline-none transition hover:bg-ds-hover focus:border-accent/45 focus:ring-1 focus:ring-accent/20"
        value={selectedValue}
        onChange={(event) => {
          if (!event.target.value) {
            onWorkspaceChange(null)
            return
          }
          const index = Number(event.target.value.replace('workspace-', ''))
          onWorkspaceChange(safeWorkspaces[index]?.workspaceHostId ?? null)
        }}
      >
        <option value="">{t('remoteWorkspaceLocal')}</option>
        {safeWorkspaces.map((workspace, index) => (
          <option key={workspace.workspaceHostId} value={`workspace-${index}`}>
            {workspace.displayLabel} · {workspace.workspacePathLabel}
          </option>
        ))}
      </select>
      {selectedWorkspace ? (
        <>
          <span
            className={`inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold ${phaseClassName(selectedWorkspace.phase)}`}
            title={statusTitle}
            aria-label={t('remoteWorkspaceConnectionStatusLabel', { status })}
          >
            {ACTIVE_PHASES.has(selectedWorkspace.phase) ? (
              <RotateCw className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
            ) : null}
            {status}
          </span>
          {lifecycle ? (
            <span
              className="hidden shrink-0 rounded-md border border-ds-border-muted bg-ds-subtle px-1.5 py-0.5 text-[10.5px] font-medium text-ds-faint lg:inline-flex"
              title={lifecycle}
            >
              {lifecycle}
            </span>
          ) : null}
          {selectedEgressRoute ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Network className="h-3.5 w-3.5 shrink-0 text-ds-faint" aria-hidden="true" />
              <span
                aria-label={t('remoteWorkspaceEgressLabel')}
                title={t('remoteWorkspaceEgressDescription')}
                className="inline-flex min-h-8 max-w-[180px] items-center truncate rounded-lg border border-ds-border-muted bg-ds-card px-2 py-1 text-[11.5px] font-medium text-ds-muted"
              >
                {selectedEgressRoute.displayLabel}
              </span>
            </span>
          ) : null}
          {action ? (
            <button
              type="button"
              className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-card px-2 text-[11.5px] font-semibold text-ds-muted transition hover:bg-ds-hover disabled:cursor-wait disabled:opacity-60"
              disabled={actionBusy || !onReconnect}
              onClick={() => onReconnect?.(selectedWorkspace.workspaceHostId)}
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('remoteWorkspaceReconnect')}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export function RemoteWorkspaceSelector({
  client = rendererRemoteWorkspaceClient,
  className = ''
}: {
  client?: RemoteWorkspaceClient
  className?: string
}): ReactElement {
  const [snapshot, setSnapshot] = useState<RemoteWorkspaceViewSnapshot | null>(null)
  const [attachedSessions, setAttachedSessions] = useState<RemoteWorkspaceViewSummary[]>([])
  const [actionBusy, setActionBusy] = useState(false)
  const setWorkspaceLocator = useChatStore((state) => state.setWorkspaceLocator)

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    const [hosts, nextSnapshot] = await Promise.all([
      client.list(),
      client.get()
    ])
    setAttachedSessions([...hosts])
    setSnapshot(nextSnapshot)
  }, [client])

  useEffect(() => {
    let cancelled = false
    void Promise.all([client.list(), client.get()])
      .then(([hosts, nextSnapshot]) => {
        if (!cancelled) {
          setAttachedSessions([...hosts])
          setSnapshot(nextSnapshot)
        }
      })
      .catch(() => undefined)
    const unsubscribe = client.onSnapshotChanged((next) => {
      if (!cancelled) setSnapshot(next)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [client])

  const bridgeSupported = client.supported !== false
  const workspaces = useMemo(() => {
    const byId = new Map(
      attachedSessions.map((workspace) => [workspace.workspaceHostId, workspace])
    )
    for (const workspace of snapshot?.workspaces ?? []) {
      byId.set(workspace.workspaceHostId, workspace)
    }
    return [...byId.values()]
  }, [attachedSessions, snapshot?.workspaces])
  const attachedLocator = useMemo(
    () => workspaces.find(
      (workspace) => workspace.workspaceHostId === snapshot?.activeWorkspaceHostId
    )?.locator ?? null,
    [snapshot?.activeWorkspaceHostId, workspaces]
  )

  useEffect(() => {
    setWorkspaceLocator(attachedLocator)
  }, [attachedLocator, setWorkspaceLocator])

  const runAction = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setActionBusy(true)
    try {
      await action()
    } catch {
      // The canonical connection state and sanitized error detail come from the
      // workspace-host snapshot rather than raw transport exceptions.
    } finally {
      await refreshSnapshot().catch(() => undefined)
      setActionBusy(false)
    }
  }, [refreshSnapshot])

  return (
    <RemoteWorkspaceSelectorView
      workspaces={bridgeSupported ? workspaces : []}
      selectedWorkspaceHostId={snapshot?.activeWorkspaceHostId ?? null}
      onWorkspaceChange={(workspaceHostId) => {
        if (!bridgeSupported) return
        setWorkspaceLocator(null)
        const workspace = workspaces.find(
          (candidate) => candidate.workspaceHostId === workspaceHostId
        )
        void runAction(() => client.select({
          sessionId: workspace?.locator.hostSessionId ?? null
        }).then(() => undefined))
      }}
      onReconnect={bridgeSupported
        ? (workspaceHostId) => {
            const workspace = workspaces.find(
              (candidate) => candidate.workspaceHostId === workspaceHostId
            )
            if (!workspace) return
            void runAction(() => client.reconnect({
              sessionId: workspace.locator.hostSessionId
            }).then(() => undefined))
          }
        : undefined}
      actionBusy={actionBusy}
      className={className}
    />
  )
}
