import type {
  AgentRuntimeFileReference,
  AgentRuntimeWorkspaceReferenceKind
} from '@shared/agent-runtime-contract'

const MAX_FILE_REFERENCES = 50
const MAX_PATH_LENGTH = 4_096
const MAX_NAME_LENGTH = 512
const MAX_MIME_TYPE_LENGTH = 128

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeRelativePath(value: unknown): string | null {
  const input = trimmedString(value)
  if (!input || input.length > MAX_PATH_LENGTH) return null
  const normalized = input.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//u, '')
  if (!normalized || normalized === '.' || normalized === '..') return null
  if (normalized.includes('\0')) return null
  if (normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return null
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized)) return null
  const parts = normalized.split('/').filter((part) => part && part !== '.')
  if (parts.length === 0 || parts.includes('..')) return null
  return parts.join('/')
}

function fileNameFromRelativePath(relativePath: string): string {
  return relativePath.split('/').filter(Boolean).pop() ?? relativePath
}

function referenceKind(value: unknown): AgentRuntimeWorkspaceReferenceKind | undefined {
  return value === 'file' || value === 'directory' || value === 'image' ||
    value === 'pdf' || value === 'text'
    ? value
    : undefined
}

function normalizeRuntimeFileReference(value: unknown): AgentRuntimeFileReference | null {
  const input = record(value)
  if (!input) return null
  const relativePath = normalizeRelativePath(input.relativePath) ?? normalizeRelativePath(input.path)
  if (!relativePath) return null
  const suppliedName = trimmedString(input.name)
  const name = (suppliedName ?? fileNameFromRelativePath(relativePath)).slice(0, MAX_NAME_LENGTH)
  if (!name) return null
  const kind = referenceKind(input.kind)
  const suppliedMimeType = trimmedString(input.mimeType)
  const mimeType = suppliedMimeType?.slice(0, MAX_MIME_TYPE_LENGTH)
  return {
    path: relativePath,
    relativePath,
    name,
    ...(kind ? { kind } : {}),
    ...(mimeType ? { mimeType } : {})
  }
}

/**
 * Converts renderer-owned workspace selections into the strict runtime reference
 * contract. Only workspace-relative locator metadata crosses the runtime boundary.
 */
export function normalizeRuntimeFileReferences(value: unknown): AgentRuntimeFileReference[] {
  if (!Array.isArray(value)) return []
  const references: AgentRuntimeFileReference[] = []
  for (const item of value) {
    const reference = normalizeRuntimeFileReference(item)
    if (!reference) continue
    references.push(reference)
    if (references.length >= MAX_FILE_REFERENCES) break
  }
  return references
}
