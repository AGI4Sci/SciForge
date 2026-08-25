import type { ReactElement } from 'react'
import { DagWorkbenchProgressiveLayer } from '@sciforge/domain-evidence-dag/renderer'
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
    <DagWorkbenchProgressiveLayer
      ariaLabel={t('projectDagCommittedLayer')}
      committedLabel={status.committed
        ? t('projectDagCommitted', { version: status.committed.version })
        : t('projectDagCommittedLayer')}
      auditWarning={t('projectDagAuditWarning')}
      {...(pending
        ? {
            pending: {
              failed: pending.state === 'failed',
              label: projectDagPendingLabel(pending, t),
              state: pending.state
            }
          }
        : {})}
    />
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
