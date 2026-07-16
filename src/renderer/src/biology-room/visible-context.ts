import type { BiologyRoomManifest } from '@shared/biology-room'
import type { CapabilityResourceBinding } from '@shared/capability-broker'
import type {
  VisibleContextComponentSnapshot,
  VisibleContextResource
} from '@shared/visible-context'
import {
  describeBiologyRoomSelection,
  isBiologyRoomTrackVisible,
  resolveActiveBiologyRoomAsset,
  resolveBiologyRoomViewerKind
} from './model'

export const BIOLOGY_ROOM_VISIBLE_CONTEXT_COMPONENT = 'biology-room'
export const BIOLOGY_ROOM_VISIBLE_CONTEXT_REGION = 'main-workspace'
export const BIOLOGY_ROOM_VISIBLE_CONTEXT_RESOURCE_LIMIT = 62

export function biologyRoomVisibleContextComponentId(roomId: string): string {
  return `biology-room:${roomId}`
}

export function buildBiologyRoomVisibleContextComponent(input: {
  room: BiologyRoomManifest & { capability?: CapabilityResourceBinding }
  workspaceRoot: string
  updatedAt?: string
  conflicted?: boolean
}): VisibleContextComponentSnapshot {
  const { room, workspaceRoot } = input
  const activeAsset = resolveActiveBiologyRoomAsset(room)
  const viewerKind = resolveBiologyRoomViewerKind(activeAsset)
  const roomRelativePath = `.sciforge/biology/rooms/${room.roomId}/room.json`
  const orderedAssets = [...room.assets].sort((left, right) => {
    if (left.id === activeAsset?.id) return -1
    if (right.id === activeAsset?.id) return 1
    return left.path.localeCompare(right.path)
  })
  const resources: VisibleContextResource[] = [
    {
      kind: 'biologyRoom',
      role: 'active-room',
      title: room.title,
      workspaceRoot,
      path: absoluteWorkspacePath(workspaceRoot, roomRelativePath),
      relativePath: roomRelativePath,
      resourceUri: workspaceFileResourceUri(roomRelativePath),
      annotationCount: room.annotations.length,
      updatedAt: room.updatedAt,
      capability: room.capability,
      metadata: {
        roomId: room.roomId,
        revision: room.revision,
        activeAssetId: activeAsset?.id ?? null,
        operationIds: room.capability?.operations.map((operation) => operation.id) ?? []
      }
    },
    ...orderedAssets.slice(0, BIOLOGY_ROOM_VISIBLE_CONTEXT_RESOURCE_LIMIT).map((asset): VisibleContextResource => ({
      kind: 'workspaceFile',
      role: 'biology-room-asset',
      title: basename(asset.path),
      workspaceRoot,
      path: absoluteWorkspacePath(workspaceRoot, asset.path),
      relativePath: asset.path,
      resourceUri: workspaceFileResourceUri(asset.path),
      name: basename(asset.path),
      fileKind: asset.modality,
      size: asset.sizeBytes,
      mtimeMs: asset.mtimeMs,
      updatedAt: asset.updatedAt,
      metadata: {
        roomId: room.roomId,
        assetId: asset.id,
        format: asset.format,
        sha256: asset.sha256,
        readiness: asset.readiness ?? 'ready',
        readinessError: asset.readinessError ?? null,
        active: asset.id === activeAsset?.id,
        visible: isBiologyRoomTrackVisible(room, asset.id),
        referenceAssetId: asset.referenceAssetId ?? null,
        referenceCompatibility: asset.referenceCompatibility ?? null,
        indexPaths: asset.indexPaths,
        indexFingerprints: asset.indexFingerprints ?? []
      }
    }))
  ]
  const selectionSummary = describeBiologyRoomSelection(room.selection, room)

  return {
    id: biologyRoomVisibleContextComponentId(room.roomId),
    region: BIOLOGY_ROOM_VISIBLE_CONTEXT_REGION,
    component: BIOLOGY_ROOM_VISIBLE_CONTEXT_COMPONENT,
    title: room.title,
    visible: true,
    priority: 80,
    updatedAt: input.updatedAt ?? room.updatedAt,
    summary: `Biology Room ${room.title} at revision ${room.revision}; ${room.assets.length} assets, ${room.annotations.length} annotations; selection: ${selectionSummary}.`,
    resources,
    state: {
      roomId: room.roomId,
      workspaceRoot,
      revision: room.revision,
      activeAssetId: activeAsset?.id ?? null,
      viewerKind,
      selectionKind: room.selection?.kind ?? null,
      annotationCount: room.annotations.length,
      conflicted: input.conflicted === true,
      assetsTruncated: room.assets.length > BIOLOGY_ROOM_VISIBLE_CONTEXT_RESOURCE_LIMIT
    }
  }
}

function absoluteWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const root = workspaceRoot.trim().replaceAll('\\', '/').replace(/\/+$/, '')
  return root ? `${root}/${relativePath}` : relativePath
}

function workspaceFileResourceUri(relativePath: string): string {
  return `workspace://file/${relativePath.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
}

function basename(value: string): string {
  return value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? value
}
