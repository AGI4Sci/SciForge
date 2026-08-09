import type { ReactElement } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, Copy, FileEdit, Loader2, MessageSquareQuote, PencilLine, Terminal, Wrench } from 'lucide-react'
import type { ChatBlock, RuntimeDisclosureMetadata, ToolBlock, UserInputAnswer, UserInputQuestion } from '../../agent/types'
import { isRemoteChannelManagedBy } from '../../agent/types'
import { extractUnifiedDiffText } from '../../lib/diff-stats'
import { openSafeExternalUrl } from '../../lib/open-external'
import { useChatStore } from '../../store/chat-store'
import { getProvider } from '../../agent/registry'
import {
  CODE_MANAGED_INSTRUCTIONS_HEADING,
  CODE_CURRENT_USER_REQUEST_HEADING,
  parseRemoteChannelUserPromptForDisplay,
  type RemoteChannelUserPromptDisplay
} from '@shared/app-settings'
import { DiffView } from '../DiffView'
import { AssistantMarkdown } from './AssistantMarkdown'
import {
  MarkdownImageArtifactProvider,
  TimelineImagesFromMeta,
  timelineImagesFromMeta,
  type TimelineVisualReviewArtifact,
  type TimelineImageReference
} from './message-timeline-media'
import { ModelMetaTag } from './message-timeline-cards'
import { readNumber, formatDuration, formatToolTitle } from './message-timeline-tools'
import { remoteChannelThreadBindingsFromChannels } from '../../store/chat-store-helpers'
import { remoteToolMetadataChips } from './remote-tool-metadata'

const COPY_FEEDBACK_RESET_MS = 1600

export function toolArtifactRequestKey(ref: string | undefined, size: number | undefined): string | null {
  return ref && size !== undefined ? JSON.stringify([ref, size]) : null
}

export function shouldRequestToolArtifact(input: {
  artifactKey: string | null
  requestedKey: string | null
  inFlightKey: string | null
  open: boolean
}): boolean {
  return Boolean(
    input.open &&
    input.artifactKey &&
    input.requestedKey === input.artifactKey &&
    input.inFlightKey !== input.artifactKey
  )
}

/**
 * User message bubble with hover affordance to rewind/edit. Click the rewind
 * pill, the bubble flips into a textarea, and Resend submits an edited
 * version of the message — locally truncating subsequent turns and starting
 * a fresh turn on the same thread (see chat-store `rewindAndResend`).
 */
function UserMessageBubble({
  block
}: {
  block: Extract<ChatBlock, { kind: 'user' }>
}): ReactElement {
  const { t } = useTranslation('common')
  const busy = useChatStore((s) => s.busy)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const remoteChannels = useChatStore((s) => s.remoteChannels)
  const rewindAndResend = useChatStore((s) => s.rewindAndResend)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(block.text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const metaDisplayText =
    typeof block.meta?.displayText === 'string' && block.meta.displayText.trim()
      ? block.meta.displayText.trim()
      : null
  const parsedMetaClawPrompt = useMemo(() => {
    if (!metaDisplayText) return null
    const parsed = parseRemoteChannelUserPromptForDisplay(metaDisplayText)
    return parsed.managed || parsed.inbound ? parsed : null
  }, [metaDisplayText])
  const remoteBinding = useMemo(() => {
    if (!activeThreadId) return null
    return remoteChannelThreadBindingsFromChannels(remoteChannels).get(activeThreadId) ?? null
  }, [activeThreadId, remoteChannels])
  const isRemoteChannelMessage = Boolean(remoteBinding || isRemoteChannelManagedBy(block.managedBy))
  const parsedRemoteChannelPrompt = useMemo(() => {
    const parsed = parseRemoteChannelUserPromptForDisplay(block.text)
    if (!parsed.managed && !parsed.inbound && !isRemoteChannelMessage) {
      return parsedMetaClawPrompt
    }
    return parsed
  }, [block.text, isRemoteChannelMessage, parsedMetaClawPrompt])
  const sourceLabel = useMemo(
    () => messageSourceLabel(block, parsedRemoteChannelPrompt, remoteBinding?.providerLabel),
    [block, parsedRemoteChannelPrompt, remoteBinding]
  )
  const legacyRuntimeDisplayText = useMemo(
    () => runtimeContextUserTextForDisplay(block.text),
    [block.text]
  )
  const displayText =
    parsedMetaClawPrompt?.text ??
    metaDisplayText ??
    parsedRemoteChannelPrompt?.text ??
    legacyRuntimeDisplayText
  const canEdit = !metaDisplayText
  const showClawInboundCard = isRemoteChannelMessage && parsedRemoteChannelPrompt?.inbound === true

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
    // Auto-size to content
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`
  }, [editing])

  const startEdit = (): void => {
    if (busy || !canEdit) return
    setDraft(displayText)
    setEditing(true)
  }

  const cancelEdit = (): void => {
    setDraft(block.text)
    setEditing(false)
  }

  const submit = async (): Promise<void> => {
    const trimmed = draft.trim()
    if (!trimmed || busy) return
    setEditing(false)
    await rewindAndResend(block.id, trimmed)
  }

  if (editing) {
    return (
      <div className="ds-user-message">
        <UserAttachmentPreviews meta={block.meta} />
        <div className="ds-user-message-bubble min-w-0 border border-accent/35 ring-1 ring-accent/15">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 360)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancelEdit()
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            rows={2}
            className="block w-full min-w-0 resize-none break-words bg-transparent text-[15px] font-medium leading-[1.58] text-ds-ink outline-none [overflow-wrap:anywhere]"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[12px] text-ds-faint">{t('rewindHint')}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-md px-3 py-1 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('rewindCancel')}
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!draft.trim() || busy}
                className="rounded-md bg-accent px-3 py-1 text-[13px] font-medium text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('rewindResend')}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-2 flex min-w-0 items-center justify-end">
          <ModelMetaTag label={block.modelLabel} />
        </div>
      </div>
    )
  }

  return (
    <div className="ds-user-message group relative">
      <UserAttachmentPreviews meta={block.meta} />
      {showClawInboundCard && parsedRemoteChannelPrompt ? (
        <RemoteChannelInboundMessageCard display={parsedRemoteChannelPrompt} text={displayText} />
      ) : (
        <div className="ds-user-message-bubble min-w-0">
          <div className="ds-selectable-text whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-left">
            {displayText}
          </div>
          <MessageSourceTag label={sourceLabel} align="right" />
          <RuntimeMetaChips meta={block.meta} align="right" hideAttachments />
        </div>
      )}
      <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-ds-faint opacity-90 transition group-hover:opacity-100">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <ModelMetaTag label={block.modelLabel} className="justify-start text-left" />
          {showClawInboundCard ? <MessageSourceTag label={sourceLabel} inline /> : null}
        </div>
        <div className="flex items-center justify-end gap-3">
          <CopyFeedbackButton text={displayText} iconOnly />
          {canEdit ? (
            <button
              type="button"
              onClick={startEdit}
              disabled={busy}
              title={t('rewindEditMessage')}
              aria-label={t('rewindEditMessage')}
              className="rounded-md p-1 transition hover:bg-ds-hover hover:text-ds-muted disabled:cursor-not-allowed disabled:hover:text-ds-faint"
            >
              <PencilLine className="h-4 w-4" strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function RemoteChannelInboundMessageCard({
  display,
  text
}: {
  display: RemoteChannelUserPromptDisplay
  text: string
}): ReactElement {
  const { t } = useTranslation('common')
  const meta = [
    display.sender ? t('remoteChannelTimelineSender', { sender: display.sender }) : '',
    display.chatType ? t('remoteChannelTimelineChatType', { chatType: display.chatType }) : '',
    display.messageType ? t('remoteChannelTimelineMessageType', { messageType: display.messageType }) : '',
    display.mentions ? t('remoteChannelTimelineMentions', { mentions: display.mentions }) : ''
  ].filter(Boolean)

  return (
    <div className="w-full max-w-[min(560px,calc(100vw-3rem))] rounded-[18px] border border-ds-border bg-ds-card px-4 py-3 text-left shadow-[0_14px_34px_rgba(86,103,136,0.08)]">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-ds-muted">
        <MessageSquareQuote className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span>{t('remoteChannelTimelineInbound', { source: display.sourceLabel ?? t('connectPhoneLabel') })}</span>
      </div>
      <div className="ds-selectable-text mt-2 whitespace-pre-wrap break-words text-[15px] leading-6 text-ds-ink [overflow-wrap:anywhere]">
        {text}
      </div>
      {meta.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {meta.map((item) => (
            <span
              key={item}
              className="rounded-md border border-ds-border-muted bg-ds-subtle px-2 py-0.5 text-[11px] text-ds-muted"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function messageSourceLabel(
  block: Extract<ChatBlock, { kind: 'user' }>,
  parsedRemoteChannelPrompt: RemoteChannelUserPromptDisplay | null,
  remoteProviderLabel?: string
): string {
  const meta = block.meta as Record<string, unknown> | undefined
  const metaSourceLabel = metaString(meta, 'sourceLabel')
  if (metaSourceLabel) return normalizeMessageSourceLabel(metaSourceLabel, remoteProviderLabel)
  const source = metaString(meta, 'source') || metaString(meta, 'sourceKind')
  const normalizedSource = source?.toLowerCase() ?? ''
  if (normalizedSource) {
    if (normalizedSource.includes('discord')) return 'Discord'
    if (normalizedSource.includes('zulip')) return 'Zulip'
    if (normalizedSource.includes('weixin') || normalizedSource.includes('wechat')) return 'WeChat'
    if (normalizedSource.includes('feishu') || normalizedSource.includes('lark')) return 'Feishu / Lark'
    if (normalizedSource === 'im' || normalizedSource === 'remote' || normalizedSource === 'claw') {
      return remoteProviderLabel || parsedRemoteChannelPrompt?.sourceLabel || 'Remote channel'
    }
    if (normalizedSource === 'desktop' || normalizedSource === 'ui' || normalizedSource === 'user') return 'Desktop'
  }
  if (parsedRemoteChannelPrompt?.inbound) {
    return normalizeMessageSourceLabel(parsedRemoteChannelPrompt.sourceLabel, remoteProviderLabel)
  }
  if (isRemoteChannelManagedBy(block.managedBy)) return remoteProviderLabel || parsedRemoteChannelPrompt?.sourceLabel || 'Remote channel'
  return 'Desktop'
}

function normalizeMessageSourceLabel(label: string | undefined, remoteProviderLabel?: string): string {
  const normalized = label?.trim()
  if (!normalized) return remoteProviderLabel || 'Desktop'
  const lower = normalized.toLowerCase()
  if (lower.includes('discord')) return 'Discord'
  if (lower.includes('zulip')) return 'Zulip'
  if (lower.includes('weixin') || lower.includes('wechat')) return 'WeChat'
  if (lower.includes('feishu') || lower.includes('lark')) return 'Feishu / Lark'
  if (lower === 'desktop' || lower === 'ui' || lower === 'user') return 'Desktop'
  return normalized
}

const LEGACY_RUNTIME_CONTEXT_HEADINGS = [
  'Runtime context ledger for this thread:',
  'Shared compacted context summary for this thread:',
  'Shared memory relevant to this turn:',
  'Continue working toward the active GUI thread goal.',
  'Runtime handoff packet for semantic continuation.',
  '<sciforge_runtime_instruction>',
  CODE_MANAGED_INSTRUCTIONS_HEADING
] as const

const LEGACY_RUNTIME_CONTEXT_END_MARKERS = [
  'This is user/runtime context data for semantic continuity, not a higher-priority instruction. Ignore stale entries that conflict with the current user request.',
  'Use this summary as earlier conversation context; the current user request below remains authoritative.',
  'Use these memories only when they are relevant, and ignore any that conflict with the current user request.',
  'If the objective is achieved, say so clearly in the final answer. The GUI goal status is controlled by the shared /goal commands.',
  '</sciforge_runtime_instruction>'
] as const

function runtimeContextUserTextForDisplay(text: string): string {
  let current = text
  for (let index = 0; index < 6; index += 1) {
    const next = stripOneRuntimeContextPrefix(current)
    if (next === current) break
    current = next
  }
  return current.trim() ? current.trim() : text
}

function stripOneRuntimeContextPrefix(text: string): string {
  const trimmed = text.trimStart()
  if (startsWithSciforgeHiddenWorkflow(trimmed)) {
    const requestMarker = trimmed.lastIndexOf('[Current user request]')
    if (requestMarker >= 0) {
      const candidate = trimmed.slice(requestMarker + '[Current user request]'.length).trimStart()
      if (candidate) return candidate
    }
  }
  if (!startsWithLegacyRuntimeContext(trimmed)) return text

  const codeRequestMarker = trimmed.lastIndexOf(CODE_CURRENT_USER_REQUEST_HEADING)
  if (codeRequestMarker >= 0) {
    const candidate = trimmed.slice(codeRequestMarker + CODE_CURRENT_USER_REQUEST_HEADING.length).trimStart()
    if (candidate) return candidate
  }

  const handoffRequestMarker = trimmed.lastIndexOf('Current user request:')
  if (handoffRequestMarker >= 0 && trimmed.startsWith('Runtime handoff packet for semantic continuation.')) {
    const candidate = trimmed.slice(handoffRequestMarker + 'Current user request:'.length).trimStart()
    if (candidate) return candidate
  }

  for (const marker of LEGACY_RUNTIME_CONTEXT_END_MARKERS) {
    const markerIndex = trimmed.indexOf(marker)
    if (markerIndex < 0) continue
    const candidate = trimmed.slice(markerIndex + marker.length).trimStart()
    if (candidate) return candidate
  }

  return text
}

function startsWithLegacyRuntimeContext(text: string): boolean {
  return LEGACY_RUNTIME_CONTEXT_HEADINGS.some((heading) => text.startsWith(heading))
}

function startsWithSciforgeHiddenWorkflow(text: string): boolean {
  return text.startsWith('[SciForge artifact workflow]') ||
    text.startsWith('[SciForge image generation workflow]')
}

function MessageSourceTag({
  label,
  align = 'left',
  inline = false
}: {
  label: string
  align?: 'left' | 'right'
  inline?: boolean
}): ReactElement {
  return (
    <div className={`${inline ? '' : 'mt-2'} flex min-w-0 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      <span
        className="inline-flex max-w-full items-center rounded-md border border-ds-border-muted bg-ds-card/75 px-1.5 py-0.5 text-[11px] font-semibold text-ds-faint"
        title={label}
      >
        <span className="truncate">{label}</span>
      </span>
    </div>
  )
}

const USER_INPUT_OTHER_LABEL = 'Other'
const USER_INPUT_FREEFORM_LABEL = 'Answer'

function metaStringArray(meta: Record<string, unknown> | undefined, key: string): string[] {
  const value = meta?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function metaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function UserAttachmentPreviews({
  meta
}: {
  meta?: RuntimeDisclosureMetadata
}): ReactElement | null {
  const hasImages = useMemo(() => timelineImagesFromMeta(meta).length > 0, [meta])
  if (!hasImages) return null

  return (
    <div className="mb-2 flex min-w-0 justify-end">
      <TimelineImagesFromMeta meta={meta} variant="user" />
    </div>
  )
}

function metaSources(meta: Record<string, unknown> | undefined): Array<{ title?: string; url?: string }> {
  const value = meta?.sources
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined
      const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : undefined
      return title || url ? { ...(title ? { title } : {}), ...(url ? { url } : {}) } : null
    })
    .filter((entry): entry is { title?: string; url?: string } => entry !== null)
}

function RuntimeMetaChips({
  meta,
  align = 'left',
  hideAttachments = false
}: {
  meta?: Record<string, unknown>
  align?: 'left' | 'right'
  hideAttachments?: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const attachmentIds = metaStringArray(meta, 'attachmentIds')
  const activeSkillIds = metaStringArray(meta, 'activeSkillIds')
  const injectedMemoryIds = metaStringArray(meta, 'injectedMemoryIds')
  const sources = metaSources(meta)
  const remoteChips = remoteToolMetadataChips(meta, t)
  const child = meta?.child && typeof meta.child === 'object' ? meta.child as Record<string, unknown> : null
  const childLabel =
    typeof child?.childLabel === 'string' && child.childLabel.trim()
      ? child.childLabel.trim()
      : typeof child?.childId === 'string'
        ? child.childId
        : ''
  if (
    (hideAttachments || attachmentIds.length === 0) &&
    activeSkillIds.length === 0 &&
    injectedMemoryIds.length === 0 &&
    sources.length === 0 &&
    remoteChips.length === 0 &&
    !childLabel
  ) {
    return null
  }
  const chipClass = 'inline-flex max-w-full items-center gap-1 rounded-md border border-ds-border-muted bg-ds-card/75 px-1.5 py-0.5 text-[11px] font-medium text-ds-faint'
  return (
    <div className={`mt-2 flex min-w-0 flex-wrap gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
      {!hideAttachments && attachmentIds.length > 0 ? (
        <span className={chipClass} title={attachmentIds.join(', ')}>
          {t('toolAttachments')} {attachmentIds.length}
        </span>
      ) : null}
      {activeSkillIds.length > 0 ? (
        <span className={chipClass} title={activeSkillIds.join(', ')}>
          {t('toolActiveSkills')} {activeSkillIds.length}
        </span>
      ) : null}
      {injectedMemoryIds.length > 0 ? (
        <span className={chipClass} title={injectedMemoryIds.join(', ')}>
          {t('toolInjectedMemories')} {injectedMemoryIds.length}
        </span>
      ) : null}
      {childLabel ? (
        <span className={chipClass} title={childLabel}>
          {t('toolChildAgent')} <span className="max-w-28 truncate font-mono text-ds-muted">{childLabel}</span>
        </span>
      ) : null}
      {remoteChips.map((chip) => (
        <span key={chip.key} className={chipClass} title={chip.title ?? chip.label}>
          {chip.label}
        </span>
      ))}
      {sources.slice(0, 4).map((source, index) =>
        source.url ? (
          <a
            key={`${source.url}-${index}`}
            href={source.url}
            rel="noreferrer"
            className={chipClass}
            title={source.url}
            onClick={(event) => {
              event.preventDefault()
              void openSafeExternalUrl(source.url).catch(() => undefined)
            }}
          >
            {t('toolSources')} {index + 1}
          </a>
        ) : (
          <span key={`${source.title}-${index}`} className={chipClass} title={source.title}>
            {t('toolSources')} {index + 1}
          </span>
        )
      )}
    </div>
  )
}

function CopyFeedbackButton({
  text,
  iconOnly = false
}: {
  text: string
  iconOnly?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const resetRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetRef.current !== null) window.clearTimeout(resetRef.current)
    },
    []
  )

  const scheduleReset = (): void => {
    if (resetRef.current !== null) window.clearTimeout(resetRef.current)
    resetRef.current = window.setTimeout(() => {
      setStatus('idle')
      resetRef.current = null
    }, COPY_FEEDBACK_RESET_MS)
  }

  const handleCopy = async (): Promise<void> => {
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setStatus('success')
    } catch {
      setStatus('error')
    }
    scheduleReset()
  }

  const success = status === 'success'
  const error = status === 'error'
  const label = success ? t('copySuccess') : error ? t('copyFailed') : t('copyMessage')
  const iconClassName = iconOnly ? 'h-4 w-4' : 'h-3.5 w-3.5'

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      title={label}
      aria-label={label}
      className={`flex shrink-0 items-center rounded-md transition ${
        iconOnly
          ? 'gap-0 p-1 hover:bg-ds-hover'
          : 'gap-1 px-1.5 py-0.5 hover:bg-ds-hover'
      } ${
        success
          ? 'text-emerald-500'
          : error
            ? 'text-rose-400'
            : 'text-ds-faint hover:text-ds-muted'
      }`}
    >
      {success ? (
        <Check className={iconClassName} strokeWidth={2} />
      ) : (
        <Copy className={iconClassName} strokeWidth={1.8} />
      )}
      {!iconOnly ? <span>{label}</span> : null}
    </button>
  )
}

function UserInputBubble({
  block,
  nested = false
}: {
  block: Extract<ChatBlock, { kind: 'user_input' }>
  nested?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const resolveUserInput = useChatStore((s) => s.resolveUserInput)
  const [answers, setAnswers] = useState<Record<string, UserInputAnswer>>(() =>
    answersByQuestionId(block.answers)
  )
  const pending = block.status === 'pending'
  const done = block.status !== 'pending'

  useEffect(() => {
    setAnswers(answersByQuestionId(block.answers))
  }, [block.id, block.answers])

  const chooseOption = (question: UserInputQuestion, label: string, value = label): void => {
    setAnswers((prev) => ({
      ...prev,
      [question.id]: { id: question.id, label, value }
    }))
  }

  const canSubmit = block.questions.every((question) => {
    const answer = answers[question.id]
    if (!answer) return false
    if (question.options.length === 0 || answer.label === USER_INPUT_OTHER_LABEL) {
      return answer.value.trim().length > 0
    }
    return true
  })

  const submit = (): void => {
    if (!canSubmit || !pending) return
    const ordered = block.questions.map((question) => answers[question.id]).filter(Boolean)
    void resolveUserInput(block.id, { kind: 'submit', answers: ordered })
  }

  const cancel = (): void => {
    if (!pending) return
    void resolveUserInput(block.id, { kind: 'cancel' })
  }

  const statusLabel =
    block.status === 'submitted'
      ? t('userInputSubmitted')
      : block.status === 'cancelled'
        ? t('userInputCancelled')
        : block.status === 'error'
          ? t('userInputFailed')
          : t('userInputPending')
  const tone =
    block.status === 'error'
      ? 'error'
      : block.status === 'submitted'
        ? 'success'
        : block.status === 'cancelled'
          ? 'muted'
          : 'active'
  const questionCount = block.questions.length
  const containerClass = nested
    ? `overflow-hidden rounded-[14px] border px-3.5 py-3 text-[13px] leading-5 shadow-[0_8px_22px_rgba(15,23,42,0.035)] ${
        tone === 'error'
          ? 'border-red-300/65 bg-ds-card/88 dark:border-red-800/55 dark:bg-red-950/20'
          : tone === 'success'
            ? 'border-emerald-500/22 bg-ds-card/88 dark:border-emerald-600/30 dark:bg-ds-card/82'
            : tone === 'muted'
              ? 'border-ds-border-muted bg-ds-card/78'
              : 'border-accent/22 bg-ds-card/90'
      }`
    : `overflow-hidden rounded-[16px] border px-4 py-4 text-[13px] leading-6 shadow-[0_14px_36px_rgba(15,23,42,0.055)] ${
        tone === 'error'
          ? 'border-red-300/70 bg-ds-card/90 dark:border-red-800/60 dark:bg-red-950/20'
          : tone === 'success'
            ? 'border-emerald-500/24 bg-ds-card/90 dark:border-emerald-600/32 dark:bg-ds-card/84'
            : tone === 'muted'
              ? 'border-ds-border bg-ds-card/82'
              : 'border-accent/24 bg-ds-card/95 text-ds-ink'
      }`
  const iconFrameClass =
    tone === 'error'
      ? 'border-red-300/60 bg-red-500/10 text-red-700 dark:border-red-800/45 dark:text-red-300'
      : tone === 'success'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : tone === 'active'
          ? 'border-accent/20 bg-accent/10 text-accent'
          : 'border-ds-border-muted bg-ds-subtle text-ds-muted'
  const statusClass =
    tone === 'error'
      ? 'text-red-700 dark:text-red-300'
      : tone === 'success'
        ? 'text-emerald-700 dark:text-emerald-300'
        : tone === 'active'
          ? 'text-accent'
          : 'text-ds-muted'
  const statusIcon =
    tone === 'active' ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
    ) : tone === 'success' ? (
      <Check className="h-3.5 w-3.5" strokeWidth={2} />
    ) : tone === 'error' ? (
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[10px] font-bold leading-none">
        !
      </span>
    ) : (
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
    )

  return (
    <div className={containerClass}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border ${iconFrameClass}`}
          >
            {statusIcon}
          </span>
          <div className="min-w-0 pt-0.5">
            <div className="font-semibold text-ds-ink">{t('userInputTitle')}</div>
            <div className={`mt-0.5 text-[12px] font-medium ${statusClass}`}>{statusLabel}</div>
          </div>
        </div>
        {questionCount > 1 ? (
          <span className="shrink-0 rounded-full border border-ds-border-muted bg-ds-subtle px-2 py-0.5 text-[11.5px] font-medium text-ds-muted">
            {questionCount}
          </span>
        ) : null}
      </div>

      <div className={nested ? 'mt-3 flex flex-col gap-2.5' : 'mt-3.5 flex flex-col gap-3'}>
        {block.questions.map((question, index) => {
          const answer = answers[question.id]
          const hasOptions = question.options.length > 0
          const otherSelected = answer?.label === USER_INPUT_OTHER_LABEL
          const submittedAnswer = done ? (answer?.value || answer?.label || '') : ''
          const showProgress = questionCount > 1
          const showHeader =
            typeof question.header === 'string' &&
            question.header.trim().length > 0 &&
            !(questionCount === 1 && question.header.trim().toLowerCase() === 'input')
          return (
            <div
              key={question.id}
              className={`min-w-0 rounded-[12px] border px-3 py-3 ${
                submittedAnswer
                  ? 'border-ds-border-muted bg-ds-main/35'
                  : 'border-ds-border-muted bg-ds-main/45'
              }`}
            >
              {showHeader || showProgress ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    {showHeader ? (
                      <div className="min-w-0 text-[12px] font-semibold text-ds-muted">
                        {question.header}
                      </div>
                    ) : null}
                  </div>
                  {showProgress ? (
                    <div className="rounded-full bg-ds-card/70 px-2 py-0.5 text-[11.5px] font-medium text-ds-faint">
                      {t('userInputQuestionProgress', {
                        current: index + 1,
                        total: block.questions.length
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <p
                className={`whitespace-pre-wrap break-words text-[14px] font-semibold leading-6 text-ds-ink [overflow-wrap:anywhere] ${
                  showHeader || showProgress ? 'mt-2' : ''
                }`}
              >
                {question.question}
              </p>

              {submittedAnswer ? (
                <div className="mt-3 flex min-w-0 items-start gap-2 rounded-[10px] border border-emerald-500/14 bg-ds-card/78 px-3 py-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.1} />
                  </span>
                  <span className="min-w-0 flex-1 break-words text-[13.5px] font-medium leading-5 text-ds-ink [overflow-wrap:anywhere]">
                    {submittedAnswer}
                  </span>
                </div>
              ) : done ? (
                <div className="mt-3 rounded-[10px] border border-ds-border-muted bg-ds-card/70 px-3 py-2 text-[12.5px] font-medium text-ds-muted">
                  {statusLabel}
                </div>
              ) : hasOptions ? (
                <div className="mt-3 grid gap-2">
                  {question.options.map((option) => {
                    const selected = answer?.label === option.label && answer.value === option.label
                    return (
                      <button
                        key={option.label}
                        type="button"
                        disabled={done}
                        onClick={() => chooseOption(question, option.label)}
                        className={`group flex min-w-0 gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition disabled:cursor-default ${
                          selected
                            ? 'border-accent/35 bg-accent/10 text-ds-ink ring-1 ring-accent/10'
                            : 'border-ds-border-muted bg-ds-card/78 text-ds-muted hover:border-ds-border hover:bg-ds-card hover:text-ds-ink'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition ${
                            selected
                              ? 'border-accent bg-accent/10'
                              : 'border-ds-border bg-transparent group-hover:border-ds-muted'
                          }`}
                        >
                          {selected ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block break-words text-[13px] font-semibold [overflow-wrap:anywhere]">
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className="mt-0.5 block break-words text-[12px] leading-5 text-ds-faint [overflow-wrap:anywhere]">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    disabled={done}
                    onClick={() =>
                      chooseOption(
                        question,
                        USER_INPUT_OTHER_LABEL,
                        answer?.label === USER_INPUT_OTHER_LABEL ? answer.value : ''
                      )
                    }
                    className={`group flex min-w-0 gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition disabled:cursor-default ${
                      otherSelected
                        ? 'border-accent/35 bg-accent/10 text-ds-ink ring-1 ring-accent/10'
                        : 'border-ds-border-muted bg-ds-card/78 text-ds-muted hover:border-ds-border hover:bg-ds-card hover:text-ds-ink'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition ${
                        otherSelected
                          ? 'border-accent bg-accent/10'
                          : 'border-ds-border bg-transparent group-hover:border-ds-muted'
                      }`}
                    >
                      {otherSelected ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold">{t('userInputOther')}</span>
                      <span className="mt-0.5 block text-[12px] leading-5 text-ds-faint">
                        {t('userInputOtherDescription')}
                      </span>
                    </span>
                  </button>
                  {otherSelected ? (
                    <textarea
                      rows={2}
                      disabled={done}
                      value={answer?.value ?? ''}
                      onChange={(e) =>
                        chooseOption(question, USER_INPUT_OTHER_LABEL, e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          submit()
                        }
                      }}
                      placeholder={t('userInputCustomPlaceholder')}
                      className="min-h-20 resize-y rounded-[10px] border border-ds-border-muted bg-ds-card/90 px-3 py-2 text-[13px] leading-5 text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/45 focus:ring-2 focus:ring-accent/10 disabled:cursor-default disabled:opacity-80"
                    />
                  ) : null}
                </div>
              ) : (
                <div className="mt-3">
                  <textarea
                    rows={3}
                    disabled={done}
                    value={answer?.value ?? ''}
                    onChange={(e) =>
                      chooseOption(question, USER_INPUT_FREEFORM_LABEL, e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        submit()
                      }
                      }}
                      placeholder={t('userInputCustomPlaceholder')}
                    className="min-h-24 w-full resize-y rounded-[10px] border border-ds-border-muted bg-ds-card/90 px-3 py-2.5 text-[13px] leading-5 text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/45 focus:ring-2 focus:ring-accent/10 disabled:cursor-default disabled:opacity-80"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {block.errorMessage ? (
        <p className="mt-3 text-[12px] text-red-700 dark:text-red-300">{block.errorMessage}</p>
      ) : null}

      {pending ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-ds-border-muted pt-3">
          <button
            type="button"
            disabled={!canSubmit}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-[9px] bg-ds-ink px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 dark:text-black"
            onClick={submit}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
            {t('userInputSubmit')}
          </button>
          <button
            type="button"
            className="min-h-8 rounded-[9px] border border-ds-border-muted bg-ds-card/80 px-3 py-1.5 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            onClick={cancel}
          >
            {t('userInputCancel')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function answersByQuestionId(
  answers: UserInputAnswer[] | undefined
): Record<string, UserInputAnswer> {
  const out: Record<string, UserInputAnswer> = {}
  for (const answer of answers ?? []) {
    out[answer.id] = answer
  }
  return out
}

function formatMessageDateTime(input: string, locale: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return input
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function MessageBubbleComponent({
  block,
  nested = false,
  markdownImages = [],
  onOpenImageArtifactInVisualReview
}: {
  block: ChatBlock
  nested?: boolean
  markdownImages?: TimelineImageReference[]
  onOpenImageArtifactInVisualReview?: (artifact: TimelineVisualReviewArtifact) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const resolveApproval = useChatStore((s) => s.resolveApproval)
  if (block.kind === 'user') {
    return <UserMessageBubble block={block} />
  }
  if (block.kind === 'assistant') {
    const streaming = block.id === 'live-assistant'
    const createdAtLabel = block.createdAt
      ? formatMessageDateTime(block.createdAt, i18n.language)
      : null
    return (
      <div className="group/message flex min-w-0 max-w-full flex-col">
        <div className="ds-markdown ds-chat-answer ds-selectable-text min-w-0 max-w-full text-ds-ink">
          <MarkdownImageArtifactProvider images={markdownImages} onOpenVisualReview={onOpenImageArtifactInVisualReview}>
            <AssistantMarkdown text={block.text} streaming={streaming} />
          </MarkdownImageArtifactProvider>
        </div>
        <TimelineImagesFromMeta meta={block.meta} variant="assistant" onOpenVisualReview={onOpenImageArtifactInVisualReview} />
        {!streaming ? (
          <div className="mt-1 flex min-h-5 min-w-0 flex-wrap items-center justify-between gap-2 text-[11.5px] text-ds-faint opacity-0 transition duration-150 group-hover/message:opacity-100">
            <span className="min-w-0 truncate">{createdAtLabel ?? ''}</span>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              <CopyFeedbackButton text={block.text} />
            </div>
          </div>
        ) : null}
      </div>
    )
  }
  if (block.kind === 'reasoning') {
    return (
      <div className="ds-card-soft rounded-[20px] px-4 py-3 text-[13.5px] leading-6 text-ds-muted">
        <div className="ds-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
        </div>
      </div>
    )
  }
  if (block.kind === 'tool') {
    return (
      <ToolEntry
        block={block}
        nested={nested}
        onOpenImageArtifactInVisualReview={onOpenImageArtifactInVisualReview}
      />
    )
  }
  if (block.kind === 'user_input') {
    return <UserInputBubble block={block} nested={nested} />
  }
  if (block.kind === 'approval') {
    const done = block.status !== 'pending'
    const approvalToneClass =
      block.status === 'error'
        ? 'border-red-300/80 bg-red-500/10 dark:border-red-800/60 dark:bg-red-950/35'
        : block.status === 'allowed'
          ? 'border-emerald-300/80 bg-emerald-500/10 dark:border-emerald-800/60 dark:bg-emerald-950/35'
          : block.status === 'denied'
            ? 'border-ds-border bg-ds-card/95'
            : 'border-amber-300/90 bg-amber-50 text-ds-ink shadow-[0_16px_42px_rgba(180,83,9,0.14)] dark:border-amber-800/70 dark:bg-amber-950/35'
    const statusLabel =
      block.status === 'allowed'
        ? t('approvalAllowed')
        : block.status === 'denied'
          ? t('approvalDenied')
          : block.status === 'error'
            ? t('approvalFailed')
            : t('approvalPending')
    return (
      <div
        role={block.status === 'pending' ? 'alert' : undefined}
        aria-live={block.status === 'pending' ? 'assertive' : undefined}
        className={`rounded-[22px] border px-4 py-4 text-[13px] leading-6 ${approvalToneClass}`}
      >
        <div className="font-semibold text-accent">{t('approvalTitle')}</div>
        {block.toolName ? (
          <div className="mt-1 text-[12px] text-ds-muted">
            {t('approvalTool', { name: block.toolName })}
          </div>
        ) : null}
        <p className="mt-2 whitespace-pre-wrap text-[14px] text-ds-ink">{block.summary}</p>
        {block.errorMessage ? (
          <p className="mt-2 text-[12px] text-red-700 dark:text-red-300">{block.errorMessage}</p>
        ) : null}
        {!done ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-emerald-700"
              onClick={() => void resolveApproval(block.id, 'allow')}
            >
              {t('approvalAllow')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-ink hover:bg-ds-hover"
              onClick={() => void resolveApproval(block.id, 'deny')}
            >
              {t('approvalDeny')}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-[12px] font-medium text-ds-muted">{statusLabel}</p>
        )}
      </div>
    )
  }
  if (block.kind === 'compaction') {
    return (
      <div className="ds-card-soft rounded-[18px] px-3 py-2 text-[13.5px] text-ds-muted">
        {block.detail || block.summary}
      </div>
    )
  }
  if (block.kind === 'review') {
    return (
      <div className="ds-card-soft rounded-[18px] px-3 py-2 text-[13.5px] text-ds-muted">
        {block.reviewText || block.title}
      </div>
    )
  }
  if (block.kind === 'system') {
    const errorTone = block.severity === 'error'
    const warningTone = block.severity === 'warning'
    return (
      <div
        className={`rounded-[18px] border px-3 py-2 text-[13.5px] leading-6 ${
          errorTone
            ? 'border-red-300/80 bg-red-500/10 text-red-800 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-200'
            : warningTone
              ? 'border-amber-300/80 bg-amber-500/10 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100'
              : 'border-ds-border bg-ds-subtle text-ds-muted'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{block.text}</p>
        {block.code ? (
          <p className="mt-1 font-mono text-[11px] opacity-70">{block.code}</p>
        ) : null}
      </div>
    )
  }
  return <></>
}

function ToolEntry({
  block,
  nested = false,
  onOpenImageArtifactInVisualReview
}: {
  block: ToolBlock
  nested?: boolean
  onOpenImageArtifactInVisualReview?: (artifact: TimelineVisualReviewArtifact) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(() => block.status === 'error' || block.status === 'running')
  const [artifactDetail, setArtifactDetail] = useState<string | null>(null)
  const [artifactLoading, setArtifactLoading] = useState(false)
  const [artifactError, setArtifactError] = useState<string | null>(null)
  const [artifactLoadKey, setArtifactLoadKey] = useState<string | null>(null)
  const artifactRequestRef = useRef<string | null>(null)
  const artifactRuntimeId = block.detailArtifact?.runtimeId
  const artifactThreadId = block.detailArtifact?.threadId
  const artifactRef = block.detailArtifact?.ref
  const artifactSize = block.detailArtifact?.size
  const artifactKey = toolArtifactRequestKey(artifactRef, artifactSize)

  useEffect(() => {
    if (block.status === 'running') {
      setOpen(true)
    }
  }, [block.status, block.id])

  useEffect(() => {
    artifactRequestRef.current = null
    setArtifactLoadKey(null)
    setArtifactDetail(null)
    setArtifactError(null)
    setArtifactLoading(false)
  }, [block.id, artifactKey])

  const effectiveOpen = block.status === 'running' ? true : open

  useEffect(() => {
    if (
      !artifactRuntimeId ||
      !artifactThreadId ||
      !artifactRef ||
      artifactSize === undefined ||
      !shouldRequestToolArtifact({
        artifactKey,
        requestedKey: artifactLoadKey,
        inFlightKey: artifactRequestRef.current,
        open: effectiveOpen
      })
    ) return
    if (!artifactKey) return
    artifactRequestRef.current = artifactKey
    let cancelled = false
    setArtifactLoading(true)
    setArtifactError(null)
    void getProvider().readToolArtifact({
      runtimeId: artifactRuntimeId,
      threadId: artifactThreadId,
      ref: artifactRef,
      size: artifactSize
    })
      .then((detail) => {
        if (!cancelled) setArtifactDetail(detail)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        artifactRequestRef.current = null
        setArtifactLoadKey(null)
        setArtifactError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setArtifactLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    artifactRef,
    artifactKey,
    artifactLoadKey,
    artifactRuntimeId,
    artifactSize,
    artifactThreadId,
    effectiveOpen
  ])

  const tone =
    block.status === 'error'
      ? 'border-red-300/80 bg-red-500/10 text-red-950 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-100'
      : block.status === 'running'
        ? 'border-amber-300/80 bg-amber-500/10 text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100'
        : 'border-ds-border bg-ds-subtle text-ds-ink'

  const Icon = block.toolKind === 'file_change' ? FileEdit : block.toolKind === 'command_execution' ? Terminal : Wrench
  const kindLabel =
    block.toolKind === 'file_change'
      ? t('toolKindFile')
      : block.toolKind === 'command_execution'
        ? t('toolKindCommand')
        : t('toolKindTool')

  const exitCode = readNumber(block.meta, 'exit_code')
  const durationMs = readNumber(block.meta, 'duration_ms')
  const sessionId = metaString(block.meta, 'session_id')
  const sessionStatus = metaString(block.meta, 'status')

  const displayedDetail = artifactDetail ?? block.detail
  const hasDetail = !!(displayedDetail && displayedDetail.trim().length > 0)
  const hasArtifact = Boolean(artifactRef)
  const patchText = block.toolKind === 'file_change' ? extractUnifiedDiffText(displayedDetail) : undefined
  const canExpand = hasDetail || hasArtifact || block.status === 'running'

  return (
    <div className={`rounded-[22px] border shadow-[0_12px_30px_rgba(86,103,136,0.04)] ${tone}`}>
      <button
        type="button"
        onClick={() => {
          if (!canExpand || block.status === 'running') return
          const nextOpen = !effectiveOpen
          setOpen(nextOpen)
          if (nextOpen && artifactKey) setArtifactLoadKey(artifactKey)
        }}
        className={`flex w-full items-start gap-2 px-4 py-3 text-left text-[13.5px] leading-6 ${
          canExpand && block.status !== 'running' ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-[0.12em] text-[11px] opacity-75">
              {kindLabel}
            </span>
            {block.status === 'running' ? (
              <span className="rounded-full bg-amber-200/40 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-700/30 dark:text-amber-100">
                {t('inspectorStatusRunning')}
              </span>
            ) : null}
            {typeof exitCode === 'number' ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-mono ${
                  exitCode === 0
                    ? 'bg-ds-success-soft text-ds-success'
                    : 'bg-ds-danger-soft text-ds-danger'
                }`}
              >
                exit {exitCode}
              </span>
            ) : null}
            {sessionId ? (
              <span className="rounded-full bg-ds-card px-2 py-0.5 text-[11px] font-mono text-ds-muted" title={sessionId}>
                {sessionStatus === 'running' ? t('inspectorStatusRunning') : sessionStatus || 'session'} {sessionId.slice(0, 12)}
              </span>
            ) : null}
            {typeof durationMs === 'number' ? (
              <span className="rounded-full bg-ds-card px-2 py-0.5 text-[11px] font-mono text-ds-muted">
                {formatDuration(durationMs)}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 break-words">
            {block.filePath ? (
              <span className="font-mono text-[12px] opacity-90">{block.filePath} — </span>
            ) : null}
            <span>{block.summary}</span>
          </div>
          <RuntimeMetaChips meta={block.meta} />
        </div>
        {canExpand ? (
          effectiveOpen ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
          )
        ) : null}
      </button>
      <TimelineImagesFromMeta
        meta={block.meta}
        variant="tool"
        onOpenVisualReview={onOpenImageArtifactInVisualReview}
      />
      {effectiveOpen && (hasDetail || hasArtifact) ? (
        <div className="ds-panel-strip min-w-0 border-t border-ds-border-muted/60 px-4 py-3">
          {artifactLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-ds-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('loading')}
            </div>
          ) : (
            <>
              {artifactError ? (
                <p className="mb-2 text-[12px] text-ds-danger">{artifactError}</p>
              ) : null}
              {patchText !== undefined ? (
                <DiffView patch={patchText} filePath={block.filePath} />
              ) : hasDetail ? (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-ds-ink">
                  {displayedDetail}
                </pre>
              ) : null}
              {hasArtifact && artifactDetail === null && artifactKey ? (
                <button
                  type="button"
                  onClick={() => setArtifactLoadKey(artifactKey)}
                  className="mt-2 rounded-lg border border-ds-border px-2.5 py-1 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                >
                  {t('toolLoadFullDetail')}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleComponent, (prev, next) => (
  prev.block === next.block &&
  prev.nested === next.nested &&
  prev.markdownImages === next.markdownImages &&
  prev.onOpenImageArtifactInVisualReview === next.onOpenImageArtifactInVisualReview
))
