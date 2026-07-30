import { useEffect, useRef, type ReactElement } from 'react'
import { Annotation, Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { drawSelection, EditorView, highlightActiveLine, keymap, type ViewUpdate } from '@codemirror/view'
import {
  buildCodeMirrorEditorSelectionState,
  buildInlineCompletionExtension,
  buildInlineCompletionPayload,
  codeMirrorRecentEditsFromUpdate,
  type WriteEditorSelectionState,
  type WriteRecentEdit
} from '../../write/inline-completion'
import { writeMarkdownLivePreviewExtensions } from '../../write/markdown-live-preview'
import { buildWriteTemplateShortcutExpansion } from '../../write/template-shortcuts'
import {
  buildWriteCanonicalTermPropagationChanges,
  buildWriteTermPropagationChanges,
  type WriteTermReplacementSeed
} from '../../write/term-propagation'
import { withPinnedWorkspaceLocator } from '../../remote-workspace/placement'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'

export type {
  WriteEditorSelectionState,
  WriteSelectionAnchorRect,
  WriteSelectionPageRect,
  WriteSelectionRange
} from '../../write/inline-completion'

type Props = {
  value: string
  workspaceRoot?: string | null
  filePath?: string | null
  imageDirectory?: string | null
  appearance?: 'source' | 'live'
  livePreviewEnabled?: boolean
  markdownFeatures?: boolean
  readOnly?: boolean
  completionEnabled: boolean
  completionDebounceMs: number
  completionMinAcceptScore: number
  completionLongEnabled: boolean
  completionLongDebounceMs: number
  completionLongMinAcceptScore: number
  recentEdits?: WriteRecentEdit[]
  onChange: (value: string) => void
  onDocumentEdit?: (edits: WriteRecentEdit[]) => void
  onSelectionChange: (selection: WriteEditorSelectionState) => void
  onSaveShortcut: () => void
  onImagePasteSaved?: () => void
  onImagePasteError?: (message: string) => void
}

const externalValueSyncAnnotation = Annotation.define<boolean>()
const termPropagationAnnotation = Annotation.define<boolean>()

function termReplacementSeedFromUpdate(update: ViewUpdate): WriteTermReplacementSeed | null {
  const changes: WriteTermReplacementSeed[] = []
  update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    changes.push({
      from: fromB,
      to: toB,
      deletedText: update.startState.sliceDoc(fromA, toA),
      insertedText: inserted.toString()
    })
  })
  if (changes.length !== 1) return null
  const [change] = changes
  if (!change.deletedText || !change.insertedText) return null
  return change
}

function buildEditorTheme(appearance: 'source' | 'live'): Extension {
  const sourceMode = appearance === 'source'
  return EditorView.theme({
    '&': {
      height: '100%',
      minWidth: '0',
      minHeight: '0',
      color: 'var(--ds-text)',
      backgroundColor: 'transparent',
      fontFamily: sourceMode
        ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
        : 'Georgia, Charter, "Iowan Old Style", "Noto Serif SC", serif',
      fontSize: sourceMode ? '14px' : '15px'
    },
    '.cm-scroller': {
      overflow: 'auto',
      lineHeight: sourceMode ? '1.75' : '1.85',
      backgroundColor: 'transparent'
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '26px 24px 56px',
      caretColor: 'var(--ds-text)'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--ds-text)'
    },
    '.cm-selectionBackground': {
      backgroundColor: 'var(--write-selection-bg, var(--ds-selection))'
    },
    '.cm-content::selection, .cm-content *::selection': {
      backgroundColor: 'var(--write-selection-bg, var(--ds-selection))',
      color: 'var(--write-selection-text, inherit)'
    },
    '.cm-gutters': {
      display: 'none'
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(0, 0, 0, 0.025)'
    },
    '[data-theme="dark"] & .cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.04)'
    }
  })
}

function buildInteractionExtensions(readOnly: boolean, appearance: 'source' | 'live'): Extension[] {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({
      spellcheck: readOnly ? 'false' : 'true',
      autocorrect: readOnly ? 'off' : 'on',
      autocapitalize: readOnly ? 'off' : 'sentences',
      'data-write-editor-mode': appearance
    })
  ]
}

function hasClipboardImage(event: ClipboardEvent): boolean {
  const items = event.clipboardData?.items
  if (!items) return false
  return Array.from(items).some((item) => item.kind === 'file' && item.type.startsWith('image/'))
}

function buildPastedImageMarkdown(
  state: EditorState,
  from: number,
  to: number,
  markdownPath: string
): { text: string; cursor: number } {
  const before = from > 0 ? state.sliceDoc(from - 1, from) : ''
  const after = to < state.doc.length ? state.sliceDoc(to, to + 1) : ''
  const leadingBreak = from > 0 && before !== '\n' ? '\n' : ''
  const trailingBreak = after && after !== '\n' ? '\n' : ''
  const text = `${leadingBreak}![Pasted image](${markdownPath})${trailingBreak}\n`
  return {
    text,
    cursor: from + text.length
  }
}

function expandWriteTemplateShortcut(view: EditorView): boolean {
  const selection = view.state.selection.main
  if (!selection.empty) return false
  const expansion = buildWriteTemplateShortcutExpansion({
    text: view.state.doc.toString(),
    cursor: selection.head
  })
  if (!expansion) return false

  const nextHead = expansion.from + expansion.insert.length
  view.dispatch({
    changes: {
      from: expansion.from,
      to: expansion.to,
      insert: expansion.insert
    },
    selection: EditorSelection.cursor(nextHead),
    scrollIntoView: true
  })
  return true
}

export function WriteMarkdownEditor({
  value,
  workspaceRoot,
  filePath,
  imageDirectory,
  appearance = 'live',
  livePreviewEnabled = appearance === 'live',
  markdownFeatures = true,
  readOnly = false,
  completionEnabled,
  completionDebounceMs,
  completionMinAcceptScore,
  completionLongEnabled,
  completionLongDebounceMs,
  completionLongMinAcceptScore,
  recentEdits = [],
  onChange,
  onDocumentEdit,
  onSelectionChange,
  onSaveShortcut,
  onImagePasteSaved,
  onImagePasteError
}: Props): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartmentRef = useRef<Compartment | null>(null)
  const livePreviewCompartmentRef = useRef<Compartment | null>(null)
  const editableCompartmentRef = useRef<Compartment | null>(null)
  const workspaceRootRef = useRef(workspaceRoot ?? '')
  const filePathRef = useRef(filePath ?? '')
  const imageDirectoryRef = useRef(imageDirectory ?? '')
  const livePreviewEnabledRef = useRef(livePreviewEnabled)
  const markdownFeaturesRef = useRef(markdownFeatures)
  const readOnlyRef = useRef(readOnly)
  const completionEnabledRef = useRef(completionEnabled)
  const completionDebounceMsRef = useRef(completionDebounceMs)
  const completionMinAcceptScoreRef = useRef(completionMinAcceptScore)
  const completionLongEnabledRef = useRef(completionLongEnabled)
  const completionLongDebounceMsRef = useRef(completionLongDebounceMs)
  const completionLongMinAcceptScoreRef = useRef(completionLongMinAcceptScore)
  const recentEditsRef = useRef(recentEdits)
  const appearanceRef = useRef(appearance)
  const onChangeRef = useRef(onChange)
  const onDocumentEditRef = useRef(onDocumentEdit)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onSaveShortcutRef = useRef(onSaveShortcut)
  const onImagePasteSavedRef = useRef(onImagePasteSaved)
  const onImagePasteErrorRef = useRef(onImagePasteError)
  const valueRef = useRef(value)

  workspaceRootRef.current = workspaceRoot ?? ''
  filePathRef.current = filePath ?? ''
  imageDirectoryRef.current = imageDirectory ?? ''
  livePreviewEnabledRef.current = livePreviewEnabled
  markdownFeaturesRef.current = markdownFeatures
  readOnlyRef.current = readOnly
  completionEnabledRef.current = completionEnabled
  completionDebounceMsRef.current = completionDebounceMs
  completionMinAcceptScoreRef.current = completionMinAcceptScore
  completionLongEnabledRef.current = completionLongEnabled
  completionLongDebounceMsRef.current = completionLongDebounceMs
  completionLongMinAcceptScoreRef.current = completionLongMinAcceptScore
  recentEditsRef.current = recentEdits
  appearanceRef.current = appearance
  onChangeRef.current = onChange
  onDocumentEditRef.current = onDocumentEdit
  onSelectionChangeRef.current = onSelectionChange
  onSaveShortcutRef.current = onSaveShortcut
  onImagePasteSavedRef.current = onImagePasteSaved
  onImagePasteErrorRef.current = onImagePasteError
  valueRef.current = value

  useEffect(() => {
    if (!hostRef.current) return

    const inlineCompletionCompartment = new Compartment()
    const themeCompartment = new Compartment()
    const livePreviewCompartment = new Compartment()
    const editableCompartment = new Compartment()
    themeCompartmentRef.current = themeCompartment
    livePreviewCompartmentRef.current = livePreviewCompartment
    editableCompartmentRef.current = editableCompartment
    const inlineCompletionExtension = buildInlineCompletionExtension({
      getDebounceMs: () => completionDebounceMsRef.current,
      getMinAcceptScore: () => completionMinAcceptScoreRef.current,
      getLongDebounceMs: () => completionLongDebounceMsRef.current,
      getLongMinAcceptScore: () => completionLongMinAcceptScoreRef.current,
      isLongEnabled: () => completionLongEnabledRef.current,
      isEnabled: () => completionEnabledRef.current && !readOnlyRef.current,
      getFilePath: () => filePathRef.current,
      language: 'markdown',
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
          return {
            text: result.action.replacement,
            action: result.action,
            mode
          }
        }
        const completionText = result.action ? result.action.text : result.completion
        if (!completionText) return null
        return {
          text: completionText,
          action: result.action,
          mode
        }
      }
    })

    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        themeCompartment.of(buildEditorTheme(appearanceRef.current)),
        livePreviewCompartment.of(
          markdownFeaturesRef.current && appearanceRef.current === 'live' && livePreviewEnabledRef.current
            ? writeMarkdownLivePreviewExtensions(filePathRef.current, workspaceRootRef.current)
            : []
        ),
        editableCompartment.of(buildInteractionExtensions(readOnlyRef.current, appearanceRef.current)),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        history(),
        drawSelection(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        EditorView.lineWrapping,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: 'Tab',
            run: (view) => {
              if (readOnlyRef.current) return false
              if (!markdownFeaturesRef.current) return false
              return expandWriteTemplateShortcut(view)
            }
          },
          indentWithTab,
          {
            key: 'Mod-s',
            run: () => {
              onSaveShortcutRef.current()
              return true
            }
          }
        ]),
        EditorView.domEventHandlers({
          paste(event, view) {
            if (readOnlyRef.current) return false
            if (!markdownFeaturesRef.current) return false
            if (!hasClipboardImage(event)) return false
            const nextWorkspaceRoot = workspaceRootRef.current.trim()
            const nextFilePath = filePathRef.current.trim()
            if (!nextWorkspaceRoot || !nextFilePath) {
              onImagePasteErrorRef.current?.('Open a workspace file before pasting an image.')
              event.preventDefault()
              return true
            }
            if (typeof window.sciforge?.saveWorkspaceClipboardImage !== 'function') return false

            event.preventDefault()
            let input
            try {
              input = withPinnedWorkspaceLocator(
                {
                  workspaceRoot: nextWorkspaceRoot,
                  currentFilePath: nextFilePath,
                  ...(imageDirectoryRef.current.trim()
                    ? { imageDirectory: imageDirectoryRef.current.trim() }
                    : {})
                },
                useWriteWorkspaceStore.getState().pinnedWorkspaceLocator
              )
            } catch (error) {
              onImagePasteErrorRef.current?.(
                error instanceof Error ? error.message : String(error)
              )
              return true
            }
            void window.sciforge
              .saveWorkspaceClipboardImage(input)
              .then((result) => {
                if (!result.ok) {
                  onImagePasteErrorRef.current?.(result.message)
                  return
                }
                const selection = view.state.selection.main
                const insertion = buildPastedImageMarkdown(
                  view.state,
                  selection.from,
                  selection.to,
                  result.markdownPath
                )
                view.focus()
                view.dispatch({
                  changes: {
                    from: selection.from,
                    to: selection.to,
                    insert: insertion.text
                  },
                  selection: EditorSelection.cursor(insertion.cursor),
                  scrollIntoView: true
                })
                onImagePasteSavedRef.current?.()
              })
              .catch((error) => {
                onImagePasteErrorRef.current?.(
                  error instanceof Error ? error.message : String(error)
                )
              })
            return true
          }
        }),
        inlineCompletionCompartment.of(inlineCompletionExtension),
        EditorView.updateListener.of((update) => {
          const externalValueSync = update.transactions.some((transaction) =>
            transaction.annotation(externalValueSyncAnnotation)
          )
          const termPropagationSync = update.transactions.some((transaction) =>
            transaction.annotation(termPropagationAnnotation)
          )
          if (update.docChanged && !externalValueSync) {
            const recentEdits = codeMirrorRecentEditsFromUpdate(update, filePathRef.current)
            if (recentEdits.length > 0) onDocumentEditRef.current?.(recentEdits)
            onChangeRef.current(update.state.doc.toString())
          }
          if (update.docChanged || update.selectionSet) {
            onSelectionChangeRef.current(buildCodeMirrorEditorSelectionState(update.view))
          }
          if (markdownFeaturesRef.current && update.docChanged && !externalValueSync && !termPropagationSync) {
            const seed = termReplacementSeedFromUpdate(update)
            if (seed) {
              const content = update.state.doc.toString()
              const rawPropagationChanges = [
                ...buildWriteTermPropagationChanges(content, seed),
                ...buildWriteCanonicalTermPropagationChanges(content, seed)
              ]
              const seenPropagationChanges = new Set<string>()
              const propagationChanges = rawPropagationChanges.filter((change) => {
                const key = `${change.from}:${change.to}`
                if (seenPropagationChanges.has(key)) return false
                seenPropagationChanges.add(key)
                return true
              })
              if (propagationChanges.length > 0) {
                update.view.dispatch({
                  changes: propagationChanges,
                  annotations: termPropagationAnnotation.of(true)
                })
              }
            }
          }
        })
      ]
    })

    const view = new EditorView({
      state,
      parent: hostRef.current
    })
    viewRef.current = view
    onSelectionChangeRef.current(buildCodeMirrorEditorSelectionState(view))

    return () => {
      view.destroy()
      viewRef.current = null
      themeCompartmentRef.current = null
      livePreviewCompartmentRef.current = null
      editableCompartmentRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    const themeCompartment = themeCompartmentRef.current
    const livePreviewCompartment = livePreviewCompartmentRef.current
    const editableCompartment = editableCompartmentRef.current
    if (!view || !themeCompartment || !livePreviewCompartment || !editableCompartment) return
    view.dispatch({
      effects: [
        themeCompartment.reconfigure(buildEditorTheme(appearance)),
        livePreviewCompartment.reconfigure(
          markdownFeatures && appearance === 'live' && livePreviewEnabled
            ? writeMarkdownLivePreviewExtensions(filePath, workspaceRoot)
            : []
        ),
        editableCompartment.reconfigure(buildInteractionExtensions(readOnly, appearance))
      ]
    })
  }, [appearance, filePath, livePreviewEnabled, markdownFeatures, readOnly, workspaceRoot])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    const nextLength = value.length
    const { anchor, head } = view.state.selection.main
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: externalValueSyncAnnotation.of(true),
      selection: EditorSelection.single(
        Math.min(anchor, nextLength),
        Math.min(head, nextLength)
      )
    })
  }, [value])

  return <div ref={hostRef} className="write-codemirror-host flex h-full min-h-0 w-full min-w-0" />
}
