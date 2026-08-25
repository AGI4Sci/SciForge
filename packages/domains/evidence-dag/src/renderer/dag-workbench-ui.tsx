import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2
} from 'lucide-react'
import type { ReactElement, Ref } from 'react'

export type DagWorkbenchPendingLayer = Readonly<{
  failed: boolean
  label: string
  state: string
}>

export function DagWorkbenchProgressiveLayer({
  ariaLabel,
  auditWarning,
  committedLabel,
  pending
}: Readonly<{
  ariaLabel: string
  auditWarning?: string
  committedLabel: string
  pending?: DagWorkbenchPendingLayer
}>): ReactElement {
  return (
    <section
      className="shrink-0 border-b border-ds-border-muted bg-ds-sidebar px-3 py-2"
      aria-label={ariaLabel}
      data-dag-progressive-view="true"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
        <span
          className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"
          data-dag-layer="committed"
        >
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          {committedLabel}
        </span>
        {pending ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
              pending.failed
                ? 'border-rose-300 bg-rose-50 text-rose-700'
                : 'border-sky-300 bg-sky-50 text-sky-700'
            }`}
            data-dag-layer="staging"
            data-dag-attempt-state={pending.state}
          >
            {pending.failed
              ? <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              : <CircleDashed className="h-3 w-3" aria-hidden="true" />}
            {pending.label}
          </span>
        ) : null}
      </div>
      {pending && auditWarning ? (
        <div className="mt-1.5 text-[10.5px] leading-4 text-amber-800">
          {auditWarning}
        </div>
      ) : null}
    </section>
  )
}

export function DagWorkbenchFrame({
  action,
  emptyIcon,
  emptyLabel,
  frameKey,
  frameRef,
  frameUrl,
  hasView,
  loading,
  loadingLabel,
  sandbox,
  title
}: Readonly<{
  action?: Readonly<{
    disabled?: boolean
    label: string
    onClick: () => void
  }>
  emptyIcon: ReactElement
  emptyLabel: string
  frameKey: string
  frameRef: Ref<HTMLIFrameElement>
  frameUrl?: string
  hasView: boolean
  loading: boolean
  loadingLabel: string
  sandbox: string
  title: string
}>): ReactElement {
  return (
    <div className="min-h-0 flex-1 bg-ds-main" data-dag-workbench-frame="true">
      {loading && !hasView ? (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-ds-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {loadingLabel}
        </div>
      ) : frameUrl && hasView ? (
        <iframe
          ref={frameRef}
          key={frameKey}
          src={frameUrl}
          title={title}
          className="ds-no-drag block h-full w-full border-0 bg-ds-main"
          data-dag-layer="committed"
          sandbox={sandbox}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-ds-muted">
          {emptyIcon}
          <span>{emptyLabel}</span>
          {action ? (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="rounded-lg border border-ds-border bg-ds-surface px-3 py-1.5 text-xs text-ds-ink hover:bg-ds-hover disabled:opacity-50"
            >
              {action.label}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
