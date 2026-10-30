import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  buildCodeMirrorSelectionState,
  codeMirrorRecentEditsFromUpdate
} from './codemirror-editor'

describe('CodeMirror write editor adapters', () => {
  it('captures non-empty selection ranges without requiring a view', () => {
    const state = EditorState.create({
      doc: 'Alpha beta\nGamma delta',
      selection: EditorSelection.create([
        EditorSelection.range(0, 5),
        EditorSelection.range(11, 16)
      ]),
      extensions: [EditorState.allowMultipleSelections.of(true)]
    })

    expect(buildCodeMirrorSelectionState(state)).toEqual({
      text: 'Alpha\n\nGamma',
      ranges: [
        {
          from: 0,
          to: 5,
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 5,
          text: 'Alpha',
          charCount: 5
        },
        {
          from: 11,
          to: 16,
          startLine: 2,
          startColumn: 1,
          endLine: 2,
          endColumn: 5,
          text: 'Gamma',
          charCount: 5
        }
      ],
      charCount: 10
    })
  })

  it('extracts recent edit records from CodeMirror document changes', () => {
    const startState = EditorState.create({ doc: 'Alpha beta gamma' })
    const transaction = startState.update({
      changes: {
        from: 6,
        to: 10,
        insert: 'delta'
      }
    })

    const edits = codeMirrorRecentEditsFromUpdate(
      transaction,
      '/tmp/workspace/draft.md',
      { timestamp: 1_800_000_000_000 }
    )

    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({
      source: 'user',
      timestamp: 1_800_000_000_000,
      filePath: '/tmp/workspace/draft.md',
      from: 6,
      to: 10,
      deletedText: 'beta',
      insertedText: 'delta',
      beforeContext: 'Alpha ',
      afterContext: ' gamma'
    })
  })

  it('ignores document changes when the file path is not available', () => {
    const startState = EditorState.create({ doc: 'Alpha beta' })
    const transaction = startState.update({
      changes: {
        from: 6,
        insert: 'new '
      }
    })

    expect(codeMirrorRecentEditsFromUpdate(transaction, '  ')).toEqual([])
  })
})
