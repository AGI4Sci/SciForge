export const VISUAL_DOCUMENT_SCHEMA_VERSION = 1 as const

export const VISUAL_ARTIFACT_KINDS = [
  'image',
  'generated_image',
  'edited_image',
  'scientific_plot',
  'presentation_slide'
] as const

export type VisualArtifactKind = typeof VISUAL_ARTIFACT_KINDS[number]
export type VisualRevisionStatus = 'candidate' | 'accepted' | 'rejected'
export type VisualAnnotationKind = 'box' | 'arrow' | 'freehand' | 'pin'
export type VisualAnnotationStatus = 'open' | 'resolved'

export type NormalizedPoint = { x: number; y: number }
export type NormalizedBounds = { x: number; y: number; width: number; height: number }

export type VisualAnnotationGeometry =
  | { kind: 'box'; bounds: NormalizedBounds }
  | { kind: 'pin'; point: NormalizedPoint }
  | { kind: 'arrow'; from: NormalizedPoint; to: NormalizedPoint }
  | { kind: 'freehand'; points: NormalizedPoint[] }

export type VisualReviewAnnotation = {
  id: string
  kind: VisualAnnotationKind
  geometry: VisualAnnotationGeometry
  instruction: string
  targetNodeIds: string[]
  status: VisualAnnotationStatus
  createdAt: string
  updatedAt: string
}

export type VisualTruthLock = {
  id: string
  description: string
  nodeIds: string[]
  sourceRef?: string
}

export type VisualNodeKind =
  | 'generated_asset'
  | 'scientific_plot'
  | 'text'
  | 'shape'
  | 'connector'
  | 'group'

export type VisualNode = {
  id: string
  kind: VisualNodeKind
  bounds: NormalizedBounds
  semanticRef?: string
  sourceSpecRef?: string
  assetPath?: string
  maskPath?: string
  parentId?: string
  childIds?: string[]
  style?: Record<string, unknown>
  editable: boolean
  truthLocked: boolean
}

export type VisualCanvas = {
  width: number
  height: number
  background: string
}

export type VisualArtifact = {
  id: string
  kind: VisualArtifactKind
  sourcePath: string
  sourceHash: string
  workingCopyPath: string
  workingCopyHash: string
  mimeType?: string
  width?: number
  height?: number
  manifestPath?: string
  title?: string
  caption?: string
}

export type VisualRevision = {
  id: string
  status: VisualRevisionStatus
  basedOnHash: string
  artifactPath: string
  artifactHash: string
  width?: number
  height?: number
  summary: string
  reviewEvidence: VisualCandidateReviewEvidence
  createdAt: string
  decidedAt?: string
  backupPath?: string
}

export type VisualCandidateReviewEvidence = {
  tool: 'image_generation_review_candidate'
  ok: true
  reviewedArtifactPath: string
  reviewedArtifactHash: string
  reviewedAt: string
  score: {
    overall: number
    dimensions: number
    nonEmpty: number
    background: number
    reference?: number
    semantic: number
    warnings: string[]
  }
  semantic: {
    pass: true
    summary: string
    violations: string[]
    repairInstructions: string[]
  }
  repairable: false
  warnings: string[]
}

export type VisualDocument = {
  schemaVersion: typeof VISUAL_DOCUMENT_SCHEMA_VERSION
  documentId: string
  canvas: VisualCanvas
  artifact: VisualArtifact | null
  nodes: VisualNode[]
  annotations: VisualReviewAnnotation[]
  truthLocks: VisualTruthLock[]
  styleProfileRef: string | null
  revisions: VisualRevision[]
  activeCandidateRevisionId: string | null
  acceptedRevisionId: string | null
  createdAt: string
  updatedAt: string
}

export type VisualDocumentPaths = {
  documentDir: string
  documentPath: string
  assetsDir: string
  revisionsDir: string
  backupsDir: string
  reviewPacketsDir: string
}

export type VisualDocumentOpenRequest = {
  workspaceRoot: string
  documentId?: string
  createIfMissing?: boolean
  canvas?: Partial<VisualCanvas>
  styleProfileRef?: string | null
}

export type VisualDocumentOpenResult = {
  ok: true
  status: 'created' | 'opened'
  workspaceRoot: string
  document: VisualDocument
  paths: VisualDocumentPaths
}

export type VisualDocumentInsertArtifactRequest = {
  workspaceRoot: string
  documentId?: string
  kind: VisualArtifactKind
  sourcePath: string
  manifestPath?: string
  title?: string
  caption?: string
  mimeType?: string
  width?: number
  height?: number
  nodes?: VisualNode[]
  truthLocks?: VisualTruthLock[]
  styleProfileRef?: string | null
}

export type VisualDocumentInsertArtifactResult = {
  ok: true
  status: 'inserted'
  document: VisualDocument
  paths: VisualDocumentPaths
}

export type VisualDocumentSaveAnnotationsRequest = {
  workspaceRoot: string
  documentId?: string
  annotations: Array<{
    id?: string
    geometry: VisualAnnotationGeometry
    instruction: string
    targetNodeIds?: string[]
    status?: VisualAnnotationStatus
  }>
}

export type VisualDocumentSaveAnnotationsResult = {
  ok: true
  status: 'saved'
  annotations: VisualReviewAnnotation[]
  document: VisualDocument
}

export type VisualDocumentUpdateContextRequest = {
  workspaceRoot: string
  documentId?: string
  styleProfileRef?: string | null
  truthLocks?: VisualTruthLock[]
  nodes?: VisualNode[]
}

export type VisualDocumentUpdateContextResult = {
  ok: true
  status: 'updated'
  document: VisualDocument
}

export type VisualReviewPacket = {
  schemaVersion: 1
  packetId: string
  documentId: string
  createdAt: string
  sourceArtifact: VisualArtifact
  annotations: VisualReviewAnnotation[]
  truthLocks: VisualTruthLock[]
  styleProfileRef: string | null
  revisionContext: {
    acceptedRevisionId: string | null
    activeCandidateRevisionId: string | null
    selectedRegions: VisualAnnotationGeometry[]
    selectedNodeIds: string[]
    preserve: string[]
  }
}

export type VisualDocumentExportReviewPacketRequest = {
  workspaceRoot: string
  documentId?: string
  packetId?: string
}

export type VisualDocumentExportReviewPacketResult = {
  ok: true
  status: 'exported'
  packet: VisualReviewPacket
  packetPath: string
}

export type VisualDocumentCreateCandidateRequest = {
  workspaceRoot: string
  documentId?: string
  candidatePath: string
  summary: string
  reviewEvidence: VisualCandidateReviewEvidence
  expectedBaseHash?: string
  width?: number
  height?: number
}

export type VisualDocumentCreateCandidateResult = {
  ok: true
  status: 'candidate_created'
  revision: VisualRevision
  document: VisualDocument
}

export type VisualDocumentRevisionDecisionRequest = {
  workspaceRoot: string
  documentId?: string
  revisionId: string
}

export type VisualDocumentRevisionDecisionResult = {
  ok: true
  status: 'accepted' | 'rejected'
  revision: VisualRevision
  document: VisualDocument
}
