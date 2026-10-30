import type {
  WriteInlineCompletionAction,
  WriteInlineCompletionEditCandidate,
  WriteInlineCompletionMode,
  WriteInlineCompletionRequest
} from '@shared/write-inline-completion'
import type { WriteRecentEdit } from '../recent-edits'

export type { WriteRecentEdit }

export type WriteEditorTextPosition = {
  line: number
  column: number
}

export type WriteSelectionAnchorRect = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export type WriteSelectionPageRect = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export type WriteSelectionRange = {
  from: number
  to: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  text: string
  charCount: number
  page?: number
}

export type WriteEditorSelectionState = {
  text: string
  ranges: WriteSelectionRange[]
  charCount: number
  anchorRect?: WriteSelectionAnchorRect
  rects?: WriteSelectionPageRect[]
  sourceKind?: 'text' | 'pdf'
  pageStart?: number
  pageEnd?: number
}

export type WriteEditorRecentEdit = WriteRecentEdit

export type InlineCompletionRequestContext = {
  filePath: string
  language: string
  head: number
  lineNumber: number
  column: number
  docLength: number
  prefix: string
  suffix: string
  prefixWindow: string
  suffixWindow: string
  currentLinePrefix: string
  currentLineSuffix: string
  currentLineText: string
  previousLineText: string
  previousNonEmptyLineText: string
  nextLineText: string
  indentation: string
  isAtLineEnd: boolean
  currentLinePrefixTrimmed: string
  currentLineSuffixTrimmed: string
  docPreview: string
  isBlankLine: boolean
  hasMeaningfulPrefix: boolean
  hasStructuralContext: boolean
  hasListContext: boolean
  hasQuoteContext: boolean
  hasHeadingContext: boolean
  hasTableContext: boolean
  endsWithWordChar: boolean
  endsWithSentencePunctuation: boolean
  previousLineEndsWithSentencePunctuation: boolean
  prefersNewLineCompletion: boolean
  isParagraphBreakOpportunity: boolean
  nextCharIsWord: boolean
  looksLikeUrlTail: boolean
  editCandidate?: WriteInlineCompletionEditCandidate
}

export type InlineCompletionSuggestion = {
  text: string
  mode?: WriteInlineCompletionMode
  action?: WriteInlineCompletionAction
}

export type InlineCompletionFeedback = {
  phase: 'candidate' | 'interaction'
  decision: 'show' | 'suppress' | 'accept' | 'dismiss'
  reason: string
  score: number
  preview: string
  mode?: WriteInlineCompletionMode
  cursor?: {
    line: number
    column: number
  }
}

export type InlineCompletionPayload = WriteInlineCompletionRequest
