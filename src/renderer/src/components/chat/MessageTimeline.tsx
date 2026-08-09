import type { ReactElement, RefObject } from 'react'
import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock, RuntimeConnectionStatus, RuntimeDisclosureMetadata } from '../../agent/types'
import type { VisibleContextComponentSnapshot } from '@shared/visible-context'
import { useChatStore } from '../../store/chat-store'
import { isRemoteChannelThread } from '../../store/chat-store-helpers'
import { useTimelineStores } from './use-timeline-stores'
import { useTimelineScroll } from './use-timeline-scroll'
import { deriveTurnSections } from './derive-turn-sections'
import { MessageTimelineEmptyHero, ThreadForkBanner, ThreadForkPoint } from './message-timeline-empty'
import { MessageBubble } from './message-timeline-bubbles'
import { ReviewPlanCard, ReviewSummaryCard, TurnChangeSummary, WorkMetaRow } from './message-timeline-cards'
import {
  TimelineImageResultsPanel,
  timelineImagesFromToolBlocks,
  type TimelineVisualReviewArtifact
} from './message-timeline-media'
import { ProcessSectionRow, groupProcessSections } from './message-timeline-process'
import { AnimatedWorkLogo } from './AnimatedWorkLogo'
import {
  groupTurns,
  sameTurnContent,
  splitThink,
  stableTurnKey,
  turnHasPendingRuntimeWork,
  type Turn
} from './message-timeline-turns'
import { extractPlanMetadataFromBlock } from '../../plan/plan-tool'
import { planDisplayNameFromRelativePath } from '../../plan/plan-path'
import { performanceMonitor } from '../../lib/performance-monitor'
import { registerVisibleContextComponent } from '../../lib/visible-context'
import { TimelineScientificObjectsPanel } from './TimelineScientificObjectsPanel'
import { installedRendererContributions } from '../../domain-modules/installed-renderer-contributions'

export { summarizeToolBlock } from './message-timeline-process'

type Props = {
  blocks: ChatBlock[]
  liveReasoning: string
  live: string
  activeThreadId: string | null
  runtimeConnection: RuntimeConnectionStatus
  runtimeError?: string | null
  onRetryConnection: () => void
  onOpenSettings: () => void
  autoScrollEnabled?: boolean
  onSelectSuggestion?: (prompt: string) => void
  /** Disables the inline Review Plan card's Build action while a turn runs. */
  planActionsBusy?: boolean
  /** Runs the active plan (Build button on the inline Review Plan card). */
  onBuildPlan?: () => void
  /** Opens/focuses the Plan panel (Open button on the inline card). */
  onOpenPlan?: () => void
  busyOverride?: boolean
  currentTurnUserIdOverride?: string | null
  turnStartedAtByUserIdOverride?: Record<string, number>
  turnDurationByUserIdOverride?: Record<string, number>
  turnReasoningFirstAtByUserIdOverride?: Record<string, number>
  turnReasoningLastAtByUserIdOverride?: Record<string, number>
  onOpenImageArtifactInVisualReview?: (artifact: TimelineVisualReviewArtifact) => void
}

const TURN_PAGE_SIZE = 18
const AUTO_COLLAPSE_THRESHOLD = 24
const PROCESS_SECTION_PAGE_SIZE = 80

export function messageTimelineVisibleContextComponentId(activeThreadId: string | null): string {
  return activeThreadId ? `chat.timeline.${activeThreadId}` : 'chat.timeline.empty'
}

export function buildMessageTimelineVisibleContextComponent(input: {
  activeThreadId: string | null
  blockCount: number
  turnCount: number
  visibleTurnCount: number
  hiddenTurnCount: number
  pendingRuntimeTurnCount: number
  busy: boolean
  live: boolean
  reasoning: boolean
  runtimeConnection: RuntimeConnectionStatus
  remoteChannelMode: boolean
  updatedAt?: string
}): VisibleContextComponentSnapshot {
  const active = Boolean(input.activeThreadId)
  return {
    id: messageTimelineVisibleContextComponentId(input.activeThreadId),
    region: 'main',
    component: 'message-timeline',
    title: 'Chat timeline',
    visible: true,
    priority: 100,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    summary: active
      ? `Active chat timeline with ${input.turnCount} turns; ${input.visibleTurnCount} visible and ${input.hiddenTurnCount} hidden.`
      : 'Chat timeline without an active thread.',
    state: {
      activeThreadId: input.activeThreadId,
      blockCount: input.blockCount,
      turnCount: input.turnCount,
      visibleTurnCount: input.visibleTurnCount,
      hiddenTurnCount: input.hiddenTurnCount,
      pendingRuntimeTurnCount: input.pendingRuntimeTurnCount,
      busy: input.busy,
      live: input.live,
      reasoning: input.reasoning,
      runtimeConnection: input.runtimeConnection,
      remoteChannelMode: input.remoteChannelMode,
      hasContent: input.blockCount > 0 || input.live || input.reasoning
    }
  }
}

function useStableOptionalCallback<Args extends unknown[]>(
  callback: ((...args: Args) => void) | undefined
): ((...args: Args) => void) | undefined {
  const callbackRef = useRef(callback)
  const hasCallback = Boolean(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  return useMemo(() => {
    if (!hasCallback) return undefined
    return (...args: Args): void => {
      callbackRef.current?.(...args)
    }
  }, [hasCallback])
}

function useStableCallback<Args extends unknown[]>(
  callback: (...args: Args) => void
): (...args: Args) => void {
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  return useMemo(() => (...args: Args): void => {
    callbackRef.current(...args)
  }, [])
}

function blockScrollStamp(block: ChatBlock | undefined): string {
  if (!block) return ''
  switch (block.kind) {
    case 'user':
    case 'assistant':
    case 'reasoning':
    case 'system':
      return `${block.id}:${block.kind}:${block.text.length}`
    case 'tool':
      return `${block.id}:${block.kind}:${block.status}:${block.summary.length}:${block.detail?.length ?? 0}`
    case 'review':
      return `${block.id}:${block.kind}:${block.status}:${block.reviewText?.length ?? 0}`
    case 'approval':
    case 'user_input':
    case 'compaction':
      return `${block.id}:${block.kind}:${block.status}`
    default:
      return ''
  }
}

export function MessageTimeline(props: Props): ReactElement {
  const onRetryConnection = useStableCallback(props.onRetryConnection)
  const onOpenSettings = useStableCallback(props.onOpenSettings)
  const onSelectSuggestion = useStableOptionalCallback(props.onSelectSuggestion)
  const onBuildPlan = useStableOptionalCallback(props.onBuildPlan)
  const onOpenPlan = useStableOptionalCallback(props.onOpenPlan)
  const onOpenImageArtifactInVisualReview = useStableOptionalCallback(
    props.onOpenImageArtifactInVisualReview
  )

  return (
    <MemoMessageTimelineComponent
      {...props}
      onRetryConnection={onRetryConnection}
      onOpenSettings={onOpenSettings}
      onSelectSuggestion={onSelectSuggestion}
      onBuildPlan={onBuildPlan}
      onOpenPlan={onOpenPlan}
      onOpenImageArtifactInVisualReview={onOpenImageArtifactInVisualReview}
    />
  )
}

function MessageTimelineComponent({
  blocks,
  liveReasoning,
  live,
  activeThreadId,
  runtimeConnection,
  runtimeError,
  onRetryConnection,
  onOpenSettings,
  autoScrollEnabled = true,
  onSelectSuggestion,
  planActionsBusy,
  onBuildPlan,
  onOpenPlan,
  busyOverride,
  currentTurnUserIdOverride,
  turnStartedAtByUserIdOverride,
  turnDurationByUserIdOverride,
  turnReasoningFirstAtByUserIdOverride,
  turnReasoningLastAtByUserIdOverride,
  onOpenImageArtifactInVisualReview
}: Props): ReactElement {
  const renderStartedAt = performanceMonitor.now()
  const { t } = useTranslation('common')
  const {
    workspaceRoot,
    chooseWorkspace,
    remoteChannels,
    activeRemoteChannel,
    activeAgentRuntime,
    busy,
    currentTurnUserId,
    turnStartedAtByUserId,
    turnDurationByUserId,
    turnReasoningFirstAtByUserId,
    turnReasoningLastAtByUserId,
    activeThread
  } = useTimelineStores(activeThreadId)
  const effectiveBusy = busyOverride ?? busy
  const effectiveCurrentTurnUserId = currentTurnUserIdOverride ?? currentTurnUserId
  const effectiveTurnStartedAtByUserId = turnStartedAtByUserIdOverride ?? turnStartedAtByUserId
  const effectiveTurnDurationByUserId = turnDurationByUserIdOverride ?? turnDurationByUserId
  const effectiveTurnReasoningFirstAtByUserId =
    turnReasoningFirstAtByUserIdOverride ?? turnReasoningFirstAtByUserId
  const effectiveTurnReasoningLastAtByUserId =
    turnReasoningLastAtByUserIdOverride ?? turnReasoningLastAtByUserId
  const liveReasoningMeta = useChatStore((s) =>
    activeThreadId && activeThreadId === s.activeThreadId ? s.liveReasoningMeta : null
  )
  const serverHistoryCursor = useChatStore((s) =>
    activeThreadId && activeThreadId === s.activeThreadId ? s.threadHistoryCursor : null
  )
  const serverHistoryLoading = useChatStore((s) => s.threadHistoryLoading)
  const loadEarlierThreadHistory = useChatStore((s) => s.loadEarlierThreadHistory)
  const stableOnBuildPlan = onBuildPlan
  const stableOnOpenPlan = onOpenPlan
  const stableOnOpenImageArtifactInVisualReview = onOpenImageArtifactInVisualReview
  const stableOnContinueScientificObject = useStableOptionalCallback(onSelectSuggestion)

  const remoteChannelMode = Boolean(activeThread && isRemoteChannelThread(activeThread, remoteChannels))
  const hasContent = blocks.length > 0 || live || liveReasoning
  const containerRef = useRef<HTMLDivElement>(null)

  const turns = useMemo(() => groupTurns(blocks), [blocks])
  const latestBlock = blocks[blocks.length - 1]
  const scrollContentKey = [
    activeThreadId ?? '',
    turns.length,
    blocks.length,
    blockScrollStamp(latestBlock),
    live.length,
    liveReasoning.length,
    liveReasoningMeta?.reasoning?.visibility ?? '',
    liveReasoningMeta?.reasoning?.source ?? ''
  ].join(':')
  const {
    visibleTurnCount,
    hiddenTurnCount,
    loadEarlierTurns,
    collapseEarlierTurns
  } = useTimelineScroll({
    containerRef,
    activeThreadId,
    pageSize: TURN_PAGE_SIZE,
    autoCollapseThreshold: AUTO_COLLAPSE_THRESHOLD,
    totalTurns: turns.length,
      busy: effectiveBusy,
      autoScrollEnabled,
      scrollDeps: {
      contentKey: scrollContentKey,
      streaming: Boolean(live.trim() || liveReasoning.trim()),
      userTurnKey: effectiveCurrentTurnUserId ?? ''
    }
  })
  const visibleTurns = useMemo(
    () => (hiddenTurnCount > 0 ? turns.slice(hiddenTurnCount) : turns),
    [hiddenTurnCount, turns]
  )
  const pendingRuntimeTurnCount = useMemo(
    () => turns.filter(turnHasPendingRuntimeWork).length,
    [turns]
  )

  useEffect(() => registerVisibleContextComponent(buildMessageTimelineVisibleContextComponent({
    activeThreadId,
    blockCount: blocks.length,
    turnCount: turns.length,
    visibleTurnCount,
    hiddenTurnCount,
    pendingRuntimeTurnCount,
    busy: effectiveBusy,
    live: Boolean(live.trim()),
    reasoning: Boolean(liveReasoning.trim()),
    runtimeConnection,
    remoteChannelMode
  })), [
    activeThreadId,
    blocks.length,
    effectiveBusy,
    hiddenTurnCount,
    live,
    liveReasoning,
    pendingRuntimeTurnCount,
    remoteChannelMode,
    runtimeConnection,
    turns.length,
    visibleTurnCount
  ])
  const forkedFromTitle = activeThread?.forkedFromTitle?.trim() ?? ''
  const forkBoundaryTurnCount =
    typeof activeThread?.forkedFromTurnCount === 'number'
      ? Math.max(0, activeThread.forkedFromTurnCount)
      : undefined

  useEffect(() => {
    performanceMonitor.sample('react.commit.MessageTimeline', performanceMonitor.now() - renderStartedAt, {
      activeThread: activeThreadId ? 'yes' : 'no',
      blocks: blocks.length,
      turns: turns.length,
      visibleTurns: visibleTurns.length,
      liveChars: live.length,
      reasoningChars: liveReasoning.length
    })
  })

  return (
    <div ref={containerRef} className="ds-no-drag flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      <div className="ds-message-timeline-content ds-chat-column-inset mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-8 pb-10 pt-8">
        {!hasContent || !activeThreadId ? (
          <MessageTimelineEmptyHero
            remoteChannelMode={remoteChannelMode}
            ready={runtimeConnection === 'ready'}
            hasWorkspace={!!workspaceRoot}
            runtimeError={runtimeError}
            runtimeId={activeAgentRuntime}
            activeRemoteChannel={activeRemoteChannel}
            onPickWorkspace={() => void chooseWorkspace()}
            onRetry={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onSelectSuggestion={onSelectSuggestion}
          />
        ) : null}

        {activeThread?.forkedFromThreadId ? (
          <ThreadForkBanner parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount > 0 ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => loadEarlierTurns({ userInitiated: true })}
              className="ds-chip rounded-full px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
            >
              {t('timelineShowEarlierTurns', { count: Math.min(hiddenTurnCount, TURN_PAGE_SIZE) })}
            </button>
          </div>
        ) : null}

        {hiddenTurnCount === 0 && serverHistoryCursor ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              disabled={serverHistoryLoading}
              onClick={() => void loadEarlierThreadHistory()}
              className="ds-chip rounded-full px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
            >
              {serverHistoryLoading
                ? t('loading')
                : t('timelineShowEarlierTurns', { count: TURN_PAGE_SIZE })}
            </button>
          </div>
        ) : null}

        {visibleTurns.map((turn, index) => {
          const absoluteTurnIndex = hiddenTurnCount + index
          const userId = turn.user?.id
          const isLive = !!(userId && effectiveCurrentTurnUserId === userId)
          const startedAt = userId ? effectiveTurnStartedAtByUserId[userId] : undefined
          const recordedDuration = userId ? effectiveTurnDurationByUserId[userId] : undefined
          const durationMs = recordedDuration
          const liveStartedAtMs = isLive && typeof startedAt === 'number' ? startedAt : undefined
          const reasoningFirst = userId ? effectiveTurnReasoningFirstAtByUserId[userId] : undefined
          const reasoningLast = userId ? effectiveTurnReasoningLastAtByUserId[userId] : undefined
          const reasoningDurationMs =
            typeof reasoningFirst === 'number' && typeof reasoningLast === 'number'
              ? Math.max(0, reasoningLast - reasoningFirst)
              : undefined
          const turnPending = turnHasPendingRuntimeWork(turn)
          const isLatestTurn = index === visibleTurns.length - 1
          const hasLiveStream = isLatestTurn && !!(liveReasoning.trim() || live.trim())
          const showForkPoint =
            forkBoundaryTurnCount !== undefined && absoluteTurnIndex === forkBoundaryTurnCount
          return (
            <Fragment key={stableTurnKey(turn, absoluteTurnIndex)}>
              {showForkPoint ? <ThreadForkPoint parentTitle={forkedFromTitle} /> : null}
              <MemoMessageTurn
                turn={turn}
                sessionId={activeThreadId ?? undefined}
                isProcessing={(effectiveBusy && isLatestTurn) || turnPending || hasLiveStream}
                terminalStatus={turn.user?.turnStatus}
                liveReasoning={isLatestTurn ? liveReasoning : ''}
                liveReasoningMeta={isLatestTurn ? liveReasoningMeta : null}
                live={isLatestTurn ? live : ''}
                durationMs={durationMs}
                liveStartedAtMs={liveStartedAtMs}
                reasoningDurationMs={reasoningDurationMs}
                planActionsBusy={planActionsBusy}
                onBuildPlan={stableOnBuildPlan}
                onOpenPlan={stableOnOpenPlan}
                onOpenImageArtifactInVisualReview={stableOnOpenImageArtifactInVisualReview}
                onContinueScientificObject={stableOnContinueScientificObject}
                viewportRef={containerRef}
              />
            </Fragment>
          )
        })}

        {forkBoundaryTurnCount !== undefined &&
        forkBoundaryTurnCount === turns.length &&
        hasContent ? (
          <ThreadForkPoint parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount === 0 && turns.length > TURN_PAGE_SIZE && turns.length > AUTO_COLLAPSE_THRESHOLD && !effectiveBusy ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                collapseEarlierTurns()
              }}
              className="rounded-full px-3 py-1.5 text-[12.5px] font-medium text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('timelineCollapseEarlierTurns')}
            </button>
          </div>
        ) : null}

        {blocks.length === 0 && (live || liveReasoning) ? (
          <MemoMessageTurn
            turn={{ blocks: [] }}
            sessionId={activeThreadId ?? undefined}
            isProcessing={effectiveBusy}
            liveReasoning={liveReasoning}
            liveReasoningMeta={liveReasoningMeta}
            live={live}
            onOpenImageArtifactInVisualReview={stableOnOpenImageArtifactInVisualReview}
            onContinueScientificObject={stableOnContinueScientificObject}
            viewportRef={containerRef}
            liveStartedAtMs={
              effectiveCurrentTurnUserId && typeof effectiveTurnStartedAtByUserId[effectiveCurrentTurnUserId] === 'number'
                ? effectiveTurnStartedAtByUserId[effectiveCurrentTurnUserId]
                : undefined
            }
            reasoningDurationMs={(() => {
              if (!effectiveCurrentTurnUserId) return undefined
              const first = effectiveTurnReasoningFirstAtByUserId[effectiveCurrentTurnUserId]
              const last = effectiveTurnReasoningLastAtByUserId[effectiveCurrentTurnUserId]
              if (typeof first !== 'number' || typeof last !== 'number') return undefined
              return Math.max(0, last - first)
            })()}
          />
        ) : null}
      </div>
    </div>
  )
}

const MemoMessageTimelineComponent = memo(MessageTimelineComponent)

function MessageTurn({
  turn,
  sessionId,
  isProcessing,
  terminalStatus,
  liveReasoning,
  liveReasoningMeta,
  live,
  durationMs,
  liveStartedAtMs,
  reasoningDurationMs,
  planActionsBusy,
  onBuildPlan,
  onOpenPlan,
  onOpenImageArtifactInVisualReview,
  onContinueScientificObject,
  viewportRef
}: {
  turn: Turn
  sessionId?: string
  isProcessing: boolean
  terminalStatus?: string
  liveReasoning: string
  liveReasoningMeta?: RuntimeDisclosureMetadata | null
  live: string
  durationMs?: number
  liveStartedAtMs?: number
  reasoningDurationMs?: number
  planActionsBusy?: boolean
  onBuildPlan?: () => void
  onOpenPlan?: () => void
  onOpenImageArtifactInVisualReview?: (artifact: TimelineVisualReviewArtifact) => void
  onContinueScientificObject?: (prompt: string) => void
  viewportRef: RefObject<HTMLDivElement | null>
}): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  // Inline Review Plan card: surfaced under a turn that produced a
  // successful `create_plan` result so the user can open/build the plan
  // without leaving the conversation.
  const planResult = useMemo(() => {
    if (isProcessing) return null
    for (let index = turn.blocks.length - 1; index >= 0; index -= 1) {
      const block = turn.blocks[index]
      if (block.kind !== 'tool' || block.status !== 'success') continue
      const meta = extractPlanMetadataFromBlock(block)
      if (meta) return meta
    }
    return null
  }, [turn.blocks, isProcessing])
  const { think: liveThink, content: liveContent } = splitThink(live)
  const liveProcessText = [liveReasoning, liveThink].filter(Boolean).join('\n\n')
  const liveProcessMeta = liveReasoning.trim() ? liveReasoningMeta : null
  const [workExpandedOverride, setWorkExpandedOverride] = useState<boolean | null>(null)
  const workExpanded = workExpandedOverride ?? isProcessing

  const { processBlocks, conversationBlocks, turnFileChanges } = useMemo(
    () =>
      deriveTurnSections({
        turn,
        isProcessing,
        liveProcessText,
        liveProcessMeta,
        liveContent,
        workspaceRoot
      }),
    [turn, isProcessing, liveProcessText, liveProcessMeta, liveContent, workspaceRoot]
  )
  const reviewBlocks = useMemo(
    () => turn.blocks.filter((block) => block.kind === 'review'),
    [turn.blocks]
  )
  const toolResultImageBlocks = useMemo(
    () =>
      isProcessing
        ? []
        : turn.blocks.filter(
          (block): block is Extract<ChatBlock, { kind: 'tool' }> =>
            block.kind === 'tool' && block.status === 'success'
        ),
    [isProcessing, turn.blocks]
  )
  const turnArtifactImages = useMemo(
    () => timelineImagesFromToolBlocks(toolResultImageBlocks),
    [toolResultImageBlocks]
  )

  const processSections = useMemo(
    () => (workExpanded ? groupProcessSections(processBlocks) : []),
    [processBlocks, workExpanded]
  )
  const [visibleProcessSectionCount, setVisibleProcessSectionCount] = useState(
    PROCESS_SECTION_PAGE_SIZE
  )
  const hiddenProcessSectionCount = Math.max(
    0,
    processSections.length - visibleProcessSectionCount
  )
  const visibleProcessSections = useMemo(
    () => hiddenProcessSectionCount > 0
      ? processSections.slice(hiddenProcessSectionCount)
      : processSections,
    [hiddenProcessSectionCount, processSections]
  )
  const reasoningSectionCount = useMemo(
    () => processSections.filter((section) => section.kind === 'reasoning').length,
    [processSections]
  )
  const showLiveAssistant = !!liveContent.trim()
  // Keep completed reasoning/tool work tucked away, but make the active turn's
  // work visible unless the user explicitly collapses it.

  const hasProcess = isProcessing || processBlocks.length > 0

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {turn.user ? <MessageBubble block={turn.user} /> : null}

      {hasProcess ? (
        <div className="flex flex-col gap-1 pb-2">
          <WorkMetaRow
            processing={isProcessing}
            terminalStatus={terminalStatus}
            stepCount={processBlocks.length}
            durationMs={durationMs}
            liveStartedAtMs={liveStartedAtMs}
            reasoningDurationMs={reasoningDurationMs}
            expanded={workExpanded}
            onToggle={() => setWorkExpandedOverride((value) => !(value ?? isProcessing))}
          />
          {workExpanded && processSections.length > 0 ? (
            <div className="flex flex-col gap-1">
              {hiddenProcessSectionCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setVisibleProcessSectionCount((count) =>
                    Math.min(processSections.length, count + PROCESS_SECTION_PAGE_SIZE)
                  )}
                  className="mb-1 w-fit rounded-full px-3 py-1.5 text-[12px] font-medium text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                >
                  {t('timelineShowEarlierWork', {
                    count: Math.min(hiddenProcessSectionCount, PROCESS_SECTION_PAGE_SIZE)
                  })}
                </button>
              ) : null}
              {visibleProcessSections.map((section) => (
                <ProcessSectionRow
                  key={section.id}
                  section={section}
                  processing={isProcessing}
                  reasoningDurationMs={reasoningDurationMs}
                  singleReasoningSection={reasoningSectionCount === 1}
                  viewportRef={viewportRef}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {conversationBlocks.map((block) => (
        <MessageBubble
          key={block.id}
          block={block}
          markdownImages={block.kind === 'assistant' ? turnArtifactImages : undefined}
          onOpenImageArtifactInVisualReview={onOpenImageArtifactInVisualReview}
        />
      ))}

      {showLiveAssistant ? (
        <MessageBubble
          block={{ kind: 'assistant', id: 'live-assistant', text: liveContent }}
          markdownImages={turnArtifactImages}
          onOpenImageArtifactInVisualReview={onOpenImageArtifactInVisualReview}
        />
      ) : null}

      <TimelineImageResultsPanel blocks={toolResultImageBlocks} onOpenVisualReview={onOpenImageArtifactInVisualReview} />

      {installedRendererContributions.chatResultPanels.list().map((registered) => (
        <Fragment key={registered.id}>
          {registered.contribution.render({
            blocks: isProcessing ? [] : turn.blocks,
            workspaceRoot,
            sessionId,
            onContinuePrompt: onContinueScientificObject
          })}
        </Fragment>
      ))}

      <TimelineScientificObjectsPanel
        blocks={isProcessing ? [] : turn.blocks}
        workspaceRoot={workspaceRoot}
        onContinuePrompt={onContinueScientificObject}
      />

      {reviewBlocks.map((review) => (
        <ReviewSummaryCard key={review.id} review={review} />
      ))}

      {isProcessing ? <LiveTurnProgressRow /> : null}

      {planResult ? (
        <ReviewPlanCard
          title={planResult.title?.trim() || planDisplayNameFromRelativePath(planResult.relativePath)}
          relativePath={planResult.relativePath}
          busy={planActionsBusy === true}
          onOpen={onOpenPlan}
          onBuild={onBuildPlan}
        />
      ) : null}

      {!isProcessing && turnFileChanges.length > 0 ? (
        <TurnChangeSummary changes={turnFileChanges} viewportRef={viewportRef} />
      ) : null}
    </div>
  )
}

function LiveTurnProgressRow(): ReactElement {
  const { t } = useTranslation('common')

  return (
    <div className="flex w-fit max-w-full items-center gap-2 py-0.5 text-[14px] font-medium text-ds-muted">
      <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
        <AnimatedWorkLogo active phase="trail" size="sm" />
      </span>
      <span className="ds-shiny-text">{t('working')}</span>
    </div>
  )
}

const MemoMessageTurn = memo(MessageTurn, (prev, next) => (
  sameTurnContent(prev.turn, next.turn) &&
  prev.sessionId === next.sessionId &&
  prev.isProcessing === next.isProcessing &&
  prev.terminalStatus === next.terminalStatus &&
  prev.liveReasoning === next.liveReasoning &&
  prev.liveReasoningMeta === next.liveReasoningMeta &&
  prev.live === next.live &&
  prev.durationMs === next.durationMs &&
  prev.liveStartedAtMs === next.liveStartedAtMs &&
  prev.reasoningDurationMs === next.reasoningDurationMs &&
  prev.planActionsBusy === next.planActionsBusy &&
  prev.onBuildPlan === next.onBuildPlan &&
  prev.onOpenPlan === next.onOpenPlan &&
  prev.onOpenImageArtifactInVisualReview === next.onOpenImageArtifactInVisualReview &&
  prev.onContinueScientificObject === next.onContinueScientificObject &&
  prev.viewportRef === next.viewportRef
))
