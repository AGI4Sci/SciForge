import type { ReactElement } from 'react'
import { useState } from 'react'
import { AlertTriangle, ExternalLink, Github, Image as ImageIcon, X } from 'lucide-react'
import {
  DEFAULT_PRODUCT_FEEDBACK_DISCLOSURE,
  type AnchoredCommentThreadView,
  type ProductFeedbackDisclosure
} from './types'

const OPTIONS: Array<{
  key: keyof ProductFeedbackDisclosure
  title: string
  description: string
  safe: boolean
}> = [
  {
    key: 'annotatedScreenshots',
    title: 'Annotated screenshots',
    description: 'Host-redacted capture of the registered target with its callout.',
    safe: true
  },
  {
    key: 'applicationEnvironment',
    title: 'Application environment',
    description: 'SciForge version, operating system, route, theme and window size.',
    safe: true
  },
  {
    key: 'workspacePaths',
    title: 'Workspace paths',
    description: 'Local project and file-system paths.',
    safe: false
  },
  {
    key: 'fileMetadata',
    title: 'File metadata',
    description: 'Names, sizes and types of files related to the target.',
    safe: false
  }
]

function ScreenshotPreview({ url, label }: { url?: string; label: string }): ReactElement {
  return (
    <div className="relative grid min-h-28 place-items-center overflow-hidden rounded-xl border border-ds-border bg-ds-main">
      {url ? (
        <img src={url} alt={label} className="max-h-44 w-full object-contain" />
      ) : (
        <div className="flex flex-col items-center gap-1.5 px-4 text-center text-ds-muted">
          <ImageIcon className="h-5 w-5" />
          <span className="text-[11px]">{label} will be captured with the comment target marked.</span>
        </div>
      )}
      <span className="absolute left-2 top-2 rounded-md bg-slate-950/75 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
        {label}
      </span>
    </div>
  )
}

export function ProductFeedbackDialog({
  thread,
  onClose,
  onConfirm
}: {
  thread: AnchoredCommentThreadView
  onClose: () => void
  onConfirm: (disclosure: ProductFeedbackDisclosure) => void
}): ReactElement {
  const [disclosure, setDisclosure] = useState<ProductFeedbackDisclosure>({
    ...DEFAULT_PRODUCT_FEEDBACK_DISCLOSURE
  })
  const isSubmitting = thread.feedbackStatus === 'submitting'

  return (
    <div
      data-sciforge-comments-ui
      className="ds-no-drag fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose()
      }}
    >
      <section
        className="flex max-h-[min(820px,94vh)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card text-ds-ink shadow-[0_32px_100px_rgba(0,0,0,0.38)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-feedback-title"
      >
        <header className="flex items-start gap-3 border-b border-ds-border px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-950">
            <Github className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="product-feedback-title" className="text-[16px] font-semibold">
              Submit feedback to GitHub
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-ds-muted" title={thread.target.label}>
              Target: {thread.target.label}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            aria-label="Close feedback dialog"
            disabled={isSubmitting}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          <div className="flex gap-2.5 rounded-xl border border-amber-400/55 bg-amber-400/10 p-3 text-amber-950 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-[12.5px] font-semibold">This feedback will be uploaded publicly.</p>
              <p className="mt-0.5 text-[11.5px] leading-5 opacity-85">
                Review every selected item. Anyone may be able to view the GitHub Issue and its images.
              </p>
            </div>
          </div>

          <p className="mt-4 text-[12px] font-semibold">Screenshot preview</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <ScreenshotPreview url={thread.focusedScreenshotUrl} label="Focused target" />
            {thread.fullScreenshotUrl ? (
              <ScreenshotPreview url={thread.fullScreenshotUrl} label="Full app window" />
            ) : null}
          </div>

          <fieldset className="mt-4">
            <legend className="text-[12px] font-semibold">Choose what to include</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {OPTIONS.map((option) => (
                <label
                  key={option.key}
                  className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-ds-border px-3 py-2.5 transition hover:bg-ds-hover"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-indigo-600"
                    checked={disclosure[option.key]}
                    onChange={(event) => setDisclosure((current) => ({
                      ...current,
                      [option.key]: event.target.checked
                    }))}
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[12px] font-medium">
                      {option.title}
                      {option.safe ? (
                        <span className="rounded bg-emerald-500/12 px-1 py-0.5 text-[9px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
                          default
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] leading-4 text-ds-muted">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4 rounded-xl bg-ds-main px-3 py-2.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ds-muted">Your comment</p>
            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5">{thread.comment}</p>
          </div>
          {thread.error ? (
            <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11.5px] text-red-700 dark:text-red-300">
              {thread.error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-ds-border px-5 py-3.5">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            disabled={isSubmitting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
            disabled={isSubmitting}
            onClick={() => onConfirm(disclosure)}
          >
            {isSubmitting ? 'Submitting…' : 'Submit GitHub Issue'}
            {!isSubmitting ? <ExternalLink className="h-3.5 w-3.5" /> : null}
          </button>
        </footer>
      </section>
    </div>
  )
}
