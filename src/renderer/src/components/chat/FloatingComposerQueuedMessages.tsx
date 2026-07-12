import { type KeyboardEvent, type ReactElement, useState } from 'react'
import { AlertTriangle, Check, Clock3, CornerUpRight, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type QueuedComposerMessage = {
  id: string
  text: string
  displayText?: string
  sendFailure?: { message: string }
  restoredAttachmentWarning?: string
  deliveryAttempt?: { restored?: boolean }
}

type Props = {
  messages: QueuedComposerMessage[]
  persistenceDegraded?: boolean
  onRemove: (id: string) => void
  onEdit?: (id: string, text: string) => void
  onSteer?: (id: string) => void
  onRetry?: (id: string) => void
}

export function FloatingComposerQueuedMessages({
  messages,
  persistenceDegraded = false,
  onRemove,
  onEdit,
  onSteer,
  onRetry
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  if (messages.length === 0 && !persistenceDegraded) return null

  if (messages.length === 0) {
    return (
      <div className="mb-2 flex items-start gap-1.5 rounded-2xl border border-amber-400/50 bg-amber-50/90 px-3 py-2 text-[12px] leading-4 text-amber-700 shadow-sm dark:bg-amber-950/30 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{t('queuedMessagesPersistenceDegraded')}</span>
      </div>
    )
  }

  const finishEditing = (id: string): void => {
    const nextText = draft.trim()
    if (!nextText) return
    onEdit?.(id, nextText)
    setEditingId(null)
    setDraft('')
  }

  const cancelEditing = (): void => {
    setEditingId(null)
    setDraft('')
  }

  const handleEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, id: string): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditing()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      finishEditing(id)
    }
  }

  return (
    <div className="mb-2 rounded-[22px] border border-ds-border bg-ds-card/88 px-4 py-3 shadow-sm backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-[13px] font-medium text-ds-ink">
          <Clock3 className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
          <span>{t('queuedMessagesTitle', { count: messages.length })}</span>
        </div>
        <div className="text-[12px] text-ds-muted">{t('queuedMessagesHint')}</div>
      </div>
      {persistenceDegraded ? (
        <div className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 px-2.5 py-2 text-[12px] leading-4 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('queuedMessagesPersistenceDegraded')}</span>
        </div>
      ) : null}
      <div className="mt-2 space-y-2">
        {messages.map((message, index) => {
          const uncertainDelivery = message.deliveryAttempt?.restored === true
          const failureMessage = message.sendFailure?.message ?? message.restoredAttachmentWarning ??
            (uncertainDelivery ? t('queuedMessageDeliveryUncertainDetail') : undefined)
          const failureLabel = message.sendFailure
            ? t('queuedMessageSendFailed')
            : message.restoredAttachmentWarning
              ? t('queuedMessageAttachmentConfirmation')
              : t('queuedMessageDeliveryUncertain')
          return (
            <div
              key={message.id}
              className={`flex min-w-0 max-w-full items-start gap-2 rounded-2xl border px-3 py-2 text-[13px] text-ds-ink ${failureMessage ? 'border-amber-400/50 bg-amber-50/80 dark:bg-amber-950/20' : 'border-ds-border-muted bg-ds-main/80'}`}
            >
            <span className="mt-1 shrink-0 text-ds-faint">{index + 1}.</span>
            {editingId === message.id ? (
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => handleEditKeyDown(event, message.id)}
                rows={3}
                autoFocus
                className="min-w-0 flex-1 resize-y rounded-xl border border-ds-border bg-ds-card px-2.5 py-1.5 leading-5 text-ds-ink outline-none focus:border-accent"
                aria-label={t('queuedMessageEditInput')}
              />
            ) : (
              <span className="min-w-0 flex-1">
                <span className="block max-h-32 overflow-y-auto whitespace-pre-wrap break-words leading-5">
                  {message.displayText ?? message.text}
                </span>
                {failureMessage ? (
                  <span className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-4 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span><strong>{failureLabel}</strong> {failureMessage}</span>
                  </span>
                ) : null}
              </span>
            )}
            {editingId === message.id ? (
              <>
                <button
                  type="button"
                  onClick={() => finishEditing(message.id)}
                  disabled={!draft.trim()}
                  className="mt-0.5 shrink-0 rounded-full p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={t('queuedMessageSaveEdit')}
                  title={t('queuedMessageSaveEdit')}
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={cancelEditing}
                  className="mt-0.5 shrink-0 rounded-full p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={t('queuedMessageCancelEdit')}
                  title={t('queuedMessageCancelEdit')}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </>
            ) : null}
            {onEdit && !message.sendFailure && !message.deliveryAttempt && editingId !== message.id ? (
              <button
                type="button"
                onClick={() => {
                  setEditingId(message.id)
                  setDraft(message.displayText ?? message.text)
                }}
                className="mt-0.5 shrink-0 rounded-full p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                aria-label={t('queuedMessageEdit')}
                title={t('queuedMessageEdit')}
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            ) : null}
            {failureMessage && onRetry ? (
              <button
                type="button"
                onClick={() => onRetry(message.id)}
                className="mt-0.5 shrink-0 rounded-full p-1 text-amber-700 transition hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30"
                aria-label={t('queuedMessageRetry')}
                title={t('queuedMessageRetry')}
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            ) : null}
            {onSteer && !failureMessage ? (
              <button
                type="button"
                onClick={() => onSteer(message.id)}
                className="mt-0.5 shrink-0 rounded-full p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                aria-label={t('queuedMessageSteer')}
                title={t('queuedMessageSteer')}
              >
                <CornerUpRight className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(message.id)}
              className="mt-0.5 shrink-0 rounded-full p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('queuedMessageRemove')}
              title={t('queuedMessageRemove')}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
