import type { AgentRuntimeWorkspaceReference } from '@shared/agent-runtime-contract'
import {
  WORKSPACE_PREVIEW_DRAG_SOURCE_MIME,
  type WorkspacePreviewDragOutAction,
  type WorkspacePreviewDragSource
} from '@shared/workspace-preview'
import type { ComposerFileReference } from './composer-file-references'
import { composerReferenceFromWorkspaceReference } from './workspace-reference-composer'

export const WORKSPACE_REFERENCE_DRAG_MIME = 'application/vnd.sciforge.workspace-reference+json'

export type WorkspaceReferenceDragSource =
  | Extract<WorkspacePreviewDragSource, { kind: 'workspace-file' }>
  | Extract<WorkspacePreviewDragSource, { kind: 'workspace-directory' }>

export type WorkspaceReferenceDragPayload = {
  version: 1
  workspaceRoot: string
  reference: AgentRuntimeWorkspaceReference
  source: WorkspaceReferenceDragSource
}

export type WorkspaceReferenceDragDataTransfer = {
  effectAllowed?: string
  setData: (format: string, data: string) => void
}

export type WorkspaceReferenceDragDataSource = {
  types?: ArrayLike<string> | Iterable<string> | null
  getData: (format: string) => string
}

function normalizePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/+$/g, '')
}

export function workspaceReferenceDragPayload(
  reference: AgentRuntimeWorkspaceReference,
  fallbackWorkspaceRoot: string
): WorkspaceReferenceDragPayload {
  const relativePath = normalizePath(reference.relativePath)
  const workspaceRoot = reference.workspaceRoot?.trim() || fallbackWorkspaceRoot.trim()
  const supportedActions: WorkspacePreviewDragOutAction[] = ['copy-path', 'attach-to-session']
  const common = {
    path: relativePath,
    displayName: reference.name || relativePath,
    supportedActions
  }
  const source: WorkspaceReferenceDragSource = reference.kind === 'directory'
    ? {
        kind: 'workspace-directory',
        ...common
      }
    : {
        kind: 'workspace-file',
        ...common,
        ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
        ...(typeof reference.size === 'number' ? { size: reference.size } : {})
      }
  return {
    version: 1,
    workspaceRoot,
    reference: {
      ...reference,
      workspaceRoot,
      relativePath
    },
    source
  }
}

export function writeWorkspaceReferenceDragData(
  dataTransfer: WorkspaceReferenceDragDataTransfer,
  reference: AgentRuntimeWorkspaceReference,
  fallbackWorkspaceRoot: string
): WorkspaceReferenceDragPayload {
  const payload = workspaceReferenceDragPayload(reference, fallbackWorkspaceRoot)
  const serialized = JSON.stringify(payload)
  dataTransfer.effectAllowed = 'copyMove'
  dataTransfer.setData(WORKSPACE_PREVIEW_DRAG_SOURCE_MIME, JSON.stringify(payload.source))
  dataTransfer.setData(WORKSPACE_REFERENCE_DRAG_MIME, serialized)
  dataTransfer.setData('text/plain', payload.source.path)
  return payload
}

export function workspaceReferenceDragDataTypes(
  source: Pick<WorkspaceReferenceDragDataSource, 'types'>
): string[] {
  return Array.from(source.types ?? [])
}

export function hasWorkspaceReferenceDragData(
  source: Pick<WorkspaceReferenceDragDataSource, 'types'>
): boolean {
  const types = workspaceReferenceDragDataTypes(source)
  return types.includes(WORKSPACE_REFERENCE_DRAG_MIME) ||
    types.includes(WORKSPACE_PREVIEW_DRAG_SOURCE_MIME)
}

export function readWorkspaceReferenceDragPayload(
  source: WorkspaceReferenceDragDataSource
): WorkspaceReferenceDragPayload | null {
  const types = workspaceReferenceDragDataTypes(source)
  if (types.includes(WORKSPACE_REFERENCE_DRAG_MIME)) {
    const payload = parseWorkspaceReferenceDragPayload(source.getData(WORKSPACE_REFERENCE_DRAG_MIME))
    if (payload) return payload
  }
  if (types.includes(WORKSPACE_PREVIEW_DRAG_SOURCE_MIME)) {
    const payload = parseWorkspacePreviewDragSourcePayload(source.getData(WORKSPACE_PREVIEW_DRAG_SOURCE_MIME))
    if (payload) return payload
  }
  return null
}

export function composerReferenceFromWorkspaceReferenceDragData(
  source: WorkspaceReferenceDragDataSource
): ComposerFileReference | null {
  const payload = readWorkspaceReferenceDragPayload(source)
  if (!payload) return null
  return composerReferenceFromWorkspaceReference(payload.reference)
}

function parseWorkspaceReferenceDragPayload(value: string): WorkspaceReferenceDragPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.version !== 1) return null
  if (typeof parsed.workspaceRoot !== 'string') return null
  const reference = parsed.reference
  const source = parsed.source
  if (!isRecord(reference) || !isRecord(source)) return null
  if (typeof reference.relativePath !== 'string' || typeof reference.name !== 'string') return null
  if (typeof reference.kind !== 'string' || typeof source.path !== 'string') return null
  if (source.kind !== 'workspace-file' && source.kind !== 'workspace-directory') return null
  return parsed as WorkspaceReferenceDragPayload
}

function parseWorkspacePreviewDragSourcePayload(value: string): WorkspaceReferenceDragPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(parsed) || (parsed.kind !== 'workspace-file' && parsed.kind !== 'workspace-directory')) return null
  if (typeof parsed.path !== 'string' || !parsed.path.trim()) return null
  const source = parsed as WorkspaceReferenceDragSource
  const name = typeof source.displayName === 'string' && source.displayName.trim()
    ? source.displayName.trim()
    : basename(source.path)
  const reference: AgentRuntimeWorkspaceReference = {
    workspaceRoot: '',
    relativePath: normalizePath(source.path),
    name,
    kind: source.kind === 'workspace-directory' ? 'directory' : workspaceReferenceKindFromDragSource(source),
    ...(source.kind === 'workspace-file' && source.mimeType ? { mimeType: source.mimeType } : {}),
    ...(source.kind === 'workspace-file' && typeof source.size === 'number' ? { size: source.size } : {})
  }
  return {
    version: 1,
    workspaceRoot: '',
    reference,
    source
  }
}

function workspaceReferenceKindFromDragSource(
  source: Extract<WorkspaceReferenceDragSource, { kind: 'workspace-file' }>
): AgentRuntimeWorkspaceReference['kind'] {
  const mimeType = source.mimeType?.toLowerCase() ?? ''
  const lowerPath = source.path.toLowerCase()
  if (mimeType === 'application/pdf' || lowerPath.endsWith('.pdf')) return 'pdf'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('text/')) return 'text'
  return 'file'
}

function basename(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).at(-1) || path
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
