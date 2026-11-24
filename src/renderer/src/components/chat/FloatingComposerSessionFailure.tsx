import type { ReactElement } from 'react'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { canReexecuteSessionInput, type SessionFailureFact } from '../../store/chat-session-admission'

import { errorPresentationIdentity, useErrorPresentationStore } from '../../store/error-presentation-store'

/** A historical failure is an action source, not another queued input. */
export function FloatingComposerSessionFailure({ failure, busy, onReexecute, runtimeId, sessionId }: {
  failure?: SessionFailureFact | null
  busy: boolean
  runtimeId?: string
  sessionId?: string | null
  onReexecute?: (id: string) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const identity = failure ? errorPresentationIdentity(runtimeId ?? '',
    sessionId ?? null, 'session-input', failure.receipt.clientDirectiveId, failure.receipt.turnId, failure.receipt.execution) : ''
  const dismissed = useErrorPresentationStore((state) => state.dismissed[identity] === true)
  if (!failure || dismissed) return null
  const reexecute = canReexecuteSessionInput(failure.receipt)
  return <div data-testid="session-input-failure" role="status"
    className="mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-ds-border bg-ds-card px-3 py-2 text-ds-ink">
    <AlertTriangle className="h-4 w-4 shrink-0 text-ds-muted" aria-hidden="true" />
    <span className="min-w-0 flex-1">{t(reexecute ? 'queuedMessageExecutionFailed' : 'sessionInputStopped')}
      {' '}{t(reexecute ? 'queuedMessageReexecuteDetail' : 'sessionInputStoppedDetail')}</span>
    {reexecute && onReexecute ? <button type="button" data-testid="session-input-reexecute"
      disabled={busy} onClick={() => onReexecute(failure.receipt.clientDirectiveId)}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-ds-ink hover:bg-ds-hover disabled:opacity-50">
      <RotateCcw className="h-4 w-4" aria-hidden="true" />{t('queuedMessageReexecute')}
    </button> : null}
    <button type="button" aria-label={t('close')} title={t('close')} data-testid="session-input-failure-dismiss"
      onClick={() => useErrorPresentationStore.getState().dismiss(identity)}
      className="shrink-0 rounded-md p-1 text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  </div>
}
