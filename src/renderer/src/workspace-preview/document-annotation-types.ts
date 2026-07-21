import type {
  WorkspacePreviewAnnotationDocumentKind,
  WorkspacePreviewAnnotationTextRange
} from '@shared/workspace-preview'

export type DocumentKind = WorkspacePreviewAnnotationDocumentKind

export type DocumentAnnotationAction =
  | 'highlight'
  | 'comment'
  | 'translation'
  | 'question'
  | 'copy'

export type DocumentAnnotationKind =
  | 'highlight'
  | 'comment'
  | 'note'
  | 'translation'
  | 'question'
  | 'answer'

export type DocumentSelectionAnchorRect = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export type DocumentSelectionPageRect = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export type DocumentAnnotationSelectionRange = {
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

export type DocumentAnnotationSelectionMetadata = {
  sourceKind: DocumentKind
  filePath: string
  sourceTitle: string
  mimeType: string
  size?: number
  mtimeMs?: number
  pageStart?: number
  pageEnd?: number
  pageCount?: number
  rects: DocumentSelectionPageRect[]
}

export type DocumentSelectionVisualImage = {
  dataUrl: string
  mimeType: string
  fileName: string
}

export type DocumentAnnotationSelection = {
  text: string
  ranges: DocumentAnnotationSelectionRange[]
  charCount: number
  sourceKind: DocumentKind
  contextBefore?: string
  contextAfter?: string
  pageStart?: number
  pageEnd?: number
  anchorRect?: DocumentSelectionAnchorRect
  rects?: DocumentSelectionPageRect[]
  visualImage?: DocumentSelectionVisualImage
  metadata: DocumentAnnotationSelectionMetadata
}

export type DocumentTextAnnotationOverlay = {
  id: string
  kind: DocumentAnnotationKind
  quote: string
  contextBefore?: string
  contextAfter?: string
  textRange?: DocumentAnnotationTextRange
  color?: string
  status?: 'open' | 'resolved'
  label?: string
}

export type DocumentAnnotationTextRange = WorkspacePreviewAnnotationTextRange

export type DocumentNavigationRequest = {
  requestId: string
  threadId: string
  quote: string
  contextBefore?: string
  contextAfter?: string
  textRange?: DocumentAnnotationTextRange
  pageRect?: DocumentSelectionPageRect
}
