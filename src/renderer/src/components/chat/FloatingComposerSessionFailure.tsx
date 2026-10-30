import type { ReactElement } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { canReexecuteSessionInput, type SessionFailureFact } from '../../store/chat-session-admission'

/** A historical failure is an action source, not another queued input. */
export function FloatingComposerSessionFailure({ failure, busy, onReexecute }: {
  failure?: SessionFailureFact | null
  busy: boolean
  onReexecute?: (id: string) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (!failure) return null
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
  </div>
}
