import { type KeyboardEvent, type ReactElement, useState } from 'react'
import { Check, Clock3, CornerUpRight, Pencil, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type QueuedComposerMessage = {
  id: string
  text: string
  displayText?: string
}

type Props = {
  messages: QueuedComposerMessage[]
  onRemove: (id: string) => void
  onEdit?: (id: string, text: string) => void
  onSteer?: (id: string) => void
}

export function FloatingComposerQueuedMessages({ messages, onRemove, onEdit, onSteer }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  if (messages.length === 0) return null

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
      <div className="mt-2 space-y-2">
        {messages.map((message, index) => (
          <div
            key={message.id}
            className="flex min-w-0 max-w-full items-start gap-2 rounded-2xl border border-ds-border-muted bg-ds-main/80 px-3 py-2 text-[13px] text-ds-ink"
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
              <span className="max-h-32 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words leading-5">
                {message.displayText ?? message.text}
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
            {onEdit && editingId !== message.id ? (
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
            {onSteer ? (
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
        ))}
      </div>
    </div>
  )
}
