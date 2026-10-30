import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
  type ReactNode
} from 'react'
import { Editor, Extension, type AnyExtension } from '@tiptap/core'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  buildInlineCompletionPayload,
  type WriteEditorSelectionState,
  type WriteRecentEdit,
  type WriteSelectionAnchorRect,
  type WriteSelectionRange
} from '../inline-completion'
import { createWriteRecentEdit } from '../recent-edits'
import {
  auditWriteMarkdownFidelity,
  buildWriteRichExtensions,
  getWriteMarkdownManager,
  parseWriteMarkdown,
  type WriteRichFidelity
} from './markdown-manager'
import { replaceRangeWithMarkdown } from './markdown-insert'
import {
  buildWriteRichMarkdownProjection,
  posForProjectedOffset,
  projectedOffsetForPos
} from './markdown-projection'
import { applyExternalMarkdownToEditor } from './markdown-sync'
import { recentEditsFromRichTransaction } from './recent-edits-pm'
import { WriteRichInlineCompletion } from './extensions/inline-completion'
import {
  WriteRichTermPropagation,
  writeRichExternalSyncMeta
} from './extensions/term-propagation'
import { WriteRichTemplateShortcuts } from './extensions/template-shortcuts'
import { WritePasteImage } from './paste-image'

export type WriteRichEditorHandle = {
  getProjectionText: () => string | null
  applyProjectedReplacement: (
    range: { from: number; to: number },
    original: string,
    replacement: string,
    instruction?: string
  ) => boolean
}

type Props = {
  value: string
  workspaceRoot?: string | null
  filePath?: string | null
  imageDirectory?: string | null
  readOnly?: boolean
  completionEnabled?: boolean
  completionDebounceMs?: number
  completionMinAcceptScore?: number
  completionLongEnabled?: boolean
  completionLongDebounceMs?: number
  completionLongMinAcceptScore?: number
  recentEdits?: WriteRecentEdit[]
  onChange: (value: string) => void
  onDocumentEdit?: (edits: WriteRecentEdit[]) => void
  onSelectionChange: (selection: WriteEditorSelectionState) => void
  onSaveShortcut: () => void
  onFidelityChange?: (fidelity: WriteRichFidelity) => void
  onImagePasteSaved?: () => void
  onError?: (message: string) => void
  handleRef?: MutableRefObject<WriteRichEditorHandle | null>
  fallback?: ReactNode
}

type GateState = {
  fileKey: string
  eligible: boolean
}

function fileKeyOf(filePath?: string | null): string {
  return (filePath ?? '').trim()
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
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}

function lineColumnOfText(prefix: string): { line: number; column: number } {
  const breaks = prefix.match(/\n/g)?.length ?? 0
  const lastBreak = prefix.lastIndexOf('\n')
  return { line: breaks + 1, column: prefix.length - lastBreak }
}

export function selectionStateFromEditor(editor: Editor): WriteEditorSelectionState {
  const { state, view } = editor
  const doc = state.doc
  const projection = buildWriteRichMarkdownProjection(doc)
  const ranges: WriteSelectionRange[] = []
  const rects: Array<{ left: number; right: number; top: number; bottom: number }> = []

  for (const range of state.selection.ranges) {
    const pmFrom = range.$from.pos
    const pmTo = range.$to.pos
    if (pmFrom === pmTo) continue
    const from = projectedOffsetForPos(doc, projection, pmFrom)
    const to = projectedOffsetForPos(doc, projection, pmTo)
    try {
      rects.push(view.coordsAtPos(pmFrom), view.coordsAtPos(pmTo))
    } catch {
      // The view can throw while it is tearing down.
    }
    if (from === null || to === null || to <= from) continue
    const text = projection.text.slice(from, to)
    const start = lineColumnOfText(projection.text.slice(0, from))
    const end = lineColumnOfText(projection.text.slice(0, Math.max(from, to - 1)))
    ranges.push({
      from,
      to,
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
      text,
      charCount: to - from
    })
  }

  const text = ranges.map((range) => range.text).join('\n\n')
  return {
    text,
    ranges,
    charCount: ranges.reduce((total, range) => total + range.charCount, 0),
    sourceKind: 'text',
    ...(rects.length > 0 ? { anchorRect: unionRects(rects) } : {})
  }
}

const INLINE_EDIT_RECENT_CONTEXT_CHARS = 180

export function WriteRichEditor({
  value,
  workspaceRoot,
  filePath,
  imageDirectory,
  readOnly = false,
  completionEnabled = false,
  completionDebounceMs = 0,
  completionMinAcceptScore = 0,
  completionLongEnabled = false,
  completionLongDebounceMs = 0,
  completionLongMinAcceptScore = 0,
  recentEdits = [],
  onChange,
  onDocumentEdit,
  onSelectionChange,
  onSaveShortcut,
  onFidelityChange,
  onImagePasteSaved,
  onError,
  handleRef,
  fallback
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const workspaceRootRef = useRef(workspaceRoot ?? '')
  const filePathRef = useRef(filePath ?? '')
  const imageDirectoryRef = useRef(imageDirectory ?? '')
  const readOnlyRef = useRef(readOnly)
  const completionEnabledRef = useRef(completionEnabled)
  const completionDebounceMsRef = useRef(completionDebounceMs)
  const completionMinAcceptScoreRef = useRef(completionMinAcceptScore)
  const completionLongEnabledRef = useRef(completionLongEnabled)
  const completionLongDebounceMsRef = useRef(completionLongDebounceMs)
  const completionLongMinAcceptScoreRef = useRef(completionLongMinAcceptScore)
  const recentEditsRef = useRef(recentEdits)
  const onChangeRef = useRef(onChange)
  const onDocumentEditRef = useRef(onDocumentEdit)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onSaveShortcutRef = useRef(onSaveShortcut)
  const onFidelityChangeRef = useRef(onFidelityChange)
  const onImagePasteSavedRef = useRef(onImagePasteSaved)
  const onErrorRef = useRef(onError)
  const lastEmittedValueRef = useRef<string | null>(null)
  const [gate, setGate] = useState<GateState | null>(null)

  workspaceRootRef.current = workspaceRoot ?? ''
  filePathRef.current = filePath ?? ''
  imageDirectoryRef.current = imageDirectory ?? ''
  readOnlyRef.current = readOnly
  completionEnabledRef.current = completionEnabled
  completionDebounceMsRef.current = completionDebounceMs
  completionMinAcceptScoreRef.current = completionMinAcceptScore
  completionLongEnabledRef.current = completionLongEnabled
  completionLongDebounceMsRef.current = completionLongDebounceMs
  completionLongMinAcceptScoreRef.current = completionLongMinAcceptScore
  recentEditsRef.current = recentEdits
  onChangeRef.current = onChange
  onDocumentEditRef.current = onDocumentEdit
  onSelectionChangeRef.current = onSelectionChange
  onSaveShortcutRef.current = onSaveShortcut
  onFidelityChangeRef.current = onFidelityChange
  onImagePasteSavedRef.current = onImagePasteSaved
  onErrorRef.current = onError

  const fileKey = fileKeyOf(filePath)
  const eligible = gate?.fileKey === fileKey ? gate.eligible : null

  useEffect(() => {
    if (value === lastEmittedValueRef.current && gate?.fileKey === fileKey) return
    const fidelity = auditWriteMarkdownFidelity(value)
    onFidelityChangeRef.current?.(fidelity)
    setGate((current) => {
      if (current?.fileKey === fileKey && current.eligible === fidelity.eligible) return current
      return { fileKey, eligible: fidelity.eligible }
    })
    if (!fidelity.eligible) {
      lastEmittedValueRef.current = null
      return
    }

    const editor = editorRef.current
    if (editor && !editor.isDestroyed && applyExternalMarkdownToEditor(editor, value)) {
      lastEmittedValueRef.current = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, fileKey])

  useEffect(() => {
    if (eligible !== true || !hostRef.current || editorRef.current) return

    const manager = getWriteMarkdownManager()
    const saveShortcut = Extension.create({
      name: 'writeSaveShortcut',
      addKeyboardShortcuts() {
        return {
          'Mod-s': () => {
            onSaveShortcutRef.current()
            return true
          }
        }
      }
    })

    const extensions: AnyExtension[] = [
      ...buildWriteRichExtensions({
        getFilePath: () => filePathRef.current,
        getWorkspaceRoot: () => workspaceRootRef.current
      }),
      WritePasteImage.configure({
        getWorkspaceRoot: () => workspaceRootRef.current,
        getFilePath: () => filePathRef.current,
        getImageDirectory: () => imageDirectoryRef.current,
        isReadOnly: () => readOnlyRef.current,
        onSaved: () => onImagePasteSavedRef.current?.(),
        onError: (message) => onErrorRef.current?.(message)
      }),
      WriteRichInlineCompletion.configure({
        getDebounceMs: () => completionDebounceMsRef.current,
        getMinAcceptScore: () => completionMinAcceptScoreRef.current,
        getLongDebounceMs: () => completionLongDebounceMsRef.current,
        getLongMinAcceptScore: () => completionLongMinAcceptScoreRef.current,
        isLongEnabled: () => completionLongEnabledRef.current,
        isEnabled: () => completionEnabledRef.current && !readOnlyRef.current,
        getFilePath: () => filePathRef.current,
        requestCompletion: async (context, mode) => {
          if (typeof window.sciforge?.requestWriteInlineCompletion !== 'function') return null
          const result = await window.sciforge.requestWriteInlineCompletion(
            buildInlineCompletionPayload(context, {
              workspaceRoot: workspaceRootRef.current,
              mode,
              recentEdits: recentEditsRef.current
            })
          )
          if (!result.ok) return null
          if (result.action?.kind === 'edit') {
            return { text: result.action.replacement, action: result.action, mode }
          }
          const completionText = result.action ? result.action.text : result.completion
          if (!completionText) return null
          return { text: completionText, action: result.action, mode }
        }
      }),
      WriteRichTermPropagation,
      WriteRichTemplateShortcuts.configure({
        isReadOnly: () => readOnlyRef.current
      }),
      saveShortcut
    ]

    const editor = new Editor({
      element: hostRef.current,
      extensions,
      content: parseWriteMarkdown(value),
      editable: !readOnlyRef.current,
      editorProps: {
        attributes: {
          class: 'write-rich-editor',
          spellcheck: readOnlyRef.current ? 'false' : 'true',
          'data-write-editor-mode': 'rich'
        }
      },
      onUpdate({ editor: instance, transaction }) {
        if (transaction.getMeta(writeRichExternalSyncMeta)) {
          onSelectionChangeRef.current(selectionStateFromEditor(instance))
          return
        }
        try {
          const markdown = manager.serialize(instance.state.doc.toJSON())
          lastEmittedValueRef.current = markdown
          onChangeRef.current(markdown)
        } catch (error) {
          onErrorRef.current?.(error instanceof Error ? error.message : String(error))
        }
        if (onDocumentEditRef.current && transaction.docChanged) {
          const edits = recentEditsFromRichTransaction(transaction, filePathRef.current)
          if (edits.length > 0) onDocumentEditRef.current(edits)
        }
        onSelectionChangeRef.current(selectionStateFromEditor(instance))
      },
      onSelectionUpdate({ editor: instance }) {
        onSelectionChangeRef.current(selectionStateFromEditor(instance))
      }
    })

    editorRef.current = editor
    lastEmittedValueRef.current = value
    onSelectionChangeRef.current(selectionStateFromEditor(editor))

    if (handleRef) {
      handleRef.current = {
        getProjectionText: () => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed) return null
          return buildWriteRichMarkdownProjection(instance.state.doc).text
        },
        applyProjectedReplacement: (range, original, replacement, instruction) => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed || readOnlyRef.current) return false
          const doc = instance.state.doc
          const projection = buildWriteRichMarkdownProjection(doc)
          const from = posForProjectedOffset(doc, projection, range.from)
          const to = posForProjectedOffset(doc, projection, range.to)
          if (from === null || to === null || to < from) return false
          const current = doc.textBetween(from, to, '\n', () => '')
          if (current.replace(/\n+/g, '\n') !== original.replace(/\n+/g, '\n')) return false
          const applied = replaceRangeWithMarkdown(
            instance.state,
            (tr) => instance.view.dispatch(tr),
            from,
            to,
            replacement
          )
          if (!applied) return false

          const record = createWriteRecentEdit({
            source: 'inline-edit',
            filePath: filePathRef.current,
            from: range.from,
            to: range.to,
            deletedText: original,
            insertedText: replacement,
            beforeContext: projection.text.slice(
              Math.max(0, range.from - INLINE_EDIT_RECENT_CONTEXT_CHARS),
              range.from
            ),
            afterContext: projection.text.slice(
              range.to,
              Math.min(projection.text.length, range.to + INLINE_EDIT_RECENT_CONTEXT_CHARS)
            ),
            instruction,
            scopeKind: 'selection'
          })
          if (record) onDocumentEditRef.current?.([record])
          return true
        }
      }
    }

    return () => {
      if (handleRef) handleRef.current = null
      editor.destroy()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, fileKey])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!readOnly)
  }, [readOnly])

  if (eligible === false) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <div className="write-rich-fallback-notice flex shrink-0 items-center gap-2 border-b border-amber-200/80 bg-amber-50/90 px-4 py-2 text-[12.5px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span>{t('writeRichFallbackNotice')}</span>
        </div>
        <div className="min-h-0 min-w-0 flex-1">{fallback}</div>
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      className="write-rich-host flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto"
    />
  )
}
