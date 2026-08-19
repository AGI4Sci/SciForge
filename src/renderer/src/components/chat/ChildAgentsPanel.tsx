import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  CornerUpLeft,
  Clock3,
  ExternalLink,
  Loader2,
  PanelRightClose
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  AgentRuntimeChild,
  AgentRuntimeChildStatus,
  AgentRuntimeChildTranscript,
  AgentRuntimeChildTranscriptEntry
} from '@shared/agent-runtime-contract'
import type { AgentRuntimeId } from '@shared/app-settings'
import type {
  AgentProviderCapabilities,
  AttachmentReference,
  ChatBlock,
  NormalizedThread,
  RuntimeConnectionStatus,
  ToolBlock
} from '../../agent/types'
import type { ModelProviderModelGroup } from '@shared/sciforge-api'
import type { ComposerReasoningEffort } from './FloatingComposerModelPicker'
import type { SideConversation } from '../../store/chat-store-types'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { AssistantMarkdown } from './AssistantMarkdown'
import {
  FloatingComposer,
  type ComposerFileReference,
  type ComposerImageAttachmentInput,
  type ComposerSendIntent
} from './FloatingComposer'
import { MessageTimeline } from './MessageTimeline'
import { ProcessSectionRow, groupProcessSections } from './message-timeline-process'
import { prepareImageAttachmentUpload } from '../../lib/image-attachment-upload'
import { buildImageGenerationWorkflowPrompt } from '../../lib/image-generation-chat'
import {
  readRightPanelContextState,
  rememberRightPanelContextState,
  rightPanelContextStateKey
} from '../right-panel-context-state'
import { useRightPanelSurfaceId } from '../right-panel-session-scope'

export type ChildAgentTFunction = (k: string, opts?: Record<string, unknown>) => string

export type ChildAgentTranscriptState =
  | { status: 'idle' }
  | { status: 'loading'; childId: string }
  | { status: 'loaded'; childId: string; transcript: AgentRuntimeChildTranscript }
  | { status: 'error'; childId: string; message: string }

export type ThreadChildrenState = {
  children: AgentRuntimeChild[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  nextCursor: string | null
  loadMore: () => void
}

type UseThreadChildrenInput = {
  activeThreadId: string | null
  activeRuntimeId?: AgentRuntimeId
  childRefreshKey: number
  runtimeReady: boolean
  busy: boolean
}

export type ChildAgentsPanelProps = {
  activeThreadId: string | null
  activeThread: NormalizedThread | null
  children: AgentRuntimeChild[]
  loading: boolean
  error: string | null
  loadingMore?: boolean
  nextCursor?: string | null
  onLoadMore?: () => void
  focusChildId?: string | null
  focusChildRequestKey?: number
  onOpenChildInFocus?: (child: AgentRuntimeChild) => void
  onCollapse: () => void
  className?: string
}

/**
 * A session-owned child-agent panel. It resolves runtime refresh signals from
 * the store inside the mounted panel, so an inactive session keeps polling its
 * own child tree without following the globally focused thread.
 */
export type SessionChildAgentsPanelProps = {
  sessionId: string
  thread: NormalizedThread | null
  busy?: boolean
  focusChildId?: string | null
  focusChildRequestKey?: number
  onOpenChildInFocus?: (child: AgentRuntimeChild) => void
  onCollapse: () => void
  className?: string
}

export function sessionChildAgentsOwner(
  sessionId: string,
  thread: NormalizedThread | null
): Pick<UseThreadChildrenInput, 'activeThreadId' | 'activeRuntimeId'> {
  return {
    activeThreadId: sessionId.trim() || null,
    activeRuntimeId: thread?.runtimeId
  }
}

export function childAgentsPanelContextStateKey(input: {
  activeThreadId: string | null
  surfaceId: string | null
}): string {
  return rightPanelContextStateKey({
    mode: 'child-agents',
    threadId: input.activeThreadId,
    surfaceId: input.surfaceId
  })
}

export type ChildAgentNavigationCrumb = {
  threadId: string
  runtimeId?: AgentRuntimeId
  label: string
}

export type ChildComposerDraft = {
  attachments: AttachmentReference[]
  fileReferences: ComposerFileReference[]
  uploadBusy: boolean
  uploadError: string | null
}

const EMPTY_CHILD_COMPOSER_DRAFT: ChildComposerDraft = {
  attachments: [],
  fileReferences: [],
  uploadBusy: false,
  uploadError: null
}

type RememberedChildPanelState = {
  selectedChildId: string | null
  navigationPath: ChildAgentNavigationCrumb[]
  composerDrafts: Record<string, ChildComposerDraft>
}

export type ChildAgentsPanelViewProps = {
  activeThreadId: string | null
  activeRuntimeId?: AgentRuntimeId
  children: AgentRuntimeChild[]
  selectedChildId: string | null
  loading: boolean
  error: string | null
  currentTurnId?: string
  loadingMore?: boolean
  nextCursor?: string | null
  onLoadMore?: () => void
  selectedSide: SideConversation | null
  sideLoading: boolean
  runtimeConnection: RuntimeConnectionStatus
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  activeAgentRuntime?: AgentRuntimeId
  runtimeCapabilities?: AgentProviderCapabilities
  transcriptState: ChildAgentTranscriptState
  navigationPath?: ChildAgentNavigationCrumb[]
  selectedComposerDraft?: ChildComposerDraft
  workspaceRoot?: string
  onSelectChild: (childId: string) => void
  onNavigateToDepth?: (depth: number) => void
  onOpenSelectedChildren?: (child: AgentRuntimeChild) => void
  onOpenChildInFocus?: (child: AgentRuntimeChild) => void
  onSideInputChange: (threadId: string, value: string) => void
  onSideSend: (
    threadId: string,
    text: string,
    payload?: {
      attachmentIds?: string[]
      fileReferences?: ComposerFileReference[]
      displayText?: string
    }
  ) => void
  onSidePickAttachments?: (threadId: string, attachments: ComposerImageAttachmentInput[]) => void
  onSidePasteClipboardImage?: (threadId: string, options?: { silentNoImage?: boolean }) => void
  onSideRemoveAttachment?: (threadId: string, attachmentId: string) => void
  onSideAddFileReference?: (threadId: string, reference: ComposerFileReference) => void
  onSideRemoveFileReference?: (threadId: string, relativePath: string, workspaceRoot?: string) => void
  onSideRemoveQueuedMessage: (threadId: string, messageId: string) => void
  onSideInterrupt: (threadId: string) => void
  onSideModelChange: (threadId: string, model: string) => void
  onSideReasoningEffortChange: (threadId: string, effort: ComposerReasoningEffort) => void
  onCollapse: () => void
  className?: string
  t: ChildAgentTFunction
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clipboardImageFile(image: { name: string; mimeType: string; dataBase64: string }): File {
  const binary = atob(image.dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], image.name || 'image', { type: image.mimeType })
}

function mergeChildFileReference(
  references: readonly ComposerFileReference[],
  reference: ComposerFileReference
): ComposerFileReference[] {
  const identity = `${reference.workspaceRoot ?? ''}\u0000${reference.relativePath}`
  return [
    ...references.filter((current) =>
      `${current.workspaceRoot ?? ''}\u0000${current.relativePath}` !== identity
    ),
    reference
  ]
}

export function childAgentShortName(child: AgentRuntimeChild): string {
  return child.name?.trim() || child.label?.trim() || child.id.trim() || 'child'
}

export function filterDirectChildAgents(
  children: readonly AgentRuntimeChild[],
  activeThreadId: string | null,
  activeRuntimeId?: string
): AgentRuntimeChild[] {
  const threadId = activeThreadId?.trim()
  if (!threadId) return []
  const directChildren = children
    .filter((child) => child.parentThreadId === threadId)
    .filter((child) => !activeRuntimeId || child.runtimeId === activeRuntimeId)
  const deduped = new Map<string, AgentRuntimeChild>()
  for (const child of directChildren) {
    const openThreadId = childOpenThreadId(child)
    const openRuntimeId = childOpenThreadRuntimeId(child) ?? child.runtimeId
    const identity = openThreadId
      ? `${openRuntimeId}\u0000thread:${openThreadId}`
      : `${child.runtimeId}\u0000child:${child.id}`
    const existing = deduped.get(identity)
    if (!existing) {
      deduped.set(identity, { ...child })
      continue
    }

    const canonicalId = openThreadId && (existing.id === openThreadId || child.id === openThreadId)
      ? openThreadId
      : existing.id
    const existingUpdatedAt = Date.parse(existing.updatedAt ?? existing.startedAt ?? existing.createdAt ?? '')
    const childUpdatedAt = Date.parse(child.updatedAt ?? child.startedAt ?? child.createdAt ?? '')
    const childIsNewer = Number.isFinite(childUpdatedAt) && (
      !Number.isFinite(existingUpdatedAt) || childUpdatedAt >= existingUpdatedAt
    )
    const primary = childIsNewer ? child : existing
    const fallback = childIsNewer ? existing : child
    deduped.set(identity, {
      ...fallback,
      ...primary,
      id: canonicalId,
      name: primary.name?.trim() ? primary.name : fallback.name,
      label: primary.label?.trim() ? primary.label : fallback.label,
      prompt: primary.prompt?.trim() ? primary.prompt : fallback.prompt,
      summary: primary.summary?.trim() ? primary.summary : fallback.summary,
      transcriptRef: primary.transcriptRef ?? fallback.transcriptRef,
      openAsThreadRef: primary.openAsThreadRef ?? fallback.openAsThreadRef,
      usage: primary.usage ?? fallback.usage
    })
  }
  const records = [...deduped.values()]
  const pairedShadowIds = new Set<string>()
  for (let index = 0; index < records.length; index += 1) {
    const threadChild = records[index]
    if (!childOpenThreadId(threadChild)) continue
    const candidates = records.filter((candidate) =>
      !childOpenThreadId(candidate) &&
      !pairedShadowIds.has(candidate.id) &&
      isSemanticShadowOfThreadChild(candidate, threadChild)
    )
    if (candidates.length !== 1) continue
    const shadow = candidates[0]
    records[index] = mergeShadowChildIntoThreadChild(threadChild, shadow)
    pairedShadowIds.add(shadow.id)
  }
  return records.filter((child) => !pairedShadowIds.has(child.id))
}

export type ChildAgentAttemptInfo = {
  current: number
  total: number
}

export type ChildAgentAttemptGroup = {
  key: string
  primary: AgentRuntimeChild
  attempts: AgentRuntimeChild[]
}

function normalizedAttemptPart(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase() ?? ''
}

function normalizedDelegatedPrompt(child: AgentRuntimeChild): string {
  return normalizedAttemptPart(child.prompt ? stripChildRuntimeGuardrails(child.prompt) : '')
}

function isSemanticShadowOfThreadChild(
  shadow: AgentRuntimeChild,
  threadChild: AgentRuntimeChild
): boolean {
  const parentTurnId = shadow.parentTurnId?.trim()
  if (!parentTurnId || parentTurnId !== threadChild.parentTurnId?.trim()) return false
  if (shadow.runtimeId !== threadChild.runtimeId || shadow.parentThreadId !== threadChild.parentThreadId) return false
  const shadowName = normalizedAttemptPart(shadow.name || shadow.label)
  const threadName = normalizedAttemptPart(threadChild.name || threadChild.label)
  if (!shadowName || shadowName !== threadName) return false
  const shadowPrompt = normalizedDelegatedPrompt(shadow)
  const threadPrompt = normalizedDelegatedPrompt(threadChild)
  return !shadowPrompt || !threadPrompt || shadowPrompt === threadPrompt
}

function mergeShadowChildIntoThreadChild(
  threadChild: AgentRuntimeChild,
  shadow: AgentRuntimeChild
): AgentRuntimeChild {
  const threadTime = childCreatedTime(threadChild)
  const shadowTime = childCreatedTime(shadow)
  const latest = shadowTime > threadTime ? shadow : threadChild
  const status = isActiveChildAttempt(threadChild)
    ? threadChild.status
    : isActiveChildAttempt(shadow)
      ? shadow.status
      : latest.status === 'unknown'
        ? (latest === shadow ? threadChild.status : shadow.status)
        : latest.status
  return {
    ...shadow,
    ...threadChild,
    id: threadChild.id,
    kind: threadChild.kind,
    status,
    name: threadChild.name?.trim() ? threadChild.name : shadow.name,
    label: threadChild.label?.trim() ? threadChild.label : shadow.label,
    prompt: threadChild.prompt?.trim() ? threadChild.prompt : shadow.prompt,
    summary: threadChild.summary?.trim() ? threadChild.summary : shadow.summary,
    usage: threadChild.usage || shadow.usage
      ? { ...(shadow.usage ?? {}), ...(threadChild.usage ?? {}) }
      : undefined,
    transcriptRef: threadChild.transcriptRef ?? shadow.transcriptRef,
    openAsThreadRef: threadChild.openAsThreadRef,
    updatedAt: latest.updatedAt ?? threadChild.updatedAt ?? shadow.updatedAt,
    completedAt: latest.completedAt ?? threadChild.completedAt ?? shadow.completedAt,
    metadata: {
      ...(shadow.metadata ?? {}),
      ...(threadChild.metadata ?? {}),
      shadowChildId: shadow.id
    }
  }
}

function childAgentAttemptGroupKey(child: AgentRuntimeChild): string {
  const name = normalizedAttemptPart(child.name || child.label)
  const prompt = normalizedDelegatedPrompt(child)
  const scope = `${child.runtimeId}\u0000${child.parentThreadId}`
  if (!name || !prompt) return `child\u0000${scope}\u0000${child.id}`
  return `task\u0000${scope}\u0000${name}\u0000${prompt}`
}

function isActiveChildAttempt(child: AgentRuntimeChild): boolean {
  return child.status === 'running' || child.status === 'queued'
}

/**
 * Group only retries of the same logical task. The prompt is part of the
 * identity so two same-name children with different assignments stay separate.
 * Each group promotes its newest active attempt, or otherwise its newest
 * attempt, while retaining the full chronological history.
 */
export function childAgentAttemptGroups(
  children: readonly AgentRuntimeChild[]
): ChildAgentAttemptGroup[] {
  const grouped = new Map<string, AgentRuntimeChild[]>()
  for (const child of children) {
    const key = childAgentAttemptGroupKey(child)
    grouped.set(key, [...(grouped.get(key) ?? []), child])
  }

  const groups = [...grouped.entries()].map(([key, group]) => {
    const attempts = [...group].sort((a, b) => {
      const byTime = childCreatedTime(a) - childCreatedTime(b)
      return byTime || a.id.localeCompare(b.id)
    })
    const active = attempts.filter(isActiveChildAttempt)
    return {
      key,
      primary: active.at(-1) ?? attempts.at(-1)!,
      attempts
    }
  })

  return groups.sort((a, b) => compareChildAgents(a.primary, b.primary))
}

export type ChildAgentListFilter = 'recent' | 'history'

export type ChildAgentHistorySection = {
  turnId: string
  groups: ChildAgentAttemptGroup[]
}

export type ChildAgentGroupBuckets = {
  active: ChildAgentAttemptGroup[]
  recent: ChildAgentAttemptGroup[]
  history: ChildAgentHistorySection[]
  recentTurnId: string | null
}

function groupTurnId(group: ChildAgentAttemptGroup | undefined): string {
  if (!group) return ''
  return group.primary.parentTurnId?.trim() || ''
}

/**
 * Split the bounded runtime page without duplicating a logical retry group.
 * Active work is always its own first bucket. Terminal work from the current
 * turn is recent; older turns remain grouped so the view can keep them folded.
 */
export function childAgentGroupBuckets(
  groups: readonly ChildAgentAttemptGroup[],
  currentTurnId?: string
): ChildAgentGroupBuckets {
  const active = groups.filter((group) => group.attempts.some(isActiveChildAttempt))
  const terminal = groups.filter((group) => !group.attempts.some(isActiveChildAttempt))
  const requestedTurnId = currentTurnId?.trim() || ''
  const recentTurnId = requestedTurnId || groupTurnId(terminal[0] ?? active[0]) || null
  const recent = terminal.filter((group) => {
    const turnId = groupTurnId(group)
    return recentTurnId ? turnId === recentTurnId || !turnId : !turnId
  })
  const historyByTurn = new Map<string, ChildAgentAttemptGroup[]>()
  for (const group of terminal) {
    if (recent.includes(group)) continue
    const turnId = groupTurnId(group) || 'unknown'
    historyByTurn.set(turnId, [...(historyByTurn.get(turnId) ?? []), group])
  }
  const history = [...historyByTurn.entries()].map(([turnId, sectionGroups]) => ({
    turnId,
    groups: sectionGroups
  }))
  return { active, recent, history, recentTurnId }
}

export function filterChildAgentAttemptGroups(
  groups: readonly ChildAgentAttemptGroup[],
  filter: ChildAgentListFilter,
  currentTurnId?: string
): ChildAgentAttemptGroup[] {
  const buckets = childAgentGroupBuckets(groups, currentTurnId)
  if (filter === 'recent') return buckets.recent
  return buckets.history.flatMap((section) => section.groups)
}

export const CHILD_AGENT_HISTORY_PAGE_SIZE = 40

/** Merge cursor pages while replacing repeated active summaries with the newest copy. */
export function mergeChildAgentPages(
  pages: readonly (readonly AgentRuntimeChild[])[]
): AgentRuntimeChild[] {
  const merged = new Map<string, AgentRuntimeChild>()
  for (const page of pages) {
    for (const child of page) {
      if (!merged.has(child.id)) merged.set(child.id, child)
    }
  }
  return [...merged.values()]
}

/**
 * Identify real retries without collapsing them. Repeated native/event records
 * have already been removed by filterDirectChildAgents; records that remain
 * with the same runtime, label and prompt are distinct attempts (usually from
 * a restarted parent turn) and should be presented as such.
 */
export function childAgentAttemptInfo(
  children: readonly AgentRuntimeChild[]
): Map<string, ChildAgentAttemptInfo> {
  const attempts = new Map<string, ChildAgentAttemptInfo>()
  for (const group of childAgentAttemptGroups(children)) {
    if (group.attempts.length < 2) continue
    group.attempts.forEach((child, index) => attempts.set(child.id, {
      current: index + 1,
      total: group.attempts.length
    }))
  }
  return attempts
}

function childCreatedTime(child: AgentRuntimeChild): number {
  const parsed = Date.parse(child.createdAt ?? child.startedAt ?? child.updatedAt ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function childStatusOrder(status: AgentRuntimeChildStatus): number {
  switch (status) {
    case 'running':
      return 0
    case 'queued':
      return 1
    case 'unknown':
    case 'failed':
    case 'aborted':
    case 'completed':
    default:
      return 2
  }
}

export function sortChildAgents(children: readonly AgentRuntimeChild[]): AgentRuntimeChild[] {
  return [...children].sort(compareChildAgents)
}

function compareChildAgents(a: AgentRuntimeChild, b: AgentRuntimeChild): number {
  const byStatus = childStatusOrder(a.status) - childStatusOrder(b.status)
  if (byStatus !== 0) return byStatus
  const parsedATime = Date.parse(a.updatedAt ?? a.startedAt ?? a.createdAt ?? '')
  const parsedBTime = Date.parse(b.updatedAt ?? b.startedAt ?? b.createdAt ?? '')
  const aTime = Number.isFinite(parsedATime) ? parsedATime : 0
  const bTime = Number.isFinite(parsedBTime) ? parsedBTime : 0
  if (aTime !== bTime) return bTime - aTime
  const byName = childAgentShortName(a).localeCompare(childAgentShortName(b))
  return byName || a.id.localeCompare(b.id)
}

export function preferredChildAgentId(
  children: readonly AgentRuntimeChild[],
  currentId: string | null
): string | null {
  const sorted = sortChildAgents(children)
  if (currentId && sorted.some((child) => child.id === currentId)) return currentId
  return sorted[0]?.id ?? null
}

export function childAgentStatusLabel(status: AgentRuntimeChildStatus, t: ChildAgentTFunction): string {
  switch (status) {
    case 'queued':
      return t('sidebarChildrenStatusQueued')
    case 'running':
      return t('sidebarChildrenStatusRunning')
    case 'completed':
      return t('sidebarChildrenStatusCompleted')
    case 'failed':
      return t('sidebarChildrenStatusFailed')
    case 'aborted':
      return t('sidebarChildrenStatusAborted')
    case 'unknown':
    default:
      return t('sidebarChildrenStatusUnknown')
  }
}

function childStatusTone(status: AgentRuntimeChildStatus): string {
  switch (status) {
    case 'running':
      return 'border-emerald-400/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
    case 'queued':
      return 'border-amber-400/35 bg-amber-500/14 text-amber-800 dark:text-amber-200'
    case 'completed':
      return 'border-ds-border-muted bg-ds-subtle text-ds-faint'
    case 'failed':
    case 'aborted':
      return 'border-red-400/35 bg-red-500/12 text-red-700 dark:text-red-300'
    case 'unknown':
    default:
      return 'border-ds-border-muted bg-ds-subtle text-ds-faint'
  }
}

export function ChildAgentStatusIcon({
  status,
  className = 'h-3.5 w-3.5'
}: {
  status: AgentRuntimeChildStatus
  className?: string
}): ReactElement {
  if (status === 'running') return <Loader2 className={`${className} animate-spin`} strokeWidth={2} />
  if (status === 'queued') return <Clock3 className={className} strokeWidth={1.9} />
  if (status === 'completed') return <CheckCircle2 className={className} strokeWidth={1.9} />
  if (status === 'failed' || status === 'aborted') return <CircleAlert className={className} strokeWidth={1.9} />
  return <CircleHelp className={className} strokeWidth={1.9} />
}

function ChildStatusBadge({
  status,
  t
}: {
  status: AgentRuntimeChildStatus
  t: ChildAgentTFunction
}): ReactElement {
  return (
    <span
      className={`inline-flex min-h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10.5px] font-semibold leading-none ${childStatusTone(status)}`}
      title={childAgentStatusLabel(status, t)}
    >
      <ChildAgentStatusIcon status={status} className="h-3 w-3" />
      <span className="truncate">{childAgentStatusLabel(status, t)}</span>
    </span>
  )
}

function childKindLabel(child: AgentRuntimeChild, t: ChildAgentTFunction): string {
  switch (child.kind) {
    case 'workflow':
      return t('sidebarChildrenKindWorkflow')
    case 'thread':
      return t('sidebarChildrenKindThread')
    case 'remote':
      return t('sidebarChildrenKindRemote')
    case 'agent':
    default:
      return t('sidebarChildrenKindAgent')
  }
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

export function formatChildUsage(child: AgentRuntimeChild, t: ChildAgentTFunction): string {
  const usage = child.usage
  if (!usage) return t('sidebarChildrenUsageUnavailable')
  const pieces: string[] = []
  if (typeof usage.totalTokens === 'number') pieces.push(t('sidebarChildrenUsageTotal', { count: formatNumber(usage.totalTokens) }))
  if (typeof usage.inputTokens === 'number') pieces.push(t('sidebarChildrenUsageInput', { count: formatNumber(usage.inputTokens) }))
  if (typeof usage.outputTokens === 'number') pieces.push(t('sidebarChildrenUsageOutput', { count: formatNumber(usage.outputTokens) }))
  if (typeof usage.reasoningTokens === 'number') pieces.push(t('sidebarChildrenUsageReasoning', { count: formatNumber(usage.reasoningTokens) }))
  if (typeof usage.costUsd === 'number') pieces.push(t('sidebarChildrenUsageCost', { cost: `$${usage.costUsd.toFixed(4)}` }))
  return pieces.length > 0 ? pieces.join(' · ') : t('sidebarChildrenUsageUnavailable')
}

function childDetailText(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback
}

function childIdFragment(value: string | undefined): string {
  const id = value?.trim() ?? ''
  if (!id) return '—'
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

export function formatChildTimestamp(child: AgentRuntimeChild): string {
  const raw = child.createdAt ?? child.startedAt ?? child.updatedAt ?? child.completedAt
  if (!raw) return '—'
  const parsed = new Date(raw)
  if (!Number.isFinite(parsed.getTime())) return raw
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(parsed)
}

function childOpenThreadId(child: AgentRuntimeChild | null | undefined): string {
  const threadId = child?.openAsThreadRef?.threadId
  return typeof threadId === 'string' ? threadId.trim() : ''
}

function childOpenThreadRuntimeId(child: AgentRuntimeChild | null | undefined): AgentRuntimeId | undefined {
  return child?.openAsThreadRef?.runtimeId ?? child?.runtimeId
}

function transcriptEntries(transcript: AgentRuntimeChildTranscript): AgentRuntimeChildTranscriptEntry[] {
  const entries = (transcript as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return []
  return entries.filter((entry): entry is AgentRuntimeChildTranscriptEntry =>
    Boolean(entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string')
  )
}

function transcriptEntryText(entry: AgentRuntimeChildTranscriptEntry): string {
  return entry.text?.trim() || entry.summary?.trim() || entry.status?.trim() || ''
}

function stripChildRuntimeGuardrails(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('Child-agent runtime guardrails:')) return text
  const marker = 'Delegated task:'
  const markerIndex = trimmed.indexOf(marker)
  if (markerIndex < 0) return text
  return trimmed.slice(markerIndex + marker.length).trim() || marker
}

function isInternalToolCallMarkup(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? ''
  if (!trimmed) return false
  return /DSML/i.test(trimmed) && /tool_calls/i.test(trimmed) && /invoke\s+name=/i.test(trimmed)
}

function rewriteLegacyCollectedResultsFallback(text: string): string {
  return text
    .replace(
      /^Child agent gathered tool results, but the model kept emitting internal tool-call markup instead of a final answer\.\s*/i,
      'Collected research notes from available sources:\n\n'
    )
    .replace(
      /^子 agent 已经收集到资料，但模型在最终阶段继续输出内部 tool-call 标记，未能生成自然语言总结。\s*/i,
      '已收集到以下资料，供后续汇总使用：\n\n'
    )
    .replace(/^Usable collected results:\s*/im, 'Sources reviewed:\n')
    .replace(/^下面是这次运行已经拿到的可用结果\/来源：\s*/m, '主要来源：\n')
}

function visibleChildSummary(text: string | undefined): string {
  const trimmed = text?.trim() ?? ''
  if (!trimmed || isInternalToolCallMarkup(trimmed)) return ''
  return rewriteLegacyCollectedResultsFallback(trimmed)
}

function transcriptEntryDisplayText(entry: AgentRuntimeChildTranscriptEntry): string {
  const text = transcriptEntryText(entry)
  if (isInternalToolCallMarkup(text)) return ''
  if (entry.kind === 'user_message') return stripChildRuntimeGuardrails(text)
  return rewriteLegacyCollectedResultsFallback(text)
}

function transcriptEntryCallId(entry: AgentRuntimeChildTranscriptEntry): string {
  const callId = entry.metadata?.callId
  return typeof callId === 'string' ? callId.trim() : ''
}

function transcriptEntryPhase(entry: AgentRuntimeChildTranscriptEntry): string {
  const phase = entry.metadata?.phase
  return typeof phase === 'string' ? phase.trim() : ''
}

function normalizeVisibleTranscriptText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function transcriptEntriesForDisplay(
  transcript: AgentRuntimeChildTranscript
): AgentRuntimeChildTranscriptEntry[] {
  const entries = transcriptEntries(transcript)
  const resultCallIds = new Set(
    entries
      .filter((entry) => entry.kind === 'tool' && transcriptEntryPhase(entry) === 'result')
      .map(transcriptEntryCallId)
      .filter(Boolean)
  )
  const seenUserText = new Set<string>()
  return entries.filter((entry) => {
    if (entry.kind === 'assistant_message' && isInternalToolCallMarkup(transcriptEntryText(entry))) return false
    if (entry.kind === 'tool' && transcriptEntryPhase(entry) === 'call') {
      const callId = transcriptEntryCallId(entry)
      if (callId && resultCallIds.has(callId)) return false
    }
    if (entry.kind === 'user_message') {
      const key = normalizeVisibleTranscriptText(stripChildRuntimeGuardrails(transcriptEntryText(entry)))
      if (!key) return false
      if (seenUserText.has(key)) return false
      seenUserText.add(key)
    }
    return true
  })
}

function transcriptRefKey(ref: unknown): string {
  if (!ref) return ''
  try {
    return JSON.stringify(ref) ?? ''
  } catch {
    return String(ref)
  }
}

function transcriptMetadataString(
  entry: AgentRuntimeChildTranscriptEntry,
  keys: readonly string[]
): string {
  const metadata = entry.metadata
  if (!metadata) return ''
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function recordString(record: Record<string, unknown> | null | undefined, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function compactOneLine(text: string, max = 180): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1).trimEnd()}…`
}

function compactToolPayloadText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed || isInternalToolCallMarkup(trimmed)) return ''
  const record = parseJsonRecord(trimmed)
  if (!record) return compactOneLine(trimmed, 220)

  const direct = [
    recordString(record, 'title'),
    recordString(record, 'url') || recordString(record, 'finalUrl'),
    recordString(record, 'query'),
    recordString(record, 'path') || recordString(record, 'file_path'),
    recordString(record, 'pattern'),
    recordString(record, 'error')
  ].filter(Boolean)
  if (direct.length > 0) return compactOneLine(direct.join(' · '), 220)

  const original = record.original
  if (original && typeof original === 'object' && !Array.isArray(original)) {
    const nested = compactToolPayloadText(JSON.stringify(original))
    if (nested) return nested
  }

  const result = record.result
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const content = (result as Record<string, unknown>).content
    if (Array.isArray(content)) {
      const textEntry = content
        .map((entry) => entry && typeof entry === 'object' ? (entry as Record<string, unknown>).text : undefined)
        .find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      if (textEntry) return compactOneLine(textEntry, 220)
    }
  }

  return ''
}

function transcriptToolSummary(
  entry: AgentRuntimeChildTranscriptEntry,
  toolName: string,
  t: ChildAgentTFunction
): string {
  const rawSummary = entry.summary?.trim() || toolName || entry.status?.trim() || t('toolKindTool')
  const payload = compactToolPayloadText(entry.text?.trim() ?? '')
  if (!toolName || !payload) return rawSummary
  if (/^call\s+[a-z0-9_-]+$/i.test(rawSummary) || /^[a-z0-9_-]+\s+(?:result|failed)$/i.test(rawSummary)) {
    return `${toolName}: ${payload}`
  }
  return rawSummary
}

function transcriptToolDetail(entry: AgentRuntimeChildTranscriptEntry, summary: string): string | undefined {
  const text = entry.text?.trim() ?? ''
  if (!text || text === summary || isInternalToolCallMarkup(text)) return undefined
  if (transcriptEntryPhase(entry) === 'call') return undefined
  const compact = compactToolPayloadText(text)
  if (!compact || compact === summary) return undefined
  return compact
}

function transcriptToolStatus(status: string | undefined): ToolBlock['status'] {
  const normalized = status?.trim().toLowerCase()
  if (!normalized) return 'success'
  if (['running', 'pending', 'queued', 'in_progress', 'started'].includes(normalized)) return 'running'
  if (['failed', 'error', 'aborted', 'cancelled', 'canceled'].includes(normalized)) return 'error'
  return 'success'
}

function transcriptEntryToBlock(
  entry: AgentRuntimeChildTranscriptEntry,
  t: ChildAgentTFunction
): ChatBlock | null {
  const text = transcriptEntryDisplayText(entry)
  switch (entry.kind) {
    case 'user_message':
      return text ? { kind: 'user', id: entry.id, createdAt: entry.createdAt, text } : null
    case 'assistant_message':
      return text ? { kind: 'assistant', id: entry.id, createdAt: entry.createdAt, text } : null
    case 'reasoning':
      return text ? { kind: 'reasoning', id: entry.id, createdAt: entry.createdAt, text } : null
    case 'tool': {
      const toolName = transcriptMetadataString(entry, ['toolName', 'tool_name', 'name'])
      const summary = transcriptToolSummary(entry, toolName, t)
      const detail = transcriptToolDetail(entry, summary)
      return {
        kind: 'tool',
        id: entry.id,
        createdAt: entry.createdAt,
        summary,
        status: transcriptToolStatus(entry.status),
        detail,
        meta: {
          ...(entry.metadata ?? {}),
          ...(toolName ? { toolName } : {})
        }
      }
    }
    case 'system':
    case 'event':
      return text
        ? {
            kind: 'system',
            id: entry.id,
            createdAt: entry.createdAt,
            text,
            severity: transcriptToolStatus(entry.status) === 'error' ? 'error' : 'info'
          }
        : null
    default:
      return null
  }
}

function childTranscriptBlocks(
  child: AgentRuntimeChild,
  state: ChildAgentTranscriptState,
  t: ChildAgentTFunction
): ChatBlock[] {
  if (state.status === 'loaded' && state.childId === child.id) {
    const blocks = transcriptEntriesForDisplay(state.transcript)
      .map((entry) => transcriptEntryToBlock(entry, t))
      .filter((block): block is ChatBlock => Boolean(block))
    if (blocks.length > 0) return blocks
    const fallback = state.transcript.content?.trim() || state.transcript.summary?.trim() || state.transcript.reason?.trim()
    if (fallback) return [{ kind: 'assistant', id: `${child.id}-transcript-fallback`, text: fallback }]
  }

  const blocks: ChatBlock[] = []
  const prompt = child.prompt ? stripChildRuntimeGuardrails(child.prompt).trim() : ''
  const summary = visibleChildSummary(child.summary)
  if (prompt) blocks.push({ kind: 'user', id: `${child.id}-prompt`, text: prompt })
  if (summary) blocks.push({ kind: 'assistant', id: `${child.id}-summary`, text: summary })
  return blocks
}

function isConversationBlock(
  block: ChatBlock
): block is Extract<ChatBlock, { kind: 'user' | 'assistant' }> {
  return block.kind === 'user' || block.kind === 'assistant'
}

type ChildTranscriptSegment =
  | { kind: 'message'; block: Extract<ChatBlock, { kind: 'user' | 'assistant' }> }
  | { kind: 'process'; id: string; blocks: ChatBlock[] }

function childTranscriptSegments(blocks: ChatBlock[]): ChildTranscriptSegment[] {
  const segments: ChildTranscriptSegment[] = []
  let processBlocks: ChatBlock[] = []
  const flushProcess = (): void => {
    if (processBlocks.length === 0) return
    const first = processBlocks[0]
    segments.push({ kind: 'process', id: `process-${first.id}`, blocks: processBlocks })
    processBlocks = []
  }

  for (const block of blocks) {
    if (isConversationBlock(block)) {
      flushProcess()
      segments.push({ kind: 'message', block })
      continue
    }
    processBlocks.push(block)
  }
  flushProcess()
  return segments
}

function ChildAgentOverview({
  child,
  attempt,
  t
}: {
  child: AgentRuntimeChild
  attempt?: ChildAgentAttemptInfo
  t: ChildAgentTFunction
}): ReactElement {
  const name = childAgentShortName(child)
  const parentTurnId = child.parentTurnId?.trim()

  return (
    <div
      className="rounded-lg border border-ds-border-muted bg-ds-card/68 p-3"
      role="region"
      aria-label={`${name} ${t('sidebarChildrenDetail')}`}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-ds-border-muted bg-ds-subtle text-ds-faint">
          <Bot className="h-3.5 w-3.5" strokeWidth={1.85} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ds-ink">{name}</span>
            <ChildStatusBadge status={child.status} t={t} />
          </div>
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">
            {childKindLabel(child, t)} · {formatChildUsage(child, t)}
          </div>
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-[auto,minmax(0,1fr)] gap-x-2 gap-y-1 border-t border-ds-border-muted pt-2 text-[10.5px] leading-4 text-ds-faint">
        {attempt ? (
          <>
            <dt>{t('sidebarChildrenAttemptLabel')}</dt>
            <dd>{t('sidebarChildrenAttempt', attempt)}</dd>
          </>
        ) : null}
        <dt>{t('sidebarChildrenParentTurn')}</dt>
        <dd className="truncate font-mono" title={parentTurnId || undefined}>
          {childIdFragment(parentTurnId)}
        </dd>
        <dt>{t('sidebarChildrenStartedAt')}</dt>
        <dd className="truncate" title={child.createdAt ?? child.startedAt ?? child.updatedAt}>
          {formatChildTimestamp(child)}
        </dd>
        <dt>{t('sidebarChildrenChildId')}</dt>
        <dd className="truncate font-mono" title={child.id}>{childIdFragment(child.id)}</dd>
      </dl>

      {child.status === 'aborted' ? (
        <div
          className="mt-2 rounded-md border border-red-400/25 bg-red-500/8 px-2 py-1.5 text-[11px] leading-4 text-red-700 dark:text-red-300"
          role="status"
        >
          {t('sidebarChildrenAbortedNotice')}
        </div>
      ) : null}

      {visibleChildSummary(child.summary) ? (
        <div className="mt-2 line-clamp-2 whitespace-pre-wrap text-[12px] leading-5 text-ds-muted">
          {childDetailText(visibleChildSummary(child.summary), t('sidebarChildrenSummaryEmpty'))}
        </div>
      ) : null}
    </div>
  )
}

function ChildTranscriptMessage({
  block
}: {
  block: Extract<ChatBlock, { kind: 'user' | 'assistant' }>
}): ReactElement {
  if (block.kind === 'user') {
    return (
      <div className="flex min-w-0 justify-end">
        <div className="ds-user-message-bubble min-w-0 max-w-[92%]">
          <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-left">
            {block.text}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group/message flex min-w-0 max-w-full flex-col">
      <div className="ds-markdown ds-chat-answer min-w-0 max-w-full text-ds-ink">
        <AssistantMarkdown text={block.text} streaming={false} />
      </div>
    </div>
  )
}

function ChildTranscriptProcessGroup({
  blocks,
  child,
  t
}: {
  blocks: ChatBlock[]
  child: AgentRuntimeChild
  t: ChildAgentTFunction
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const sections = useMemo(() => groupProcessSections(blocks), [blocks])
  const processing = child.status === 'running' || child.status === 'queued'

  return (
    <div ref={viewportRef} className="min-w-0 space-y-1">
      <div className="text-[12px] font-medium text-ds-muted">
        {t('processed')} · {t('processStepCount', { count: blocks.length })}
      </div>
      <div className="space-y-0.5">
        {sections.map((section) => (
          <ProcessSectionRow
            key={section.id}
            section={section}
            processing={processing}
            singleReasoningSection={sections.length === 1}
            viewportRef={viewportRef}
          />
        ))}
      </div>
    </div>
  )
}

function ChildAgentTranscriptTimeline({
  child,
  state,
  t
}: {
  child: AgentRuntimeChild
  state: ChildAgentTranscriptState
  t: ChildAgentTFunction
}): ReactElement {
  if (state.status === 'loading' && state.childId === child.id) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle/55 px-3 py-2 text-[12px] text-ds-faint">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        {t('sidebarChildrenTranscriptLoading')}
      </div>
    )
  }

  if (state.status === 'error' && state.childId === child.id) {
    return (
      <div className="rounded-lg border border-red-400/25 bg-red-500/8 px-3 py-2 text-[12px] leading-5 text-red-700 dark:text-red-300">
        {t('sidebarChildrenTranscriptError')}: {state.message}
      </div>
    )
  }

  const blocks = childTranscriptBlocks(child, state, t)
  if (blocks.length === 0) {
    return (
      <div className="rounded-lg border border-ds-border-muted bg-ds-subtle/45 px-3 py-3 text-[12.5px] leading-5 text-ds-faint">
        {child.transcriptRef ? t('sidebarChildrenTranscriptEmpty') : t('sidebarChildrenTranscriptUnavailable')}
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-5">
      {childTranscriptSegments(blocks).map((segment) =>
        segment.kind === 'message' ? (
          <ChildTranscriptMessage key={segment.block.id} block={segment.block} />
        ) : (
          <ChildTranscriptProcessGroup key={segment.id} blocks={segment.blocks} child={child} t={t} />
        )
      )}
    </div>
  )
}

function childRuntimeCapabilities(
  capabilities: AgentProviderCapabilities | undefined
): AgentProviderCapabilities | undefined {
  if (!capabilities) return undefined
  return {
    ...capabilities,
    compact: false,
    fork: false,
    goals: false,
    review: false,
    sideConversations: false
  }
}

export type FocusedChildAgentWorkbenchProps = {
  child: AgentRuntimeChild
  side: SideConversation | null
  loading: boolean
  runtimeConnection: RuntimeConnectionStatus
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  activeAgentRuntime?: AgentRuntimeId
  runtimeCapabilities?: AgentProviderCapabilities
  composerDraft: ChildComposerDraft
  workspaceRoot?: string
  onInputChange: (threadId: string, value: string) => void
  onSend: (
    threadId: string,
    text: string,
    payload?: {
      attachmentIds?: string[]
      fileReferences?: ComposerFileReference[]
      displayText?: string
    }
  ) => void
  onPickAttachments?: (threadId: string, attachments: ComposerImageAttachmentInput[]) => void
  onPasteClipboardImage?: (threadId: string, options?: { silentNoImage?: boolean }) => void
  onRemoveAttachment?: (threadId: string, attachmentId: string) => void
  onAddFileReference?: (threadId: string, reference: ComposerFileReference) => void
  onRemoveFileReference?: (threadId: string, relativePath: string, workspaceRoot?: string) => void
  onRemoveQueuedMessage: (threadId: string, messageId: string) => void
  onInterrupt: (threadId: string) => void
  onModelChange: (threadId: string, model: string) => void
  onReasoningEffortChange: (threadId: string, effort: ComposerReasoningEffort) => void
  t: ChildAgentTFunction
}

/**
 * Full child-thread timeline and composer without panel chrome. The right-hand
 * child inspector and the central focus workspace share this surface so their
 * interaction capabilities stay in sync.
 */
export function FocusedChildAgentWorkbench({
  child,
  side,
  loading,
  runtimeConnection,
  composerPickList,
  composerModelGroups,
  activeAgentRuntime,
  runtimeCapabilities,
  composerDraft,
  workspaceRoot,
  onInputChange,
  onSend,
  onPickAttachments,
  onPasteClipboardImage,
  onRemoveAttachment,
  onAddFileReference,
  onRemoveFileReference,
  onRemoveQueuedMessage,
  onInterrupt,
  onModelChange,
  onReasoningEffortChange,
  t
}: FocusedChildAgentWorkbenchProps): ReactElement {
  const [mode, setMode] = useState<'plan' | 'agent'>('agent')
  const threadId = childOpenThreadId(child)
  const effectiveCapabilities = childRuntimeCapabilities(runtimeCapabilities)
  const effectivePickList = side?.model && !composerPickList.includes(side.model)
    ? [side.model, ...composerPickList]
    : composerPickList

  const sendComposerMessage = (intent?: ComposerSendIntent): void => {
    if (!side) return
    const imageGeneration = intent?.kind === 'image-generation'
    const text = imageGeneration
      ? buildImageGenerationWorkflowPrompt(side.input, {
          threadId: side.threadId,
          ...(workspaceRoot ? { workspaceRoot } : {})
        })
      : side.input
    onSend(side.threadId, text, {
      attachmentIds: composerDraft.attachments.map((attachment) => attachment.id),
      fileReferences: composerDraft.fileReferences,
      ...(imageGeneration && side.input.trim() ? { displayText: side.input.trim() } : {})
    })
  }

  if (!threadId) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ChildAgentTranscriptTimeline child={child} state={{ status: 'idle' }} t={t} />
      </div>
    )
  }

  if (loading || !side) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-3 text-[12.5px] text-ds-faint">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          {t('sidebarChildrenTranscriptLoading')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageTimeline
        blocks={side.blocks}
        liveReasoning={side.liveReasoning}
        live={side.liveAssistant}
        activeThreadId={side.threadId}
        runtimeConnection={runtimeConnection}
        runtimeError={side.error}
        onRetryConnection={() => undefined}
        onOpenSettings={() => undefined}
        autoScrollEnabled
        busyOverride={side.busy}
        currentTurnUserIdOverride={side.userItemId}
        turnStartedAtByUserIdOverride={{}}
        turnDurationByUserIdOverride={{}}
        turnReasoningFirstAtByUserIdOverride={{}}
        turnReasoningLastAtByUserIdOverride={{}}
      />
      {side.error ? (
        <div className="mx-3 mb-2 rounded-lg border border-red-400/25 bg-red-500/8 px-3 py-2 text-[12px] leading-5 text-red-700 dark:text-red-300">
          {side.error}
        </div>
      ) : null}
      <div className="ds-no-drag flex shrink-0 justify-center border-t border-ds-border-muted bg-white/94 px-2 pb-3 pt-3 dark:bg-ds-canvas/94">
        <FloatingComposer
          threadIdOverride={side.threadId}
          disableThreadManagementCommands
          preferSteerWhileBusy={side.source === 'child_agent'}
          input={side.input}
          setInput={(value) => onInputChange(side.threadId, value)}
          mode={mode}
          setMode={setMode}
          busy={side.busy}
          runtimeReady={runtimeConnection === 'ready'}
          hasActiveThread
          composerModel={side.model}
          composerPickList={effectivePickList}
          composerModelGroups={composerModelGroups}
          activeAgentRuntime={activeAgentRuntime}
          composerReasoningEffort={side.reasoningEffort}
          onComposerModelChange={(model) => onModelChange(side.threadId, model)}
          onComposerReasoningEffortChange={(effort) => onReasoningEffortChange(side.threadId, effort)}
          queuedMessages={side.queuedMessages ?? []}
          onRemoveQueuedMessage={(messageId) => onRemoveQueuedMessage(side.threadId, messageId)}
          attachments={composerDraft.attachments}
          attachmentUploadEnabled={Boolean(onPickAttachments)}
          attachmentUploadBusy={composerDraft.uploadBusy}
          attachmentUploadError={composerDraft.uploadError}
          fileReferenceEnabled={Boolean(workspaceRoot && onAddFileReference)}
          fileReferences={composerDraft.fileReferences}
          workspaceRootOverride={workspaceRoot}
          preferWorkspaceRootOverride
          onPickAttachments={onPickAttachments
            ? (attachments) => onPickAttachments(side.threadId, attachments)
            : undefined}
          onPasteClipboardImage={onPasteClipboardImage
            ? (options) => onPasteClipboardImage(side.threadId, options)
            : undefined}
          onRemoveAttachment={onRemoveAttachment
            ? (attachmentId) => onRemoveAttachment(side.threadId, attachmentId)
            : undefined}
          onAddFileReference={onAddFileReference
            ? (reference) => onAddFileReference(side.threadId, reference)
            : undefined}
          onRemoveFileReference={onRemoveFileReference
            ? (relativePath, referenceWorkspaceRoot) =>
                onRemoveFileReference(side.threadId, relativePath, referenceWorkspaceRoot)
            : undefined}
          runtimeCapabilities={effectiveCapabilities}
          onSend={sendComposerMessage}
          onInterrupt={() => onInterrupt(side.threadId)}
          hideBtwCommand
        />
      </div>
    </div>
  )
}

export function ChildAgentsPanelView({
  activeThreadId,
  activeRuntimeId,
  children,
  selectedChildId,
  loading,
  error,
  currentTurnId,
  loadingMore = false,
  nextCursor = null,
  onLoadMore,
  selectedSide,
  sideLoading,
  runtimeConnection,
  composerPickList,
  composerModelGroups,
  activeAgentRuntime,
  runtimeCapabilities,
  transcriptState,
  navigationPath = [],
  selectedComposerDraft = EMPTY_CHILD_COMPOSER_DRAFT,
  workspaceRoot,
  onSelectChild,
  onNavigateToDepth,
  onOpenSelectedChildren,
  onOpenChildInFocus,
  onSideInputChange,
  onSideSend,
  onSidePickAttachments,
  onSidePasteClipboardImage,
  onSideRemoveAttachment,
  onSideAddFileReference,
  onSideRemoveFileReference,
  onSideRemoveQueuedMessage,
  onSideInterrupt,
  onSideModelChange,
  onSideReasoningEffortChange,
  onCollapse,
  className = '',
  t
}: ChildAgentsPanelViewProps): ReactElement {
  const directChildren = sortChildAgents(filterDirectChildAgents(children, activeThreadId, activeRuntimeId))
  const attemptGroups = childAgentAttemptGroups(directChildren)
  const buckets = childAgentGroupBuckets(attemptGroups, currentTurnId)
  const [listFilter, setListFilter] = useState<ChildAgentListFilter>(() =>
    buckets.recent.length > 0 ? 'recent' : 'history'
  )
  const [expandedHistoryTurns, setExpandedHistoryTurns] = useState<Set<string>>(() => new Set())
  const visibleTerminalGroups = listFilter === 'history'
    ? buckets.history
        .filter((section) => expandedHistoryTurns.has(section.turnId))
        .flatMap((section) => section.groups)
    : filterChildAgentAttemptGroups(attemptGroups, listFilter, currentTurnId)
  const visibleAttemptGroups = [...buckets.active, ...visibleTerminalGroups]
  const [expandedAttemptGroups, setExpandedAttemptGroups] = useState<Set<string>>(() => new Set())
  const isAttemptGroupExpanded = (group: ChildAgentAttemptGroup): boolean =>
    expandedAttemptGroups.has(group.key) || (
      Boolean(selectedChildId) &&
      selectedChildId !== group.primary.id &&
      group.attempts.some((child) => child.id === selectedChildId)
    )
  const presentationChildren = visibleAttemptGroups.flatMap((group) => {
    if (!isAttemptGroupExpanded(group)) return [group.primary]
    const history = group.attempts
      .filter((child) => child.id !== group.primary.id)
      .reverse()
    return [group.primary, ...history]
  })
  const selectedChild = presentationChildren.find((child) => child.id === selectedChildId) ?? presentationChildren[0] ?? null
  const attemptsByChildId = childAgentAttemptInfo(directChildren)
  const runningCount = attemptGroups.filter((group) => group.attempts.some(isActiveChildAttempt)).length
  const selectListFilter = (nextFilter: ChildAgentListFilter): void => {
    setListFilter(nextFilter)
    const nextTerminalGroups = nextFilter === 'history'
      ? buckets.history
          .filter((section) => expandedHistoryTurns.has(section.turnId))
          .flatMap((section) => section.groups)
      : filterChildAgentAttemptGroups(attemptGroups, nextFilter, currentTurnId)
    const nextGroups = [...buckets.active, ...nextTerminalGroups]
    const selectionStillVisible = nextGroups.some((group) =>
      group.attempts.some((child) => child.id === selectedChildId)
    )
    if (!selectionStillVisible && nextGroups[0]) onSelectChild(nextGroups[0].primary.id)
  }
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const transcriptScrollKey = useMemo(() => {
    if (!selectedChild) return ''
    const pieces = [selectedChild.id, selectedChild.status, selectedChild.updatedAt ?? '']
    if (transcriptState.status === 'loaded' && transcriptState.childId === selectedChild.id) {
      const entries = transcriptEntries(transcriptState.transcript)
      const latest = entries[entries.length - 1]
      pieces.push(String(entries.length), latest?.id ?? '', latest?.createdAt ?? '')
    } else {
      pieces.push(transcriptState.status)
    }
    return pieces.join('\u0000')
  }, [selectedChild, transcriptState])

  useEffect(() => {
    const node = transcriptScrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [transcriptScrollKey])

  return (
    <aside
      className={`ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-white dark:bg-ds-canvas ${className}`}
    >
      <div className="shrink-0 border-b border-ds-border-muted bg-white/92 dark:bg-ds-card">
        <div className="flex h-12 min-w-0 items-center gap-2 px-4">
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Bot className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
            <span className="truncate text-[13px] font-semibold text-ds-ink">
              {t('sidebarChildren')}
            </span>
          </div>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-ds-faint" strokeWidth={2} /> : null}
        </div>
        <div className="grid grid-cols-3 gap-2 px-4 pb-3">
          <ChildAgentStat
            label={t('sidebarChildrenActive')}
            value={runningCount}
            active={Boolean(selectedChild && buckets.active.some((group) =>
              group.attempts.some((child) => child.id === selectedChild.id)
            ))}
            title={t('sidebarChildrenFilterActive')}
            onClick={() => {
              if (buckets.active[0]) onSelectChild(buckets.active[0].primary.id)
            }}
          />
          <ChildAgentStat
            label={t('sidebarChildrenRecent')}
            value={buckets.recent.length}
            active={listFilter === 'recent'}
            title={t('sidebarChildrenFilterRecent')}
            onClick={() => selectListFilter('recent')}
          />
          <ChildAgentStat
            label={t('sidebarChildrenHistory')}
            value={buckets.history.reduce((count, section) => count + section.groups.length, 0)}
            active={listFilter === 'history'}
            title={t('sidebarChildrenFilterHistory')}
            onClick={() => selectListFilter('history')}
          />
        </div>
        {navigationPath.length > 0 ? (
          <nav
            className="flex min-w-0 items-center gap-1 overflow-x-auto px-4 pb-2 text-[11.5px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label={t('sidebarChildrenNavigation')}
          >
            <button
              type="button"
              onClick={() => onNavigateToDepth?.(0)}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <CornerUpLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('sidebarChildrenRoot')}
            </button>
            {navigationPath.map((crumb, index) => {
              const current = index === navigationPath.length - 1
              return (
                <span key={`${crumb.threadId}:${index}`} className="inline-flex min-w-0 shrink-0 items-center gap-1">
                  <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={1.8} />
                  <button
                    type="button"
                    aria-current={current ? 'page' : undefined}
                    onClick={() => onNavigateToDepth?.(index + 1)}
                    className={`h-7 max-w-36 truncate rounded-md px-1.5 font-medium transition ${
                      current
                        ? 'bg-ds-hover text-ds-ink'
                        : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                    }`}
                    title={crumb.label}
                  >
                    {crumb.label}
                  </button>
                </span>
              )
            })}
          </nav>
        ) : null}
        {listFilter === 'recent' && buckets.recentTurnId ? (
          <div className="px-4 pb-2 text-[11px] font-medium text-ds-faint">
            {t('sidebarChildrenCurrentTurn', { turnId: childIdFragment(buckets.recentTurnId) })}
          </div>
        ) : null}
        {listFilter === 'history' && buckets.history.length > 0 ? (
          <div className="space-y-1 px-4 pb-2" aria-label={t('sidebarChildrenHistoryTurns')}>
            {buckets.history.map((section) => {
              const expanded = expandedHistoryTurns.has(section.turnId)
              return (
                <button
                  key={section.turnId}
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => {
                    setExpandedHistoryTurns((current) => {
                      const next = new Set(current)
                      if (expanded) next.delete(section.turnId)
                      else next.add(section.turnId)
                      return next
                    })
                    if (!expanded && section.groups[0]) onSelectChild(section.groups[0].primary.id)
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                >
                  {expanded
                    ? <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                    : <ChevronRight className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />}
                  <span className="min-w-0 flex-1 truncate">
                    {t('sidebarChildrenHistoryTurn', { turnId: childIdFragment(section.turnId) })}
                  </span>
                  <span className="text-ds-faint">{section.groups.length}</span>
                </button>
              )
            })}
          </div>
        ) : null}
        {visibleAttemptGroups.length > 0 ? (
          <div
            role="tablist"
            aria-label={t('sidebarChildren')}
            className="flex min-w-0 gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {visibleAttemptGroups.map((group) => {
              const expanded = isAttemptGroupExpanded(group)
              const displayedAttempts = expanded
                ? [
                    group.primary,
                    ...group.attempts.filter((child) => child.id !== group.primary.id).reverse()
                  ]
                : [group.primary]
              return (
                <div key={group.key} role="presentation" className="inline-flex shrink-0 items-center gap-1">
                  {displayedAttempts.map((child) => {
                    const name = childAgentShortName(child)
                    const attempt = attemptsByChildId.get(child.id)
                    const displayName = attempt
                      ? `${name} · ${t('sidebarChildrenAttempt', attempt)}`
                      : name
                    const active = selectedChild?.id === child.id
                    return (
                      <button
                        key={child.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        title={`${displayName}\n${childAgentStatusLabel(child.status, t)}\n${t('sidebarChildrenParentTurn')}: ${child.parentTurnId ?? '—'}\n${t('sidebarChildrenChildId')}: ${child.id}`}
                        onClick={() => onSelectChild(child.id)}
                        className={`inline-flex h-9 max-w-44 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition ${
                          active
                            ? 'border-accent/45 bg-accent/10 text-ds-ink shadow-sm'
                            : 'border-ds-border-muted bg-ds-card/72 text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                        }`}
                      >
                        <span className={active ? 'text-accent' : 'text-ds-faint'}>
                          <ChildAgentStatusIcon status={child.status} className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 truncate">{displayName}</span>
                      </button>
                    )
                  })}
                  {group.attempts.length > 1 ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={expanded
                        ? t('sidebarChildrenHideAttemptHistory', { count: group.attempts.length - 1 })
                        : t('sidebarChildrenShowAttemptHistory', { count: group.attempts.length - 1 })}
                      title={expanded
                        ? t('sidebarChildrenHideAttemptHistory', { count: group.attempts.length - 1 })
                        : t('sidebarChildrenShowAttemptHistory', { count: group.attempts.length - 1 })}
                      onClick={() => {
                        setExpandedAttemptGroups((current) => {
                          const next = new Set(current)
                          if (expanded) next.delete(group.key)
                          else next.add(group.key)
                          return next
                        })
                        if (expanded && selectedChildId !== group.primary.id &&
                          group.attempts.some((child) => child.id === selectedChildId)) {
                          onSelectChild(group.primary.id)
                        }
                      }}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ds-border-muted bg-ds-card/72 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                    >
                      {expanded
                        ? <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.9} />
                        : <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.9} />}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
        {listFilter === 'history' && nextCursor && onLoadMore ? (
          <div className="px-4 pb-3">
            <button
              type="button"
              disabled={loadingMore}
              onClick={onLoadMore}
              className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-ds-border-muted bg-ds-card/72 px-3 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
            >
              {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
              {loadingMore ? t('sidebarChildrenLoadingMore') : t('sidebarChildrenLoadMore')}
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!activeThreadId ? (
          <div className="h-full px-3 py-3">
            <ChildAgentsEmpty icon={<Bot className="h-6 w-6" strokeWidth={1.6} />} title={t('sidebarChildrenNoThread')} />
          </div>
        ) : directChildren.length === 0 && loading ? (
          <div className="flex items-center gap-2 px-5 py-5 text-[12.5px] text-ds-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            {t('sidebarChildrenLoading')}
          </div>
        ) : directChildren.length === 0 ? (
          <div className="h-full px-3 py-3">
            <ChildAgentsEmpty icon={<Bot className="h-6 w-6" strokeWidth={1.6} />} title={t('sidebarChildrenEmpty')} />
          </div>
        ) : visibleAttemptGroups.length === 0 ? (
          <div className="h-full px-3 py-3">
            <ChildAgentsEmpty
              icon={<Clock3 className="h-6 w-6" strokeWidth={1.6} />}
              title={listFilter === 'recent'
                ? t('sidebarChildrenRecentEmpty')
                : t('sidebarChildrenHistoryCollapsed')}
            />
          </div>
        ) : selectedChild ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {childOpenThreadId(selectedChild) && (onOpenChildInFocus || onOpenSelectedChildren) ? (
              <div className="flex shrink-0 justify-end gap-2 border-b border-ds-border-muted px-3 py-2">
                {onOpenChildInFocus ? (
                  <button
                    type="button"
                    onClick={() => onOpenChildInFocus(selectedChild)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[11.5px] font-medium text-white transition hover:bg-accent/90"
                    title={t('sidebarChildrenOpenInFocus')}
                  >
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {t('sidebarChildrenOpenInFocus')}
                  </button>
                ) : null}
                {onOpenSelectedChildren ? (
                  <button
                    type="button"
                    onClick={() => onOpenSelectedChildren(selectedChild)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card/72 px-2.5 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                    title={t('sidebarChildrenViewNested')}
                  >
                    {t('sidebarChildrenViewNested')}
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                ) : null}
              </div>
            ) : null}
            {childOpenThreadId(selectedChild) ? (
              <FocusedChildAgentWorkbench
                child={selectedChild}
                side={selectedSide}
                loading={sideLoading}
                runtimeConnection={runtimeConnection}
                composerPickList={composerPickList}
                composerModelGroups={composerModelGroups}
                activeAgentRuntime={activeAgentRuntime}
                runtimeCapabilities={runtimeCapabilities}
                composerDraft={selectedComposerDraft}
                workspaceRoot={workspaceRoot}
                onInputChange={onSideInputChange}
                onSend={onSideSend}
                onPickAttachments={onSidePickAttachments}
                onPasteClipboardImage={onSidePasteClipboardImage}
                onRemoveAttachment={onSideRemoveAttachment}
                onAddFileReference={onSideAddFileReference}
                onRemoveFileReference={onSideRemoveFileReference}
                onRemoveQueuedMessage={onSideRemoveQueuedMessage}
                onInterrupt={onSideInterrupt}
                onModelChange={onSideModelChange}
                onReasoningEffortChange={onSideReasoningEffortChange}
                t={t}
              />
            ) : (
            <div ref={transcriptScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
              <ChildAgentOverview child={selectedChild} attempt={attemptsByChildId.get(selectedChild.id)} t={t} />
              <ChildAgentTranscriptTimeline child={selectedChild} state={transcriptState} t={t} />
            </div>
            )}
          </div>
        ) : null}
        {error ? (
          <div className="mx-3 mt-3 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-800 dark:text-amber-200">
            {t('sidebarChildrenLoadError')}: {error}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function ChildAgentStat({
  label,
  value,
  active,
  title,
  onClick
}: {
  label: string
  value: number
  active: boolean
  title: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={title}
      title={title}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-2 text-left transition ${
        active
          ? 'border-accent/35 bg-accent/10 shadow-sm'
          : 'border-transparent bg-ds-surface-subtle hover:border-ds-border-muted hover:bg-ds-hover dark:bg-white/6'
      }`}
    >
      <div className="text-[15px] font-semibold leading-none text-ds-ink">{value}</div>
      <div className={`mt-1 truncate text-[10.5px] font-medium ${active ? 'text-accent' : 'text-ds-faint'}`}>{label}</div>
    </button>
  )
}

function ChildAgentsEmpty({ icon, title }: { icon: ReactElement; title: string }): ReactElement {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-full bg-ds-surface-subtle p-3 text-ds-faint dark:bg-white/6">{icon}</div>
      <div className="max-w-64 text-[12.5px] font-medium leading-5 text-ds-muted">{title}</div>
    </div>
  )
}

export function useThreadChildren({
  activeThreadId,
  activeRuntimeId,
  childRefreshKey,
  runtimeReady,
  busy
}: UseThreadChildrenInput): ThreadChildrenState {
  const [children, setChildren] = useState<AgentRuntimeChild[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const pagesRef = useRef<Array<{ children: AgentRuntimeChild[]; nextCursor: string | null }>>([])
  const generationRef = useRef(0)
  const ownerKeyRef = useRef<string | null>(null)
  const loadMoreInFlightRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let interval: ReturnType<typeof window.setInterval> | null = null

    if (!activeThreadId || !runtimeReady) {
      generationRef.current += 1
      ownerKeyRef.current = null
      pagesRef.current = []
      loadMoreInFlightRef.current = false
      setChildren([])
      setLoading(false)
      setLoadingMore(false)
      setError(null)
      setNextCursor(null)
      return undefined
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    loadMoreInFlightRef.current = false
    setLoadingMore(false)
    const ownerKey = `${activeRuntimeId ?? ''}\u0000${activeThreadId}`
    if (ownerKeyRef.current !== ownerKey) {
      ownerKeyRef.current = ownerKey
      pagesRef.current = []
      setChildren([])
      setNextCursor(null)
    }

    const provider = getProvider()
    provider.rememberThreadRuntime?.(activeThreadId, activeRuntimeId)

    const refresh = async (showLoading: boolean): Promise<void> => {
      if (typeof provider.listThreadChildren !== 'function') {
        if (!cancelled) {
          setChildren([])
          setError(null)
          setLoading(false)
        }
        return
      }
      if (showLoading) setLoading(true)
      try {
        const response = await provider.listThreadChildren(activeThreadId, {
          limit: CHILD_AGENT_HISTORY_PAGE_SIZE
        })
        if (cancelled) return
        const firstPage = {
          children: filterDirectChildAgents(response.children ?? [], activeThreadId, activeRuntimeId),
          nextCursor: response.nextCursor ?? null
        }
        pagesRef.current = [firstPage, ...pagesRef.current.slice(1)]
        setChildren(mergeChildAgentPages(pagesRef.current.map((page) => page.children)))
        setNextCursor(pagesRef.current.at(-1)?.nextCursor ?? null)
        setError(response.degraded && response.reason ? response.reason : null)
      } catch (err) {
        if (!cancelled) setError(messageFromError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void refresh(true)
    // Child refresh events update this view immediately. Keep polling as a
    // conservative fallback so an expensive tree scan cannot interrupt input
    // or window dragging every few seconds.
    interval = window.setInterval(() => void refresh(false), busy ? 10_000 : 30_000)

    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [activeThreadId, activeRuntimeId, busy, childRefreshKey, runtimeReady])

  const loadMore = (): void => {
    const cursor = pagesRef.current.at(-1)?.nextCursor
    if (!activeThreadId || !runtimeReady || !cursor || loadMoreInFlightRef.current) return
    const provider = getProvider()
    if (typeof provider.listThreadChildren !== 'function') return
    const generation = generationRef.current
    loadMoreInFlightRef.current = true
    setLoadingMore(true)
    void provider.listThreadChildren(activeThreadId, {
      cursor,
      limit: CHILD_AGENT_HISTORY_PAGE_SIZE
    }).then((response) => {
      if (generationRef.current !== generation) return
      pagesRef.current = [
        ...pagesRef.current,
        {
          children: filterDirectChildAgents(response.children ?? [], activeThreadId, activeRuntimeId),
          nextCursor: response.nextCursor ?? null
        }
      ]
      setChildren(mergeChildAgentPages(pagesRef.current.map((page) => page.children)))
      setNextCursor(response.nextCursor ?? null)
      setError(response.degraded && response.reason ? response.reason : null)
    }).catch((err: unknown) => {
      if (generationRef.current === generation) setError(messageFromError(err))
    }).finally(() => {
      if (generationRef.current === generation) {
        loadMoreInFlightRef.current = false
        setLoadingMore(false)
      }
    })
  }

  return { children, loading, loadingMore, error, nextCursor, loadMore }
}

export function SessionChildAgentsPanel({
  sessionId,
  thread,
  busy = false,
  focusChildId = null,
  focusChildRequestKey = 0,
  onOpenChildInFocus,
  onCollapse,
  className = ''
}: SessionChildAgentsPanelProps): ReactElement {
  const { runtimeConnection, childRefreshKey } = useChatStore(
    useShallow((state) => ({
      runtimeConnection: state.runtimeConnection,
      childRefreshKey: state.childRefreshKey
    }))
  )
  const owner = sessionChildAgentsOwner(sessionId, thread)
  const childrenState = useThreadChildren({
    ...owner,
    childRefreshKey,
    runtimeReady: runtimeConnection === 'ready',
    busy
  })

  return (
    <ChildAgentsPanel
      activeThreadId={owner.activeThreadId}
      activeThread={thread}
      children={childrenState.children}
      loading={childrenState.loading}
      error={childrenState.error}
      loadingMore={childrenState.loadingMore}
      nextCursor={childrenState.nextCursor}
      onLoadMore={childrenState.loadMore}
      focusChildId={focusChildId}
      focusChildRequestKey={focusChildRequestKey}
      onOpenChildInFocus={onOpenChildInFocus}
      onCollapse={onCollapse}
      className={className}
    />
  )
}

export function ChildAgentsPanel({
  activeThreadId,
  activeThread,
  children,
  loading,
  error,
  loadingMore = false,
  nextCursor = null,
  onLoadMore,
  focusChildId = null,
  focusChildRequestKey = 0,
  onOpenChildInFocus,
  onCollapse,
  className = ''
}: ChildAgentsPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const rightPanelSurfaceId = useRightPanelSurfaceId()
  const sideData = useChatStore(
    useShallow((s) => ({
      sideConversations: s.sideConversations,
      attachSideConversation: s.attachSideConversation,
      sendSideMessage: s.sendSideMessage,
      removeSideQueuedMessage: s.removeSideQueuedMessage,
      interruptSide: s.interruptSide,
      setSideInput: s.setSideInput,
      setSideModel: s.setSideModel,
      setSideReasoningEffort: s.setSideReasoningEffort,
      runtimeConnection: s.runtimeConnection,
      composerPickList: s.composerPickList,
      composerModelGroups: s.composerModelGroups,
      composerModel: s.composerModel,
      activeAgentRuntime: s.activeAgentRuntime
    }))
  )
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  const [navigationPath, setNavigationPath] = useState<ChildAgentNavigationCrumb[]>([])
  const [transcriptState, setTranscriptState] = useState<ChildAgentTranscriptState>({ status: 'idle' })
  const [attachingThreadId, setAttachingThreadId] = useState<string | null>(null)
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ChildComposerDraft>>({})
  const appliedFocusRequestKeyRef = useRef<number | null>(null)
  const restoringContextKeyRef = useRef<string | null>(null)
  const activeRuntimeId = activeThread?.runtimeId
  const currentParent = navigationPath[navigationPath.length - 1]
  const currentParentThreadId = currentParent?.threadId ?? activeThreadId
  const currentRuntimeId = currentParent?.runtimeId ?? activeRuntimeId
  const nestedChildrenState = useThreadChildren({
    activeThreadId: navigationPath.length > 0 ? currentParentThreadId : null,
    activeRuntimeId: currentRuntimeId,
    childRefreshKey: focusChildRequestKey,
    runtimeReady: sideData.runtimeConnection === 'ready',
    busy: false
  })
  const visibleChildren = navigationPath.length > 0 ? nestedChildrenState.children : children
  const visibleLoading = navigationPath.length > 0 ? nestedChildrenState.loading : loading
  const visibleError = navigationPath.length > 0 ? nestedChildrenState.error : error
  const visibleLoadingMore = navigationPath.length > 0 ? nestedChildrenState.loadingMore : loadingMore
  const visibleNextCursor = navigationPath.length > 0 ? nestedChildrenState.nextCursor : nextCursor
  const loadMoreVisibleChildren = navigationPath.length > 0 ? nestedChildrenState.loadMore : onLoadMore
  const directChildren = useMemo(
    () => sortChildAgents(filterDirectChildAgents(visibleChildren, currentParentThreadId, currentRuntimeId)),
    [currentParentThreadId, currentRuntimeId, visibleChildren]
  )
  const selectedChild = directChildren.find((child) => child.id === selectedChildId) ?? directChildren[0] ?? null
  const selectedChildThreadId = childOpenThreadId(selectedChild)
  const selectedSide = selectedChildThreadId
    ? sideData.sideConversations[selectedChildThreadId] ?? null
    : null
  const selectedComposerDraft = selectedChildThreadId
    ? composerDrafts[selectedChildThreadId] ?? EMPTY_CHILD_COMPOSER_DRAFT
    : EMPTY_CHILD_COMPOSER_DRAFT
  const runtimeCapabilities = sideData.runtimeConnection === 'ready'
    ? getProvider().getCapabilities()
    : undefined
  const selectedTranscriptKey = selectedChild
    ? `${currentParentThreadId ?? ''}:${selectedChild.runtimeId}:${selectedChild.id}:${selectedChild.parentTurnId ?? ''}:${selectedChild.updatedAt ?? ''}:${transcriptRefKey(selectedChild.transcriptRef)}`
    : ''
  const contextStateKey = childAgentsPanelContextStateKey({
    activeThreadId,
    surfaceId: rightPanelSurfaceId
  })

  useEffect(() => {
    const remembered = readRightPanelContextState<RememberedChildPanelState>(contextStateKey)
    restoringContextKeyRef.current = contextStateKey
    setSelectedChildId(remembered?.selectedChildId ?? null)
    setNavigationPath(remembered?.navigationPath ?? [])
    setComposerDrafts(Object.fromEntries(
      Object.entries(remembered?.composerDrafts ?? {}).map(([threadId, draft]) => [
        threadId,
        { ...draft, uploadBusy: false }
      ])
    ))
  }, [contextStateKey])

  useEffect(() => {
    if (restoringContextKeyRef.current === contextStateKey) {
      restoringContextKeyRef.current = null
      return
    }
    rememberRightPanelContextState<RememberedChildPanelState>(contextStateKey, {
      selectedChildId,
      navigationPath,
      composerDrafts
    })
  }, [composerDrafts, contextStateKey, navigationPath, selectedChildId])

  const patchComposerDraft = (
    threadId: string,
    patch: (draft: ChildComposerDraft) => ChildComposerDraft
  ): void => {
    setComposerDrafts((current) => ({
      ...current,
      [threadId]: patch(current[threadId] ?? EMPTY_CHILD_COMPOSER_DRAFT)
    }))
  }

  const pickSideAttachments = async (
    threadId: string,
    inputs: ComposerImageAttachmentInput[]
  ): Promise<void> => {
    if (inputs.length === 0) return
    const provider = getProvider()
    patchComposerDraft(threadId, (draft) => ({ ...draft, uploadBusy: true, uploadError: null }))
    try {
      const runtimeInfo = await provider.getRuntimeInfo?.()
      const capabilities = runtimeInfo?.capabilities.attachments
      if (!capabilities || typeof provider.uploadAttachment !== 'function') {
        throw new Error(t('composerAttachmentUnavailable'))
      }
      const uploaded: AttachmentReference[] = []
      for (const input of inputs) {
        if (!input.file.type.startsWith('image/')) continue
        const prepared = await prepareImageAttachmentUpload(input.file, capabilities)
        const attachment = await provider.uploadAttachment({
          name: input.file.name || 'image',
          mimeType: prepared.mimeType,
          dataBase64: prepared.dataBase64,
          textFallback: prepared.textFallback,
          ...(input.path ? { localFilePath: input.path } : {}),
          threadId,
          ...(activeThread?.workspace ? { workspace: activeThread.workspace } : {})
        })
        uploaded.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
          width: attachment.width,
          height: attachment.height,
          previewUrl: `data:${prepared.mimeType};base64,${prepared.dataBase64}`,
          ...(attachment.localFilePath ? { absolutePath: attachment.localFilePath } : {})
        })
      }
      patchComposerDraft(threadId, (draft) => {
        const byId = new Map(draft.attachments.map((attachment) => [attachment.id, attachment]))
        for (const attachment of uploaded) byId.set(attachment.id, attachment)
        return { ...draft, attachments: [...byId.values()], uploadError: null }
      })
    } catch (uploadError) {
      patchComposerDraft(threadId, (draft) => ({
        ...draft,
        uploadError: messageFromError(uploadError)
      }))
    } finally {
      patchComposerDraft(threadId, (draft) => ({ ...draft, uploadBusy: false }))
    }
  }

  useEffect(() => {
    setSelectedChildId((current) =>
      current && directChildren.some((child) => child.id === current) ? current : null
    )
    setTranscriptState({ status: 'idle' })
    appliedFocusRequestKeyRef.current = null
  }, [currentParentThreadId, directChildren])

  useEffect(() => {
    setSelectedChildId((current) => preferredChildAgentId(directChildren, current))
  }, [directChildren])

  useEffect(() => {
    const nextFocusId = focusChildId?.trim() || null
    if (!nextFocusId) {
      appliedFocusRequestKeyRef.current = null
      return
    }
    if (appliedFocusRequestKeyRef.current === focusChildRequestKey) return
    if (navigationPath.length > 0 || !directChildren.some((child) => child.id === nextFocusId)) return
    appliedFocusRequestKeyRef.current = focusChildRequestKey
    setSelectedChildId(nextFocusId)
  }, [directChildren, focusChildId, focusChildRequestKey, navigationPath.length])

  useEffect(() => {
    let cancelled = false
    const child = selectedChild
    const threadId = selectedChildThreadId
    if (!currentParentThreadId || !child || !threadId) {
      setAttachingThreadId(null)
      return undefined
    }
    if (sideData.sideConversations[threadId]) {
      setAttachingThreadId(null)
      return undefined
    }
    setAttachingThreadId(threadId)
    void sideData.attachSideConversation({
      threadId,
      parentThreadId: currentParentThreadId,
      runtimeId: childOpenThreadRuntimeId(child),
      title: childAgentShortName(child),
      model: activeThread?.model ?? sideData.composerModel,
      source: 'child_agent'
    }).finally(() => {
      if (!cancelled) setAttachingThreadId(null)
    })
    return () => {
      cancelled = true
    }
  }, [
    activeThread?.model,
    currentParentThreadId,
    selectedChild,
    selectedChildThreadId,
    sideData
  ])

  useEffect(() => {
    let cancelled = false
    const child = selectedChild

    if (!currentParentThreadId || !child) {
      setTranscriptState({ status: 'idle' })
      return undefined
    }

    if (childOpenThreadId(child)) {
      setTranscriptState({ status: 'idle' })
      return undefined
    }

    if (!child.transcriptRef) {
      setTranscriptState({ status: 'idle' })
      return undefined
    }

    const provider = getProvider()
    if (typeof provider.readChildTranscript !== 'function') {
      setTranscriptState({
        status: 'error',
        childId: child.id,
        message: t('sidebarChildrenTranscriptUnavailable')
      })
      return undefined
    }

    provider.rememberThreadRuntime?.(currentParentThreadId, child.runtimeId)
    setTranscriptState({ status: 'loading', childId: child.id })
    void provider.readChildTranscript({
      runtimeId: child.runtimeId,
      parentThreadId: currentParentThreadId,
      ...(child.parentTurnId ? { parentTurnId: child.parentTurnId } : {}),
      childId: child.id,
      transcriptRef: child.transcriptRef,
      limit: 120
    }).then((response) => {
      if (cancelled) return
      setTranscriptState({ status: 'loaded', childId: child.id, transcript: response.transcript })
    }).catch((err: unknown) => {
      if (cancelled) return
      setTranscriptState({ status: 'error', childId: child.id, message: messageFromError(err) })
    })

    return () => {
      cancelled = true
    }
  }, [currentParentThreadId, selectedChild, selectedTranscriptKey, t])

  return (
    <ChildAgentsPanelView
      activeThreadId={currentParentThreadId}
      activeRuntimeId={currentRuntimeId}
      children={visibleChildren}
      selectedChildId={selectedChildId}
      loading={visibleLoading}
      error={visibleError}
      currentTurnId={navigationPath.length === 0 ? activeThread?.latestTurnId : undefined}
      loadingMore={visibleLoadingMore}
      nextCursor={visibleNextCursor}
      onLoadMore={loadMoreVisibleChildren}
      selectedSide={selectedSide}
      sideLoading={Boolean(selectedChildThreadId && attachingThreadId === selectedChildThreadId && !selectedSide)}
      runtimeConnection={sideData.runtimeConnection}
      composerPickList={sideData.composerPickList}
      composerModelGroups={sideData.composerModelGroups}
      activeAgentRuntime={sideData.activeAgentRuntime}
      runtimeCapabilities={runtimeCapabilities}
      transcriptState={transcriptState}
      navigationPath={navigationPath}
      selectedComposerDraft={selectedComposerDraft}
      workspaceRoot={activeThread?.workspace}
      onSelectChild={(childId) => setSelectedChildId(childId)}
      onNavigateToDepth={(depth) => {
        setNavigationPath((current) => depth <= 0 ? [] : current.slice(0, depth))
      }}
      onOpenSelectedChildren={(child) => {
        const threadId = childOpenThreadId(child)
        if (!threadId) return
        const existingDepth = navigationPath.findIndex((crumb) => crumb.threadId === threadId)
        if (existingDepth >= 0) {
          setNavigationPath((current) => current.slice(0, existingDepth + 1))
          return
        }
        setNavigationPath((current) => [
          ...current,
          {
            threadId,
            runtimeId: childOpenThreadRuntimeId(child),
            label: childAgentShortName(child)
          }
        ])
      }}
      onOpenChildInFocus={onOpenChildInFocus}
      onSideInputChange={(threadId, value) => sideData.setSideInput(threadId, value)}
      onSideSend={(threadId, text, payload) => {
        void sideData.sendSideMessage(threadId, text, payload).then((sent) => {
          if (!sent) return
          patchComposerDraft(threadId, (draft) => ({
            ...draft,
            attachments: [],
            fileReferences: [],
            uploadError: null
          }))
        })
      }}
      onSidePickAttachments={(threadId, attachments) => {
        void pickSideAttachments(threadId, attachments)
      }}
      onSidePasteClipboardImage={(threadId, options) => {
        void (async () => {
          if (typeof window.sciforge?.readClipboardImage !== 'function') {
            patchComposerDraft(threadId, (draft) => ({
              ...draft,
              uploadError: t('composerAttachmentUnavailable')
            }))
            return
          }
          const image = await window.sciforge.readClipboardImage()
          if (!image.ok) {
            if (options?.silentNoImage) return
            patchComposerDraft(threadId, (draft) => ({ ...draft, uploadError: image.message }))
            return
          }
          await pickSideAttachments(threadId, [{ file: clipboardImageFile(image) }])
        })()
      }}
      onSideRemoveAttachment={(threadId, attachmentId) => {
        patchComposerDraft(threadId, (draft) => ({
          ...draft,
          attachments: draft.attachments.filter((attachment) => attachment.id !== attachmentId)
        }))
      }}
      onSideAddFileReference={(threadId, reference) => {
        patchComposerDraft(threadId, (draft) => ({
          ...draft,
          fileReferences: mergeChildFileReference(draft.fileReferences, reference)
        }))
      }}
      onSideRemoveFileReference={(threadId, relativePath, workspaceRoot) => {
        patchComposerDraft(threadId, (draft) => ({
          ...draft,
          fileReferences: draft.fileReferences.filter((reference) =>
            reference.relativePath !== relativePath ||
            (workspaceRoot !== undefined && reference.workspaceRoot !== workspaceRoot)
          )
        }))
      }}
      onSideRemoveQueuedMessage={(threadId, messageId) => {
        sideData.removeSideQueuedMessage(threadId, messageId)
      }}
      onSideInterrupt={(threadId) => {
        void sideData.interruptSide(threadId)
      }}
      onSideModelChange={(threadId, model) => sideData.setSideModel(threadId, model)}
      onSideReasoningEffortChange={(threadId, effort) => sideData.setSideReasoningEffort(threadId, effort)}
      onCollapse={onCollapse}
      className={className}
      t={t}
    />
  )
}
