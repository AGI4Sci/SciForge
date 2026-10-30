import type { EditorState } from '@codemirror/state'
import type { EditorView, ViewUpdate } from '@codemirror/view'
import {
  createWriteRecentEdit,
  type WriteRecentEdit,
  type WriteRecentEditInput
} from '../recent-edits'
import type {
  WriteEditorSelectionState,
  WriteEditorTextPosition,
  WriteSelectionAnchorRect,
  WriteSelectionRange
} from './types'

export type CodeMirrorRecentEditUpdate = Pick<
  ViewUpdate,
  'docChanged' | 'changes' | 'startState' | 'state'
>

export type CodeMirrorRecentEditOptions = {
  source?: WriteRecentEditInput['source']
  timestamp?: number
  contextChars?: number
}

const CODEMIRROR_RECENT_EDIT_CONTEXT_CHARS = 160

function clampCodeMirrorOffset(state: EditorState, offset = 0): number {
  const size = state.doc.length
  const value = Number(offset)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(size, Math.floor(value)))
}

function positionForCodeMirrorOffset(
  state: EditorState,
  offset: number
): WriteEditorTextPosition {
  const point = clampCodeMirrorOffset(state, offset)
  const line = state.doc.lineAt(point)
  return {
    line: line.number,
    column: point - line.from + 1
  }
}

function unionRects(
  rects: Array<{ left: number; right: number; top: number; bottom: number }>
): WriteSelectionAnchorRect | undefined {
  if (rects.length === 0) return undefined
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return undefined
  }
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top
  }
}

function selectionAnchorRect(
  view: EditorView,
  ranges: WriteSelectionRange[]
): WriteSelectionAnchorRect | undefined {
  const rects: Array<{ left: number; right: number; top: number; bottom: number }> = []
  for (const range of ranges) {
    const start = view.coordsAtPos(range.from, 1)
    const end = view.coordsAtPos(range.to, -1) ?? view.coordsAtPos(Math.max(range.from, range.to - 1), 1)
    if (start) rects.push(start)
    if (end) rects.push(end)
  }
  return unionRects(rects)
}

export function buildCodeMirrorSelectionState(state: EditorState): WriteEditorSelectionState {
  const ranges = state.selection.ranges
    .map((range): WriteSelectionRange | null => {
      if (range.empty) return null
      const from = clampCodeMirrorOffset(state, range.from)
      const to = clampCodeMirrorOffset(state, range.to)
      const start = positionForCodeMirrorOffset(state, from)
      const end = positionForCodeMirrorOffset(state, Math.max(from, to - 1))
      const text = state.sliceDoc(from, to)
      return {
        from,
        to,
        startLine: start.line,
        startColumn: start.column,
        endLine: end.line,
        endColumn: end.column,
        text,
        charCount: Math.max(0, to - from)
      }
    })
    .filter((value): value is WriteSelectionRange => value !== null)

  const text = ranges.map((range) => range.text).join('\n\n')
  return {
    text,
    ranges,
    charCount: ranges.reduce((total, range) => total + range.charCount, 0)
  }
}

export function buildCodeMirrorEditorSelectionState(view: EditorView): WriteEditorSelectionState {
  const selection = buildCodeMirrorSelectionState(view.state)
  return {
    ...selection,
    anchorRect: selectionAnchorRect(view, selection.ranges)
  }
}

export function codeMirrorRecentEditsFromUpdate(
  update: CodeMirrorRecentEditUpdate,
  filePath: string,
  options: CodeMirrorRecentEditOptions = {}
): WriteRecentEdit[] {
  const path = filePath.trim()
  if (!path || !update.docChanged) return []
  const edits: WriteRecentEdit[] = []
  const timestamp = Number.isFinite(options.timestamp)
    ? Math.floor(options.timestamp ?? Date.now())
    : Date.now()
  const contextChars = Number.isFinite(options.contextChars)
    ? Math.max(0, Math.floor(options.contextChars ?? CODEMIRROR_RECENT_EDIT_CONTEXT_CHARS))
    : CODEMIRROR_RECENT_EDIT_CONTEXT_CHARS

  update.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
    const edit = createWriteRecentEdit({
      source: options.source ?? 'user',
      timestamp,
      filePath: path,
      from: fromA,
      to: toA,
      deletedText: update.startState.sliceDoc(fromA, toA),
      insertedText: inserted.toString(),
      beforeContext: update.startState.sliceDoc(Math.max(0, fromA - contextChars), fromA),
      afterContext: update.state.sliceDoc(toB, Math.min(update.state.doc.length, toB + contextChars))
    })
    if (edit) edits.push(edit)
  })

  return edits
}
