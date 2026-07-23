import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation
} from '@shared/workspace-preview'
import {
  TextWorkspaceViewer,
  buildTextWorkspaceViewerModel,
  createTextReplaceAllOperation,
  saveTextWorkspaceViewerDraft,
  textWorkspaceSelectionOffsets,
  textWorkspaceViewerDraftSourceKey
} from './TextWorkspaceViewer'

function createTextObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/notes.txt',
      workspaceRoot: '/workspace/lab',
      mimeType: 'text/plain',
      size: 11
    },
    view: {
      pluginId: 'text',
      modality: 'text',
      mode: 'preview',
      title: 'notes.txt'
    },
    visibleText: 'alpha\nbeta\n',
    text: {
      lineCount: 3,
      characterCount: 11,
      truncated: false
    },
    actions: ['observe', 'workspace.setSelection', 'text.replaceRange', 'applyEdit', 'save'],
    ...overrides
  }
}

describe('TextWorkspaceViewer', () => {
  it('builds an editable model from text observation metadata', () => {
    const observation = createTextObservation()
    const model = buildTextWorkspaceViewerModel(observation, true)

    expect(model.status.kind).toBe('ready')
    expect(model.title).toBe('notes.txt')
    expect(model.text).toBe('alpha\nbeta\n')
    expect(model.lineCount).toBe(3)
    expect(model.characterCount).toBe(11)
    expect(model.editable).toBe(true)
    expect(model.agentSummary).toContain('3 lines')
    expect(createTextReplaceAllOperation({
      observation,
      beforeText: model.text,
      text: 'alpha\ngamma\n'
    })).toEqual({
      kind: 'text.replaceRange',
      path: '/workspace/lab/notes.txt',
      range: {
        start: { line: 1, column: 1 },
        end: { line: 3, column: 1 }
      },
      text: 'alpha\ngamma\n'
    })
  })

  it('renders text content and disables full-file edit for truncated observations', () => {
    const html = renderToStaticMarkup(createElement(TextWorkspaceViewer, {
      observation: createTextObservation({
        text: {
          lineCount: 1,
          characterCount: 200_000,
          truncated: true
        }
      }),
      onApplyEdit: () => undefined
    }))

    expect(html).toContain('data-workspace-preview-text-viewer')
    expect(html).toContain('overflow-hidden')
    expect(html).toContain('data-truncated="true"')
    expect(html).toContain('data-editable="false"')
    expect(html).not.toContain('data-text-agent-summary')
    expect(html).toContain('data-text-preview-editor')
    expect(html).toContain('This text preview is truncated.')
  })

  it('renders a clear save action that is disabled until the draft changes', () => {
    const html = renderToStaticMarkup(createElement(TextWorkspaceViewer, {
      observation: createTextObservation(),
      onApplyEdit: () => undefined
    }))

    expect(html).toContain('data-text-save="true"')
    expect(html).toContain('data-text-save-status="idle"')
    expect(html).toContain('workspacePreviewTextNoUnsavedChanges')
    expect(html).toContain('disabled=""')
    expect(html).toContain('>workspacePreviewTextSave</button>')
  })

  it('awaits saves and reports rejected edit handlers as failures', async () => {
    const observation = createTextObservation()
    let finishSave: (() => void) | undefined
    const onApplyEdit = vi.fn(() => new Promise<void>((resolve) => {
      finishSave = resolve
    }))
    let settled = false
    const saving = saveTextWorkspaceViewerDraft({
      observation,
      beforeText: observation.visibleText ?? '',
      text: 'alpha\ngamma\n',
      onApplyEdit
    }).then((result) => {
      settled = true
      return result
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    expect(onApplyEdit).toHaveBeenCalledWith(createTextReplaceAllOperation({
      observation,
      beforeText: observation.visibleText ?? '',
      text: 'alpha\ngamma\n'
    }))

    finishSave?.()
    await expect(saving).resolves.toEqual({ ok: true })

    await expect(saveTextWorkspaceViewerDraft({
      observation,
      beforeText: observation.visibleText ?? '',
      text: 'not saved',
      onApplyEdit: async () => {
        throw new Error('disk is read-only')
      }
    })).resolves.toEqual({ ok: false, message: 'disk is read-only' })
  })

  it('changes the draft source key when async observations arrive or switch files', () => {
    const emptyModel = buildTextWorkspaceViewerModel(null, true)
    const notesObservation = createTextObservation()
    const notesModel = buildTextWorkspaceViewerModel(notesObservation, true)
    const envObservation = createTextObservation({
      file: {
        path: '/workspace/lab/.env',
        workspaceRoot: '/workspace/lab',
        mimeType: 'text/plain',
        size: 11,
        mtimeMs: 42
      },
      view: {
        pluginId: 'text',
        modality: 'text',
        mode: 'preview',
        title: '.env'
      },
      visibleText: notesModel.text
    })
    const envModel = buildTextWorkspaceViewerModel(envObservation, true)

    expect(textWorkspaceViewerDraftSourceKey(null, emptyModel)).not.toBe(
      textWorkspaceViewerDraftSourceKey(notesObservation, notesModel)
    )
    expect(textWorkspaceViewerDraftSourceKey(notesObservation, notesModel)).not.toBe(
      textWorkspaceViewerDraftSourceKey(envObservation, envModel)
    )
  })

  it('maps one-based text anchors to textarea offsets and marks the initial selection', () => {
    expect(textWorkspaceSelectionOffsets('alpha\nbeta\ngamma', {
      startLine: 2,
      startColumn: 2,
      endLine: 2,
      endColumn: 5
    })).toEqual({ start: 7, end: 10 })

    const html = renderToStaticMarkup(createElement(TextWorkspaceViewer, {
      observation: createTextObservation({
        selection: {
          kind: 'text',
          ranges: [{ startLine: 2, startColumn: 1, endLine: 2, endColumn: 5 }]
        }
      })
    }))
    expect(html).toContain('data-initial-selection="true"')
  })
})
