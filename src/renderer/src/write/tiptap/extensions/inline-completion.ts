import { EditorSelection as CMEditorSelection, EditorState as CMEditorState } from '@codemirror/state'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type {
  WriteInlineCompletionAction,
  WriteInlineCompletionMode
} from '@shared/write-inline-completion'
import {
  INLINE_COMPLETION_DEBOUNCE_MS,
  INLINE_COMPLETION_EMPTY_BURST_LIMIT,
  INLINE_COMPLETION_EMPTY_BURST_WINDOW_MS,
  INLINE_COMPLETION_EMPTY_COOLDOWN_MS,
  INLINE_COMPLETION_EMPTY_GLOBAL_COOLDOWN_MS,
  INLINE_LONG_COMPLETION_DEBOUNCE_MS
} from '../../inline-completion/constants'
import {
  inlineCompletionMinRequestInterval,
  inlineCompletionRequestSignature,
  isInlineCompletionEmptyFeedback
} from '../../inline-completion/codemirror'
import { buildInlineCompletionRequestContext } from '../../inline-completion/context'
import { evaluateInlineCompletionCandidate } from '../../inline-completion/feedback'
import {
  shouldRequestInlineCompletion,
  shouldRequestLongInlineCompletion
} from '../../inline-completion/policy'
import type {
  InlineCompletionFeedback,
  InlineCompletionRequestContext,
  InlineCompletionSuggestion
} from '../../inline-completion/types'
import { replaceRangeWithMarkdown } from '../markdown-insert'
import {
  buildWriteRichMarkdownProjection,
  posForProjectedOffset,
  projectedOffsetForPos
} from '../markdown-projection'

export type WriteRichInlineCompletionOptions = {
  getDebounceMs: () => number
  getMinAcceptScore: () => number
  getLongDebounceMs: () => number
  getLongMinAcceptScore: () => number
  isLongEnabled: () => boolean
  isEnabled: () => boolean
  getFilePath: () => string
  requestCompletion: (
    context: InlineCompletionRequestContext,
    mode: WriteInlineCompletionMode
  ) => Promise<InlineCompletionSuggestion | null>
  onFeedback?: (feedback: InlineCompletionFeedback) => void
}

type RichSuggestion = {
  text: string
  action: WriteInlineCompletionAction
  anchor: number
  feedback: InlineCompletionFeedback
}

const inlineCompletionKey = new PluginKey<RichSuggestion | null>('writeRichInlineCompletion')

export function buildRichCompletionContext(
  state: EditorState,
  filePath: string
): InlineCompletionRequestContext | null {
  if (!state.selection.empty) return null
  const projection = buildWriteRichMarkdownProjection(state.doc)
  const head = projectedOffsetForPos(state.doc, projection, state.selection.head)
  if (head === null) return null
  const cmState = CMEditorState.create({
    doc: projection.text,
    selection: CMEditorSelection.single(Math.min(head, projection.text.length))
  })
  return buildInlineCompletionRequestContext(cmState, { filePath, language: 'markdown' })
}

function mapEditActionToDoc(
  state: EditorState,
  action: Extract<WriteInlineCompletionAction, { kind: 'edit' }>
): { from: number; to: number } | null {
  const projection = buildWriteRichMarkdownProjection(state.doc)
  const from = posForProjectedOffset(state.doc, projection, action.from)
  const to = posForProjectedOffset(state.doc, projection, action.to)
  if (from === null || to === null || to < from) return null
  if (state.doc.textBetween(from, to, '\n', () => '') !== action.original) return null
  return { from, to }
}

function ghostWidget(text: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'write-rich-ghost-text'
  span.textContent = text
  return span
}

function editReplacementWidget(text: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'write-rich-ghost-text write-rich-inline-edit-replacement'
  span.textContent = ` => ${text}`
  return span
}

function suggestionDecorations(state: EditorState): DecorationSet {
  const suggestion = inlineCompletionKey.getState(state)
  if (!suggestion?.text) return DecorationSet.empty
  if (!state.selection.empty || state.selection.head !== suggestion.anchor) return DecorationSet.empty

  if (suggestion.action.kind === 'edit') {
    const mapped = mapEditActionToDoc(state, suggestion.action)
    if (!mapped) return DecorationSet.empty
    return DecorationSet.create(state.doc, [
      Decoration.inline(mapped.from, mapped.to, { class: 'write-rich-inline-edit-original' }),
      Decoration.widget(mapped.to, () => editReplacementWidget(suggestion.text), { side: 1 })
    ])
  }

  return DecorationSet.create(state.doc, [
    Decoration.widget(suggestion.anchor, () => ghostWidget(suggestion.text), { side: 1 })
  ])
}

function feedbackFromInteraction(
  decision: 'accept' | 'dismiss',
  suggestion: RichSuggestion | null
): InlineCompletionFeedback {
  return {
    phase: 'interaction',
    decision,
    reason: decision === 'accept' ? 'tab-applied' : 'escape-dismissed',
    score: suggestion?.feedback.score || 0,
    preview: suggestion?.feedback.preview || '',
    mode: suggestion?.feedback.mode
  }
}

const MARKDOWN_STRUCTURE_PATTERN = /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|)|\*\*|__|\[[^\]]*\]\(/

export function insertCompletionText(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  head: number,
  text: string
): boolean {
  if (!MARKDOWN_STRUCTURE_PATTERN.test(text) && !text.includes('\n')) {
    if (dispatch) {
      const tr = state.tr.insertText(text, head)
      tr.setMeta(inlineCompletionKey, null)
      dispatch(tr.scrollIntoView())
    }
    return true
  }

  return replaceRangeWithMarkdown(state, dispatch, head, head, text, (tr) => {
    tr.setMeta(inlineCompletionKey, null)
  })
}

class RichInlineCompletionController {
  private sequence = 0
  private shortTimer: number | null = null
  private longTimer: number | null = null
  private readonly inFlightModes = new Set<WriteInlineCompletionMode>()
  private readonly pendingAfterInFlight = new Set<WriteInlineCompletionMode>()
  private readonly lastRequestStartedAt = new Map<WriteInlineCompletionMode, number>()
  private readonly emptyCooldowns = new Map<string, number>()
  private emptyEvents: number[] = []
  private globalEmptyCooldownUntil = 0

  constructor(
    private readonly view: EditorView,
    private readonly options: WriteRichInlineCompletionOptions
  ) {
    this.schedule()
  }

  update(prevState: EditorState): void {
    const state = this.view.state
    if (prevState.doc.eq(state.doc) && prevState.selection.eq(state.selection)) return
    this.schedule()
  }

  private schedule(): void {
    this.sequence += 1
    this.clearTimers()
    if (!this.options.isEnabled()) return

    const requestId = this.sequence
    this.shortTimer = window.setTimeout(() => {
      this.shortTimer = null
      void this.requestAndRender('short', requestId)
    }, this.options.getDebounceMs() || INLINE_COMPLETION_DEBOUNCE_MS)
    if (this.options.isLongEnabled()) {
      this.longTimer = window.setTimeout(() => {
        this.longTimer = null
        void this.requestAndRender('long', requestId)
      }, this.options.getLongDebounceMs() || INLINE_LONG_COMPLETION_DEBOUNCE_MS)
    }
  }

  private clearSuggestion(): void {
    if (!inlineCompletionKey.getState(this.view.state)) return
    this.view.dispatch(this.view.state.tr.setMeta(inlineCompletionKey, null))
  }

  private async requestAndRender(mode: WriteInlineCompletionMode, requestId: number): Promise<void> {
    const latestState = this.view.state
    const latestContext = buildRichCompletionContext(latestState, this.options.getFilePath())
    const shouldRequest = mode === 'long'
      ? shouldRequestLongInlineCompletion(latestContext, this.options.isEnabled, this.options.isLongEnabled)
      : shouldRequestInlineCompletion(latestContext, this.options.isEnabled)
    if (!latestContext || !shouldRequest) return

    const signature = inlineCompletionRequestSignature(latestContext, mode)
    const now = Date.now()
    this.pruneEmptyCooldowns(now)
    if (this.isInEmptyCooldown(signature, now)) return

    const lastStartedAt = this.lastRequestStartedAt.get(mode) ?? 0
    const minInterval = inlineCompletionMinRequestInterval(mode)
    const waitMs = minInterval - (now - lastStartedAt)
    if (waitMs > 0) {
      window.setTimeout(() => {
        if (requestId === this.sequence) void this.requestAndRender(mode, requestId)
      }, waitMs)
      return
    }

    if (this.inFlightModes.has(mode)) {
      this.pendingAfterInFlight.add(mode)
      return
    }

    this.inFlightModes.add(mode)
    this.lastRequestStartedAt.set(mode, now)
    let suggestion: InlineCompletionSuggestion | null = null
    try {
      suggestion = await this.options.requestCompletion(latestContext, mode).catch(() => null)
    } finally {
      this.inFlightModes.delete(mode)
      if (this.pendingAfterInFlight.delete(mode)) this.schedule()
    }

    if (requestId !== this.sequence) return
    if (this.view.state !== latestState) return

    const decision = evaluateInlineCompletionCandidate(latestContext, suggestion, {
      minAcceptScore: mode === 'long'
        ? this.options.getLongMinAcceptScore()
        : this.options.getMinAcceptScore(),
      longMinAcceptScore: this.options.getLongMinAcceptScore(),
      mode
    })
    this.options.onFeedback?.(decision.feedback)
    if (!decision.accepted && isInlineCompletionEmptyFeedback(decision.feedback.reason)) {
      this.recordEmptyResponse(signature, Date.now())
    }
    if (!decision.accepted || (decision.action?.kind === 'long' && !this.options.isLongEnabled())) {
      this.clearSuggestion()
      return
    }

    this.view.dispatch(
      this.view.state.tr.setMeta(inlineCompletionKey, {
        text: decision.text,
        action: decision.action ?? { kind: 'short', text: decision.text },
        anchor: latestState.selection.head,
        feedback: decision.feedback
      })
    )
  }

  private clearTimers(): void {
    if (this.shortTimer) window.clearTimeout(this.shortTimer)
    if (this.longTimer) window.clearTimeout(this.longTimer)
    this.shortTimer = null
    this.longTimer = null
  }

  private pruneEmptyCooldowns(now: number): void {
    for (const [signature, until] of this.emptyCooldowns) {
      if (until <= now) this.emptyCooldowns.delete(signature)
    }
    const cutoff = now - INLINE_COMPLETION_EMPTY_BURST_WINDOW_MS
    this.emptyEvents = this.emptyEvents.filter((time) => time >= cutoff)
  }

  private isInEmptyCooldown(signature: string, now: number): boolean {
    return now < this.globalEmptyCooldownUntil || now < (this.emptyCooldowns.get(signature) ?? 0)
  }

  private recordEmptyResponse(signature: string, now: number): void {
    this.pruneEmptyCooldowns(now)
    this.emptyCooldowns.set(signature, now + INLINE_COMPLETION_EMPTY_COOLDOWN_MS)
    this.emptyEvents.push(now)
    if (this.emptyEvents.length >= INLINE_COMPLETION_EMPTY_BURST_LIMIT) {
      this.globalEmptyCooldownUntil = now + INLINE_COMPLETION_EMPTY_GLOBAL_COOLDOWN_MS
      this.emptyEvents = []
    }
  }

  destroy(): void {
    this.sequence += 1
    this.clearTimers()
  }
}

export const WriteRichInlineCompletion = Extension.create<WriteRichInlineCompletionOptions>({
  name: 'writeRichInlineCompletion',
  priority: 10_000,

  addOptions() {
    return {
      getDebounceMs: () => INLINE_COMPLETION_DEBOUNCE_MS,
      getMinAcceptScore: () => 0,
      getLongDebounceMs: () => INLINE_LONG_COMPLETION_DEBOUNCE_MS,
      getLongMinAcceptScore: () => 0,
      isLongEnabled: () => false,
      isEnabled: () => false,
      getFilePath: () => '',
      requestCompletion: async () => null
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const state = editor.state
        const suggestion = inlineCompletionKey.getState(state)
        if (!suggestion?.text) return false
        if (!state.selection.empty || state.selection.head !== suggestion.anchor) return false

        if (suggestion.action.kind === 'edit') {
          const mapped = mapEditActionToDoc(state, suggestion.action)
          if (!mapped) {
            editor.view.dispatch(state.tr.setMeta(inlineCompletionKey, null))
            return false
          }
          const tr = state.tr.insertText(suggestion.text, mapped.from, mapped.to)
          tr.setMeta(inlineCompletionKey, null)
          editor.view.dispatch(tr.scrollIntoView())
          this.options.onFeedback?.(feedbackFromInteraction('accept', suggestion))
          return true
        }

        const inserted = insertCompletionText(
          state,
          (tr) => editor.view.dispatch(tr),
          suggestion.anchor,
          suggestion.text
        )
        if (inserted) this.options.onFeedback?.(feedbackFromInteraction('accept', suggestion))
        return inserted
      },
      Escape: ({ editor }) => {
        const state = editor.state
        const suggestion = inlineCompletionKey.getState(state)
        if (!suggestion) return false
        editor.view.dispatch(state.tr.setMeta(inlineCompletionKey, null))
        this.options.onFeedback?.(feedbackFromInteraction('dismiss', suggestion))
        return true
      }
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin<RichSuggestion | null>({
        key: inlineCompletionKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(inlineCompletionKey) as RichSuggestion | null | undefined
            if (meta !== undefined) return meta
            if (tr.docChanged) return null
            return value
          }
        },
        props: {
          decorations: suggestionDecorations
        },
        view: (editorView) => {
          const controller = new RichInlineCompletionController(editorView, options)
          return {
            update: (_view, prevState) => controller.update(prevState),
            destroy: () => controller.destroy()
          }
        }
      })
    ]
  }
})

export const writeRichInlineCompletionTestInternals = {
  inlineCompletionKey,
  mapEditActionToDoc
}
