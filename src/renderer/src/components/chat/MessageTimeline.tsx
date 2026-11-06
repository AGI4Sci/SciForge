import type { ReactElement, RefObject } from 'react'
import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock, RuntimeConnectionStatus, RuntimeDisclosureMetadata } from '../../agent/types'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import { isSessionInputExecuting, isSessionInputOutputPending } from '../../store/chat-session-admission'
import type { VisibleContextComponentSnapshot } from '@shared/visible-context'
import { useChatStore } from '../../store/chat-store'
import { useTimelineStores } from './use-timeline-stores'
import { useTimelineScroll } from './use-timeline-scroll'
import { useConversationSourceNavigation } from './use-conversation-source-navigation'
import { deriveTurnSections } from './derive-turn-sections'
import { MessageTimelineEmptyHero, ThreadForkBanner, ThreadForkPoint } from './message-timeline-empty'
import { MessageBubble } from './message-timeline-bubbles'
import { ReviewPlanCard, ReviewSummaryCard, TurnChangeSummary, WorkMetaRow } from './message-timeline-cards'
import {
  TimelineImageResultsPanel,
  MarkdownImageArtifactProvider,
  timelineImagesFromToolBlocks,
  type TimelineVisualReviewArtifact
} from './message-timeline-media'
import { ProcessSectionRow, groupProcessSections } from './message-timeline-process'
import { AnimatedWorkLogo } from './AnimatedWorkLogo'
import {
  createGroupTurnsMemo,
  sameTurnContent,
  splitThink,
  stableTurnKey,
  turnHasPendingRuntimeWork,
  type Turn
} from './message-timeline-turns'
import { extractPlanMetadataFromBlock } from '../../plan/plan-tool'
import { planDisplayNameFromRelativePath } from '../../plan/plan-path'
import { performanceMonitor } from '../../lib/performance-monitor'
import { registerVisibleContextComponent, registerVisibleContextVisualTarget } from '../../lib/visible-context'
import { TimelineScientificObjectsPanel } from './TimelineScientificObjectsPanel'
import { installedRendererContributions } from '../../domain-modules/installed-renderer-contributions'
import { useStableCallback } from '../../lib/use-stable-callback'
import type { DomainRendererChatResultPanelRenderContext } from '@sciforge/domain-sdk/renderer'
import { normalizeAgentRuntimeTurnState } from '@shared/agent-runtime-contract'
import type { ChatMessagePresentationScope } from '../../domain-modules/chat-message-slot'
import type { AgentRuntimeId } from '@shared/app-settings'

export { summarizeToolBlock } from './message-timeline-process'

const sourceNavigationLabels = {
  loading: 'conversationSourceLoading', ready: 'conversationSourceReady',
  located: 'conversationSourceLocated', missing: 'conversationSourceMissing',
  limited: 'conversationSourceLimited', unavailable: 'conversationSourceUnavailable'
} as const

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
  workspaceRootOverride?: string
  runtimeIdOverride?: AgentRuntimeId
  busyOverride?: boolean
  currentTurnUserIdOverride?: string | null
  turnStartedAtByUserIdOverride?: Record<string, number>
  turnDurationByUserIdOverride?: Record<string, number>
  turnReasoningFirstAtByUserIdOverride?: Record<string, number>
  turnReasoningLastAtByUserIdOverride?: Record<string, number>
  onOpenImageArtifactInVisualReview?: (artifact: TimelineVisualReviewArtifact) => void
  queuedMessages?: QueuedUserMessage[]
  /** Compact conversations do not show the main session usage dashboard. */
  emptyPresentation?: 'dashboard' | 'conversation'
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

export function canonicalTurnId(turn: Turn): string | undefined {
  for (const block of [turn.user, ...turn.blocks]) {
    if (!block || typeof block !== 'object') continue
    const value = Reflect.get(block, 'turnId')
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function chatResultTurnLifecycle(input: Readonly<{
  turnId?: string
  isProcessing: boolean
  isLatest: boolean
  terminalStatus?: string
  threadRevision?: string
}>): DomainRendererChatResultPanelRenderContext['turnLifecycle'] {
  const turnId = input.turnId?.trim()
  if (!turnId) return undefined
  const normalizedStatus = normalizeAgentRuntimeTurnState(input.terminalStatus)
  const phase = input.isProcessing
    ? 'active'
    : normalizedStatus === 'completed'
      ? 'terminal'
      : 'settled'
  return {
    phase,
    revision: [
      turnId,
      phase,
      normalizedStatus ?? input.terminalStatus?.trim().toLowerCase() ?? '',
      input.threadRevision?.trim() ?? ''
    ].join('\0'),
    isLatest: input.isLatest,
    ...(input.terminalStatus?.trim() ? { status: input.terminalStatus.trim() } : {})
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
  workspaceRootOverride,
  runtimeIdOverride,
  busyOverride,
  currentTurnUserIdOverride,
  turnStartedAtByUserIdOverride,
  turnDurationByUserIdOverride,
  turnReasoningFirstAtByUserIdOverride,
  turnReasoningLastAtByUserIdOverride,
  onOpenImageArtifactInVisualReview,
  queuedMessages = [],
  emptyPresentation = 'dashboard'
}: Props): ReactElement {
  const renderStartedAt = performanceMonitor.now()
  const { t } = useTranslation('common')
  const {
    workspaceRoot,
    chooseWorkspace,
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

  const transcriptRuntimeId = runtimeIdOverride ?? activeThread?.runtimeId
  const timelineRuntimeId = transcriptRuntimeId ?? activeAgentRuntime
  const timelineWorkspaceRoot = workspaceRootOverride ?? (activeThread?.workspace?.trim() || workspaceRoot)
  // Hydrated admission records also contain the current execution. Its user
  // message belongs to the transcript, not to a new bubble after the response.
  const pendingQueuedMessages = queuedMessages.filter((message) =>
    !isSessionInputExecuting(message.admissionReceipt) &&
    !isSessionInputOutputPending(message.admissionReceipt))
  const hasContent = blocks.length > 0 || live || liveReasoning || pendingQueuedMessages.length > 0
  const containerRef = useRef<HTMLDivElement>(null)
  const sourceNavigation = useChatStore(state => {
    const navigation = state.conversationSourceNavigation
    return navigation?.threadId === activeThreadId && navigation.runtimeId === timelineRuntimeId ? navigation : null
  })

  // Append-mostly streaming: reuse unchanged prefix turns by reference instead
  // of regrouping every block on each tool/live-output update.
  const [memoizedGroupTurns] = useState(createGroupTurnsMemo)
  const turns = memoizedGroupTurns(blocks)
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
    loadEarlierHistory,
    collapseEarlierTurns,
    revealTurn
  } = useTimelineScroll({
    containerRef,
    activeThreadId,
    pageSize: TURN_PAGE_SIZE,
    autoCollapseThreshold: AUTO_COLLAPSE_THRESHOLD,
    totalTurns: turns.length,
      busy: effectiveBusy,
      autoScrollEnabled: autoScrollEnabled && !sourceNavigation,
      scrollDeps: {
      contentKey: scrollContentKey,
      streaming: Boolean(live.trim() || liveReasoning.trim()),
      userTurnKey: effectiveCurrentTurnUserId ?? ''
    }
  })
  useConversationSourceNavigation(sourceNavigation, containerRef, revealTurn, hiddenTurnCount)
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
    runtimeConnection
  }), () => containerRef.current), [
    activeThreadId,
    blocks.length,
    effectiveBusy,
    hiddenTurnCount,
    live,
    liveReasoning,
    pendingRuntimeTurnCount,
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
    <MarkdownImageArtifactProvider key={`${activeThreadId ?? ''}:${timelineWorkspaceRoot}`} images={[]} workspaceRoot={timelineWorkspaceRoot} threadId={activeThreadId}>
    <div ref={containerRef} className="ds-no-drag flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      {sourceNavigation && <p role="status" className="sticky top-0 z-10 border-b border-ds-border bg-ds-main px-4 py-2 text-xs text-ds-muted">{t(sourceNavigation.status === 'located' && sourceNavigation.itemId && !sourceNavigation.match?.itemFound ? 'conversationSourceItemMissing' : sourceNavigationLabels[sourceNavigation.status])}</p>}
      <div className="ds-message-timeline-content ds-chat-column-inset mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-8 pb-10 pt-8">
        {(!hasContent || !activeThreadId) && emptyPresentation === 'dashboard' ? (
          <MessageTimelineEmptyHero
            ready={runtimeConnection === 'ready'}
            hasWorkspace={!!workspaceRoot}
            runtimeError={runtimeError}
            runtimeId={activeAgentRuntime}
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
              onClick={() => void loadEarlierHistory(loadEarlierThreadHistory)}
              className="ds-chip rounded-full px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
            >
              {serverHistoryLoading
                ? t('loading')
                : t('timelineLoadEarlierHistory')}
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
          const turnId = canonicalTurnId(turn)
          const threadScopedStatus = (
            isLatestTurn &&
            turnId &&
            (!activeThread?.latestTurnId || activeThread.latestTurnId === turnId)
              ? activeThread?.latestTurnStatus
              : undefined
          )
          const terminalStatus = threadScopedStatus ?? turn.user?.turnStatus
          const isProcessing = (effectiveBusy && isLatestTurn) || turnPending || hasLiveStream
          const turnLifecycle = chatResultTurnLifecycle({
            turnId,
            isProcessing,
            isLatest: isLatestTurn,
            terminalStatus,
            threadRevision: isLatestTurn ? activeThread?.updatedAt : turn.user?.createdAt
          })
          const showForkPoint =
            forkBoundaryTurnCount !== undefined && absoluteTurnIndex === forkBoundaryTurnCount
          return (
            <Fragment key={stableTurnKey(turn, absoluteTurnIndex)}>
              {showForkPoint ? <ThreadForkPoint parentTitle={forkedFromTitle} /> : null}
              <div data-conversation-turn={stableTurnKey(turn, absoluteTurnIndex)} className={sourceNavigation?.match?.turnKey === stableTurnKey(turn, absoluteTurnIndex) ? 'rounded-lg ring-2 ring-accent ring-offset-4 ring-offset-ds-main' : undefined}>
              <MemoMessageTurn
                sourceFocused={sourceNavigation?.match?.turnKey === stableTurnKey(turn, absoluteTurnIndex)}
                turn={turn}
                sessionId={activeThreadId ?? undefined}
                workspaceRoot={timelineWorkspaceRoot}
                runtimeId={transcriptRuntimeId}
                threadId={activeThreadId ?? undefined}
                turnId={turnId}
                turnLifecycle={turnLifecycle}
                isProcessing={isProcessing}
                terminalStatus={terminalStatus}
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
              </div>
            </Fragment>
          )
        })}

        {pendingQueuedMessages.map((message) => (
          <div key={`queued-${message.id}`} className="flex min-w-0 justify-end">
            <div
              className="ds-user-message-bubble max-w-[min(85%,42rem)]"
              title={[message.createdAt, message.modelLabel ?? message.model].filter(Boolean).join(' · ') || undefined}
            >
              <div className="ds-selectable-text whitespace-pre-wrap break-words text-left">
                {message.displayText ?? message.text}
              </div>
              <div className="mt-2 flex justify-end gap-2 text-[11px] text-ds-faint">
                {message.createdAt ? <span>{new Date(message.createdAt).toLocaleString()}</span> : null}
                {message.modelLabel ?? message.model ? <span>{message.modelLabel ?? message.model}</span> : null}
              </div>
            </div>
          </div>
        ))}

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
            workspaceRoot={timelineWorkspaceRoot}
            runtimeId={transcriptRuntimeId}
            threadId={activeThreadId ?? undefined}
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
    </MarkdownImageArtifactProvider>
  )
}

const MemoMessageTimelineComponent = memo(MessageTimelineComponent)

function MessageTurn({
  turn,
  sourceFocused,
  sessionId,
  workspaceRoot,
  runtimeId,
  threadId,
  turnId,
  turnLifecycle,
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
  sourceFocused?: boolean
  sessionId?: string
  workspaceRoot: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  turnLifecycle?: DomainRendererChatResultPanelRenderContext['turnLifecycle']
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
  const workExpanded = workExpandedOverride ?? (isProcessing || Boolean(sourceFocused))

  const { timeline, turnFileChanges } = useMemo(
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
  const processBlocks = useMemo(() => timeline.flatMap((section) =>
    section.kind === 'process' ? section.blocks : []), [timeline])
  const processArtifactImages = useMemo(
    () => timelineImagesFromToolBlocks(
      turn.blocks.filter(
        (block): block is Extract<ChatBlock, { kind: 'tool' }> => block.kind === 'tool'
      )
    ),
    [turn.blocks]
  )
  const turnArtifactImages = useMemo(
    () => timelineImagesFromToolBlocks(turn.blocks.filter(
      (block): block is Extract<ChatBlock, { kind: 'tool' }> => block.kind === 'tool' && block.status === 'success'
    )),
    [turn.blocks]
  )

  const timelineSections = useMemo(() => timeline.map((section) => section.kind === 'process'
    ? { ...section, sections: groupProcessSections(section.blocks) }
    : section), [timeline])
  const processSections = useMemo(() => timelineSections.flatMap((section) =>
    section.kind === 'process' ? section.sections : []), [timelineSections])
  const [visibleProcessSectionCount, setVisibleProcessSectionCount] = useState(PROCESS_SECTION_PAGE_SIZE)
  const hiddenProcessSectionCount = Math.max(0, processSections.length - visibleProcessSectionCount)
  const visibleProcessSectionIds = useMemo(() => new Set(processSections
    .slice(hiddenProcessSectionCount).map((section) => section.id)), [processSections, hiddenProcessSectionCount])
  useEffect(() => {
    if (sourceFocused) {
      setWorkExpandedOverride(true)
      setVisibleProcessSectionCount(Number.MAX_SAFE_INTEGER)
    }
  }, [sourceFocused])

  const reasoningSectionCount = useMemo(
    () => processSections.filter((section) => section.kind === 'reasoning').length,
    [processSections]
  )
  const showLiveAssistant = !!liveContent.trim()
  // Keep completed reasoning/tool work tucked away, but make the active turn's
  // work visible unless the user explicitly collapses it.

  const hasProcess = isProcessing || processBlocks.length > 0
  const messagePresentationScope = useMemo<ChatMessagePresentationScope>(() => ({
    sessionId,
    runtimeId,
    threadId,
    turnId,
    turnLifecycle,
    relatedInput: turn.user
  }), [sessionId, runtimeId, threadId, turnId, turnLifecycle, turn.user])

  const turnElement = useRef<HTMLDivElement>(null)
  const anchorId = turnId ?? turn.user?.id
  useEffect(() => {
    if (!threadId || !anchorId) return
    return registerVisibleContextVisualTarget({
      componentId: messageTimelineVisibleContextComponentId(threadId),
      target: {
        id: `turn:${anchorId}`, kind: 'region', contentType: 'text/markdown', active: true,
        metadata: { label: 'Conversation turn', threadId, turnId, runtimeId, workspaceRoot, resourceKind: 'chat-turn', resourceId: `${threadId}/${anchorId}` }
      },
      element: () => turnElement.current
    })
  }, [threadId, anchorId, turnId, runtimeId, workspaceRoot])

  return (
    <div ref={turnElement} className="flex min-w-0 flex-col gap-4">
      {turn.user ? <MessageBubble block={turn.user} threadId={threadId} presentationScope={messagePresentationScope} /> : null}

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
          {workExpanded && hiddenProcessSectionCount > 0 ? (
            <button
              type="button"
              onClick={() => setVisibleProcessSectionCount((count) =>
                Math.min(processSections.length, count + PROCESS_SECTION_PAGE_SIZE))}
              className="mb-1 w-fit rounded-full px-3 py-1.5 text-[12px] font-medium text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('timelineShowEarlierWork', { count: Math.min(hiddenProcessSectionCount, PROCESS_SECTION_PAGE_SIZE) })}
            </button>
          ) : null}
        </div>
      ) : null}

      {timelineSections.map((entry) => {
        const block = entry.kind === 'process' ? entry.blocks[0] : entry.block
        return <Fragment key={block.id}>
          {entry.kind === 'process' ? (
            workExpanded ? <div className="flex flex-col gap-1">
              {entry.sections.filter((section) => visibleProcessSectionIds.has(section.id)).map((section) => (
                <ProcessSectionRow
                  key={section.id}
                  section={section}
                  processing={isProcessing}
                  reasoningDurationMs={reasoningDurationMs}
                  liveStartedAtMs={liveStartedAtMs}
                  singleReasoningSection={reasoningSectionCount === 1}
                  viewportRef={viewportRef}
                  markdownImages={processArtifactImages}
                />
              ))}
            </div> : null
          ) : entry.kind === 'conversation' ? (
            <MessageBubble
              block={entry.block}
              threadId={threadId}
              presentationScope={messagePresentationScope}
              markdownImages={entry.block.kind === 'assistant' ? turnArtifactImages : undefined}
              onOpenImageArtifactInVisualReview={onOpenImageArtifactInVisualReview}
            />
          ) : block.kind === 'review' ? <ReviewSummaryCard review={block} /> : null}
          <TimelineImageResultsPanel
            blocks={block.kind === 'tool' && block.status === 'success' ? [block] : []}
            onOpenVisualReview={onOpenImageArtifactInVisualReview}
          />
          <TimelineScientificObjectsPanel
            blocks={[block]}
            workspaceRoot={workspaceRoot}
            onContinuePrompt={onContinueScientificObject}
          />
          {installedRendererContributions.chatResultPanels.list()
            .filter((registered) => registered.contribution.placement === 'after-item')
            .map((registered) => <Fragment key={registered.id}>
              {registered.contribution.render({
                anchor: { kind: 'item', itemId: block.id },
                blocks: [block], workspaceRoot, sessionId, runtimeId, threadId, turnId,
                turnLifecycle, onContinuePrompt: onContinueScientificObject
              })}
            </Fragment>)}
        </Fragment>
      })}

      {showLiveAssistant ? (
        <MessageBubble
          block={{ kind: 'assistant', id: 'live-assistant', text: liveContent }}
          threadId={threadId}
          presentationScope={messagePresentationScope}
          markdownImages={turnArtifactImages}
          onOpenImageArtifactInVisualReview={onOpenImageArtifactInVisualReview}
        />
      ) : null}

      {installedRendererContributions.chatResultPanels.list()
        .filter((registered) => registered.contribution.placement === 'turn-end')
        .map((registered) => (
          <Fragment key={registered.id}>
            {registered.contribution.render({
              anchor: { kind: 'turn-end' },
              blocks: turn.blocks, workspaceRoot, sessionId, runtimeId, threadId, turnId,
              turnLifecycle, onContinuePrompt: onContinueScientificObject
            })}
          </Fragment>
        ))}

      {isProcessing ? <LiveTurnProgressRow waitingForInput={turn.blocks.some((block) =>
        block.kind === 'user_input' && (block.status === 'pending' || block.status === 'error'))} /> : null}

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

function LiveTurnProgressRow({ waitingForInput }: { waitingForInput: boolean }): ReactElement {
  const { t } = useTranslation('common')

  return (
    <div className="flex w-fit max-w-full items-center gap-2 py-0.5 text-[14px] font-medium text-ds-muted">
      <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
        <AnimatedWorkLogo active={!waitingForInput} phase="trail" size="sm" />
      </span>
      <span className={waitingForInput ? undefined : "ds-shiny-text"}>{t(waitingForInput ? 'userInputPending' : 'working')}</span>
    </div>
  )
}

const MemoMessageTurn = memo(MessageTurn, (prev, next) => (
  sameTurnContent(prev.turn, next.turn) &&
  prev.sourceFocused === next.sourceFocused &&
  prev.sessionId === next.sessionId &&
  prev.workspaceRoot === next.workspaceRoot &&
  prev.runtimeId === next.runtimeId &&
  prev.threadId === next.threadId &&
  prev.turnId === next.turnId &&
  prev.turnLifecycle?.revision === next.turnLifecycle?.revision &&
  prev.turnLifecycle?.isLatest === next.turnLifecycle?.isLatest &&
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
