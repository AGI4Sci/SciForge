import { AlertTriangle, CircleDashed, FileText } from 'lucide-react'
import type { ReactElement } from 'react'
import type {
  EvidenceDagCanonicalStatus,
  EvidenceDagPendingUpdate
} from '../contract'

type Translate = (key: string, values?: Record<string, unknown>) => string

export function evidenceDagPendingIsActive(
  pending: EvidenceDagPendingUpdate | null | undefined
): boolean {
  return Boolean(pending && pending.state !== 'failed')
}

export function evidenceDagPollInterval(
  active: boolean,
  pending: EvidenceDagPendingUpdate | null | undefined
): number | null {
  if (!active || !pending) return null
  return pending.state === 'failed' ? 10_000 : 5_000
}

export function EvidenceDagProgressiveView({
  status,
  t
}: {
  status: EvidenceDagCanonicalStatus
  t: Translate
}): ReactElement {
  const pending = status.pending
  const pendingLabel = pending
    ? evidenceDagPendingLabel(pending, t)
    : null
  return (
    <section
      className="shrink-0 border-b border-ds-border-muted bg-ds-sidebar px-3 py-2"
      aria-label={t('evidenceDagCommittedLayer')}
      data-dag-progressive-view="true"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-ds-2xs">
        <span
          className="inline-flex items-center gap-1 rounded-full border border-ds-border bg-ds-main px-2 py-0.5 font-medium text-ds-muted"
          data-dag-layer="committed"
        >
          <FileText className="h-3 w-3" aria-hidden="true" />
          {status.committed
            ? t('evidenceDagCommitted', { version: status.committed.version })
            : t('evidenceDagEmpty')}
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
            {pendingLabel}
          </span>
        ) : null}
      </div>
      {pending && status.committed ? <p className="mt-1.5 text-ds-2xs text-ds-muted">{t('evidenceDagPreviousContentRetained')}</p> : null}
    </section>
  )
}

function evidenceDagPendingLabel(
  pending: EvidenceDagPendingUpdate,
  t: Translate
): string {
  if (pending.state === 'queued') return t('evidenceDagPendingQueued')
  if (pending.state === 'running') {
    return t('evidenceDagPendingRunning', { phase: pending.phase })
  }
  if (pending.state === 'retrying') return t('evidenceDagPendingRetrying')
  return t('evidenceDagPendingFailed')
}
