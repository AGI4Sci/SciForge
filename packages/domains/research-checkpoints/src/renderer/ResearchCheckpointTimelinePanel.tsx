import * as React from 'react'
import {
  BookOpen,
  ExternalLink,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'

import type {
  ResearchCheckpointCommittedTurnStatusV1,
  ResearchCheckpointTurnStatusV1
} from '../contract.js'
import type { ResearchCheckpointsRendererClient } from './research-checkpoints-capability-client.js'
import {
  automaticPendingPollDelay,
  automaticUnrecordedPollDelay,
  shouldProbeUnrecordedCheckpoint,
  type ResearchCheckpointTurnLifecycleHint
} from './research-checkpoint-timeline-polling.js'
import { installResearchCheckpointResumeRefresh } from './research-checkpoint-resume-refresh.js'

type TimelineLoadState =
  | Readonly<{ status: 'hidden' }>
  | Readonly<{ status: 'error'; scopeKey: string; message: string }>
  | Readonly<{ status: 'ready'; scopeKey: string; value: ResearchCheckpointTurnStatusV1 }>

type ResearchCheckpointTimelineClient = Pick<
  ResearchCheckpointsRendererClient,
  'readStatus' | 'readTurnStatus'
>

export function ResearchCheckpointTimelinePanel({
  client,
  workspaceRoot,
  runtimeId,
  threadId,
  turnId,
  turnLifecycle,
  onOpenExact
}: Readonly<{
  client: ResearchCheckpointTimelineClient
  workspaceRoot?: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  turnLifecycle?: ResearchCheckpointTurnLifecycleHint
  onOpenExact?: (status: ResearchCheckpointCommittedTurnStatusV1) => void
}>): ReactElement | null {
  const workspace = workspaceRoot?.trim() ?? ''
  const runtime = runtimeId?.trim() ?? ''
  const thread = threadId?.trim() ?? ''
  const turn = turnId?.trim() ?? ''
  const enabled = Boolean(workspace && runtime && thread && turn)
  const scopeKey = useMemo(
    () => [workspace, runtime, thread, turn].join('\u0000'),
    [runtime, thread, turn, workspace]
  )
  const [loadState, setLoadState] = useState<TimelineLoadState>({ status: 'hidden' })
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [unrecordedResumeEligible, setUnrecordedResumeEligible] = useState(false)
  const pendingPolls = useRef(0)
  const unrecordedPolls = useRef(0)
  const recordingActive = useRef<boolean | null>(null)
  const observedLifecycleRevision = useRef('')

  useEffect(() => {
    pendingPolls.current = 0
    unrecordedPolls.current = 0
    recordingActive.current = null
    setUnrecordedResumeEligible(false)
  }, [scopeKey])

  useEffect(() => {
    if (
      turnLifecycle?.phase === 'terminal' &&
      observedLifecycleRevision.current !== turnLifecycle.revision
    ) {
      unrecordedPolls.current = 0
      recordingActive.current = null
    }
    observedLifecycleRevision.current = turnLifecycle?.revision ?? ''
  }, [turnLifecycle?.revision])

  useEffect(() => {
    if (!enabled) {
      setLoadState({ status: 'hidden' })
      return
    }
    let active = true
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    void client.readTurnStatus(workspace, {
      runtimeId: runtime,
      threadId: thread,
      turnId: turn
    }).then(async (result) => {
      if (!active) return
      if (!result.ok) {
        setUnrecordedResumeEligible(false)
        setLoadState({ status: 'error', scopeKey, message: result.issue.message })
        return
      }
      setLoadState({ status: 'ready', scopeKey, value: result.value })
      const pollDelay = automaticPendingPollDelay(result.value, pendingPolls.current)
      if (pollDelay !== undefined) {
        setUnrecordedResumeEligible(false)
        pendingPolls.current += 1
        pollTimer = setTimeout(() => {
          if (active) setRefreshRevision((revision) => revision + 1)
        }, pollDelay)
        return
      }
      if (
        result.value.state === 'unrecorded' &&
        turnLifecycle?.phase === 'terminal' &&
        turnLifecycle.isLatest
      ) {
        const recordingIsActive = recordingActive.current ?? await client.readStatus(workspace, {
          runtimeId: runtime,
          threadId: thread
        }).then((statusResult) => {
          if (!statusResult.ok) return false
          const value = statusResult.value.recording?.state === 'active'
          recordingActive.current = value
          return value
        }).catch(() => false)
        if (!active) return
        if (shouldProbeUnrecordedCheckpoint(result.value, turnLifecycle, recordingIsActive)) {
          setUnrecordedResumeEligible(true)
          const delay = automaticUnrecordedPollDelay(unrecordedPolls.current)
          if (delay !== undefined) {
            unrecordedPolls.current += 1
            pollTimer = setTimeout(() => {
              if (active) setRefreshRevision((revision) => revision + 1)
            }, delay)
          }
          return
        }
      }
      setUnrecordedResumeEligible(false)
    }).catch((error: unknown) => {
      if (active) {
        setUnrecordedResumeEligible(false)
        setLoadState({
          status: 'error',
          scopeKey,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    })
    return () => {
      active = false
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [
    client,
    enabled,
    refreshRevision,
    runtime,
    scopeKey,
    thread,
    turn,
    turnLifecycle?.isLatest,
    turnLifecycle?.phase,
    turnLifecycle?.revision,
    workspace
  ])

  const refresh = useCallback(() => {
    pendingPolls.current = 0
    unrecordedPolls.current = 0
    recordingActive.current = null
    setRefreshRevision((revision) => revision + 1)
  }, [])

  useEffect(() => {
    if (!unrecordedResumeEligible) return
    return installResearchCheckpointResumeRefresh(refresh)
  }, [refresh, unrecordedResumeEligible])

  if (!enabled || loadState.status === 'hidden') return null
  if (loadState.scopeKey !== scopeKey) return null
  if (loadState.status === 'error') return null
  if (loadState.status !== 'ready') return null
  if (loadState.value.state !== 'committed') return null
  return (
    <ResearchCheckpointStatusCard
      status={loadState.value}
      onOpenExact={onOpenExact}
    />
  )
}

export function ResearchCheckpointStatusCard({
  status,
  onOpenExact
}: Readonly<{
  status: Exclude<ResearchCheckpointTurnStatusV1, Readonly<{ state: 'unrecorded' }>>
  onOpenExact?: (status: ResearchCheckpointCommittedTurnStatusV1) => void
}>): ReactElement | null {
  const { t } = useTranslation('common')

  if (status.state !== 'committed') return null

  return (
    <article
      className="w-full max-w-2xl"
      data-research-checkpoint-state="committed"
      data-research-checkpoint-version-id={status.artifactRef.versionId}
    >
      <button
        type="button"
        disabled={!onOpenExact}
        onClick={() => onOpenExact?.(status)}
        className="group inline-flex max-w-full items-center gap-2 rounded-lg border border-ds-border bg-ds-card/70 px-2.5 py-1.5 text-left text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-default disabled:hover:bg-ds-card/70 disabled:hover:text-ds-muted"
        title={t('researchCheckpointOpenDossier')}
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate font-medium">{t('researchCheckpointOpenDossier')}</span>
        <ExternalLink className="h-3 w-3 shrink-0 text-ds-faint group-hover:text-ds-muted" aria-hidden="true" />
      </button>
    </article>
  )
}
