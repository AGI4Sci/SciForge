import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2 } from 'lucide-react'
import type { WorkflowNodeRunResultV1, WorkflowNodeRunStatus, WorkflowNodeV1 } from '../../contract.js'

function tone(status: WorkflowNodeRunStatus | undefined): string {
  if (status === 'running') return 'bg-amber-500'
  if (status === 'success') return 'bg-emerald-500'
  if (status === 'error') return 'bg-red-500'
  if (status === 'skipped') return 'bg-ds-border'
  return 'bg-ds-border/60'
}

function duration(startedAt: string, finishedAt: string): string {
  const start = Date.parse(startedAt)
  const finish = Date.parse(finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return ''
  const ms = finish - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function orderResults(
  nodes: WorkflowNodeV1[],
  results: Record<string, WorkflowNodeRunResultV1>
): WorkflowNodeRunResultV1[] {
  const graphOrder = new Map(nodes.map((node, index) => [node.id, index]))
  return Object.values(results).sort((left, right) => {
    if (left.startedAt && right.startedAt && left.startedAt !== right.startedAt) {
      return left.startedAt < right.startedAt ? -1 : 1
    }
    return (graphOrder.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER) -
      (graphOrder.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER)
  })
}

export function WorkflowRunLogPanel({
  nodes,
  results,
  running,
  hideHeader = false
}: {
  nodes: WorkflowNodeV1[]
  results: Record<string, WorkflowNodeRunResultV1>
  running: boolean
  hideHeader?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const names = useMemo(() => new Map(nodes.map((node) => [node.id, node.name.trim() || t(`workflowNode_${node.type}`)])), [nodes, t])
  const ordered = useMemo(() => orderResults(nodes, results), [nodes, results])

  return (
    <section className="flex h-full min-h-0 flex-col">
      {hideHeader ? null : (
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-ds-border px-4">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={2} /> : null}
          <h2 className="text-[13px] font-semibold text-ds-ink">{t('workflowRunLog')}</h2>
          {ordered.length > 0 ? <span className="text-[11px] text-ds-faint">{ordered.length}</span> : null}
        </header>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {ordered.length === 0 ? (
          <p className="px-3 py-8 text-center text-[12.5px] leading-5 text-ds-faint">{t('workflowRunLogEmpty')}</p>
        ) : (
          ordered.map((result) => (
            <LogItem key={result.nodeId} result={result} name={names.get(result.nodeId) ?? result.nodeId} />
          ))
        )}
      </div>
    </section>
  )
}

function LogItem({ result, name }: { result: WorkflowNodeRunResultV1; name: string }): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(result.status === 'running' || result.status === 'error')
  const elapsed = duration(result.startedAt, result.finishedAt)
  const retries = result.retries ?? 0

  return (
    <article className={`rounded-lg border ${result.status === 'error' ? 'border-red-500/40' : 'border-ds-border'}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition ${open ? 'rotate-90' : ''}`} strokeWidth={2} />
        {result.status === 'running' ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-500" strokeWidth={2.2} />
        ) : (
          <span className={`h-2 w-2 shrink-0 rounded-full ${tone(result.status)}`} />
        )}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ds-ink">{name}</span>
        {retries > 0 ? (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            {t('workflowRetriesBadge', { n: retries })}
          </span>
        ) : null}
        {elapsed ? <span className="shrink-0 text-[10.5px] text-ds-faint">{elapsed}</span> : null}
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-ds-border px-3 py-2.5">
          {result.error ? <ValueBlock label={t('workflowResultError')} value={result.error} error /> : null}
          {result.message ? <ValueBlock label={t('workflowResultMessage')} value={result.message} /> : null}
          <ValueBlock label={t('workflowResultInput')} value={result.inputJson || '—'} mono />
          {result.status === 'running' ? (
            <p className="text-[11px] italic text-ds-faint">{t('workflowRunLogWaiting')}</p>
          ) : (
            <ValueBlock label={t('workflowResultOutput')} value={result.outputJson || '—'} mono />
          )}
          {result.threadId ? <ValueBlock label={t('workflowResultThread')} value={result.threadId} mono /> : null}
        </div>
      ) : null}
    </article>
  )
}

function ValueBlock({
  label,
  value,
  mono,
  error
}: {
  label: string
  value: string
  mono?: boolean
  error?: boolean
}): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase text-ds-faint">{label}</span>
      <pre
        className={`max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md px-2.5 py-1.5 text-[11px] leading-5 ${
          error ? 'bg-red-500/10 text-red-600' : 'bg-ds-subtle text-ds-muted'
        } ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </pre>
    </div>
  )
}
