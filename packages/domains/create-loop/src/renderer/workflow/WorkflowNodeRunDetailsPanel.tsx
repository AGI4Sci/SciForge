import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileOutput,
  Loader2,
  Play,
  SkipForward
} from 'lucide-react'

import type {
  WorkflowNodeRunResultV1,
  WorkflowNodeRunStatus,
  WorkflowNodeV1
} from '../../contract.js'

type UpstreamNode = Readonly<{
  id: string
  name: string
  type: WorkflowNodeV1['type']
}>

type Props = Readonly<{
  node: WorkflowNodeV1 | null
  status?: WorkflowNodeRunStatus
  result: WorkflowNodeRunResultV1 | null
  running: boolean
  upstreamNodes: readonly UpstreamNode[]
  onRunNode: (nodeId: string) => void
}>

const MAX_VISIBLE_ENTRIES = 100
const MAX_VISIBLE_DEPTH = 8

export function parseWorkflowNodePayload(serialized: string | undefined): unknown {
  const value = serialized?.trim()
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function statusPresentation(status: WorkflowNodeRunStatus | undefined): Readonly<{
  labelKey: string
  className: string
  icon: ReactElement
}> {
  switch (status) {
    case 'running':
      return {
        labelKey: 'workflowRunStatus_running',
        className: 'text-amber-600',
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />
      }
    case 'success':
      return {
        labelKey: 'workflowRunStatus_success',
        className: 'text-emerald-600',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />
      }
    case 'error':
      return {
        labelKey: 'workflowRunStatus_error',
        className: 'text-red-600',
        icon: <AlertCircle className="h-3.5 w-3.5" />
      }
    case 'skipped':
      return {
        labelKey: 'workflowRunStatus_skipped',
        className: 'text-ds-faint',
        icon: <SkipForward className="h-3.5 w-3.5" />
      }
    default:
      return {
        labelKey: 'workflowRunStatus_pending',
        className: 'text-ds-faint',
        icon: <Clock3 className="h-3.5 w-3.5" />
      }
  }
}

function JsonValue({ value, depth = 0 }: Readonly<{ value: unknown; depth?: number }>): ReactElement {
  const { t } = useTranslation('common')
  if (value === null) return <span className="text-ds-faint">null</span>
  if (value === undefined) return <span className="text-ds-faint">undefined</span>
  if (typeof value === 'string') return <span className="break-words text-ds-ink">{value}</span>
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="font-mono text-accent">{String(value)}</span>
  }
  if (depth >= MAX_VISIBLE_DEPTH) {
    return <span className="text-ds-faint">{t('workflowInspectorValueContinues')}</span>
  }
  if (Array.isArray(value)) {
    const visible = value.slice(0, MAX_VISIBLE_ENTRIES)
    return (
      <ol className="flex flex-col gap-1 pl-4">
        {visible.map((entry, index) => (
          <li key={index} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-2">
            <span className="font-mono text-[10px] text-ds-faint">{index}</span>
            <JsonValue value={entry} depth={depth + 1} />
          </li>
        ))}
        {value.length > visible.length ? (
          <li className="text-ds-faint">
            {t('workflowInspectorMoreItems', { count: value.length - visible.length })}
          </li>
        ) : null}
      </ol>
    )
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const visible = entries.slice(0, MAX_VISIBLE_ENTRIES)
    return (
      <dl className="grid min-w-0 grid-cols-[minmax(7rem,0.35fr)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        {visible.map(([key, entry]) => (
          <div key={key} className="contents">
            <dt className="break-words font-mono text-[10.5px] text-ds-faint">{key}</dt>
            <dd className="min-w-0"><JsonValue value={entry} depth={depth + 1} /></dd>
          </div>
        ))}
        {entries.length > visible.length ? (
          <div className="col-span-2 text-ds-faint">
            {t('workflowInspectorMoreFields', { count: entries.length - visible.length })}
          </div>
        ) : null}
      </dl>
    )
  }
  return <span className="break-words text-ds-ink">{String(value)}</span>
}

function PayloadSection({
  label,
  serialized
}: Readonly<{ label: string; serialized: string | undefined }>): ReactElement {
  const { t } = useTranslation('common')
  const parsed = parseWorkflowNodePayload(serialized)
  const raw = serialized?.trim() ?? ''
  return (
    <section className="min-w-0 rounded-lg border border-ds-border bg-ds-card p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase text-ds-faint">{label}</h3>
      {raw ? (
        <>
          <div className="min-w-0 text-[11.5px] leading-5 text-ds-muted">
            <JsonValue value={parsed} />
          </div>
          <details className="mt-3 border-t border-ds-border pt-2">
            <summary className="cursor-pointer text-[11px] font-medium text-ds-muted">
              {t('workflowInspectorRawPayload')}
            </summary>
            <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md bg-ds-subtle p-3 font-mono text-[11px] leading-5 text-ds-muted">
              {raw}
            </pre>
          </details>
        </>
      ) : (
        <p className="text-[11.5px] text-ds-faint">{t('workflowInspectorNoPayload')}</p>
      )}
    </section>
  )
}

export function WorkflowNodeRunDetailsPanel({
  node,
  status,
  result,
  running,
  upstreamNodes,
  onRunNode
}: Props): ReactElement {
  const { t } = useTranslation('common')
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12.5px] text-ds-faint">
        {t('workflowInspectorNoSelection')}
      </div>
    )
  }

  const effectiveStatus = status ?? result?.status
  const presentation = statusPresentation(effectiveStatus)
  const artifactRefs = result?.artifactRefs ?? []
  const attempts = result?.attempts ?? []
  const startedAt = result ? Date.parse(result.startedAt) : Number.NaN
  const finishedAt = result ? Date.parse(result.finishedAt) : Number.NaN
  const elapsedMs = Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt >= startedAt
    ? finishedAt - startedAt
    : null

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start gap-3 border-b border-ds-border px-4 py-3">
        <span className={`mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-medium ${presentation.className}`}>
          {presentation.icon}
          {t(presentation.labelKey)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-[13px] font-semibold leading-5 text-ds-ink">{node.name}</h2>
          <p className="text-[10.5px] text-ds-faint">{node.type}</p>
        </div>
        <button
          type="button"
          disabled={running || effectiveStatus === 'running' || node.disabled}
          onClick={() => onRunNode(node.id)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-ds-border bg-ds-card px-2.5 text-[11.5px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" />
          {t('workflowRunNode')}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <section className="mb-3 rounded-lg border border-ds-border bg-ds-card p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase text-ds-faint">
            {t('workflowInspectorOverview')}
          </h3>
          <dl className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11.5px]">
            <dt className="text-ds-faint">{t('workflowInspectorNodeId')}</dt>
            <dd className="break-all font-mono text-ds-muted">{node.id}</dd>
            <dt className="text-ds-faint">{t('workflowInspectorUpstream')}</dt>
            <dd className="break-words text-ds-muted">
              {upstreamNodes.length > 0
                ? upstreamNodes.map((item) => item.name).join(', ')
                : t('workflowInspectorNone')}
            </dd>
            {elapsedMs !== null ? (
              <>
                <dt className="text-ds-faint">{t('workflowInspectorElapsed')}</dt>
                <dd className="text-ds-muted">{t('workflowInspectorElapsedMs', { count: elapsedMs })}</dd>
              </>
            ) : null}
          </dl>
        </section>

        {result?.message || result?.error ? (
          <section className={`mb-3 rounded-lg border p-3 ${result.error ? 'border-red-300/70 bg-red-500/5' : 'border-ds-border bg-ds-card'}`}>
            <h3 className="mb-1 text-[11px] font-semibold uppercase text-ds-faint">
              {result.error ? t('workflowResultError') : t('workflowResultMessage')}
            </h3>
            <p className={`whitespace-pre-wrap break-words text-[11.5px] leading-5 ${result.error ? 'text-red-600' : 'text-ds-muted'}`}>
              {result.error || result.message}
            </p>
          </section>
        ) : null}

        {result && (artifactRefs.length > 0 || attempts.length > 0 || result.retries) ? (
          <section className="mb-3 rounded-lg border border-ds-border bg-ds-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase text-ds-faint">
                <FileOutput className="h-3.5 w-3.5" />
                {t('workflowInspectorArtifacts')}
              </h3>
              {attempts.length > 0 ? (
                <span className="rounded-md bg-ds-subtle px-2 py-1 text-[10.5px] text-ds-muted">
                  {t('workflowInspectorAttemptCount', { count: attempts.length })}
                </span>
              ) : null}
              {result.retries ? (
                <span className="rounded-md bg-amber-500/10 px-2 py-1 text-[10.5px] text-amber-700 dark:text-amber-300">
                  {t('workflowInspectorRetryCount', { count: result.retries })}
                </span>
              ) : null}
            </div>
            {artifactRefs.length > 0 ? (
              <ul className="mt-2 flex min-w-0 flex-col gap-1.5">
                {artifactRefs.map((artifact, index) => (
                  <li
                    key={`${artifact.ref}-${index}`}
                    className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-2 rounded-md border border-ds-border/70 bg-ds-subtle/50 px-2 py-1.5 text-[10.5px]"
                  >
                    <span className="font-medium uppercase text-ds-faint">{artifact.kind}</span>
                    <span className="min-w-0 break-all font-mono text-ds-muted">{artifact.ref}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <PayloadSection label={t('workflowResultInput')} serialized={result?.inputJson} />
          <PayloadSection label={t('workflowResultOutput')} serialized={result?.outputJson} />
        </div>
      </div>
    </section>
  )
}
