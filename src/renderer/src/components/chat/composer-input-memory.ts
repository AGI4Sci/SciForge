import { browserStorage, type BrowserStorageLike } from '../../lib/browser-storage'

export const COMPOSER_INPUT_MEMORY_STORAGE_KEY = 'sciforge.composerInputMemory.v1'

const MAX_DRAFTS = 50
const MAX_HISTORY_ITEMS = 100
const MAX_TEXT_CHARS = 100_000
const MAX_STORAGE_CHARS = 2_000_000

type ComposerDraftEntry = {
  text: string
  updatedAt: number
}

type ComposerInputMemory = {
  drafts: Record<string, ComposerDraftEntry>
  history: string[]
}

type ComposerInputMemoryCacheEntry = {
  raw: string | null
  memory: ComposerInputMemory
}

const memoryCache = new WeakMap<BrowserStorageLike, ComposerInputMemoryCacheEntry>()

export type ComposerHistoryNavigationState = {
  cursor: number | null
  draft: string
}

export type ComposerHistoryNavigationResult = ComposerHistoryNavigationState & {
  value: string
}

function emptyMemory(): ComposerInputMemory {
  return { drafts: {}, history: [] }
}

function safeText(value: unknown, preserveWhitespace = false): string | null {
  if (typeof value !== 'string') return null
  const normalized = preserveWhitespace ? value : value.trim()
  if (!normalized.trim()) return null
  return normalized.slice(0, MAX_TEXT_CHARS)
}

function normalizeHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const history: string[] = []
  for (const item of value) {
    const text = safeText(item)
    if (!text) continue
    const existing = history.indexOf(text)
    if (existing >= 0) history.splice(existing, 1)
    history.push(text)
  }
  return history.slice(-MAX_HISTORY_ITEMS)
}

function readMemory(storage: BrowserStorageLike | null = browserStorage()): ComposerInputMemory {
  try {
    const raw = storage?.getItem(COMPOSER_INPUT_MEMORY_STORAGE_KEY)
    if (!storage) return emptyMemory()
    const cached = memoryCache.get(storage)
    if (cached && cached.raw === raw) return cached.memory
    if (!raw) {
      const memory = emptyMemory()
      memoryCache.set(storage, { raw: null, memory })
      return memory
    }
    if (raw.length > MAX_STORAGE_CHARS) {
      storage?.removeItem?.(COMPOSER_INPUT_MEMORY_STORAGE_KEY)
      const memory = emptyMemory()
      memoryCache.set(storage, { raw: null, memory })
      return memory
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || parsed.version !== 1) {
      const memory = emptyMemory()
      memoryCache.set(storage, { raw, memory })
      return memory
    }
    const rawDrafts = parsed.drafts && typeof parsed.drafts === 'object' && !Array.isArray(parsed.drafts)
      ? parsed.drafts as Record<string, unknown>
      : {}
    const drafts: Record<string, ComposerDraftEntry> = {}
    for (const [key, rawEntry] of Object.entries(rawDrafts)) {
      if (!key.trim() || !rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue
      const entry = rawEntry as Record<string, unknown>
      const text = safeText(entry.text, true)
      const updatedAt = typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
        ? entry.updatedAt
        : 0
      if (text) drafts[key] = { text, updatedAt }
    }
    const memory = { drafts, history: normalizeHistory(parsed.history) }
    memoryCache.set(storage, { raw, memory })
    return memory
  } catch {
    return emptyMemory()
  }
}

function writeMemory(memory: ComposerInputMemory, storage: BrowserStorageLike | null = browserStorage()): boolean {
  try {
    if (!storage) return false
    const raw = JSON.stringify({ version: 1, ...memory })
    storage.setItem(COMPOSER_INPUT_MEMORY_STORAGE_KEY, raw)
    memoryCache.set(storage, { raw, memory })
    return true
  } catch {
    return false
  }
}

export function composerDraftContextKey(input: {
  threadId?: string | null
  workspaceRoot?: string | null
}): string {
  const threadId = input.threadId?.trim()
  if (threadId) return `thread:${threadId}`
  const workspaceRoot = input.workspaceRoot?.trim()
  return workspaceRoot ? `workspace:${workspaceRoot}` : 'new-thread'
}

export function readComposerDraft(
  contextKey: string,
  storage: BrowserStorageLike | null = browserStorage()
): string {
  return readMemory(storage).drafts[contextKey]?.text ?? ''
}

export function writeComposerDraft(
  contextKey: string,
  value: string,
  storage: BrowserStorageLike | null = browserStorage(),
  now = Date.now()
): boolean {
  const key = contextKey.trim()
  if (!key) return false
  const previous = readMemory(storage)
  const text = safeText(value, true)
  if ((previous.drafts[key]?.text ?? '') === (text ?? '')) return storage !== null
  const memory: ComposerInputMemory = {
    drafts: { ...previous.drafts },
    history: previous.history
  }
  if (text) memory.drafts[key] = { text, updatedAt: now }
  else delete memory.drafts[key]
  const retained = Object.entries(memory.drafts)
    .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    .slice(0, MAX_DRAFTS)
  memory.drafts = Object.fromEntries(retained)
  return writeMemory(memory, storage)
}

export function readComposerInputHistory(
  storage: BrowserStorageLike | null = browserStorage()
): string[] {
  return [...readMemory(storage).history]
}

export function rememberComposerInput(
  value: string,
  storage: BrowserStorageLike | null = browserStorage()
): string[] {
  const previous = readMemory(storage)
  const text = safeText(value)
  if (!text) return previous.history
  const memory: ComposerInputMemory = {
    drafts: previous.drafts,
    history: normalizeHistory([...previous.history, text])
  }
  writeMemory(memory, storage)
  return memory.history
}

export type ComposerDraftPersistence = {
  schedule: (contextKey: string, value: string) => void
  flush: () => boolean
  cancel: () => void
}

export function createComposerDraftPersistence(options: {
  storage?: BrowserStorageLike | null
  delayMs?: number
  now?: () => number
} = {}): ComposerDraftPersistence {
  const storage = options.storage === undefined ? browserStorage() : options.storage
  const delayMs = Math.max(0, options.delayMs ?? 400)
  const now = options.now ?? Date.now
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { contextKey: string; value: string } | null = null

  const cancelTimer = (): void => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  const flush = (): boolean => {
    cancelTimer()
    if (!pending) return true
    const next = pending
    pending = null
    return writeComposerDraft(next.contextKey, next.value, storage, now())
  }

  return {
    schedule: (contextKey, value) => {
      const key = contextKey.trim()
      if (!key) return
      pending = { contextKey: key, value }
      cancelTimer()
      timer = setTimeout(() => {
        timer = null
        flush()
      }, delayMs)
    },
    flush,
    cancel: () => {
      cancelTimer()
      pending = null
    }
  }
}

export function mergeComposerInputHistory(...groups: ReadonlyArray<readonly string[]>): string[] {
  // Groups are ordered from least to most recent. normalizeHistory moves a
  // duplicate to its latest occurrence, so later sources define recency.
  return normalizeHistory(groups.flatMap((group) => [...group]))
}

function canNavigateUp(value: string, selectionStart: number, selectionEnd: number): boolean {
  return selectionStart === selectionEnd && value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) < 0
}

function canNavigateDown(value: string, selectionStart: number, selectionEnd: number): boolean {
  return selectionStart === selectionEnd && value.indexOf('\n', selectionEnd) < 0
}

export function navigateComposerHistory(input: {
  key: 'ArrowUp' | 'ArrowDown'
  value: string
  selectionStart: number
  selectionEnd: number
  history: readonly string[]
  state: ComposerHistoryNavigationState
}): ComposerHistoryNavigationResult | null {
  const history = normalizeHistory(input.history)
  if (history.length === 0) return null
  const navigating = input.state.cursor !== null

  if (input.key === 'ArrowUp') {
    if (!navigating && !canNavigateUp(input.value, input.selectionStart, input.selectionEnd)) return null
    const cursor = input.state.cursor === null
      ? history.length - 1
      : Math.max(0, input.state.cursor - 1)
    return {
      cursor,
      draft: input.state.cursor === null ? input.value : input.state.draft,
      value: history[cursor] ?? input.value
    }
  }

  if (!navigating || !canNavigateDown(input.value, input.selectionStart, input.selectionEnd)) return null
  const nextCursor = input.state.cursor! + 1
  if (nextCursor >= history.length) {
    return { cursor: null, draft: input.state.draft, value: input.state.draft }
  }
  return { cursor: nextCursor, draft: input.state.draft, value: history[nextCursor] ?? input.value }
}
