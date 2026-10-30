import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation
} from '@shared/workspace-preview'
import {
  DeckWorkspaceViewer,
  buildDeckWorkspaceViewerModel,
  createDeckSlideSelectionOperation,
  createDeckSlidePreviewTextBoxSelectionOperation,
  createDeckTextElementSelectionOperation,
  createDeckUpdateTextElementOperation
} from './DeckWorkspaceViewer'

function createDeckObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/talk.pptx',
      workspaceRoot: '/workspace/lab',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      size: 4096
    },
    view: {
      pluginId: 'deck',
      modality: 'deck',
      mode: 'preview',
      title: 'Assay results deck'
    },
    visibleText: [
      'Slide 1: Title',
      'Text: Assay Results',
      'Slide 2: Methods',
      'Text: Cells were profiled with a compact panel.',
      'Notes: Mention replicate wells.',
      'Slide 3: Results',
      'Text: Assay response increased after treatment.',
      'Notes: Follow-up validation is planned.',
      'Slide 4: Appendix'
    ].join('\n'),
    slides: [
      { id: 'slide-1', index: 0, title: 'Title' },
      { id: 'slide-2', index: 1, title: 'Methods', notes: 'Mention replicate wells.' },
      { id: 'slide-3', index: 2, title: 'Results', notes: 'Follow-up validation is planned.' }
    ],
    deck: {
      textElementCount: 4,
      truncatedTextElements: false,
      slidePreviews: [
        {
          slideId: 'slide-1',
          index: 0,
          width: 12_192_000,
          height: 6_858_000,
          textBoxes: [
            {
              elementId: 'slide-1-title-1',
              kind: 'title',
              text: 'Assay Results',
              x: 914_400,
              y: 457_200,
              width: 10_363_200,
              height: 914_400
            }
          ]
        },
        {
          slideId: 'slide-2',
          index: 1,
          width: 12_192_000,
          height: 6_858_000,
          textBoxes: [
            {
              elementId: 'slide-2-body-1',
              kind: 'body',
              text: 'Cells were profiled with a compact panel.',
              x: 914_400,
              y: 1_828_800,
              width: 10_363_200,
              height: 3_657_600
            }
          ]
        },
        {
          slideId: 'slide-3',
          index: 2,
          width: 12_192_000,
          height: 6_858_000,
          textBoxes: [
            {
              elementId: 'slide-3-body-1',
              kind: 'body',
              text: 'Assay response increased after treatment.',
              x: 914_400,
              y: 1_828_800,
              width: 10_363_200,
              height: 3_657_600
            }
          ]
        }
      ],
      textElements: [
        {
          slideId: 'slide-1',
          elementId: 'slide-1-title-1',
          kind: 'title',
          text: 'Assay Results'
        },
        {
          slideId: 'slide-2',
          elementId: 'slide-2-body-1',
          kind: 'body',
          text: 'Cells were profiled with a compact panel.'
        },
        {
          slideId: 'slide-3',
          elementId: 'slide-3-body-1',
          kind: 'body',
          text: 'Assay response increased after treatment.'
        },
        {
          slideId: 'slide-3',
          elementId: 'slide-3-notes-1',
          kind: 'notes',
          text: 'Follow-up validation is planned.'
        }
      ]
    },
    selection: {
      kind: 'deck',
      slideIds: ['slide-2', 'slide-3'],
      elementIds: ['slide-3-body-1', 'slide-3-notes-1']
    },
    annotations: [
      {
        id: 'slide-3-comment-1',
        kind: 'pptx-comment',
        summary: 'Slide 3, Dr Reviewer: Check assay interpretation.'
      }
    ],
    actions: [
      'observe',
      'deck.selectSlide',
      'deck.selectText',
      'applyEdit',
      'workspace.export:pptx',
      'sequence.search'
    ],
    ...overrides
  }
}

describe('DeckWorkspaceViewer', () => {
  it('builds an agent-readable deck view model from slides, visible text, and actions', () => {
    const model = buildDeckWorkspaceViewerModel(createDeckObservation())

    expect(model.status.kind).toBe('ready')
    expect(model.title).toBe('Assay results deck')
    expect(model.slides).toEqual([
      { id: 'slide-1', label: 'Slide 1', title: 'Title', notes: 'No notes reported' },
      { id: 'slide-2', label: 'Slide 2', title: 'Methods', notes: 'Mention replicate wells.' },
      { id: 'slide-3', label: 'Slide 3', title: 'Results', notes: 'Follow-up validation is planned.' }
    ])
    expect(model.visibleText.kind).toBe('reported')
    expect(model.visibleText.summary).toContain('9 non-empty lines')
    expect(model.visibleText.summary).toContain('1 line omitted')
    expect(model.textElements.summary).toBe('4 text elements available, 2 selected elements.')
    expect(model.annotations).toEqual({
      kind: 'reported',
      summary: '1 annotation reported.',
      rows: [{
        id: 'slide-3-comment-1',
        kind: 'pptx-comment',
        summary: 'Slide 3, Dr Reviewer: Check assay interpretation.'
      }]
    })
    expect(model.textElements.rows.map((row) => [row.id, row.slideId, row.kind, row.selected])).toEqual([
      ['slide-1-title-1', 'slide-1', 'title', false],
      ['slide-2-body-1', 'slide-2', 'body', false],
      ['slide-3-body-1', 'slide-3', 'body', true],
      ['slide-3-notes-1', 'slide-3', 'notes', true]
    ])
    expect(model.currentSlide).toMatchObject({
      kind: 'reported',
      id: 'slide-2',
      label: 'Slide 2',
      title: 'Methods',
      selected: true
    })
    if (model.currentSlide.kind !== 'reported') throw new Error('Expected reported current slide')
    expect(model.currentSlide.summary).toContain('Selected slide: Slide 2 - Methods.')
    expect(model.currentSlide.textElements.map((element) => element.id)).toEqual(['slide-2-body-1'])
    expect(model.currentSlide.preview).toMatchObject({
      kind: 'reported',
      slideId: 'slide-2',
      width: 12_192_000,
      height: 6_858_000,
      textBoxes: [
        {
          id: 'slide-2-body-1',
          kind: 'body',
          text: 'Cells were profiled with a compact panel.',
          hasGeometry: true
        }
      ]
    })
    if (model.currentSlide.preview.kind !== 'reported') throw new Error('Expected reported slide preview')
    expect(createDeckSlidePreviewTextBoxSelectionOperation({
      observation: createDeckObservation(),
      slideId: model.currentSlide.preview.slideId,
      textBox: model.currentSlide.preview.textBoxes[0]!
    })).toEqual({
      kind: 'workspace.setSelection',
      path: '/workspace/lab/talk.pptx',
      selection: {
        kind: 'deck',
        slideIds: ['slide-2'],
        elementIds: ['slide-2-body-1']
      }
    })
    expect(createDeckUpdateTextElementOperation({
      observation: createDeckObservation(),
      element: model.currentSlide.textElements[0],
      text: 'Updated methods summary.'
    })).toEqual({
      kind: 'deck.updateTextElement',
      path: '/workspace/lab/talk.pptx',
      slideId: 'slide-2',
      elementId: 'slide-2-body-1',
      text: 'Updated methods summary.'
    })
    expect(createDeckSlideSelectionOperation({
      observation: createDeckObservation(),
      slide: model.slides[2]!
    })).toEqual({
      kind: 'workspace.setSelection',
      path: '/workspace/lab/talk.pptx',
      selection: {
        kind: 'deck',
        slideIds: ['slide-3']
      }
    })
    expect(createDeckTextElementSelectionOperation({
      observation: createDeckObservation(),
      element: model.textElements.rows[2]!
    })).toEqual({
      kind: 'workspace.setSelection',
      path: '/workspace/lab/talk.pptx',
      selection: {
        kind: 'deck',
        slideIds: ['slide-3'],
        elementIds: ['slide-3-body-1']
      }
    })
    expect(model.actions.map((action) => [action.id, action.kind])).toEqual([
      ['observe', 'preview'],
      ['deck.selectSlide', 'select'],
      ['deck.selectText', 'select'],
      ['applyEdit', 'edit'],
      ['workspace.export:pptx', 'export']
    ])
    expect(model.agentSummary).toContain('slides: Slide 1 Title; Slide 2 Methods; Slide 3 Results')
    expect(model.agentSummary).toContain('current slide: Selected slide: Slide 2 - Methods.')
    expect(model.agentSummary).toContain('text elements: 4 text elements available, 2 selected elements.')
    expect(model.agentSummary).toContain('annotations: 1 annotation reported.')
    expect(model.agentSummary).toContain('actions: Observe, Select Slide, Select Text, Apply Edit, Export PPTX')
  })

  it('reports empty and unsupported states without trying to render a deck placeholder', () => {
    const empty = buildDeckWorkspaceViewerModel(null)
    const unsupported = buildDeckWorkspaceViewerModel({
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/samples.csv',
        workspaceRoot: '/workspace/lab',
        mimeType: 'text/csv'
      },
      view: {
        pluginId: 'tabular',
        modality: 'tabular',
        mode: 'preview',
        title: 'samples.csv'
      },
      actions: ['workspace.setSelection']
    })
    const emptyHtml = renderToStaticMarkup(createElement(DeckWorkspaceViewer, { model: empty }))
    const unsupportedHtml = renderToStaticMarkup(createElement(DeckWorkspaceViewer, { model: unsupported }))

    expect(empty.status).toMatchObject({
      kind: 'empty',
      title: 'No deck observation'
    })
    expect(unsupported.status).toMatchObject({
      kind: 'unsupported',
      title: 'Unsupported observation'
    })
    expect(emptyHtml).toContain('data-status="empty"')
    expect(emptyHtml).not.toContain('data-deck-placeholder')
    expect(unsupportedHtml).toContain('data-status="unsupported"')
    expect(unsupportedHtml).toContain('Tabular observations cannot be rendered')
  })

  it('renders slide, selection, text elements, visible text, and action details', () => {
    const model = buildDeckWorkspaceViewerModel(createDeckObservation())
    const groupsById = new Map(model.selection.groups.map((group) => [group.id, group]))
    const html = renderToStaticMarkup(createElement(DeckWorkspaceViewer, {
      observation: createDeckObservation()
    }))

    expect(model.selection.kind).toBe('deck')
    expect(model.selection.summary).toBe('Selected 2 slides, 2 elements.')
    expect(groupsById.get('slides')).toMatchObject({
      title: 'Selected slides',
      summary: '2 slides',
      items: ['Slide 2: Methods', 'Slide 3: Results']
    })
    expect(groupsById.get('elements')).toMatchObject({
      title: 'Selected elements',
      summary: '2 elements',
      items: ['slide-3-body-1', 'slide-3-notes-1']
    })
    expect(html).toContain('data-workspace-preview-deck-viewer')
    expect(html).toContain('data-deck-placeholder')
    expect(html).toContain('data-current-slide-id="slide-2"')
    expect(html).toContain('data-deck-slide-preview="reported"')
    expect(html).toContain('data-deck-preview-text-box')
    expect(html).toContain('data-has-geometry="true"')
    expect(html).toContain('Current deck slide observation')
    expect(html).toContain('Slide 2: Methods')
    expect(html).toContain('Slide 2')
    expect(html).toContain('Mention replicate wells.')
    expect(html).toContain('Selected slides')
    expect(html).toContain('data-current-slide-text-elements')
    expect(html).toContain('data-deck-select-slide')
    expect(html).toContain('data-deck-select-text-element')
    expect(html).toContain('Cells were profiled with a compact panel.')
    expect(html).toContain('data-deck-text-editor')
    expect(html).toContain('data-disabled="true"')
    expect(html).toContain('slide-3-body-1')
    expect(html).toContain('data-text-element-id="slide-3-body-1"')
    expect(html).toContain('data-selected="true"')
    expect(html).toContain('Assay response increased after treatment.')
    expect(html).toContain('data-action-kind="edit"')
    expect(html).toContain('data-action-kind="export"')
    expect(html).toContain('data-annotations-kind="reported"')
    expect(html).toContain('data-annotation-id="slide-3-comment-1"')
    expect(html).toContain('Check assay interpretation.')
  })

  it('keeps deck observations without reported slides readable', () => {
    const model = buildDeckWorkspaceViewerModel(createDeckObservation({
      slides: [],
      deck: undefined,
      selection: undefined,
      annotations: undefined,
      visibleText: undefined,
      actions: []
    }))
    const html = renderToStaticMarkup(createElement(DeckWorkspaceViewer, { model }))

    expect(model.status.kind).toBe('ready')
    expect(model.slides).toEqual([])
    expect(model.currentSlide).toEqual({
      kind: 'none',
      summary: 'No slide outline was reported, so no current slide can be derived.',
      textElements: []
    })
    expect(model.selection.summary).toBe('No deck selection is active.')
    expect(model.textElements.summary).toBe('No bounded deck text elements were reported.')
    expect(model.annotations.summary).toBe('No deck annotations were reported.')
    expect(model.visibleText.summary).toBe('No visible deck text was reported.')
    expect(html).toContain('No slide outline was reported.')
    expect(html).toContain('No select, edit, or export actions are available.')
  })

  it('renders a deck text editor when an apply handler is connected', () => {
    const html = renderToStaticMarkup(createElement(DeckWorkspaceViewer, {
      observation: createDeckObservation(),
      onApplyEdit: () => undefined
    }))

    expect(html).toContain('data-deck-text-editor')
    expect(html).toContain('data-text-element-id="slide-2-body-1"')
    expect(html).toContain('data-disabled="false"')
    expect(html).toContain('data-deck-select-slide')
    expect(html).toContain('data-deck-select-text-element')
    expect(html).toContain('Slide 2 Body text')
    expect(html).toContain('Cells were profiled with a compact panel.')
  })
})
