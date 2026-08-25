import type { ReactElement } from 'react'
import type {
  EvidenceDagCanonicalStatus,
  EvidenceDagPendingUpdate
} from '../contract'
import { DagWorkbenchProgressiveLayer } from './dag-workbench-ui'

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
    <DagWorkbenchProgressiveLayer
      ariaLabel={t('evidenceDagCommittedLayer')}
      committedLabel={status.committed
        ? t('evidenceDagCommitted', { version: status.committed.version })
        : t('evidenceDagCommittedLayer')}
      auditWarning={t('evidenceDagAuditWarning')}
      {...(pending && pendingLabel
        ? {
            pending: {
              failed: pending.state === 'failed',
              label: pendingLabel,
              state: pending.state
            }
          }
        : {})}
    />
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
