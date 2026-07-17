import type { ReactElement, RefObject } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronRight, FileEdit, Hammer, ListTodo, SearchCode, TriangleAlert } from 'lucide-react'
import type { ReviewBlock, ToolBlock } from '../../agent/types'
import { countDiffStats, sumDiffStats } from '../../lib/diff-stats'
import { useDeferredRender } from '../../hooks/use-deferred-render'
import { DiffView } from '../DiffView'
import { formatDuration } from './message-timeline-tools'
import { normalizeAgentRuntimeTurnState } from '@shared/agent-runtime-contract'

/**
 * Inline "Review Plan" card rendered under a turn whose `create_plan`
 * call succeeded. Mirrors the Plan panel actions (open / build) so the
 * user can act on the plan without leaving the conversation.
 */
export function ReviewPlanCard({
  title,
  relativePath,
  busy,
  onOpen,
  onBuild
}: {
  title: string
  relativePath: string
  busy: boolean
  onOpen?: () => void
  onBuild?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      title={relativePath}
      className="flex min-h-[64px] w-full items-center gap-3 rounded-[18px] border border-ds-border-muted bg-white/[0.78] px-4 py-3 shadow-[0_12px_34px_rgba(15,23,42,0.07)] backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.045]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
        <ListTodo className="h-5 w-5" strokeWidth={1.9} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold text-ds-ink">{title}</div>
        <div className="mt-0.5 truncate text-[12.5px] text-ds-muted">{t('reviewPlanCardHint')}</div>
      </div>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover"
        >
          <FileEdit className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('reviewPlanOpen')}
        </button>
      ) : null}
      {onBuild ? (
        <button
          type="button"
          onClick={onBuild}
          disabled={busy}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(0,136,255,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Hammer className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('planBuild')}
        </button>
      ) : null}
    </div>
  )
}

export function ReviewSummaryCard({ review }: { review: ReviewBlock }): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(review.status !== 'success')
  const findings = review.output?.findings ?? []
  const incorrect = review.output?.overallCorrectness === 'patch is incorrect'
  const running = review.status === 'running'
  const failed = review.status === 'error'
  const icon = running ? (
    <SearchCode className="h-5 w-5" strokeWidth={1.9} />
  ) : failed || incorrect ? (
    <TriangleAlert className="h-5 w-5" strokeWidth={1.9} />
  ) : (
    <CheckCircle2 className="h-5 w-5" strokeWidth={1.9} />
  )
  const statusText = running
    ? t('reviewCardRunning')
    : failed
      ? t('reviewCardFailed')
      : findings.length === 0
        ? t('reviewCardNoFindings')
        : t('reviewCardFindings', { count: findings.length })

  return (
    <section className="overflow-hidden rounded-[20px] border border-ds-border bg-ds-card/80 shadow-[0_16px_40px_rgba(86,103,136,0.08)] backdrop-blur-xl">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-ds-hover/40"
      >
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] ${
          failed || incorrect
            ? 'bg-red-500/10 text-red-600 dark:text-red-300'
            : running
              ? 'bg-accent/10 text-accent'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
        }`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ds-ink">
            {review.title}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-ds-muted">
            {statusText}
          </span>
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        )}
      </button>

      {expanded ? (
        <div className="border-t border-ds-border-muted/70 px-5 py-4">
          {review.output?.overallExplanation?.trim() ? (
            <p className="whitespace-pre-wrap text-[14px] leading-6 text-ds-muted">
              {review.output.overallExplanation}
            </p>
          ) : review.reviewText?.trim() ? (
            <p className="whitespace-pre-wrap text-[14px] leading-6 text-ds-muted">
              {review.reviewText}
            </p>
          ) : (
            <p className="text-[14px] leading-6 text-ds-muted">{statusText}</p>
          )}

          {findings.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3">
              {findings.map((finding, index) => (
                <article
                  key={`${finding.title}-${index}`}
                  className="rounded-[12px] border border-ds-border-muted bg-ds-card-muted/45 px-3.5 py-3"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded-md bg-ds-card px-1.5 py-0.5 font-mono text-[11px] text-ds-muted">
                      P{finding.priority}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-[14px] font-semibold text-ds-ink">
                        {finding.title.replace(/^\[P[0-3]\]\s*/i, '')}
                      </div>
                      <div className="mt-1 break-all font-mono text-[11.5px] text-ds-faint">
                        {finding.codeLocation.absoluteFilePath}:{finding.codeLocation.lineRange.start}
                        -{finding.codeLocation.lineRange.end}
                      </div>
                    </div>
                  </div>
                  {finding.body.trim() ? (
                    <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-6 text-ds-muted">
                      {finding.body}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export function TurnChangeSummary({
  changes,
  viewportRef
}: {
  changes: ToolBlock[]
  viewportRef: RefObject<HTMLDivElement | null>
}): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(
    () => changes.find((change) => change.detail?.trim())?.id ?? changes[0]?.id ?? null
  )

  useEffect(() => {
    if (changes.length === 0) {
      setActiveId(null)
      return
    }
    setActiveId((current) => {
      if (current && changes.some((change) => change.id === current)) return current
      return changes.find((change) => change.detail?.trim())?.id ?? changes[0]?.id ?? null
    })
  }, [changes])

  const totals = useMemo(() => sumDiffStats(changes.map((change) => change.detail)), [changes])
  const title = useMemo(
    () =>
      changes.length === 1
        ? t('turnChangeFilesOne')
        : t('turnChangeFilesMany', { count: changes.length }),
    [changes.length, t]
  )
  const { ref: deferredBodyRef, shouldRender: shouldRenderBody } = useDeferredRender<HTMLDivElement>({
    enabled: expanded,
    root: viewportRef
  })

  return (
    <section className="ds-card-strong overflow-hidden rounded-[24px] border border-ds-border shadow-[0_16px_40px_rgba(86,103,136,0.08)]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-ds-hover/40"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-ds-card-muted text-ds-muted">
          <FileEdit className="h-5 w-5" strokeWidth={1.85} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[18px] font-semibold tracking-[-0.02em] text-ds-ink">
            {title}
          </span>
          {totals ? (
            <span className="mt-1 block font-mono text-[12px]">
              <span className="text-ds-diff-added">+{totals.added}</span>
              <span className="mx-1.5 text-ds-faint">·</span>
              <span className="text-ds-diff-removed">-{totals.removed}</span>
            </span>
          ) : null}
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        )}
      </button>

      {expanded ? (
        <div
          ref={deferredBodyRef}
          className="border-t border-ds-border-muted/70"
          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 280px' }}
        >
          {shouldRenderBody
            ? changes.map((change) => {
            const stats = countDiffStats(change.detail)
            const open = activeId === change.id
            const primary = change.filePath ?? t('toolActionFile')

            return (
              <div key={change.id} className="border-b border-ds-border-muted/60 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setActiveId(open ? null : change.id)}
                  aria-expanded={open}
                  className={`flex w-full items-start gap-3 px-5 py-3 text-left transition ${
                    open ? 'bg-ds-hover/45' : 'hover:bg-ds-hover/35'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-all text-[14px] font-medium text-ds-ink">
                      {primary}
                    </span>
                  </span>
                  {stats ? (
                    <span className="shrink-0 font-mono text-[12px] tabular-nums">
                      <span className="text-ds-diff-added">+{stats.added}</span>
                      <span className="ml-1.5 text-ds-diff-removed">-{stats.removed}</span>
                    </span>
                  ) : null}
                  {open ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
                  )}
                </button>

                {open && change.detail ? (
                  <div className="bg-ds-card-muted/45 px-4 pb-4 pt-1">
                    <DiffView
                      patch={change.detail}
                      filePath={change.filePath}
                      maxHeight={440}
                      className="border border-ds-border-muted/70"
                    />
                  </div>
                ) : null}
              </div>
            )
          })
            : null}
        </div>
      ) : null}
    </section>
  )
}

/** Turn-level work-process summary. Details stay collapsed until the user opens them. */
export function WorkMetaRow({
  processing,
  terminalStatus,
  stepCount,
  durationMs,
  liveStartedAtMs,
  reasoningDurationMs,
  expanded,
  onToggle
}: {
  processing: boolean
  terminalStatus?: string
  stepCount: number
  durationMs?: number
  liveStartedAtMs?: number
  reasoningDurationMs?: number
  expanded: boolean
  onToggle: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!processing || typeof liveStartedAtMs !== 'number') return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [liveStartedAtMs, processing])

  const liveDurationMs =
    processing && typeof liveStartedAtMs === 'number'
      ? Math.max(0, now - liveStartedAtMs)
      : undefined
  const effectiveDurationMs = durationMs ?? liveDurationMs
  const terminalState = normalizeAgentRuntimeTurnState(terminalStatus)
  const terminalLabel = terminalState === 'failed'
    ? t('turnFailed')
    : terminalState === 'aborted'
      ? t('turnInterrupted')
      : terminalState === 'cancelled'
        ? t('turnCancelled')
        : t('turnEnded')

  const mainLabel = processing
    ? typeof effectiveDurationMs === 'number'
      ? `${t('processing')} ${formatDuration(effectiveDurationMs)}`
      : t('processing')
    : typeof effectiveDurationMs === 'number'
      ? `${terminalLabel} ${formatDuration(effectiveDurationMs)}`
      : `${terminalLabel} · ${t('processStepCount', { count: stepCount })}`

  const showThoughtSuffix =
    !processing &&
    typeof reasoningDurationMs === 'number' &&
    reasoningDurationMs >= 1000

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="group flex w-fit max-w-full items-center gap-1.5 rounded-md py-1 text-left text-[15px] font-medium text-ds-muted transition hover:opacity-85"
    >
      <span className={`tabular-nums ${processing ? 'ds-shiny-text' : ''}`}>{mainLabel}</span>
      {showThoughtSuffix ? (
        <span className="text-ds-faint">
          · {t('thoughtFor', { duration: formatDuration(reasoningDurationMs!) })}
        </span>
      ) : null}
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-45" strokeWidth={1.8} />
      ) : (
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 opacity-40 transition group-hover:opacity-65"
          strokeWidth={1.8}
        />
      )}
    </button>
  )
}

/**
 * Tiny mono "via <model>" tag rendered above the user message body. Subtle by
 * design — no pill, no ring, just faint monospaced text right-aligned at the
 * top of the bubble. Hidden when there's no model selection to surface.
 */
export function ModelMetaTag({
  label,
  className = ''
}: {
  label?: string
  className?: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (!label) return null
  return (
    <div
      className={`flex min-w-0 text-right ${className}`.trim()}
      title={t('turnModelBadgeTitle', { model: label })}
    >
      <span className="truncate font-mono text-[12px] tracking-tight text-ds-faint/85">
        {label}
      </span>
    </div>
  )
}
