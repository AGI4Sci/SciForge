import type { WorkspaceEntry } from './workspace-file'

export const WRITE_TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.tex',
  '.txt',
  '.text'
])

export const WRITE_IMAGE_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.avif',
  '.ico'
])

export const WRITE_PDF_FILE_EXTENSIONS = new Set([
  '.pdf'
])

export function isWriteTextFileExtension(ext: string): boolean {
  return WRITE_TEXT_FILE_EXTENSIONS.has(ext.trim().toLowerCase())
}

export function isWriteImageFileExtension(ext: string): boolean {
  return WRITE_IMAGE_FILE_EXTENSIONS.has(ext.trim().toLowerCase())
}

export function isWritePdfFileExtension(ext: string): boolean {
  return WRITE_PDF_FILE_EXTENSIONS.has(ext.trim().toLowerCase())
}

function extensionFromPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const dot = normalized.lastIndexOf('.')
  if (dot < 0) return ''
  const slash = normalized.lastIndexOf('/')
  if (dot < slash) return ''
  return normalized.slice(dot)
}

export function isWriteTextFilePath(path: string): boolean {
  return isWriteTextFileExtension(extensionFromPath(path))
}

export function isWriteImageFilePath(path: string): boolean {
  return isWriteImageFileExtension(extensionFromPath(path))
}

export function isWritePdfFilePath(path: string): boolean {
  return isWritePdfFileExtension(extensionFromPath(path))
}

export function isWriteWorkspaceFilePath(path: string): boolean {
  return isWriteTextFilePath(path) || isWriteImageFilePath(path) || isWritePdfFilePath(path)
}

export function isWriteWorkspaceEntry(entry: WorkspaceEntry): boolean {
  return entry.type === 'directory' ||
    isWriteTextFileExtension(entry.ext) ||
    isWriteImageFileExtension(entry.ext) ||
    isWritePdfFileExtension(entry.ext)
}
