import {
  AlertTriangle,
  FileText,
  Loader2,
  PanelRightClose,
  RefreshCw,
  RotateCcw
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GitCheckpoint,
  GitCheckpointPreview
} from '../contract'
import type {
  GitCheckpointsCapabilityClient
} from './git-checkpoints-capability-client'

export type GitCheckpointsPanelProps = Readonly<{
  client: GitCheckpointsCapabilityClient
  sessionId: string
  runtimeId?: string
  workspaceRoot: string
  className?: string
  onCollapse: () => void
}>

export function GitCheckpointsPanel({
  client,
  sessionId,
  runtimeId,
  workspaceRoot,
  className = '',
  onCollapse
}: GitCheckpointsPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const [checkpoints, setCheckpoints] = useState<readonly GitCheckpoint[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<GitCheckpointPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [notice, setNotice] = useState<Readonly<{
    tone: 'error' | 'success'
    message: string
  }> | null>(null)

  const selected = useMemo(
    () => checkpoints.find((checkpoint) => checkpoint.checkpointId === selectedId) ?? null,
    [checkpoints, selectedId]
  )

  const load = useCallback(async () => {
    if (!sessionId || !workspaceRoot.trim()) {
      setCheckpoints([])
      setSelectedId(null)
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      const result = await client.list({
        ...(runtimeId ? { runtimeId } : {}),
        threadId: sessionId,
        workspaceRoot
      })
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.message })
        return
      }
      setCheckpoints(result.value)
      setSelectedId((current) =>
        current && result.value.some((checkpoint) => checkpoint.checkpointId === current)
          ? current
          : result.value[0]?.checkpointId ?? null
      )
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [client, runtimeId, sessionId, workspaceRoot])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedId) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    setNotice(null)
    void client.preview(selectedId, workspaceRoot)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setPreview(null)
          setNotice({ tone: 'error', message: result.message })
          return
        }
        setPreview(result.value)
      })
      .catch((error) => {
        if (!cancelled) setNotice({ tone: 'error', message: errorMessage(error) })
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client, selectedId, workspaceRoot])

  const restore = async () => {
    if (!selected) return
    const confirmed = window.confirm(t('gitCheckpointsRestoreConfirm'))
    if (!confirmed) return
    setRestoring(true)
    setNotice(null)
    try {
      const result = await client.restore(
        { checkpointId: selected.checkpointId },
        workspaceRoot,
        { approval: { mode: 'confirmation' } }
      )
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.message })
        return
      }
      setNotice({
        tone: 'success',
        message: t('gitCheckpointsRestored', {
          id: result.value.rescueCheckpointId
        })
      })
      await load()
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setRestoring(false)
    }
  }

  const canLoad = Boolean(sessionId && workspaceRoot.trim())
  return (
    <aside className={`flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
            <RotateCcw className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <span>{t('gitCheckpointsTitle')}</span>
          </div>
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">{sessionId}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || !canLoad}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            aria-label={t('gitCheckpointsRefresh')}
            title={t('gitCheckpointsRefresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('gitCheckpointsCollapse')}
            title={t('gitCheckpointsCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {notice ? (
          <div className={`rounded-lg border px-3 py-2 text-[12px] ${
            notice.tone === 'success'
              ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
              : 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
          }`}>
            {notice.message}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-ds-muted">
            {t('gitCheckpointsCount', { count: checkpoints.length })}
          </span>
        </div>

        {!canLoad ? (
          <EmptyState text={t('gitCheckpointsNoSession')} />
        ) : loading ? (
          <LoadingState text={t('gitCheckpointsLoading')} />
        ) : checkpoints.length === 0 ? (
          <EmptyState text={t('gitCheckpointsEmpty')} />
        ) : (
          <div className="grid gap-2">
            {checkpoints.map((checkpoint) => (
              <button
                key={checkpoint.checkpointId}
                type="button"
                onClick={() => setSelectedId(checkpoint.checkpointId)}
                className={`min-w-0 rounded-lg border px-3 py-2 text-left transition ${
                  checkpoint.checkpointId === selectedId
                    ? 'border-ds-border-strong bg-ds-card text-ds-ink'
                    : 'border-ds-border-muted bg-ds-main/45 text-ds-muted hover:border-ds-border hover:bg-ds-hover'
                }`}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-semibold">
                    {checkpoint.turnId ?? checkpoint.phase}
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${statusTone(checkpoint.status)}`}>
                    {checkpoint.status}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ds-faint">
                  <span>{checkpoint.phase}</span>
                  <span>{checkpoint.provider}</span>
                  <span>{formatTime(checkpoint.createdAt)}</span>
                </div>
                {checkpoint.changeSummary ? (
                  <pre className="mt-2 max-h-12 overflow-hidden whitespace-pre-wrap font-mono text-[10.5px] leading-4 text-ds-faint">
                    {checkpoint.changeSummary}
                  </pre>
                ) : null}
              </button>
            ))}
          </div>
        )}

        {selected ? (
          <section className="flex shrink-0 flex-col gap-2 border-t border-ds-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-ds-ink">
                <FileText className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
                <span className="truncate">{t('gitCheckpointsPreview')}</span>
              </div>
              <button
                type="button"
                onClick={() => void restore()}
                disabled={restoring}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-amber-800 transition hover:bg-amber-500/15 disabled:opacity-50 dark:text-amber-200"
              >
                {restoring
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <RotateCcw className="h-3.5 w-3.5" />}
                {t('gitCheckpointsRestore')}
              </button>
            </div>

            {previewLoading ? (
              <LoadingState text={t('gitCheckpointsLoading')} />
            ) : preview?.patch ? (
              <div className="grid gap-2">
                {preview.truncated ? (
                  <div className="flex gap-2 rounded-lg border border-amber-300/60 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{t('gitCheckpointsPreviewTruncated')}</span>
                  </div>
                ) : null}
                <PatchBlock title={t('gitCheckpointsPatch')} text={preview.patch} />
              </div>
            ) : (
              <EmptyState text={t('gitCheckpointsPreviewEmpty')} />
            )}
          </section>
        ) : null}
      </div>
    </aside>
  )
}

function EmptyState({ text }: { text: string }): ReactElement {
  return (
    <div className="rounded-lg border border-ds-border-muted bg-ds-card px-3 py-3 text-[13px] text-ds-faint">
      {text}
    </div>
  )
}

function LoadingState({ text }: { text: string }): ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-card px-3 py-3 text-[13px] text-ds-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
    </div>
  )
}

function PatchBlock({ title, text }: { title: string; text: string }): ReactElement {
  return (
    <div className="rounded-lg border border-ds-border-muted bg-ds-card px-3 py-2">
      <div className="text-[11.5px] font-semibold text-ds-muted">{title}</div>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-ds-faint">
        {text}
      </pre>
    </div>
  )
}

function formatTime(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString() : value
}

function statusTone(status: GitCheckpoint['status']): string {
  if (status === 'available') {
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  }
  if (status === 'restored') {
    return 'border-blue-400/30 bg-blue-500/10 text-blue-700 dark:text-blue-200'
  }
  if (status === 'blocked') {
    return 'border-amber-300/60 bg-amber-500/10 text-amber-800 dark:text-amber-200'
  }
  return 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
