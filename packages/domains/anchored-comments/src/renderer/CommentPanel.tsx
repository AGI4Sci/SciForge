import type { ReactElement } from 'react'
import { Check, CheckCircle2, Github, MessageSquareText, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { useAnchoredCommentStore } from './anchored-comment-store'
import type { AnchoredCommentThreadView } from './types'

function statusLabel(thread: AnchoredCommentThreadView): string {
  if (thread.githubIssue) return `GitHub #${thread.githubIssue.number}`
  if (thread.feedbackStatus === 'submitting') return 'Submitting feedback…'
  if (thread.feedbackStatus === 'failed') return 'Feedback failed'
  return thread.status.replaceAll('_', ' ')
}

export function CommentPanel(): ReactElement {
  const threads = useAnchoredCommentStore((state) => state.threads)
  const selected = useAnchoredCommentStore((state) => state.selectedForConversation)
  const setPanelOpen = useAnchoredCommentStore((state) => state.setPanelOpen)
  const toggleSelection = useAnchoredCommentStore((state) => state.toggleConversationSelection)
  const addSelected = useAnchoredCommentStore((state) => state.addSelectedToConversation)
  const resolveThread = useAnchoredCommentStore((state) => state.resolveThread)
  const reopenThread = useAnchoredCommentStore((state) => state.reopenThread)
  const removeThread = useAnchoredCommentStore((state) => state.removeThread)
  const openProductFeedback = useAnchoredCommentStore((state) => state.openProductFeedback)

  return (
    <aside
      data-sciforge-comments-ui
      className="ds-no-drag fixed bottom-20 right-4 z-[1005] flex max-h-[min(680px,calc(100vh-7rem))] w-[370px] flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card text-ds-ink shadow-[0_24px_80px_rgba(2,6,23,0.26)]"
      aria-label="Anchored comments"
    >
      <header className="flex items-center gap-2 border-b border-ds-border px-4 py-3">
        <MessageSquareText className="h-4 w-4 text-indigo-500" />
        <h2 className="flex-1 text-[13px] font-semibold">Comments</h2>
        <span className="rounded-full bg-ds-main px-2 py-0.5 text-[10px] font-semibold text-ds-muted">
          {threads.length}
        </span>
        <button
          type="button"
          className="rounded-lg p-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          aria-label="Close comments"
          onClick={() => setPanelOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {threads.length === 0 ? (
          <div className="grid min-h-40 place-items-center px-8 text-center">
            <div>
              <MessageSquareText className="mx-auto h-6 w-6 text-ds-muted" />
              <p className="mt-2 text-[12px] font-medium">No comments yet</p>
              <p className="mt-1 text-[10.5px] leading-4 text-ds-muted">
                Turn on comment mode, then select research content or any SciForge UI element.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {threads.map((thread) => {
              const isSelected = selected.includes(thread.id)
              const isResolved = thread.status === 'resolved'
              return (
                <li
                  key={thread.id}
                  className={`rounded-xl border p-3 transition ${
                    isSelected ? 'border-indigo-400 bg-indigo-500/7' : 'border-ds-border bg-ds-main/40'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <button
                      type="button"
                      className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded border transition ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-ds-border bg-ds-card text-transparent hover:border-indigo-400'
                      }`}
                      aria-label={`${isSelected ? 'Remove' : 'Select'} comment for conversation`}
                      aria-pressed={isSelected}
                      onClick={() => toggleSelection(thread.id)}
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11.5px] font-semibold" title={thread.target.label}>
                          {thread.target.label}
                        </span>
                        <span className={`shrink-0 rounded px-1 py-0.5 text-[8.5px] font-semibold uppercase ${
                          thread.kind === 'product_feedback'
                            ? 'bg-slate-500/12 text-slate-600 dark:text-slate-300'
                            : 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-300'
                        }`}>
                          {thread.kind === 'product_feedback' ? 'feedback' : 'research'}
                        </span>
                      </div>
                      <p className={`mt-1 whitespace-pre-wrap text-[11.5px] leading-[18px] ${
                        isResolved ? 'text-ds-muted line-through' : 'text-ds-ink'
                      }`}>
                        {thread.comment}
                      </p>
                      <p className="mt-1.5 text-[9.5px] capitalize text-ds-muted">{statusLabel(thread)}</p>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                    {thread.kind === 'product_feedback' && thread.feedbackStatus !== 'submitted' ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                        onClick={() => openProductFeedback(thread.id)}
                      >
                        <Github className="h-3 w-3" />
                        {thread.feedbackStatus === 'failed' ? 'Retry feedback' : 'Submit feedback'}
                      </button>
                    ) : null}
                    {isResolved ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                        onClick={() => reopenThread(thread.id)}
                      >
                        <RotateCcw className="h-3 w-3" /> Reopen
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                        onClick={() => resolveThread(thread.id)}
                      >
                        <CheckCircle2 className="h-3 w-3" /> Resolve
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-md p-1 text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                      aria-label="Delete comment"
                      onClick={() => removeThread(thread.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <footer className="border-t border-ds-border p-3">
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[11.5px] font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={selected.length === 0}
          onClick={() => {
            addSelected()
            setPanelOpen(false)
          }}
        >
          <Send className="h-3.5 w-3.5" />
          Attach {selected.length || ''} {selected.length === 1 ? 'comment' : 'comments'} to the next message
        </button>
      </footer>
    </aside>
  )
}
