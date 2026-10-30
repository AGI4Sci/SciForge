import type { NormalizedThread } from '../agent/types'
import i18n from '../i18n'

const LEGACY_PLACEHOLDER_TITLES = new Set([
  'New Thread',
  'New chat',
  '新会话',
  'Codex thread',
  'Claude Code thread',
  'Claude thread',
  'Agent Runtime thread',
  'Runtime thread'
])
const MAX_THREAD_TITLE_LENGTH = 48
const MAX_DIALOG_THREAD_TITLE_LENGTH = 80
const NON_DISPLAY_TITLE_SOURCES = new Set([
  'empty',
  'id_fallback',
  'internal',
  'internal_prompt',
  'placeholder',
  'runtime_prompt'
])

function normalizeTitleLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/`+/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[\s,.;:!?，。；：！？、'"`()[\]{}]+$/g, '').trim()
}

function shortenTitle(text: string, maxLength = MAX_THREAD_TITLE_LENGTH): string {
  if (text.length <= maxLength) return text
  const sliced = text.slice(0, maxLength)
  const lastSpace = sliced.lastIndexOf(' ')
  const compact = lastSpace >= 18 ? sliced.slice(0, lastSpace) : sliced
  return `${compact.trim()}...`
}

export function getDefaultThreadTitle(): string {
  return i18n.t('common:untitledThread')
}

export function deriveThreadTitleFromPrompt(prompt: string): string {
  const fallback = getDefaultThreadTitle()
  const lines = prompt
    .split(/\r?\n/)
    .filter((line) => !/^\s*(```|~~~)/.test(line))
    .map((line) => normalizeTitleLine(line))
    .filter((line) => line)

  const firstLine = lines[0] ?? normalizeTitleLine(prompt)
  if (!firstLine) return fallback

  const sentenceBreak = firstLine.search(/[。！？.!?]/)
  const core = sentenceBreak >= 8 ? firstLine.slice(0, sentenceBreak) : firstLine
  const trimmed = stripTrailingPunctuation(shortenTitle(core))
  return trimmed || fallback
}

export function getDisplayThreadTitle(
  thread: Pick<NormalizedThread, 'title'> & Partial<Pick<NormalizedThread, 'titleSource'>> | null | undefined
): string {
  const raw = thread?.title?.trim() ?? ''
  if (
    raw &&
    !hasNonDisplayThreadTitleSource(thread?.titleSource) &&
    !hasPlaceholderThreadTitle(raw)
  ) {
    return raw
  }

  return getDefaultThreadTitle()
}

export function getDialogThreadTitle(
  thread: Pick<NormalizedThread, 'title'> & Partial<Pick<NormalizedThread, 'titleSource'>> | null | undefined
): string {
  return shortenTitle(
    getDisplayThreadTitle(thread).replace(/\s+/g, ' ').trim(),
    MAX_DIALOG_THREAD_TITLE_LENGTH
  )
}

export function hasNonDisplayThreadTitleSource(source: string | null | undefined): boolean {
  const raw = source?.trim().toLowerCase() ?? ''
  return NON_DISPLAY_TITLE_SOURCES.has(raw)
}

export function hasThreadIdFallbackTitle(
  thread: Pick<NormalizedThread, 'id' | 'title'> | null | undefined
): boolean {
  const raw = thread?.title?.trim() ?? ''
  if (!thread || !raw) return false
  return raw === thread.id.slice(0, 8)
}

export function hasPlaceholderThreadTitle(title: string | null | undefined): boolean {
  const raw = title?.trim() ?? ''
  return raw === getDefaultThreadTitle() || LEGACY_PLACEHOLDER_TITLES.has(raw)
}

export function shouldAutoTitleThread(
  thread: Pick<NormalizedThread, 'id' | 'title'> | null | undefined
): boolean {
  const raw = thread?.title?.trim() ?? ''
  if (!raw) return true
  if (hasPlaceholderThreadTitle(raw)) return true
  if (hasThreadIdFallbackTitle(thread)) return true
  return false
}
