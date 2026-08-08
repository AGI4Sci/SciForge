import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock3, Download, RotateCcw, X } from 'lucide-react'
import type { SciForgeReproSpecV1 } from '@sciforge/domain-sdk/reproducibility'
import type {
  WorkflowNodeRunResultV1,
  WorkflowNodeRunStatus,
  WorkflowNodeV1,
  WorkflowRunV1
} from '../../contract.js'
import type { CreateLoopRuntimeBridge } from '../runtime-bridge.js'

type RunHistoryRuntime = Pick<
  CreateLoopRuntimeBridge,
  'exportWorkflowRerun' | 'rerunWorkflow'
>

function marker(status: WorkflowNodeRunStatus | WorkflowRunV1['status'] | undefined): string {
  if (status === 'running') return 'bg-amber-500'
  if (status === 'success') return 'bg-emerald-500'
  if (status === 'error') return 'bg-red-500'
  if (status === 'skipped') return 'bg-ds-border'
  return 'bg-ds-border/60'
}

function timestamp(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString() : value || '—'
}

function elapsed(startedAt: string, finishedAt: string): string {
  const start = Date.parse(startedAt)
  const finish = Date.parse(finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return ''
  const ms = finish - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function WorkflowRunHistory({
  workspaceRoot,
  workflowId,
  runtime,
  runs,
  nodes,
  onClose
}: {
  workspaceRoot: string
  workflowId: string
  runtime: RunHistoryRuntime
  runs: WorkflowRunV1[]
  nodes: WorkflowNodeV1[]
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const newestFirst = useMemo(() => [...runs].reverse(), [runs])
  const [selectedId, setSelectedId] = useState<string | null>(newestFirst[0]?.id ?? null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportedSpec, setExportedSpec] = useState<SciForgeReproSpecV1 | null>(null)
  const [rerunning, setRerunning] = useState(false)
  const [rerunError, setRerunError] = useState('')
  const selected = newestFirst.find((run) => run.id === selectedId) ?? newestFirst[0] ?? null
  const nodeNames = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.name.trim() || t(`workflowNode_${node.type}`)])),
    [nodes, t]
  )

  useEffect(() => {
    if (selectedId && newestFirst.some((run) => run.id === selectedId)) return
    setSelectedId(newestFirst[0]?.id ?? null)
  }, [newestFirst, selectedId])

  useEffect(() => {
    setExportError('')
    setExportedSpec(null)
    setRerunError('')
  }, [selected?.id])

  const exportSelected = async (): Promise<void> => {
    if (!selected || exporting || rerunning) return
    setExporting(true)
    setExportError('')
    setRerunError('')
    try {
      const spec = await runtime.exportWorkflowRerun(workflowId, selected.id)
      downloadRerunSpec(spec, workflowId, selected.id)
      setExportedSpec(spec)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  const rerunSelected = async (): Promise<void> => {
    if (!selected || exporting || rerunning) return
    setRerunning(true)
    setExportError('')
    setRerunError('')
    try {
      const result = await rerunWorkflowRun(runtime, workflowId, selected.id, onClose)
      if (!result.ok) throw new Error(result.message)
    } catch (error) {
      setRerunError(error instanceof Error ? error.message : String(error))
    } finally {
      setRerunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <section
        className="flex h-[80vh] w-[860px] max-w-full flex-col overflow-hidden rounded-xl border border-ds-border bg-ds-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-ds-border px-5">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <h2 className="text-[14px] font-semibold text-ds-ink">{t('workflowRunHistory')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </header>

        {newestFirst.length === 0 ? (
          <p className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-ds-faint">
            {t('workflowRunHistoryEmpty')}
          </p>
        ) : (
          <div className="flex min-h-0 flex-1">
            <nav className="w-[236px] shrink-0 overflow-y-auto border-r border-ds-border">
              {newestFirst.map((run) => (
                <button
                  type="button"
                  key={run.id}
                  onClick={() => setSelectedId(run.id)}
                  className={`flex w-full flex-col gap-1 border-b border-ds-border/60 px-4 py-3 text-left transition hover:bg-ds-hover ${
                    selected?.id === run.id ? 'bg-ds-hover' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${marker(run.status)}`} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ds-ink">
                      {timestamp(run.startedAt)}
                    </span>
                  </span>
                  <span className="pl-4 text-[11px] text-ds-faint">
                    {run.trigger} · {elapsed(run.startedAt, run.finishedAt) || t(`workflowRunStatus_${run.status}`)}
                  </span>
                </button>
              ))}
            </nav>

            <div className="min-w-0 flex-1 overflow-y-auto p-5">
              {selected ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-ds-muted">
                      <span className={`h-2 w-2 rounded-full ${marker(selected.status)}`} />
                      <span className="font-medium text-ds-ink">{t(`workflowRunStatus_${selected.status}`)}</span>
                      <span className="text-ds-faint">·</span>
                      <span>{timestamp(selected.startedAt)}</span>
                      {elapsed(selected.startedAt, selected.finishedAt) ? (
                        <>
                          <span className="text-ds-faint">·</span>
                          <span>{elapsed(selected.startedAt, selected.finishedAt)}</span>
                        </>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { void exportSelected() }}
                        disabled={exporting || rerunning}
                        title={`${t('workflowExportRerun')} · ${workspaceRoot}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ds-border px-2.5 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
                      >
                        <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
                        {exporting ? t('workflowExportingRerun') : t('workflowExportRerun')}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void rerunSelected() }}
                        disabled={exporting || rerunning}
                        title={`${t('workflowRerunFromSpec')} · ${workspaceRoot}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ds-userbubble px-2.5 text-[11.5px] font-semibold text-ds-userbubbleFg transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                      >
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.9} />
                        {rerunning ? t('workflowRerunningFromSpec') : t('workflowRerunFromSpec')}
                      </button>
                    </div>
                  </div>

                  {exportedSpec ? (
                    <div className="rounded-lg border border-ds-border bg-ds-subtle px-3 py-2 text-[11.5px] leading-5 text-ds-muted">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <span className="font-medium text-ds-ink">
                          {exportedSpec.executionReady
                            ? t('workflowReproSpecReady')
                            : t('workflowReproSpecBlocked')}
                        </span>
                        <span>{t('workflowReproducibility', { status: exportedSpec.reproducibility })}</span>
                        <span>{t('workflowReproBreakpoints', { count: exportedSpec.breakpoints.length })}</span>
                      </div>
                      {exportedSpec.breakpoints.length > 0 ? (
                        <p className="mt-1 break-words font-mono text-[10.5px] text-ds-faint">
                          {exportedSpec.breakpoints.map((point) => point.code).join(', ')}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {selected.manifest?.comparison ? (
                    <div className="rounded-lg border border-ds-border px-3 py-2 text-[11.5px] text-ds-muted">
                      <p>
                        {t('workflowReproComparison', {
                          status: selected.manifest.comparison.replicationStatus,
                          classification: selected.manifest.comparison.classification
                        })}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selected.manifest.comparison.reasonCodes.map((reason) => (
                          <span
                            key={reason}
                            className="rounded bg-ds-subtle px-1.5 py-0.5 font-mono text-[10px] text-ds-faint"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                      {selected.manifest.comparison.differences.length > 0 ? (
                        <div className="mt-2 divide-y divide-ds-border/60 border-t border-ds-border/60">
                          {selected.manifest.comparison.differences.map((difference, index) => (
                            <div
                              key={`${difference.component}:${difference.nodeId ?? ''}:${difference.reasonCode}:${index}`}
                              className="grid grid-cols-[minmax(90px,0.4fr)_minmax(0,1fr)] gap-x-2 py-1.5 font-mono text-[10px]"
                            >
                              <span className="text-ds-muted">
                                {difference.component}{difference.nodeId ? ` · ${difference.nodeId}` : ''}
                              </span>
                              <span className="min-w-0 break-all text-ds-faint">
                                {difference.reasonCode}
                                {difference.baselineFingerprint || difference.candidateFingerprint
                                  ? ` · ${shortFingerprint(difference.baselineFingerprint)} → ${shortFingerprint(difference.candidateFingerprint)}`
                                  : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {exportError ? (
                    <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[11.5px] text-red-600">
                      {t('workflowExportRerunError', { message: exportError })}
                    </p>
                  ) : null}

                  {rerunError ? (
                    <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[11.5px] text-red-600">
                      {t('workflowRerunFromSpecError', { message: rerunError })}
                    </p>
                  ) : null}

                  {selected.message ? (
                    <p className="rounded-lg bg-ds-subtle px-3 py-2 text-[12px] leading-5 text-ds-muted">
                      {selected.message}
                    </p>
                  ) : null}

                  {selected.nodeResults.map((result) => (
                    <HistoryResult
                      key={result.nodeId}
                      result={result}
                      name={nodeNames.get(result.nodeId) ?? result.nodeId}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export function rerunSpecFileName(workflowId: string, runId: string): string {
  const safe = (value: string, fallback: string) =>
    value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || fallback
  return `${safe(workflowId, 'workflow')}-${safe(runId, 'run')}.sciforge-rerun.json`
}

export async function rerunWorkflowRun(
  runtime: RunHistoryRuntime,
  workflowId: string,
  runId: string,
  onRerunStarted: () => void
): ReturnType<CreateLoopRuntimeBridge['rerunWorkflow']> {
  const spec = await runtime.exportWorkflowRerun(workflowId, runId)
  const result = await runtime.rerunWorkflow(spec)
  if (result.ok) onRerunStarted()
  return result
}

function downloadRerunSpec(spec: SciForgeReproSpecV1, workflowId: string, runId: string): void {
  const blob = new Blob([`${JSON.stringify(spec, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = rerunSpecFileName(workflowId, runId)
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function shortFingerprint(value: string | undefined): string {
  if (!value) return '∅'
  return value.length > 22 ? `${value.slice(0, 18)}…` : value
}

function HistoryResult({ result, name }: { result: WorkflowNodeRunResultV1; name: string }): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(result.status === 'error')
  const took = elapsed(result.startedAt, result.finishedAt)
  const retries = result.retries ?? 0

  return (
    <article className="rounded-lg border border-ds-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${marker(result.status)}`} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ds-ink">{name}</span>
        {retries > 0 ? (
          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700">
            {t('workflowRetriesBadge', { n: retries })}
          </span>
        ) : null}
        {took ? <span className="shrink-0 text-[11px] text-ds-faint">{took}</span> : null}
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-ds-border px-3 py-2.5">
          {result.error ? <Block label={t('workflowResultError')} value={result.error} error /> : null}
          {result.message ? <Block label={t('workflowResultMessage')} value={result.message} /> : null}
          {result.inputJson ? <Block label={t('workflowResultInput')} value={result.inputJson} mono /> : null}
          {result.outputJson ? <Block label={t('workflowResultOutput')} value={result.outputJson} mono /> : null}
          {result.threadId ? <Block label={t('workflowResultThread')} value={result.threadId} mono /> : null}
        </div>
      ) : null}
    </article>
  )
}

function Block({
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
        className={`max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md px-2.5 py-1.5 text-[11px] leading-5 ${
          error ? 'bg-red-500/10 text-red-600' : 'bg-ds-subtle text-ds-muted'
        } ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </pre>
    </div>
  )
}
