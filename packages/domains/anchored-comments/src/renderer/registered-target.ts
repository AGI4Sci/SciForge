import type {
  DomainVisibleContextInspection,
  DomainVisibleContextSelectionInspection
} from '@sciforge/domain-sdk/host'
import type { CommentTargetBounds, CommentTargetInspection } from './types'

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, max) : undefined
}

function boundsFrom(value: unknown): CommentTargetBounds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<CommentTargetBounds>
  if (
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height) ||
    candidate.x! < 0 ||
    candidate.y! < 0 ||
    candidate.width! <= 0 ||
    candidate.height! <= 0
  ) {
    return null
  }
  return {
    x: Math.round(candidate.x!),
    y: Math.round(candidate.y!),
    width: Math.max(1, Math.round(candidate.width!)),
    height: Math.max(1, Math.round(candidate.height!))
  }
}

/**
 * Converts one Host-inspected registered visual target into package state.
 * The package never receives an element handle or selector and cannot widen
 * the target beyond the Host-measured bounds.
 */
export function commentTargetFromInspection(
  inspection: DomainVisibleContextInspection,
  route: string
): CommentTargetInspection | null {
  if (!inspection.selectable || inspection.target.redact) return null
  const metadata = inspection.target.metadata ?? {}
  const bounds = boundsFrom(inspection.bounds)
  if (!bounds) return null
  const label =
    text(metadata.label, 512) ??
    text(metadata.title, 512) ??
    text(inspection.target.contentType, 512) ??
    inspection.target.id
  const selectionValue = metadata.selection
  const selection = selectionValue === undefined
    ? undefined
    : JSON.stringify(selectionValue).slice(0, 4_096)

  return {
    targetRef: inspection.targetRef,
    label,
    route,
    bounds,
    componentId: inspection.componentId,
    elementId: inspection.target.id,
    resourceType: text(metadata.resourceKind, 128),
    resourceId: text(metadata.resourceId, 2_048),
    selection
  }
}

export function commentTargetFromTextSelection(
  inspection: DomainVisibleContextSelectionInspection,
  route: string
): CommentTargetInspection | null {
  const target = commentTargetFromInspection({
    selectable: true,
    targetRef: inspection.targetRef,
    componentId: inspection.componentId,
    target: inspection.target,
    bounds: inspection.bounds
  }, route)
  if (!target) return null
  const selectedText = inspection.text.replace(/\s+/g, ' ').trim().slice(0, 4_096)
  if (!selectedText) return null
  return {
    ...target,
    label: `Selected text: ${selectedText.slice(0, 100)}`,
    selection: JSON.stringify({ kind: 'text', text: selectedText })
  }
}
