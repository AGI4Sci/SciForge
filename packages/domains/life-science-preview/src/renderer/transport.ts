import type {
  WorkspacePreviewArtifactDescriptor,
  WorkspacePreviewAssetTransportDescriptor,
  WorkspacePreviewAssetTransportKind,
  WorkspacePreviewByteRange,
  WorkspacePreviewPrepareArtifactRequest,
  WorkspacePreviewReadArtifactRangeRequest
} from '@sciforge/domain-sdk/workspace-preview'

export type WorkspacePreviewReadRangeResult =
  | Readonly<{
      ok: true
      sessionId: string
      assetId: string
      offset: number
      length: number
      size: number
      dataBase64: string
      mimeType?: string
    }>
  | Readonly<{ ok: false; message: string }>

export type WorkspacePreviewPrepareArtifactResult =
  | Readonly<{
      ok: true
      sessionId: string
      artifact: WorkspacePreviewArtifactDescriptor
    }>
  | Readonly<{ ok: false; message: string }>

export type WorkspacePreviewReadArtifactRangeResult =
  | Readonly<{
      ok: true
      sessionId: string
      assetId: string
      artifactId: string
      offset: number
      length: number
      size: number
      mimeType: string
      dataBase64: string
    }>
  | Readonly<{ ok: false; message: string }>

/**
 * Renderer-side transport port supplied by the Workspace Preview host.
 *
 * It is deliberately structural: the domain package depends on the public
 * preview protocol, while the application remains free to own the concrete
 * capability-backed transport client.
 */
export type WorkspacePreviewAssetTransportClient = Readonly<{
  descriptor: WorkspacePreviewAssetTransportDescriptor | null
  sourceUrl?: string | null
  strategyStatus: (kind: WorkspacePreviewAssetTransportKind) =>
    WorkspacePreviewAssetTransportDescriptor['strategies'][number] | null
  readRange: (range: WorkspacePreviewByteRange) => Promise<WorkspacePreviewReadRangeResult>
  prepareArtifact: (
    request: WorkspacePreviewPrepareArtifactRequest
  ) => Promise<WorkspacePreviewPrepareArtifactResult>
  readArtifactRange: (
    request: WorkspacePreviewReadArtifactRangeRequest
  ) => Promise<WorkspacePreviewReadArtifactRangeResult>
  artifact: (artifactId: string) => WorkspacePreviewArtifactDescriptor | null
  readBytesIfWithin: (maxBytes: number) => Promise<
    | Readonly<{ ok: true; bytes: Uint8Array; bytesRead: number; truncated: false }>
    | Readonly<{ ok: false; message: string }>
  >
  readTextIfWithin: (maxBytes: number) => Promise<
    | Readonly<{ ok: true; text: string; bytesRead: number; truncated: false }>
    | Readonly<{ ok: false; message: string }>
  >
}>
