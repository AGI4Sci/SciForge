import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react'
import type { ReactElement } from 'react'
import type { ProjectDagPendingStatus, ProjectDagStatus } from '../contract'

type Translate = (key: string, values?: Record<string, unknown>) => string

export function projectDagPendingIsActive(
  pending: ProjectDagPendingStatus | null | undefined
): boolean {
  return Boolean(pending && pending.state !== 'failed')
}

export function projectDagPollInterval(
  active: boolean,
  pending: ProjectDagPendingStatus | null | undefined
): number | null {
  if (!active || !pending) return null
  return pending.state === 'failed' ? 10_000 : 2_000
}

export function ProjectDagProgressiveView({
  status,
  t
}: {
  status: ProjectDagStatus
  t: Translate
}): ReactElement {
  const pending = status.pending
  return (
    <section
      className="shrink-0 border-b border-ds-border-muted bg-ds-sidebar px-3 py-2"
      aria-label={t('projectDagCommittedLayer')}
      data-dag-progressive-view="true"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
        <span
          className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"
          data-dag-layer="committed"
        >
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          {status.committed
            ? t('projectDagCommitted', { version: status.committed.version })
            : t('projectDagCommittedLayer')}
        </span>
        {pending ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
              pending.state === 'failed'
                ? 'border-rose-300 bg-rose-50 text-rose-700'
                : 'border-sky-300 bg-sky-50 text-sky-700'
            }`}
            data-dag-layer="staging"
            data-dag-attempt-state={pending.state}
          >
            {pending.state === 'failed'
              ? <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              : <CircleDashed className="h-3 w-3" aria-hidden="true" />}
            {projectDagPendingLabel(pending, t)}
          </span>
        ) : null}
      </div>
      {pending ? (
        <div className="mt-1.5 text-[10.5px] leading-4 text-amber-800">
          {t('projectDagAuditWarning')}
        </div>
      ) : null}
    </section>
  )
}

function projectDagPendingLabel(
  pending: ProjectDagPendingStatus,
  t: Translate
): string {
  if (pending.state === 'queued') return t('projectDagPendingQueued')
  if (pending.state === 'running') return t('projectDagPendingRunning')
  if (pending.state === 'retry_scheduled') return t('projectDagPendingRetry')
  return t('projectDagPendingFailed')
}
