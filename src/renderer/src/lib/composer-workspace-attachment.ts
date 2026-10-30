import type { WorkspaceFileWritePayload, WorkspaceFileWriteResult } from '../../../shared/workspace-file'

import type { ComposerFileReference } from './composer-file-references'
import { relativeWorkspacePath } from './composer-file-references'
import {
  workspaceAttachmentKind,
  workspaceWebDocumentMetadata,
  workspaceAttachmentMaxBytes,
  workspaceAttachmentMediaType,
  workspaceAttachmentSessionDirectory,
  type WorkspaceAttachmentKind
} from '@sciforge/domain-sdk/attachment-policy'

export type ComposerWorkspaceAttachmentInput = Readonly<{
  file: File
  path?: string
}>

export type ComposerWorkspaceAttachmentImportOptions = Readonly<{
  workspaceRoot: string
  threadId: string | null
  getPathForFile?: (file: File) => string | undefined
  assertAvailable?: () => void
  writeWorkspaceFile: (payload: WorkspaceFileWritePayload) => Promise<WorkspaceFileWriteResult>
}>

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

function safeFileNameSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '_').replace(/^_+|_+$/gu, '')
  // Truncating a long name must not drop a real file extension, or preview
  // routing can no longer recognize the file type.
  const dot = normalized.lastIndexOf('.')
  const extension = dot > 0 && dot >= normalized.length - 8 ? normalized.slice(dot) : ''
  const stem = extension ? normalized.slice(0, dot) : normalized
  const encoder = new TextEncoder()
  const byteLimit = 80 - encoder.encode(extension).byteLength
  let safeStem = ''
  let byteCount = 0
  for (const character of stem) {
    const nextBytes = encoder.encode(character).byteLength
    if (byteCount + nextBytes > byteLimit) break
    safeStem += character
    byteCount += nextBytes
  }
  return (safeStem + extension) || fallback
}

function safeFileName(
  input: ComposerWorkspaceAttachmentInput,
  fallback: string,
  getPathForFile?: (file: File) => string | undefined
): string {
  const name = input.file.name || fileNameFromPath(attachmentPath(input, getPathForFile))
  const safe = name.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? fallback
  return safeFileNameSegment(safe, fallback).replace(/^\.+/gu, '') || fallback
}

function uploadRelativePath(
  input: ComposerWorkspaceAttachmentInput,
  options: ComposerWorkspaceAttachmentImportOptions,
  fallbackName: string
): string {
  const directory = workspaceAttachmentSessionDirectory(options.threadId)
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/gu, '').slice(0, 15)
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  const name = safeFileName(input, fallbackName, options.getPathForFile)
  return `${directory}/${stamp}-${random}-${name}`
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
  kind: WorkspaceAttachmentKind
): Pick<ComposerFileReference, 'kind' | 'mimeType'> {
  if (kind === 'pdf') return { kind: 'pdf', mimeType: 'application/pdf' }
  if (kind === 'web-document') return workspaceWebDocumentMetadata(input.file) ?? {}
  if (kind === 'image') {
    return {
      kind: 'image',
      mimeType: workspaceAttachmentMediaType(input.file)
    }
  }
  if (kind === 'scientific') return { mimeType: workspaceAttachmentMediaType(input.file) }
  return {}
}

function fallbackName(kind: WorkspaceAttachmentKind): string {
  if (kind === 'pdf') return 'document.pdf'
  if (kind === 'scientific') return 'scientific-data'
  if (kind === 'image') return 'figure.png'
  return 'web-document.html'
}

function sizeError(kind: WorkspaceAttachmentKind, limit: number): Error {
  const label = kind === 'pdf' ? 'PDF' : kind === 'scientific' ? 'Scientific' : kind === 'image' ? 'Image' : 'Web document'
  return new Error(`${label} attachment is larger than ${limit} bytes.`)
}

export async function importComposerWorkspaceAttachment(
  input: ComposerWorkspaceAttachmentInput,
  options: ComposerWorkspaceAttachmentImportOptions
): Promise<ComposerFileReference> {
  const kind = workspaceAttachmentKind(input.file)
  if (kind !== 'pdf' && kind !== 'scientific' && kind !== 'web-document' && kind !== 'image') {
    throw new Error('Workspace attachment type is unsupported.')
  }

  const limit = workspaceAttachmentMaxBytes(kind)
  if (!Number.isSafeInteger(input.file.size) || input.file.size < 0 || input.file.size > limit) throw sizeError(kind, limit)
  options.assertAvailable?.()
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

  const relativePath = uploadRelativePath(input, options, fallbackName(kind))
  const bytes = await input.file.arrayBuffer()
  if (bytes.byteLength > limit || bytes.byteLength !== input.file.size) throw sizeError(kind, limit)
  options.assertAvailable?.()
  const payload: WorkspaceFileWritePayload = {
    workspaceRoot: options.workspaceRoot,
    path: relativePath,
    contentBase64: arrayBufferToBase64(bytes)
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
