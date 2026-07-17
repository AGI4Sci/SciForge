import type { ReactElement } from 'react'
import { MessageSquarePlus, MessagesSquare, X } from 'lucide-react'
import { useAnchoredCommentStore } from './anchored-comment-store'

const buttonClassName = (active: boolean): string =>
  `relative rounded-full border px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${
    active
      ? 'border-ds-border-strong bg-white/70 text-ds-ink dark:bg-white/10'
      : 'border-transparent bg-white/38 text-ds-faint opacity-90 hover:border-ds-border-muted hover:bg-white/55 hover:text-ds-ink hover:opacity-100 dark:bg-white/4 dark:hover:bg-white/8'
  }`

export function AnchoredCommentsTopBarActions(): ReactElement {
  const commentMode = useAnchoredCommentStore((state) => state.commentMode)
  const toggleCommentMode = useAnchoredCommentStore((state) => state.toggleCommentMode)
  const panelOpen = useAnchoredCommentStore((state) => state.panelOpen)
  const setPanelOpen = useAnchoredCommentStore((state) => state.setPanelOpen)
  const threadCount = useAnchoredCommentStore((state) => state.threads.length)

  return (
    <AnchoredCommentsTopBarActionsView
      commentMode={commentMode}
      panelOpen={panelOpen}
      threadCount={threadCount}
      onToggleCommentMode={toggleCommentMode}
      onTogglePanel={() => setPanelOpen(!panelOpen)}
    />
  )
}

export function AnchoredCommentsTopBarActionsView({
  commentMode,
  panelOpen,
  threadCount,
  onToggleCommentMode,
  onTogglePanel
}: {
  commentMode: boolean
  panelOpen: boolean
  threadCount: number
  onToggleCommentMode: () => void
  onTogglePanel: () => void
}): ReactElement {
  return (
    <>
      <button
        type="button"
        data-sciforge-comment-mode-toggle
        className={buttonClassName(commentMode)}
        aria-label={commentMode ? 'Exit comment mode' : 'Comment on anything'}
        aria-pressed={commentMode}
        title={commentMode ? 'Exit comment mode' : 'Comment on anything'}
        onClick={onToggleCommentMode}
      >
        {commentMode
          ? <X className="h-4 w-4" strokeWidth={1.75} />
          : <MessageSquarePlus className="h-4 w-4" strokeWidth={1.75} />}
      </button>
      {threadCount > 0 ? (
        <button
          type="button"
          data-sciforge-comments-panel-toggle
          className={buttonClassName(panelOpen)}
          aria-label="Open comments"
          aria-expanded={panelOpen}
          title="Open comments"
          onClick={onTogglePanel}
        >
          <MessagesSquare className="h-4 w-4" strokeWidth={1.75} />
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-indigo-600 px-1 text-center text-[9px] font-bold leading-4 text-white">
            {Math.min(threadCount, 99)}
          </span>
        </button>
      ) : null}
    </>
  )
}
