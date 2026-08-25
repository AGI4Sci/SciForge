import type { WorkspaceFileWritePayload, WorkspaceFileWriteResult } from '@shared/workspace-file'

import type { ComposerFileReference } from './composer-file-references'
import { relativeWorkspacePath } from './composer-file-references'
import {
  composerPickedAttachmentKind,
  composerWebDocumentMetadata,
  type ComposerPickedAttachmentKind
} from './composer-attachment-policy'

export type ComposerWorkspaceAttachmentInput = Readonly<{
  file: File
  path?: string
}>

export type ComposerWorkspaceAttachmentImportOptions = Readonly<{
  workspaceRoot: string
  threadId: string | null
  getPathForFile?: (file: File) => string | undefined
  writeWorkspaceFile: (payload: WorkspaceFileWritePayload) => Promise<WorkspaceFileWriteResult>
}>

const PDF_ATTACHMENT_MAX_BYTES = 64 * 1024 * 1024
const SCIENTIFIC_ATTACHMENT_MAX_BYTES = 256 * 1024
const WEB_DOCUMENT_ATTACHMENT_MAX_BYTES = 64 * 1024 * 1024

function fileNameFromPath(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).pop() || 'file'
}

function attachmentPath(input: ComposerWorkspaceAttachmentInput, getPathForFile?: (file: File) => string | undefined): string {
  if (input.path?.trim()) return input.path.trim()
  try {
    return getPathForFile?.(input.file)?.trim() || ''
  } catch {
    return ''
  }
}

function normalizedPath(path: string): string {
  return path.trim().replaceAll('\\', '/').replace(/\/+$/gu, '').toLowerCase()
}

function pathInsideWorkspace(path: string, workspaceRoot: string): boolean {
  const filePath = normalizedPath(path)
  const root = normalizedPath(workspaceRoot)
  return Boolean(root && (filePath === root || filePath.startsWith(`${root}/`)))
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^_+|_+$/gu, '')
  return normalized.slice(0, 80) || fallback
}

function safeFileName(
  input: ComposerWorkspaceAttachmentInput,
  fallback: string,
  getPathForFile?: (file: File) => string | undefined
): string {
  const name = input.file.name || fileNameFromPath(attachmentPath(input, getPathForFile))
  const safe = name.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? fallback
  return safeSegment(safe, fallback).replace(/^\.+/gu, '') || fallback
}

function uploadRelativePath(
  input: ComposerWorkspaceAttachmentInput,
  options: ComposerWorkspaceAttachmentImportOptions,
  fallbackName: string
): string {
  const owner = safeSegment(options.threadId ?? 'draft', 'draft')
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/gu, '').slice(0, 15)
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  const name = safeFileName(input, fallbackName, options.getPathForFile)
  return `.sciforge/uploads/${owner}/${stamp}-${random}-${name}`
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function attachmentMetadata(
  input: ComposerWorkspaceAttachmentInput,
  kind: ComposerPickedAttachmentKind
): Pick<ComposerFileReference, 'kind' | 'mimeType'> {
  if (kind === 'pdf') return { kind: 'pdf', mimeType: 'application/pdf' }
  if (kind === 'web-document') return composerWebDocumentMetadata(input.file) ?? {}
  if (kind === 'scientific') {
    const browserType = input.file.type.trim()
    return { mimeType: browserType && !browserType.startsWith('image/') ? browserType : 'text/plain' }
  }
  return {}
}

function fallbackName(kind: ComposerPickedAttachmentKind): string {
  if (kind === 'pdf') return 'document.pdf'
  if (kind === 'scientific') return 'scientific-data'
  return 'web-document.html'
}

function maxBytes(kind: ComposerPickedAttachmentKind): number {
  if (kind === 'scientific') return SCIENTIFIC_ATTACHMENT_MAX_BYTES
  if (kind === 'web-document') return WEB_DOCUMENT_ATTACHMENT_MAX_BYTES
  return PDF_ATTACHMENT_MAX_BYTES
}

function sizeError(kind: ComposerPickedAttachmentKind, limit: number): Error {
  const label = kind === 'pdf' ? 'PDF' : kind === 'scientific' ? 'Scientific' : 'Web document'
  return new Error(`${label} attachment is larger than ${limit} bytes.`)
}

export async function importComposerWorkspaceAttachment(
  input: ComposerWorkspaceAttachmentInput,
  options: ComposerWorkspaceAttachmentImportOptions
): Promise<ComposerFileReference> {
  const kind = composerPickedAttachmentKind(input.file)
  if (kind !== 'pdf' && kind !== 'scientific' && kind !== 'web-document') {
    throw new Error('Workspace attachment type is unsupported.')
  }

  const sourcePath = attachmentPath(input, options.getPathForFile)
  const name = safeFileName(input, fallbackName(kind), options.getPathForFile)
  const metadata = attachmentMetadata(input, kind)
  if (sourcePath && pathInsideWorkspace(sourcePath, options.workspaceRoot)) {
    const relativePath = relativeWorkspacePath(sourcePath, options.workspaceRoot)
    return {
      path: relativePath,
      relativePath,
      name: input.file.name || fileNameFromPath(sourcePath),
      workspaceRoot: options.workspaceRoot,
      ...metadata
    }
  }

  const limit = maxBytes(kind)
  if (input.file.size > limit) throw sizeError(kind, limit)
  const relativePath = uploadRelativePath(input, options, fallbackName(kind))
  let payload: WorkspaceFileWritePayload
  if (kind === 'scientific') {
    const content = await input.file.text()
    if (content.includes('\0')) {
      throw new Error('Scientific attachment looks binary and cannot be copied as text.')
    }
    if (new TextEncoder().encode(content).byteLength > limit) throw sizeError(kind, limit)
    payload = { workspaceRoot: options.workspaceRoot, path: relativePath, content }
  } else {
    payload = {
      workspaceRoot: options.workspaceRoot,
      path: relativePath,
      contentBase64: arrayBufferToBase64(await input.file.arrayBuffer())
    }
  }
  const result = await options.writeWorkspaceFile(payload)
  if (!result.ok) throw new Error(result.message)
  return {
    path: relativePath,
    relativePath,
    name,
    workspaceRoot: options.workspaceRoot,
    ...metadata
  }
}
