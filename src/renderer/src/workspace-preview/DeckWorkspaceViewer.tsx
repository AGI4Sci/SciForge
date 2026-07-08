import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  WorkspaceObservation,
  WorkspacePreviewEditOperation,
  WorkspaceStructuredSelection
} from '@shared/workspace-preview'

type DeckStructuredSelection = Extract<WorkspaceStructuredSelection, { kind: 'deck' }>
export type DeckWorkspaceViewerUpdateTextElementOperation = Extract<
  WorkspacePreviewEditOperation,
  { kind: 'deck.updateTextElement' }
>
export type DeckWorkspaceViewerApplyEditHandler = (
  operation: WorkspacePreviewEditOperation
) => void | Promise<void>

export type DeckWorkspaceViewerStatus =
  | {
      kind: 'ready'
      title: string
      message: string
    }
  | {
      kind: 'empty'
      title: string
      message: string
    }
  | {
      kind: 'unsupported'
      title: string
      message: string
    }

export type DeckWorkspaceViewerSlideRow = {
  id: string
  label: string
  title: string
  notes: string
}

export type DeckWorkspaceViewerGroup = {
  id: string
  title: string
  summary: string
  items: string[]
}

export type DeckWorkspaceViewerVisibleTextModel = {
  kind: 'none' | 'reported'
  summary: string
  lines: string[]
}

export type DeckWorkspaceViewerTextElementRow = {
  id: string
  slideId: string
  label: string
  detail: string
  kind: string
  text: string
  selected: boolean
}

export type DeckWorkspaceViewerTextElementsModel = {
  kind: 'none' | 'reported'
  summary: string
  rows: DeckWorkspaceViewerTextElementRow[]
}

export type DeckWorkspaceViewerSlidePreviewTextBox = {
  id: string
  kind: string
  text: string
  selected: boolean
  hasGeometry: boolean
  leftPercent: number
  topPercent: number
  widthPercent: number
  heightPercent: number
}

export type DeckWorkspaceViewerSlidePreviewModel =
  | {
      kind: 'none'
      summary: string
    }
  | {
      kind: 'reported'
      slideId: string
      width: number
      height: number
      summary: string
      textBoxes: DeckWorkspaceViewerSlidePreviewTextBox[]
      truncatedTextBoxes: boolean
    }

export type DeckWorkspaceViewerAnnotationRow = {
  id: string
  kind: string
  summary: string
}

export type DeckWorkspaceViewerAnnotationsModel = {
  kind: 'none' | 'reported'
  summary: string
  rows: DeckWorkspaceViewerAnnotationRow[]
}

export type DeckWorkspaceViewerCurrentSlideModel =
  | {
      kind: 'none'
      summary: string
      textElements: []
    }
  | {
      kind: 'reported'
      id: string
      label: string
      title: string
      notes: string
      selected: boolean
      summary: string
      textElements: DeckWorkspaceViewerTextElementRow[]
      preview: DeckWorkspaceViewerSlidePreviewModel
    }

export type DeckWorkspaceViewerActionKind = 'preview' | 'select' | 'edit' | 'export' | 'other'

export type DeckWorkspaceViewerAction = {
  id: string
  label: string
  kind: DeckWorkspaceViewerActionKind
}

export type DeckWorkspaceViewerSelectionModel = {
  kind: 'none' | 'deck' | 'unsupported'
  summary: string
  groups: DeckWorkspaceViewerGroup[]
}

export type DeckWorkspaceViewerModel = {
  status: DeckWorkspaceViewerStatus
  title: string
  subtitle?: string
  viewport: {
    title: string
    message: string
  }
  agentSummary: string
  currentSlide: DeckWorkspaceViewerCurrentSlideModel
  slides: DeckWorkspaceViewerSlideRow[]
  selection: DeckWorkspaceViewerSelectionModel
  textElements: DeckWorkspaceViewerTextElementsModel
  annotations: DeckWorkspaceViewerAnnotationsModel
  visibleText: DeckWorkspaceViewerVisibleTextModel
  actions: DeckWorkspaceViewerAction[]
}

export type DeckWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  model?: DeckWorkspaceViewerModel
  className?: string
  onApplyEdit?: DeckWorkspaceViewerApplyEditHandler
}

export type DeckWorkspaceViewerTextElementEditorProps = {
  observation?: WorkspaceObservation | null
  element?: DeckWorkspaceViewerTextElementRow | null
  unavailableReason?: string
  onApplyEdit?: DeckWorkspaceViewerApplyEditHandler
}

export type DeckWorkspaceViewerSlidePreviewProps = {
  observation?: WorkspaceObservation | null
  preview: DeckWorkspaceViewerSlidePreviewModel
  onApplyEdit?: DeckWorkspaceViewerApplyEditHandler
}

const DECK_ACTION_LABELS: Record<string, string> = {
  observe: 'Observe',
  select: 'Select',
  'workspace.setSelection': 'Select',
  'deck.selectSlide': 'Select Slide',
  'deck.selectText': 'Select Text',
  'deck.updateTextElement': 'Update Text',
  applyEdit: 'Apply Edit',
  export: 'Export'
}

const MAX_VISIBLE_TEXT_LINES = 8
const MAX_VISIBLE_TEXT_LINE_CHARS = 180
const MAX_NOTES_CHARS = 180
const MAX_CURRENT_SLIDE_TEXT_ELEMENTS = 6
const MAX_ANNOTATION_ROWS = 12
const MAX_ANNOTATION_SUMMARY_CHARS = 220
const DEFAULT_PREVIEW_TEXT_BOX_WIDTH_PERCENT = 70
const DEFAULT_PREVIEW_TEXT_BOX_HEIGHT_PERCENT = 16

export function buildDeckWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined
): DeckWorkspaceViewerModel {
  if (!observation) {
    return createInactiveModel({
      kind: 'empty',
      title: 'No deck observation',
      message: 'Open a PPTX workspace preview to populate this baseline viewer.'
    })
  }

  const hasDeckContext = observation.view.modality === 'deck' ||
    Boolean(observation.slides?.length) ||
    observation.selection?.kind === 'deck'

  if (!hasDeckContext) {
    return createInactiveModel({
      kind: 'unsupported',
      title: 'Unsupported observation',
      message: `${formatModality(observation.view.modality)} observations cannot be rendered by the deck viewer.`
    }, observation)
  }

  const slides = buildSlideRows(observation)
  const selection = buildDeckSelectionModel(observation.selection, observation.slides ?? [])
  const textElements = buildDeckTextElementsModel(observation, observation.selection)
  const currentSlide = buildCurrentSlideModel(
    slides,
    observation.selection,
    textElements,
    observation.deck?.slidePreviews ?? []
  )
  const annotations = buildDeckAnnotationsModel(observation.annotations)
  const visibleText = buildVisibleTextModel(observation.visibleText)
  const actions = buildDeckActions(observation.actions)
  const agentSummary = buildAgentSummary({
    slides,
    currentSlide,
    selection,
    textElements,
    annotations,
    visibleText,
    actions
  })

  return {
    status: {
      kind: 'ready',
      title: 'Deck baseline ready',
      message: 'A future slide renderer/editor can mount into the placeholder viewport.'
    },
    title: observation.view.title || basename(observation.file.path) || 'Deck workspace',
    subtitle: compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | '),
    viewport: {
      title: 'Slide renderer/editor mount point',
      message: observation.slides?.length
        ? 'Slide outline, visible text, selection, and available actions are summarized; full PPT rendering is intentionally not loaded in this baseline.'
        : 'Waiting for deck slide metadata from the preview worker.'
    },
    agentSummary,
    currentSlide,
    slides,
    selection,
    textElements,
    annotations,
    visibleText,
    actions
  }
}

export function DeckWorkspaceViewer({
  observation,
  model,
  className,
  onApplyEdit
}: DeckWorkspaceViewerProps): ReactNode {
  const resolvedModel = model ?? buildDeckWorkspaceViewerModel(observation)
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'
  const defaultEditElement = useMemo(
    () => findDefaultDeckEditElement(resolvedModel),
    [resolvedModel]
  )
  const editUnavailableReason = getDeckTextEditUnavailableReason({
    observation,
    onApplyEdit,
    hasUpdateTextAction: resolvedModel.actions.some((action) => action.id === 'deck.updateTextElement' || action.id === 'applyEdit')
  })

  return (
    <section
      className={compactClassName('workspace-preview-deck-viewer', className)}
      data-workspace-preview-deck-viewer
      data-status={resolvedModel.status.kind}
    >
      <header className="workspace-preview-deck-viewer__header">
        <div>
          <h3>{resolvedModel.title}</h3>
          {resolvedModel.subtitle ? <p>{resolvedModel.subtitle}</p> : null}
        </div>
      </header>

      {resolvedModel.status.kind !== 'ready' ? (
        <div
          className="workspace-preview-deck-viewer__state"
          role={statusRole}
          data-state-kind={resolvedModel.status.kind}
        >
          <strong>{resolvedModel.status.title}</strong>
          <p>{resolvedModel.status.message}</p>
        </div>
      ) : (
        <>
          <div
            className="workspace-preview-deck-viewer__viewport"
            data-deck-placeholder
            data-current-slide-kind={resolvedModel.currentSlide.kind}
            data-current-slide-id={resolvedModel.currentSlide.kind === 'reported' ? resolvedModel.currentSlide.id : undefined}
            role="group"
            aria-label="Current deck slide observation and text editor"
          >
            {resolvedModel.currentSlide.kind === 'reported' ? (
              <>
                <small>
                  {resolvedModel.currentSlide.selected ? 'Selected slide' : 'Current slide'}
                </small>
                <strong>
                  {resolvedModel.currentSlide.label}: {resolvedModel.currentSlide.title}
                </strong>
                <p>{resolvedModel.currentSlide.summary}</p>
                {resolvedModel.currentSlide.notes !== 'No notes reported' ? (
                  <small data-current-slide-notes>{resolvedModel.currentSlide.notes}</small>
                ) : null}
                <DeckWorkspaceViewerSlidePreview
                  observation={observation}
                  preview={resolvedModel.currentSlide.preview}
                  onApplyEdit={onApplyEdit}
                />
                {resolvedModel.currentSlide.textElements.length ? (
                  <ol data-current-slide-text-elements>
                    {resolvedModel.currentSlide.textElements.map((element) => (
                      <li key={element.id} data-text-element-id={element.id}>
                        {element.text}
                      </li>
                    ))}
                  </ol>
                ) : null}
                <DeckWorkspaceViewerTextElementEditor
                  key={defaultEditElement?.id ?? 'deck-text-editor-empty'}
                  observation={observation}
                  element={defaultEditElement}
                  unavailableReason={editUnavailableReason}
                  onApplyEdit={onApplyEdit}
                />
              </>
            ) : (
              <>
                <strong>{resolvedModel.viewport.title}</strong>
                <p>{resolvedModel.viewport.message}</p>
              </>
            )}
          </div>

          <p className="workspace-preview-deck-viewer__agent-summary">
            {resolvedModel.agentSummary}
          </p>

          <section
            className="workspace-preview-deck-viewer__section"
            aria-label="Deck slides summary"
          >
            <h4>Slides</h4>
            {resolvedModel.slides.length ? (
              <ol>
                {resolvedModel.slides.map((slide) => (
                  <li key={slide.id} data-slide-id={slide.id}>
                    <button
                      type="button"
                      data-deck-select-slide
                      disabled={!observation || !onApplyEdit}
                      onClick={() => {
                        if (!observation || !onApplyEdit) return
                        onApplyEdit(createDeckSlideSelectionOperation({
                          observation,
                          slide
                        }))
                      }}
                    >
                      {slide.label}
                    </button>
                    <span>{slide.title}</span>
                    <small>{slide.notes}</small>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No slide outline was reported.</p>
            )}
          </section>

          <section
            className="workspace-preview-deck-viewer__section"
            aria-label="Deck selection"
            data-selection-kind={resolvedModel.selection.kind}
          >
            <h4>Selection</h4>
            <p>{resolvedModel.selection.summary}</p>
            {resolvedModel.selection.groups.length ? (
              <dl>
                {resolvedModel.selection.groups.map((group) => (
                  <div key={group.id}>
                    <dt>{group.title}</dt>
                    <dd>
                      {group.items.join(', ')}
                      <small>{group.summary}</small>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>

          <section
            className="workspace-preview-deck-viewer__section"
            aria-label="Deck text elements"
            data-text-elements-kind={resolvedModel.textElements.kind}
          >
            <h4>Text Elements</h4>
            <p>{resolvedModel.textElements.summary}</p>
            {resolvedModel.textElements.rows.length ? (
              <ol>
                {resolvedModel.textElements.rows.map((element) => (
                  <li
                    key={element.id}
                    data-text-element-id={element.id}
                    data-slide-id={element.slideId}
                    data-kind={element.kind}
                    data-selected={element.selected ? 'true' : 'false'}
                  >
                    <button
                      type="button"
                      data-deck-select-text-element
                      disabled={!observation || !onApplyEdit}
                      onClick={() => {
                        if (!observation || !onApplyEdit) return
                        onApplyEdit(createDeckTextElementSelectionOperation({
                          observation,
                          element
                        }))
                      }}
                    >
                      {element.label}
                    </button>
                    <span>{element.text}</span>
                    <small>{element.detail}</small>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>

          <section
            className="workspace-preview-deck-viewer__section"
            aria-label="Deck visible text summary"
          >
            <h4>Visible Text</h4>
            <p>{resolvedModel.visibleText.summary}</p>
            {resolvedModel.visibleText.lines.length ? (
              <pre>{resolvedModel.visibleText.lines.join('\n')}</pre>
            ) : null}
          </section>

          <section
            className="workspace-preview-deck-viewer__section"
            aria-label="Deck annotations"
            data-annotations-kind={resolvedModel.annotations.kind}
          >
            <h4>Annotations</h4>
            <p>{resolvedModel.annotations.summary}</p>
            {resolvedModel.annotations.rows.length ? (
              <ol>
                {resolvedModel.annotations.rows.map((annotation) => (
                  <li
                    key={annotation.id}
                    data-annotation-id={annotation.id}
                    data-kind={annotation.kind}
                  >
                    <strong>{annotation.kind}</strong>
                    <span>{annotation.summary}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>

          <section
            className="workspace-preview-deck-viewer__section"
            aria-label="Deck actions"
          >
            <h4>Actions</h4>
            {resolvedModel.actions.length ? (
              <ul>
                {resolvedModel.actions.map((action) => (
                  <li
                    key={action.id}
                    data-action-id={action.id}
                    data-action-kind={action.kind}
                  >
                    {action.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No select, edit, or export actions are available.</p>
            )}
          </section>
        </>
      )}
    </section>
  )
}

export function createDeckSlideSelectionOperation(input: {
  observation: WorkspaceObservation
  slide: DeckWorkspaceViewerSlideRow
}): WorkspacePreviewEditOperation {
  return {
    kind: 'workspace.setSelection',
    path: input.observation.file.path,
    selection: {
      kind: 'deck',
      slideIds: [input.slide.id]
    }
  }
}

export function createDeckTextElementSelectionOperation(input: {
  observation: WorkspaceObservation
  element: DeckWorkspaceViewerTextElementRow
}): WorkspacePreviewEditOperation {
  return {
    kind: 'workspace.setSelection',
    path: input.observation.file.path,
    selection: {
      kind: 'deck',
      slideIds: [input.element.slideId],
      elementIds: [input.element.id]
    }
  }
}

export function createDeckSlidePreviewTextBoxSelectionOperation(input: {
  observation: WorkspaceObservation
  slideId: string
  textBox: DeckWorkspaceViewerSlidePreviewTextBox
}): WorkspacePreviewEditOperation {
  return {
    kind: 'workspace.setSelection',
    path: input.observation.file.path,
    selection: {
      kind: 'deck',
      slideIds: [input.slideId],
      elementIds: [input.textBox.id]
    }
  }
}

export function createDeckUpdateTextElementOperation(input: {
  observation: WorkspaceObservation
  element: DeckWorkspaceViewerTextElementRow
  text: string
}): DeckWorkspaceViewerUpdateTextElementOperation {
  return {
    kind: 'deck.updateTextElement',
    path: input.observation.file.path,
    slideId: input.element.slideId,
    elementId: input.element.id,
    text: input.text
  }
}

export function DeckWorkspaceViewerTextElementEditor({
  observation,
  element,
  unavailableReason,
  onApplyEdit
}: DeckWorkspaceViewerTextElementEditorProps): ReactNode {
  const [draft, setDraft] = useState(element?.text ?? '')
  const canApplyEdit = Boolean(observation && element && onApplyEdit && !unavailableReason)

  return (
    <div
      className="workspace-preview-deck-viewer__text-editor"
      data-deck-text-editor
      data-text-element-id={element?.id}
      data-disabled={canApplyEdit ? 'false' : 'true'}
    >
      <label>
        <span>{element ? `${element.label} text` : 'Text element'}</span>
        <textarea
          value={draft}
          rows={3}
          disabled={!canApplyEdit}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      </label>
      {unavailableReason ? <small>{unavailableReason}</small> : null}
      <button
        type="button"
        disabled={!canApplyEdit}
        onClick={() => {
          if (!observation || !element || !onApplyEdit || unavailableReason) return
          onApplyEdit(createDeckUpdateTextElementOperation({
            observation,
            element,
            text: draft
          }))
        }}
      >
        Apply
      </button>
    </div>
  )
}

export function DeckWorkspaceViewerSlidePreview({
  observation,
  preview,
  onApplyEdit
}: DeckWorkspaceViewerSlidePreviewProps): ReactNode {
  if (preview.kind !== 'reported') {
    return (
      <div
        className="workspace-preview-deck-viewer__slide-preview"
        data-deck-slide-preview="none"
      >
        <small>{preview.summary}</small>
      </div>
    )
  }

  return (
    <div
      className="workspace-preview-deck-viewer__slide-preview"
      data-deck-slide-preview="reported"
      data-slide-id={preview.slideId}
      data-text-box-count={preview.textBoxes.length}
      style={{
        aspectRatio: `${preview.width} / ${preview.height}`,
        position: 'relative',
        overflow: 'hidden'
      }}
      role="group"
      aria-label={`Slide preview for ${preview.slideId}`}
    >
      <small>{preview.summary}</small>
      {preview.textBoxes.map((textBox) => (
        <button
          key={textBox.id}
          type="button"
          className="workspace-preview-deck-viewer__slide-preview-text-box"
          data-deck-preview-text-box
          data-text-element-id={textBox.id}
          data-kind={textBox.kind}
          data-has-geometry={textBox.hasGeometry ? 'true' : 'false'}
          data-selected={textBox.selected ? 'true' : 'false'}
          style={slidePreviewTextBoxStyle(textBox)}
          disabled={!observation || !onApplyEdit}
          onClick={() => {
            if (!observation || !onApplyEdit) return
            onApplyEdit(createDeckSlidePreviewTextBoxSelectionOperation({
              observation,
              slideId: preview.slideId,
              textBox
            }))
          }}
        >
          <span>{titleCase(textBox.kind)}</span>
          <strong>{textBox.text}</strong>
        </button>
      ))}
    </div>
  )
}

function createInactiveModel(
  status: Extract<DeckWorkspaceViewerStatus, { kind: 'empty' | 'unsupported' }>,
  observation?: WorkspaceObservation
): DeckWorkspaceViewerModel {
  return {
    status,
    title: observation?.view.title || 'Deck viewer',
    subtitle: observation ? compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | ') : undefined,
    viewport: {
      title: 'Slide renderer/editor mount point',
      message: status.message
    },
    agentSummary: status.message,
    slides: [],
    selection: {
      kind: 'none',
      summary: 'No deck selection is available.',
      groups: []
    },
    textElements: {
      kind: 'none',
      summary: 'No bounded deck text elements were reported.',
      rows: []
    },
    annotations: {
      kind: 'none',
      summary: 'No deck annotations were reported.',
      rows: []
    },
    visibleText: {
      kind: 'none',
      summary: 'No visible deck text was reported.',
      lines: []
    },
    currentSlide: {
      kind: 'none',
      summary: 'No current slide is available.',
      textElements: []
    },
    actions: []
  }
}

function buildSlideRows(observation: WorkspaceObservation): DeckWorkspaceViewerSlideRow[] {
  return (observation.slides ?? []).map((slide) => ({
    id: slide.id,
    label: `Slide ${slide.index + 1}`,
    title: slide.title || 'Untitled slide',
    notes: slide.notes ? truncateOneLine(slide.notes, MAX_NOTES_CHARS) : 'No notes reported'
  }))
}

function buildDeckSelectionModel(
  selection: WorkspaceStructuredSelection | undefined,
  slides: NonNullable<WorkspaceObservation['slides']>
): DeckWorkspaceViewerSelectionModel {
  if (!selection) {
    return {
      kind: 'none',
      summary: 'No deck selection is active.',
      groups: []
    }
  }
  if (selection.kind !== 'deck') {
    return {
      kind: 'unsupported',
      summary: `${formatModality(selection.kind)} selection is active; deck selection is not available.`,
      groups: []
    }
  }

  const deckSelection = selection as DeckStructuredSelection
  const slideMap = new Map(slides.map((slide) => [slide.id, slide]))
  const slideItems = deckSelection.slideIds.map((id) => {
    const slide = slideMap.get(id)
    return slide ? `Slide ${slide.index + 1}${slide.title ? `: ${slide.title}` : ''}` : id
  })
  const elementItems = deckSelection.elementIds ?? []
  return {
    kind: 'deck',
    summary: `Selected ${formatCount(deckSelection.slideIds.length, 'slide')}${elementItems.length ? `, ${formatCount(elementItems.length, 'element')}` : ''}.`,
    groups: compactGroups([
      slideItems.length ? {
        id: 'slides',
        title: 'Selected slides',
        summary: formatCount(slideItems.length, 'slide'),
        items: slideItems
      } : null,
      elementItems.length ? {
        id: 'elements',
        title: 'Selected elements',
        summary: formatCount(elementItems.length, 'element'),
        items: elementItems.slice(0, 12)
      } : null
    ])
  }
}

function buildDeckTextElementsModel(
  observation: WorkspaceObservation,
  selection: WorkspaceStructuredSelection | undefined
): DeckWorkspaceViewerTextElementsModel {
  const textElements = observation.deck?.textElements ?? []
  if (textElements.length === 0) {
    return {
      kind: 'none',
      summary: 'No bounded deck text elements were reported.',
      rows: []
    }
  }

  const slideMap = new Map((observation.slides ?? []).map((slide) => [slide.id, slide]))
  const selectedIds = new Set(selection?.kind === 'deck' ? selection.elementIds ?? [] : [])
  const rows = textElements.map((element) => {
    const slide = slideMap.get(element.slideId)
    const slideLabel = slide ? `Slide ${slide.index + 1}` : element.slideId
    const selected = selectedIds.has(element.elementId)
    return {
      id: element.elementId,
      slideId: element.slideId,
      label: `${slideLabel} ${titleCase(element.kind)}`,
      detail: compactStrings([
        element.elementId,
        selected ? 'selected' : undefined
      ]).join(' | '),
      kind: element.kind,
      text: truncateOneLine(element.text, MAX_VISIBLE_TEXT_LINE_CHARS),
      selected
    }
  })
  const selectedCount = rows.filter((row) => row.selected).length
  const totalCount = observation.deck?.textElementCount ?? rows.length
  const omittedCount = Math.max(0, totalCount - rows.length)

  return {
    kind: 'reported',
    summary: [
      `${formatCount(rows.length, 'text element')} available`,
      selectedCount ? formatCount(selectedCount, 'selected element') : '',
      omittedCount ? `${formatCount(omittedCount, 'text element')} omitted` : ''
    ].filter(Boolean).join(', ') + '.',
    rows
  }
}

function buildCurrentSlideModel(
  slides: DeckWorkspaceViewerSlideRow[],
  selection: WorkspaceStructuredSelection | undefined,
  textElements: DeckWorkspaceViewerTextElementsModel,
  slidePreviews: NonNullable<NonNullable<WorkspaceObservation['deck']>['slidePreviews']>
): DeckWorkspaceViewerCurrentSlideModel {
  if (slides.length === 0) {
    return {
      kind: 'none',
      summary: 'No slide outline was reported, so no current slide can be derived.',
      textElements: []
    }
  }

  const selectedSlideId = selection?.kind === 'deck' ? selection.slideIds[0] : undefined
  const selectedSlide = selectedSlideId
    ? slides.find((slide) => slide.id === selectedSlideId)
    : undefined
  const slide = selectedSlide ?? slides[0]
  const allSlideTextElements = textElements.rows.filter((element) => element.slideId === slide.id)
  const currentTextElements = allSlideTextElements.slice(0, MAX_CURRENT_SLIDE_TEXT_ELEMENTS)
  const omittedTextElementCount = allSlideTextElements.length - currentTextElements.length
  const selected = Boolean(selectedSlideId && selectedSlide?.id === selectedSlideId)
  const preview = buildSlidePreviewModel(slide, selection, slidePreviews)
  const missingSelectionMessage = selectedSlideId && !selectedSlide
    ? ` Selected slide ${selectedSlideId} is outside the bounded slide outline.`
    : ''
  const textElementMessage = currentTextElements.length
    ? `${formatCount(currentTextElements.length, 'text element')} visible on this slide${omittedTextElementCount > 0 ? `; ${formatCount(omittedTextElementCount, 'text element')} omitted` : ''}.`
    : 'No bounded text elements were reported for this slide.'

  return {
    kind: 'reported',
    id: slide.id,
    label: slide.label,
    title: slide.title,
    notes: slide.notes,
    selected,
    summary: `${selected ? 'Selected slide' : 'Current slide'}: ${slide.label} - ${slide.title}.${missingSelectionMessage} ${textElementMessage}`,
    textElements: currentTextElements,
    preview
  }
}

function buildSlidePreviewModel(
  slide: DeckWorkspaceViewerSlideRow,
  selection: WorkspaceStructuredSelection | undefined,
  slidePreviews: NonNullable<NonNullable<WorkspaceObservation['deck']>['slidePreviews']>
): DeckWorkspaceViewerSlidePreviewModel {
  const preview = slidePreviews.find((candidate) => candidate.slideId === slide.id)
  if (!preview) {
    return {
      kind: 'none',
      summary: 'No slide preview geometry was reported.'
    }
  }

  const selectedElementIds = new Set(selection?.kind === 'deck' ? selection.elementIds ?? [] : [])
  const rawTextBoxes = preview.textBoxes ?? []
  const textBoxes = rawTextBoxes.map((textBox, index) => {
    const fallbackTop = Math.min(84, 12 + index * 18)
    const fallbackHeight = DEFAULT_PREVIEW_TEXT_BOX_HEIGHT_PERCENT
    const hasGeometry = hasTextBoxGeometry(textBox)
    return {
      id: textBox.elementId,
      kind: textBox.kind,
      text: truncateOneLine(textBox.text, MAX_VISIBLE_TEXT_LINE_CHARS),
      selected: selectedElementIds.has(textBox.elementId),
      hasGeometry,
      leftPercent: hasGeometry ? toPercent(textBox.x ?? 0, preview.width) : 15,
      topPercent: hasGeometry ? toPercent(textBox.y ?? 0, preview.height) : fallbackTop,
      widthPercent: hasGeometry
        ? toPercent(textBox.width ?? preview.width, preview.width)
        : DEFAULT_PREVIEW_TEXT_BOX_WIDTH_PERCENT,
      heightPercent: hasGeometry
        ? toPercent(textBox.height ?? preview.height, preview.height)
        : fallbackHeight
    }
  })

  return {
    kind: 'reported',
    slideId: preview.slideId,
    width: preview.width,
    height: preview.height,
    summary: [
      `${formatCount(textBoxes.length, 'preview text box')} on ${slide.label}`,
      preview.truncatedTextBoxes ? 'truncated' : ''
    ].filter(Boolean).join(', ') + '.',
    textBoxes,
    truncatedTextBoxes: Boolean(preview.truncatedTextBoxes)
  }
}

function findDefaultDeckEditElement(
  model: DeckWorkspaceViewerModel
): DeckWorkspaceViewerTextElementRow | undefined {
  const currentSlideTextElements = model.currentSlide.kind === 'reported'
    ? model.currentSlide.textElements
    : []
  return currentSlideTextElements.find((element) => element.selected) ??
    currentSlideTextElements[0] ??
    model.textElements.rows.find((element) => element.selected) ??
    model.textElements.rows[0]
}

function getDeckTextEditUnavailableReason(input: {
  observation?: WorkspaceObservation | null
  onApplyEdit?: DeckWorkspaceViewerApplyEditHandler
  hasUpdateTextAction: boolean
}): string | undefined {
  if (!input.onApplyEdit) return 'Connect an edit apply handler before editing deck text.'
  if (!input.observation) return 'A source deck observation is required before text can be edited.'
  if (!input.hasUpdateTextAction) return 'This observation does not advertise deck text editing.'
  return undefined
}

function buildDeckAnnotationsModel(
  annotations: WorkspaceObservation['annotations']
): DeckWorkspaceViewerAnnotationsModel {
  const allAnnotations = annotations ?? []
  if (allAnnotations.length === 0) {
    return {
      kind: 'none',
      summary: 'No deck annotations were reported.',
      rows: []
    }
  }

  const rows = allAnnotations.slice(0, MAX_ANNOTATION_ROWS).map((annotation) => ({
    id: annotation.id,
    kind: annotation.kind,
    summary: annotation.summary
      ? truncateOneLine(annotation.summary, MAX_ANNOTATION_SUMMARY_CHARS)
      : 'No summary reported'
  }))

  return {
    kind: 'reported',
    summary: rows.length < allAnnotations.length
      ? `${formatCount(rows.length, 'annotation')} shown of ${allAnnotations.length}.`
      : `${formatCount(allAnnotations.length, 'annotation')} reported.`,
    rows
  }
}

function buildVisibleTextModel(visibleText: string | undefined): DeckWorkspaceViewerVisibleTextModel {
  const lines = visibleText
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean) ?? []
  if (lines.length === 0) {
    return {
      kind: 'none',
      summary: 'No visible deck text was reported.',
      lines: []
    }
  }
  const shown = lines.slice(0, MAX_VISIBLE_TEXT_LINES).map((line) =>
    truncateOneLine(line, MAX_VISIBLE_TEXT_LINE_CHARS)
  )
  const omitted = lines.length - shown.length
  return {
    kind: 'reported',
    summary: `${visibleText?.length ?? 0} characters across ${formatCount(lines.length, 'non-empty line')}${omitted > 0 ? `; ${formatCount(omitted, 'line')} omitted` : ''}.`,
    lines: shown
  }
}

function buildDeckActions(actions: readonly string[]): DeckWorkspaceViewerAction[] {
  const resolved = new Map<string, DeckWorkspaceViewerAction>()
  for (const actionId of actions) {
    const kind = classifyDeckAction(actionId)
    if (!kind) continue
    resolved.set(actionId, {
      id: actionId,
      label: labelForAction(actionId),
      kind
    })
  }
  return Array.from(resolved.values())
}

function classifyDeckAction(actionId: string): DeckWorkspaceViewerActionKind | null {
  if (actionId === 'observe' || actionId === 'deck.preview') return 'preview'
  if (actionId === 'select' || actionId === 'workspace.setSelection' || actionId.startsWith('deck.select')) return 'select'
  if (actionId === 'deck.updateTextElement') return 'edit'
  if (actionId === 'applyEdit' || actionId.includes('edit')) return 'edit'
  if (actionId === 'export' || actionId.startsWith('workspace.export')) return 'export'
  if (actionId.startsWith('deck.')) return 'other'
  return null
}

function buildAgentSummary({
  slides,
  currentSlide,
  selection,
  textElements,
  annotations,
  visibleText,
  actions
}: {
  slides: DeckWorkspaceViewerSlideRow[]
  currentSlide: DeckWorkspaceViewerCurrentSlideModel
  selection: DeckWorkspaceViewerSelectionModel
  textElements: DeckWorkspaceViewerTextElementsModel
  annotations: DeckWorkspaceViewerAnnotationsModel
  visibleText: DeckWorkspaceViewerVisibleTextModel
  actions: DeckWorkspaceViewerAction[]
}): string {
  const slideSummary = slides.length
    ? `slides: ${slides.slice(0, 5).map((slide) => `${slide.label} ${slide.title}`).join('; ')}${slides.length > 5 ? `; +${slides.length - 5} more` : ''}`
    : 'slides: none reported'
  return [
    slideSummary,
    `current slide: ${currentSlide.summary}`,
    `selection: ${selection.summary}`,
    `text elements: ${textElements.summary}`,
    `annotations: ${annotations.summary}`,
    `visible text: ${visibleText.summary}`,
    `actions: ${actions.length ? actions.map((action) => action.label).join(', ') : 'none'}`
  ].join(' | ')
}

function labelForAction(actionId: string): string {
  if (DECK_ACTION_LABELS[actionId]) return DECK_ACTION_LABELS[actionId]
  if (actionId.startsWith('workspace.export:')) {
    return `Export ${formatExportFormat(actionId.slice('workspace.export:'.length))}`
  }
  return titleCase(actionId.split(/[.:]/u).filter(Boolean).at(-1) ?? actionId)
}

function formatExportFormat(value: string): string {
  const normalized = value.trim()
  if (/^[a-z0-9]{2,5}$/iu.test(normalized)) return normalized.toUpperCase()
  return titleCase(normalized)
}

function hasTextBoxGeometry(textBox: { x?: number, y?: number, width?: number, height?: number }): boolean {
  return textBox.x !== undefined &&
    textBox.y !== undefined &&
    textBox.width !== undefined &&
    textBox.height !== undefined
}

function slidePreviewTextBoxStyle(textBox: DeckWorkspaceViewerSlidePreviewTextBox): CSSProperties {
  return {
    position: 'absolute',
    left: `${clamp(textBox.leftPercent, 0, 100)}%`,
    top: `${clamp(textBox.topPercent, 0, 100)}%`,
    width: `${clamp(textBox.widthPercent, 1, 100)}%`,
    height: `${clamp(textBox.heightPercent, 1, 100)}%`,
    overflow: 'hidden'
  }
}

function toPercent(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0
  return clamp((value / total) * 100, 0, 100)
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/gu, ' ')
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function formatModality(value: string): string {
  return titleCase(value || 'unknown')
}

function formatCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`
}

function truncateOneLine(value: string, max: number): string {
  const text = value.replace(/\s+/gu, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

function basename(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path
}

function compactStrings(values: Array<string | undefined | null | false>): string[] {
  return values.filter((value): value is string => Boolean(value))
}

function compactClassName(...values: Array<string | undefined | null | false>): string {
  return compactStrings(values).join(' ')
}

function compactGroups(
  groups: Array<DeckWorkspaceViewerGroup | null | undefined>
): DeckWorkspaceViewerGroup[] {
  return groups.filter((group): group is DeckWorkspaceViewerGroup => Boolean(group))
}
