import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { MessageSquareText, X } from 'lucide-react'
import type { AnchoredCommentKind, CommentTargetInspection } from './types'

export function CommentEditor({
  target,
  onCancel,
  onSave
}: {
  target: CommentTargetInspection
  onCancel: () => void
  onSave: (comment: string, kind: AnchoredCommentKind) => void
}): ReactElement {
  const [comment, setComment] = useState('')
  const [kind, setKind] = useState<AnchoredCommentKind>('research')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const width = 340
  const preferredLeft = target.bounds.x + target.bounds.width + 12
  const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - width - 12))
  const top = Math.max(12, Math.min(target.bounds.y, window.innerHeight - 330))

  return (
    <aside
      data-sciforge-comments-ui
      className="ds-no-drag fixed z-[1100] w-[340px] rounded-2xl border border-ds-border bg-ds-card p-3.5 text-ds-ink shadow-[0_24px_80px_rgba(2,6,23,0.28)]"
      style={{ left, top }}
      aria-label="New anchored comment"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-500/12 text-indigo-600 dark:text-indigo-300">
          <MessageSquareText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-muted">
            Commenting on
          </p>
          <p className="mt-0.5 truncate text-[13px] font-semibold" title={target.label}>
            {target.label}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg p-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          aria-label="Cancel comment"
          onClick={onCancel}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-ds-main p-1 text-[12px] font-medium">
        <button
          type="button"
          className={`rounded-lg px-2 py-1.5 transition ${
            kind === 'research' ? 'bg-ds-card text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
          }`}
          aria-pressed={kind === 'research'}
          onClick={() => setKind('research')}
        >
          Research content
        </button>
        <button
          type="button"
          className={`rounded-lg px-2 py-1.5 transition ${
            kind === 'product_feedback' ? 'bg-ds-card text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
          }`}
          aria-pressed={kind === 'product_feedback'}
          onClick={() => setKind('product_feedback')}
        >
          SciForge feedback
        </button>
      </div>

      <textarea
        ref={textareaRef}
        className="mt-3 min-h-24 w-full resize-y rounded-xl border border-ds-border bg-ds-main px-3 py-2 text-[13px] leading-5 outline-none transition placeholder:text-ds-muted focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
        value={comment}
        maxLength={4_000}
        placeholder={kind === 'research' ? 'What should the AI understand here?' : 'What is wrong or could be improved?'}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && comment.trim()) {
            onSave(comment, kind)
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[10.5px] text-ds-muted">⌘/Ctrl + Enter to save</span>
        <button
          type="button"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!comment.trim()}
          onClick={() => onSave(comment, kind)}
        >
          Save comment
        </button>
      </div>
    </aside>
  )
}
