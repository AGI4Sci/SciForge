import {
  useCallback,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  WorkspaceDocxParagraph,
  WorkspaceDocxTextParagraphWrite,
  WorkspaceDocxTextWriteResult
} from '@shared/workspace-file'
import type {
  WorkspaceObservation,
  WorkspacePreviewEditOperation
} from '@shared/workspace-preview'
import {
  WriteDocxViewer
} from '../components/write/WriteDocxViewer'
import type {
  WriteDocxAnnotationOverlay
} from '../components/write/WriteDocxViewer'
import type {
  WritePdfAnnotationAction,
  WritePdfSelection
} from '../components/write/WritePdfViewer'
import {
  createDocxWorkspacePreviewAnnotationOperation
} from './document-annotation-operations'

export type DocxWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  className?: string
  onApplyEdit?: (operation: WorkspacePreviewEditOperation) => Promise<void>
  annotationOverlays?: WriteDocxAnnotationOverlay[]
  activeAnnotationId?: string | null
  onAnnotationSelect?: (threadId: string) => void
  onOpenAnnotations?: () => void
}

export type DocxWorkspaceViewerModel = {
  status: 'ready' | 'empty' | 'unsupported'
  title: string
  message: string
  paragraphs: WorkspaceDocxParagraph[]
  content: string
  size: number
  mtimeMs: number
}

export function buildDocxWorkspaceViewerModel(
  observation?: WorkspaceObservation | null
): DocxWorkspaceViewerModel {
  if (!observation) {
    return {
      status: 'empty',
      title: 'DOCX viewer',
      message: 'Open a DOCX workspace preview to populate this viewer.',
      paragraphs: [],
      content: '',
      size: 0,
      mtimeMs: 0
    }
  }

  if (!isDocxObservation(observation)) {
    return {
      status: 'unsupported',
      title: observation.view.title,
      message: `${formatLabel(observation.view.modality)} observations cannot be rendered by the DOCX viewer.`,
      paragraphs: [],
      content: observation.visibleText ?? '',
      size: observation.file.size ?? 0,
      mtimeMs: observation.file.mtimeMs ?? 0
    }
  }

  const paragraphs = docxParagraphsFromObservation(observation)
  return {
    status: 'ready',
    title: observation.view.title,
    message: paragraphs.length
      ? `${paragraphs.length} bounded DOCX paragraphs are available.`
      : 'No DOCX paragraphs were extracted from this document.',
    paragraphs,
    content: observation.visibleText ?? paragraphs.map((paragraph) => paragraph.text).join('\n\n'),
    size: observation.file.size ?? 0,
    mtimeMs: observation.file.mtimeMs ?? 0
  }
}

export function docxParagraphsFromObservation(
  observation: WorkspaceObservation
): WorkspaceDocxParagraph[] {
  return (observation.document?.paragraphs ?? []).map((paragraph) => ({
    id: paragraph.id,
    index: paragraph.index,
    text: paragraph.text,
    ...(paragraph.style ? { style: paragraph.style } : {})
  }))
}

export async function saveDocxWorkspaceParagraphs(input: {
  observation: WorkspaceObservation
  paragraphs: WorkspaceDocxTextParagraphWrite[]
  onApplyEdit?: (operation: WorkspacePreviewEditOperation) => Promise<void>
}): Promise<WorkspaceDocxTextWriteResult> {
  if (!input.onApplyEdit) {
    return { ok: false, message: 'DOCX editing is unavailable for this preview.' }
  }

  for (const paragraph of input.paragraphs) {
    await input.onApplyEdit({
      kind: 'document.updateParagraph',
      path: input.observation.file.path,
      paragraphIndex: paragraph.index,
      text: paragraph.text
    })
  }

  return {
    ok: true,
    path: input.observation.file.path,
    savedAt: new Date().toISOString(),
    paragraphCount: input.paragraphs.length
  }
}

export function DocxWorkspaceViewer({
  observation,
  className,
  onApplyEdit,
  annotationOverlays = [],
  activeAnnotationId = null,
  onAnnotationSelect,
  onOpenAnnotations
}: DocxWorkspaceViewerProps): ReactElement {
  const { t } = useTranslation()
  const model = buildDocxWorkspaceViewerModel(observation)
  const handleAnnotationAction = useCallback((action: WritePdfAnnotationAction, selection: WritePdfSelection): void => {
    if (!observation || !onApplyEdit) return
    const operation = createDocxWorkspacePreviewAnnotationOperation({
      path: observation.file.path,
      action,
      selection,
      documentText: model.content,
      translationBody: t('writeDocxAnnotationTranslatePrompt')
    })
    if (!operation) return
    void onApplyEdit(operation)
  }, [model.content, observation, onApplyEdit, t])

  if (!observation || model.status !== 'ready') {
    return (
      <section
        className={className}
        data-workspace-preview-docx-viewer
        data-status={model.status}
      >
        <div className="p-4 text-sm text-ds-text" role={model.status === 'unsupported' ? 'alert' : 'status'}>
          <strong>{model.title}</strong>
          <p className="mt-1 text-ds-muted">{model.message}</p>
        </div>
      </section>
    )
  }

  return (
    <section
      className={className}
      data-workspace-preview-docx-viewer
      data-status={model.status}
      data-docx-paragraph-count={model.paragraphs.length}
    >
      <WriteDocxViewer
        filePath={observation.file.path}
        paragraphs={model.paragraphs}
        content={model.content}
        size={model.size}
        mtimeMs={model.mtimeMs}
        workspaceRoot={observation.file.workspaceRoot ?? ''}
        onAnnotationAction={onApplyEdit ? handleAnnotationAction : undefined}
        annotationOverlays={annotationOverlays}
        activeAnnotationId={activeAnnotationId}
        onAnnotationSelect={onAnnotationSelect}
        onOpenAnnotations={onOpenAnnotations}
        onSaveParagraphs={(paragraphs) => saveDocxWorkspaceParagraphs({
          observation,
          paragraphs,
          onApplyEdit
        })}
        className="h-full min-h-0"
      />
    </section>
  )
}

function isDocxObservation(observation: WorkspaceObservation): boolean {
  if (observation.view.pluginId === 'docx') return true
  if (observation.file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return true
  }
  return /\.docx$/i.test(observation.file.path)
}

function formatLabel(value: string): string {
  return value
    .replace(/[-_]+/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}
