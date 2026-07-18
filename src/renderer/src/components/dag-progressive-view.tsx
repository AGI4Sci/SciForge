import type { RefObject, ReactElement } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { CheckCircle2, CircleDashed, Database, ScanSearch } from 'lucide-react'
import type { DagPanelStatus, DagProgressiveNodeStage, DagProgressiveViewStatus } from '@shared/sciforge-api'

type TFunction = (key: string, values?: Record<string, unknown>) => string

export type DagProgressiveLegendProps = {
  status?: DagPanelStatus
  t: TFunction
  className?: string
}

type StagePresentation = {
  stage: DagProgressiveNodeStage
  count: number
  className: string
  icon: ReactElement
}

function nonNegative(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0
}

export function dagProgressiveView(status?: DagPanelStatus): DagProgressiveViewStatus {
  if (status?.progressiveView) return status.progressiveView
  const active = status?.freshness === 'queued' || status?.freshness === 'updating' || status?.freshness === 'dirty'
  const stage = status?.progress?.stage
  const pending = nonNegative(status?.pendingCount)
  return {
    inferred: true,
    committed: {
      nodeCount: 0,
      edgeCount: 0,
      ...(status?.latestSnapshotDigest ? { snapshotDigest: status.latestSnapshotDigest } : {})
    },
    ...(active ? {
      staging: {
        collectedCount: status?.freshness !== 'updating' || stage === 'capturing' ? pending : 0,
        extractingCount: status?.freshness === 'updating' && (!stage || stage === 'evidence') ? pending : 0,
        pendingVerificationCount: stage === 'project' || stage === 'compile' ? pending : 0,
        temporaryEdgeCount: 0
      }
    } : {})
  }
}

export function DagProgressiveLegend({ status, t, className = '' }: DagProgressiveLegendProps): ReactElement | null {
  const progressive = dagProgressiveView(status)
  const staging = progressive.staging
  const stagingActivity = Boolean(staging && (
    staging.collectedCount || staging.extractingCount || staging.pendingVerificationCount || staging.temporaryEdgeCount
  ))
  // An idle panel with only inferred zero counts has nothing to explain;
  // hiding the band keeps the graph area quiet until staging work exists.
  if (!stagingActivity && progressive.inferred) return null
  const presentations: StagePresentation[] = [
    {
      stage: 'collected',
      count: nonNegative(staging?.collectedCount),
      className: 'border-slate-300 bg-slate-50 text-slate-700',
      icon: <Database className="h-3 w-3" aria-hidden="true" />
    },
    {
      stage: 'extracting',
      count: nonNegative(staging?.extractingCount),
      className: 'border-sky-300 bg-sky-50 text-sky-700',
      icon: <ScanSearch className="h-3 w-3" aria-hidden="true" />
    },
    {
      stage: 'pending_verification',
      count: nonNegative(staging?.pendingVerificationCount),
      className: 'border-amber-300 bg-amber-50 text-amber-800',
      icon: <CircleDashed className="h-3 w-3" aria-hidden="true" />
    },
    {
      stage: 'committed',
      count: nonNegative(progressive.committed.nodeCount),
      className: 'border-emerald-300 bg-emerald-50 text-emerald-700',
      icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
    }
  ]
  const hasStaging = stagingActivity

  return (
    <section
      className={`shrink-0 border-b border-ds-border-muted bg-ds-sidebar px-3 py-2 ${className}`}
      aria-label={t('dagProgressiveLayers')}
      data-dag-progressive-view="true"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[10.5px] font-medium text-ds-faint">{t('dagProgressiveLifecycle')}</span>
        {presentations.map((item) => (
          <span
            key={item.stage}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${item.className}`}
            data-dag-node-stage={item.stage}
          >
            {item.icon}
            {t(`dagNodeStage.${item.stage}`)}
            <span className="tabular-nums">
              {item.stage === 'committed' && progressive.inferred ? '—' : item.count}
            </span>
          </span>
        ))}
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10.5px] text-ds-muted"
          data-dag-edge-layer="staging"
          title={t('dagTemporaryEdgeHelp')}
        >
          <span className="inline-block w-5 border-t-2 border-dashed border-sky-500" aria-hidden="true" />
          {t('dagTemporaryEdges', { count: nonNegative(staging?.temporaryEdgeCount) })}
        </span>
      </div>
      {hasStaging ? (
        <div
          role="note"
          className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-4 text-amber-800"
          data-dag-layer="staging"
        >
          <CircleDashed className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{t('dagStagingAuditWarning')}</span>
        </div>
      ) : (
        <div className="sr-only" data-dag-layer="committed">{t('dagCommittedAuditEligible')}</div>
      )}
    </section>
  )
}

export const DAG_PANEL_PRIORITY_SIGNAL = 'sciforge.dag.panel-priority'

export type DagPanelPrioritySignal = {
  type: typeof DAG_PANEL_PRIORITY_SIGNAL
  version: 1
  dag: 'evidence' | 'project'
  visible: boolean
  priority: 'foreground' | 'background'
  requestedLayers: ['committed', 'staging']
  progressiveView?: DagProgressiveViewStatus
}

export function buildDagPanelPrioritySignal(input: {
  dag: DagPanelPrioritySignal['dag']
  visible: boolean
  status?: DagPanelStatus
}): DagPanelPrioritySignal {
  return {
    type: DAG_PANEL_PRIORITY_SIGNAL,
    version: 1,
    dag: input.dag,
    visible: input.visible,
    priority: input.visible ? 'foreground' : 'background',
    requestedLayers: ['committed', 'staging'],
    ...(input.status ? { progressiveView: dagProgressiveView(input.status) } : {})
  }
}

export function postDagPanelPrioritySignal(
  target: Pick<Window, 'postMessage'> | null | undefined,
  signal: DagPanelPrioritySignal
): boolean {
  if (!target) return false
  target.postMessage(signal, '*')
  return true
}

export function dagPanelIsForeground(
  active: boolean,
  visibilityState?: DocumentVisibilityState
): boolean {
  return active && (visibilityState === undefined || visibilityState === 'visible')
}

/**
 * Expresses foreground priority to embedded DAG views. Current services may
 * ignore this backwards-compatible signal; future schedulers can bridge it to
 * refresh/extraction priority without changing panel code.
 */
export function useDagPanelPrioritySignal(input: {
  iframeRef: RefObject<HTMLIFrameElement | null>
  dag: DagPanelPrioritySignal['dag']
  status?: DagPanelStatus
  active?: boolean
  onPriorityChange?: (visible: boolean) => void
}): { signalNow: () => void } {
  const statusRef = useRef(input.status)
  statusRef.current = input.status
  const { iframeRef, dag, onPriorityChange } = input
  const active = input.active ?? true
  const signalPriority = useCallback((visible: boolean) => {
    postDagPanelPrioritySignal(
      iframeRef.current?.contentWindow,
      buildDagPanelPrioritySignal({ dag, visible, status: statusRef.current })
    )
    onPriorityChange?.(visible)
  }, [dag, iframeRef, onPriorityChange])
  const signalNow = useCallback(() => {
    signalPriority(dagPanelIsForeground(
      active,
      typeof document === 'undefined' ? undefined : document.visibilityState
    ))
  }, [active, signalPriority])

  useEffect(() => {
    signalNow()
    if (typeof document === 'undefined') return undefined
    document.addEventListener('visibilitychange', signalNow)
    return () => {
      document.removeEventListener('visibilitychange', signalNow)
      signalPriority(false)
    }
  }, [signalNow, signalPriority])

  return { signalNow }
}
