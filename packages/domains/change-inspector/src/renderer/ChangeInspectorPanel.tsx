import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { AlertCircle, FileEdit, PanelRightClose, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  DomainCapabilityResourceHandle,
  DomainRendererWorkbenchSession
} from '@sciforge/domain-sdk/renderer-contributions'
import {
  CHANGE_INSPECTOR_RESOURCE_KIND,
  type ChangeInspectorChange,
  type ChangeInspectorSnapshot
} from '../contract.js'
import type {
  ChangeInspectorCapabilityClient
} from './change-inspector-capability-client.js'
import { countDiffStats, extractDiffFilePath, formatFilePath } from './diff-utils.js'
import { UnifiedDiffView } from './UnifiedDiffView.js'

type StatusFilter = 'all' | ChangeInspectorChange['status']

export function ChangeInspectorPanel({
  active,
  className = '',
  client,
  onCollapse,
  session
}: {
  active: boolean
  className?: string
  client: ChangeInspectorCapabilityClient
  onCollapse: () => void
  session: DomainRendererWorkbenchSession
}): ReactElement {
  const { t } = useTranslation('common')
  const [snapshot, setSnapshot] = useState<ChangeInspectorSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let resource: DomainCapabilityResourceHandle | null =
      session.resources?.find((candidate) =>
        candidate.kind === CHANGE_INSPECTOR_RESOURCE_KIND
      )?.resource ?? null
    let resourceRef: string | null = null
    let refreshing = false
    let subscriptionFailed = false
    let unsubscribe: (() => void) | null = null

    const refresh = async (): Promise<void> => {
      if (disposed || !resource || refreshing) return
      refreshing = true
      try {
        const observation = await client.observe(resource, session.workspaceRoot)
        if (disposed) return
        resource = observation.resource
        resourceRef = observation.resourceRef
        setSnapshot(observation.state)
        if (!subscriptionFailed) setError(null)
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        refreshing = false
      }
    }

    void (async () => {
      try {
        if (!resource) {
          if (!session.runtimeId) {
            throw new Error('The active session has no runtime identity.')
          }
          resource = await client.openSession({
            sessionId: session.id,
            runtimeId: session.runtimeId
          }, session.workspaceRoot)
        }
        if (disposed || !resource) return
        await refresh()
        if (disposed || !resourceRef) return
        if (client.subscribe) {
          try {
            unsubscribe = await client.subscribe(
              resourceRef,
              () => void refresh(),
              session.workspaceRoot
            )
          } catch (cause) {
            subscriptionFailed = true
            throw cause
          }
        }
        if (disposed) {
          unsubscribe?.()
          unsubscribe = null
        }
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }
    })()

    // Resource events are the primary invalidation path. Polling is retained
    // as a bounded recovery path for runtimes that materialize external writes
    // before their capability notification reaches the renderer.
    const timer = window.setInterval(
      () => void refresh(),
      active ? 1_250 : 5_000
    )
    return () => {
      disposed = true
      window.clearInterval(timer)
      unsubscribe?.()
    }
  }, [
    active,
    client,
    session.id,
    session.resources,
    session.runtimeId,
    session.workspaceRoot
  ])

  return (
    <ChangeInspectorView
      className={className}
      error={error}
      onCollapse={onCollapse}
      snapshot={snapshot}
      workspaceRoot={session.workspaceRoot ?? ''}
      t={t}
    />
  )
}

export function ChangeInspectorView({
  className = '',
  error,
  onCollapse,
  snapshot,
  workspaceRoot,
  t
}: {
  className?: string
  error: string | null
  onCollapse: () => void
  snapshot: ChangeInspectorSnapshot | null
  workspaceRoot: string
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const changes = snapshot?.changes ?? []
  const visibleChanges = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return changes.filter((change) => {
      if (statusFilter !== 'all' && change.status !== statusFilter) return false
      if (!needle) return true
      const path = formatFilePath(
        extractDiffFilePath(change.patch, change.filePath),
        workspaceRoot
      )
      return path?.toLocaleLowerCase().includes(needle) ?? false
    })
  }, [changes, query, statusFilter, workspaceRoot])
  const activeChange =
    visibleChanges.find((change) => change.id === selectedId) ??
    visibleChanges[visibleChanges.length - 1]

  useEffect(() => {
    if (!selectedId || visibleChanges.some((change) => change.id === selectedId)) return
    setSelectedId(visibleChanges[visibleChanges.length - 1]?.id ?? null)
  }, [selectedId, visibleChanges])

  return (
    <aside
      className={`ds-no-drag ds-panel-ghost flex flex-col border-l border-ds-border-muted backdrop-blur-xl ${className}`}
      data-change-inspector
    >
      <div className="flex min-h-[58px] shrink-0 items-center gap-3 border-b border-ds-border-muted px-3 py-3">
        <button
          type="button"
          onClick={onCollapse}
          className="ds-sidebar-toggle-button shrink-0"
          aria-label={t('changeInspectorCollapse')}
          title={t('changeInspectorCollapse')}
        >
          <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-wide text-ds-muted">
            {t('changeInspectorTitle')}
          </div>
          <div className="mt-1 truncate text-[11px] text-ds-faint">
            {changes.length > 0
              ? t('changeInspectorSummary', { count: changes.length })
              : t('changeInspectorEmpty')}
          </div>
        </div>
      </div>

      {changes.length > 0 ? (
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-ds-border-muted p-2.5">
          <label className="relative min-w-0">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t('changeInspectorFilterPlaceholder')}
              className="h-8 w-full rounded-md border border-ds-border-muted bg-ds-surface pl-8 pr-2 text-[11px] text-ds-ink outline-none placeholder:text-ds-faint focus:border-ds-border"
            />
          </label>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.currentTarget.value as StatusFilter)}
            className="h-8 rounded-md border border-ds-border-muted bg-ds-surface px-2 text-[11px] text-ds-muted outline-none"
          >
            <option value="all">{t('changeInspectorFilterAll')}</option>
            <option value="success">{t('changeInspectorFilterSuccess')}</option>
            <option value="running">{t('changeInspectorFilterRunning')}</option>
            <option value="error">{t('changeInspectorFilterError')}</option>
          </select>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {error && !snapshot ? (
          <EmptyState
            icon={<AlertCircle className="h-7 w-7 text-red-600" strokeWidth={1.25} />}
            title={t('changeInspectorLoadFailed')}
            detail={error}
          />
        ) : changes.length === 0 ? (
          <EmptyState
            icon={<FileEdit className="h-7 w-7 text-ds-faint" strokeWidth={1.25} />}
            title={t('changeInspectorEmptyTitle')}
            detail={t('changeInspectorEmpty')}
          />
        ) : visibleChanges.length === 0 ? (
          <EmptyState
            icon={<Search className="h-7 w-7 text-ds-faint" strokeWidth={1.25} />}
            title={t('changeInspectorNoMatches')}
          />
        ) : (
          <>
            <div className="max-h-[42%] min-h-0 overflow-y-auto py-2">
              <ul className="divide-y divide-ds-border-muted/60">
                {visibleChanges.map((change) => {
                  const stats = countDiffStats(change.patch)
                  const displayPath = formatFilePath(
                    extractDiffFilePath(change.patch, change.filePath),
                    workspaceRoot
                  )
                  return (
                    <li key={change.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(change.id)}
                        className={`flex w-full items-start gap-2 px-4 py-2.5 text-left transition ${
                          activeChange?.id === change.id
                            ? 'bg-ds-hover text-ds-ink'
                            : 'text-ds-ink hover:bg-ds-hover/70'
                        }`}
                      >
                        <FileEdit
                          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                            change.status === 'error' ? 'text-red-700' : 'text-ds-muted'
                          }`}
                          strokeWidth={1.75}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] text-ds-ink">
                            {displayPath ?? t('changeInspectorUnknownFile')}
                          </div>
                          <div className="mt-0.5 flex gap-2 text-[10px] font-mono">
                            <span className="text-ds-diff-added">+{stats.added}</span>
                            <span className="text-ds-diff-removed">-{stats.removed}</span>
                          </div>
                        </div>
                        {change.status === 'running' ? (
                          <span className="rounded-full bg-amber-200/40 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-700/30 dark:text-amber-100">
                            {t('changeInspectorStatusRunning')}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
            <div className="ds-panel-strip flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-ds-border-muted">
              {activeChange ? (
                <UnifiedDiffView
                  patch={activeChange.patch}
                  filePath={activeChange.filePath}
                  className="h-full min-w-0 rounded-none border-0"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-ds-muted">
                  {t('changeInspectorSelectHint')}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {snapshot?.truncated ? (
        <div className="shrink-0 border-t border-ds-border-muted px-3 py-2 text-[10px] text-ds-faint">
          {t('changeInspectorTruncated')}
        </div>
      ) : null}
      {error && snapshot ? (
        <div className="shrink-0 border-t border-amber-300/40 px-3 py-2 text-[10px] text-amber-800 dark:text-amber-200">
          {error}
        </div>
      ) : null}
    </aside>
  )
}

function EmptyState({
  detail,
  icon,
  title
}: {
  detail?: string
  icon: ReactElement
  title: string
}): ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
      <div>
        <div className="flex justify-center">{icon}</div>
        <div className="mt-3 text-[12px] font-medium text-ds-muted">{title}</div>
        {detail ? (
          <div className="mt-1 max-w-[26rem] text-[11px] leading-6 text-ds-faint">{detail}</div>
        ) : null}
      </div>
    </div>
  )
}
