import { clipboard } from 'electron'
import type { Stats } from 'node:fs'
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import type {
  WorkspaceClipboardImageSavePayload,
  WorkspaceClipboardImageSaveResult,
  WorkspaceClipboardPastePayload,
  WorkspaceClipboardPasteResult,
  ClipboardImageReadResult,
  WorkspaceDirectoryCreatePayload,
  WorkspaceDirectoryCreateResult,
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntryDeletePayload,
  WorkspaceEntryDeleteResult,
  WorkspaceEntryCopyPayload,
  WorkspaceEntryCopyResult,
  WorkspaceEntryImportPayload,
  WorkspaceEntryImportResult,
  WorkspaceEntryMovePayload,
  WorkspaceEntryMoveResult,
  WorkspaceEntryRenamePayload,
  WorkspaceEntryRenameResult,
  WorkspaceFileCreatePayload,
  WorkspaceFileCreateResult,
  WorkspaceFileReadResult,
  WorkspaceFileResolveResult,
  WorkspaceFileConflictPolicy,
  WorkspaceFileTarget,
  WorkspaceFileWritePayload,
  WorkspaceFileWriteResult,
  WorkspaceDocxTextWritePayload,
  WorkspaceDocxTextWriteResult,
  WorkspaceImageReadResult,
  WorkspaceDocxParagraph,
  WorkspaceFileReadDocxResult,
  WorkspaceFileReadPdfResult
} from '../../shared/workspace-file'
import { createWorkspaceIntelService } from '../../../packages/workers/workspace-intel/src/index.js'
import {
  canonicalPath,
  compareWorkspaceEntries,
  ensureSafeWorkspaceDirectory,
  expandHomePath,
  extensionFromName,
  normalizePathSeparators,
  normalizeUserPath,
  pathExists,
  resolveOpenTargetPath,
  resolveSafeWorkspaceWriteTarget,
  resolveTargetPathWithinWorkspace,
  resolveWorkspaceDirectory,
  validateEntryName,
  writeSafeWorkspaceFile
} from '@sciforge/domain-sdk/node/workspace-paths'

const MAX_FILE_PREVIEW_BYTES = 1_500_000
const MAX_IMAGE_PREVIEW_BYTES = 12 * 1024 * 1024
const MAX_PDF_PREVIEW_BYTES = 64 * 1024 * 1024
const MAX_DOCX_PREVIEW_BYTES = 64 * 1024 * 1024
const WORKSPACE_IMAGE_DIR = 'img'
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const WORKSPACE_IMAGE_MIME_BY_EXT = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon']
])

type WorkspaceFileStat = Stats

function splitCopyName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, dot), ext: name.slice(dot) }
}

const DEFAULT_WORKSPACE_FILE_CONFLICT_POLICY: WorkspaceFileConflictPolicy = { strategy: 'rename' }

type WorkspaceFileConflictResolution =
  | { action: 'write'; path: string; overwrite: boolean }
  | { action: 'skip'; path: string }

function workspaceFileConflictPolicyOrDefault(
  policy?: WorkspaceFileConflictPolicy
): WorkspaceFileConflictPolicy {
  return policy ?? DEFAULT_WORKSPACE_FILE_CONFLICT_POLICY
}

function unsupportedWorkspaceFileConflictPolicy(policy: WorkspaceFileConflictPolicy): never {
  throw new Error(`Conflict policy "${policy.strategy}" is not supported for workspace file operations.`)
}

function renderRenameConflictName(
  originalName: string,
  attempt: number,
  policy: Extract<WorkspaceFileConflictPolicy, { strategy: 'rename' }>
): string {
  const { stem, ext } = splitCopyName(originalName)
  const template = policy.renameTemplate?.trim()
  if (!template) {
    const suffix = attempt === 1 ? ' copy' : ` copy ${attempt}`
    return `${stem}${suffix}${ext}`
  }

  const rendered = template
    .replaceAll('{name}', stem)
    .replaceAll('{ext}', ext)
    .replaceAll('{n}', String(attempt))
    .trim()
  if (attempt > 1 && !template.includes('{n}')) {
    const renderedParts = splitCopyName(rendered)
    return validateEntryName(`${renderedParts.stem} ${attempt}${renderedParts.ext}`)
  }
  return validateEntryName(rendered)
}

async function resolveWorkspaceEntryConflict(
  workspaceRoot: string,
  directory: string,
  name: string,
  policy?: WorkspaceFileConflictPolicy
): Promise<WorkspaceFileConflictResolution> {
  const conflictPolicy = workspaceFileConflictPolicyOrDefault(policy)
  if (conflictPolicy.strategy === 'ask' || conflictPolicy.strategy === 'merge') {
    unsupportedWorkspaceFileConflictPolicy(conflictPolicy)
  }

  const direct = await resolveSafeWorkspaceWriteTarget(join(directory, name), workspaceRoot, {
    createParentDirectories: false
  })
  if (!await pathExists(direct.path)) {
    return { action: 'write', path: direct.path, overwrite: false }
  }

  if (conflictPolicy.strategy === 'overwrite') {
    return { action: 'write', path: direct.path, overwrite: true }
  }
  if (conflictPolicy.strategy === 'skip') {
    return { action: 'skip', path: direct.path }
  }

  const maxAttempts = conflictPolicy.maxAttempts ?? 10_000
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidateName = renderRenameConflictName(name, attempt, conflictPolicy)
    const candidate = await resolveSafeWorkspaceWriteTarget(join(directory, candidateName), workspaceRoot, {
      createParentDirectories: false
    })
    if (!await pathExists(candidate.path)) {
      return { action: 'write', path: candidate.path, overwrite: false }
    }
  }
  throw new Error('Could not find an available copy name.')
}

async function resolvedWorkspaceRoot(workspaceRoot: string): Promise<string> {
  return canonicalPath(resolve(expandHomePath(workspaceRoot)))
}

async function ensureNotWorkspaceRoot(targetPath: string, workspaceRoot: string, action: string): Promise<void> {
  if (!workspaceRoot.trim()) return
  const workspacePath = await resolvedWorkspaceRoot(workspaceRoot)
  if (targetPath === workspacePath) {
    throw new Error(`${action} the workspace root is not supported.`)
  }
}

async function removeOverwriteTarget(targetPath: string, sourcePath?: string): Promise<boolean> {
  if (sourcePath) {
    const sourceCanonical = await canonicalPath(sourcePath)
    const targetCanonical = await canonicalPath(targetPath)
    if (sourceCanonical === targetCanonical) return false
  }
  await rm(targetPath, { recursive: true, force: false })
  return true
}

function workspaceFilePosition(payload: WorkspaceFileTarget): { line?: number; column?: number } {
  return {
    ...(payload.line ? { line: payload.line } : {}),
    ...(payload.column ? { column: payload.column } : {})
  }
}

function workspaceFileRevision(fileInfo: WorkspaceFileStat): string {
  return `${fileInfo.size}:${fileInfo.mtimeMs}`
}

async function readWorkspacePdfFromResolvedPath(
  targetPath: string,
  fileInfo: WorkspaceFileStat,
  payload: WorkspaceFileTarget
): Promise<WorkspaceFileReadPdfResult | { ok: false; message: string }> {
  if (fileInfo.size > MAX_PDF_PREVIEW_BYTES) {
    return { ok: false, message: 'This PDF is too large to preview in Write mode.' }
  }

  const bytes = await readFile(targetPath)
  return {
    ok: true,
    kind: 'pdf',
    path: targetPath,
    content: '',
    dataBase64: bytes.toString('base64'),
    mimeType: 'application/pdf',
    size: fileInfo.size,
    truncated: false,
    mtimeMs: fileInfo.mtimeMs,
    revision: workspaceFileRevision(fileInfo),
    ...workspaceFilePosition(payload)
  }
}

function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body.startsWith('#x')) {
      const codePoint = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity
    }
    if (body.startsWith('#')) {
      const codePoint = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity
    }
    if (body === 'amp') return '&'
    if (body === 'lt') return '<'
    if (body === 'gt') return '>'
    if (body === 'quot') return '"'
    if (body === 'apos') return '\''
    return entity
  })
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function docxParagraphStyle(paragraphXml: string): string | undefined {
  const match = paragraphXml.match(/<w:pStyle\b[^>]*(?:w:val|val)="([^"]+)"/)
  return match?.[1] ? decodeXmlText(match[1]) : undefined
}

function extractDocxParagraphText(paragraphXml: string): string {
  const parts: string[] = []
  const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g
  for (const match of paragraphXml.matchAll(tokenPattern)) {
    if (match[1] !== undefined) {
      parts.push(decodeXmlText(match[1]))
    } else if (match[0].startsWith('<w:tab')) {
      parts.push('\t')
    } else {
      parts.push('\n')
    }
  }
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function extractDocxParagraphs(documentXml: string): WorkspaceDocxParagraph[] {
  const paragraphs: WorkspaceDocxParagraph[] = []
  const paragraphPattern = /<w:p\b[\s\S]*?<\/w:p>/g
  let documentIndex = 0
  for (const match of documentXml.matchAll(paragraphPattern)) {
    documentIndex += 1
    const paragraphXml = match[0]
    const text = extractDocxParagraphText(paragraphXml)
    if (!text) continue
    const style = docxParagraphStyle(paragraphXml)
    paragraphs.push({
      id: `docx-p-${documentIndex}`,
      index: documentIndex,
      text,
      ...(style ? { style } : {})
    })
  }
  return paragraphs
}

function renderEditedDocxRuns(text: string, paragraphXml: string): string {
  const runProperties = paragraphXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] ?? ''
  const runs: string[] = []
  const pieces = text.split(/(\t|\r\n|\n|\r)/)
  for (const piece of pieces) {
    if (!piece) continue
    if (piece === '\t') {
      runs.push(`<w:r>${runProperties}<w:tab/></w:r>`)
    } else if (piece === '\n' || piece === '\r' || piece === '\r\n') {
      runs.push(`<w:r>${runProperties}<w:br/></w:r>`)
    } else {
      runs.push(`<w:r>${runProperties}<w:t xml:space="preserve">${escapeXmlText(piece)}</w:t></w:r>`)
    }
  }
  return runs.join('')
}

function replaceEditedDocxParagraphs(
  documentXml: string,
  paragraphs: readonly WorkspaceDocxTextWritePayload['paragraphs'][number][]
): { documentXml: string; updatedCount: number } {
  const edits = new Map<number, string>()
  for (const paragraph of paragraphs) {
    edits.set(paragraph.index, paragraph.text)
  }
  let documentIndex = 0
  let updatedCount = 0
  const nextDocumentXml = documentXml.replace(
    /(<w:p\b[^>]*>)([\s\S]*?)(<\/w:p>)/g,
    (full, open: string, inner: string, close: string) => {
      documentIndex += 1
      if (!edits.has(documentIndex)) return full
      updatedCount += 1
      const paragraphProperties = inner.match(/^\s*(<w:pPr\b[\s\S]*?<\/w:pPr>)/)?.[1] ?? ''
      return `${open}${paragraphProperties}${renderEditedDocxRuns(edits.get(documentIndex) ?? '', full)}${close}`
    }
  )
  return { documentXml: nextDocumentXml, updatedCount }
}

async function readWorkspaceDocxFromResolvedPath(
  targetPath: string,
  fileInfo: WorkspaceFileStat,
  payload: WorkspaceFileTarget
): Promise<WorkspaceFileReadDocxResult | { ok: false; message: string }> {
  if (fileInfo.size > MAX_DOCX_PREVIEW_BYTES) {
    return { ok: false, message: 'This DOCX file is too large to preview.' }
  }

  const bytes = await readFile(targetPath)
  const zip = await JSZip.loadAsync(bytes)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) return { ok: false, message: 'This DOCX file does not contain word/document.xml.' }
  const paragraphs = extractDocxParagraphs(documentXml)
  return {
    ok: true,
    kind: 'docx',
    path: targetPath,
    content: paragraphs.map((paragraph) => paragraph.text).join('\n\n'),
    paragraphs,
    mimeType: DOCX_MIME_TYPE,
    size: fileInfo.size,
    truncated: false,
    mtimeMs: fileInfo.mtimeMs,
    revision: workspaceFileRevision(fileInfo),
    ...workspaceFilePosition(payload)
  }
}

async function readWorkspaceTextFromWorkspaceIntel(
  targetPath: string,
  fileInfo: WorkspaceFileStat,
  payload: WorkspaceFileTarget
): Promise<WorkspaceFileReadResult> {
  const workspaceRoot = payload.workspaceRoot?.trim() ? payload.workspaceRoot : dirname(targetPath)
  const result = await createWorkspaceIntelService({
    workspaceRoot,
    maxReadBytes: MAX_FILE_PREVIEW_BYTES
  }).readFile({
    workspaceRoot,
    path: targetPath,
    maxBytes: MAX_FILE_PREVIEW_BYTES
  })
  if (!result.ok) {
    return { ok: false, message: result.error.message }
  }

  return {
    ok: true,
    kind: 'text',
    path: targetPath,
    content: result.content,
    mimeType: result.mimeType,
    size: result.size,
    truncated: result.truncated,
    revision: workspaceFileRevision(fileInfo),
    ...workspaceFilePosition(payload)
  }
}

export async function listWorkspaceDirectory(
  payload: WorkspaceDirectoryTarget
): Promise<WorkspaceDirectoryListResult> {
  try {
    const root = await resolveWorkspaceDirectory(payload)
    const entries = await readdir(root, { withFileTypes: true })
    const normalized = entries
      .filter((entry) => entry.name !== '.DS_Store')
      .map((entry) => ({
        name: entry.name,
        path: join(root, entry.name),
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        ext: entry.isDirectory() ? '' : extensionFromName(entry.name)
      }))
      .sort(compareWorkspaceEntries)

    return { ok: true, root, entries: normalized }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function readWorkspaceFile(payload: WorkspaceFileTarget): Promise<WorkspaceFileReadResult> {
  try {
    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    const fileInfo = await stat(targetPath)
    if (fileInfo.isDirectory()) {
      return { ok: false, message: 'Cannot preview a directory.' }
    }

    const ext = extensionFromName(targetPath).toLowerCase()
    if (ext === '.pdf') {
      return readWorkspacePdfFromResolvedPath(targetPath, fileInfo, payload)
    }
    if (ext === '.docx') {
      return readWorkspaceDocxFromResolvedPath(targetPath, fileInfo, payload)
    }

    return readWorkspaceTextFromWorkspaceIntel(targetPath, fileInfo, payload)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function readWorkspaceImage(
  payload: WorkspaceFileTarget
): Promise<WorkspaceImageReadResult> {
  try {
    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    const fileInfo = await stat(targetPath)
    if (fileInfo.isDirectory()) {
      return { ok: false, message: 'Cannot preview a directory.' }
    }
    if (fileInfo.size > MAX_IMAGE_PREVIEW_BYTES) {
      return { ok: false, message: 'This image is too large to preview.' }
    }

    const ext = extensionFromName(targetPath).toLowerCase()
    const mimeType = WORKSPACE_IMAGE_MIME_BY_EXT.get(ext)
    if (!mimeType) {
      return { ok: false, message: 'This image type is not supported in Write mode.' }
    }

    const bytes = await readFile(targetPath)
    return {
      ok: true,
      path: targetPath,
      dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
      mimeType,
      size: fileInfo.size,
      revision: workspaceFileRevision(fileInfo)
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function writeWorkspaceFile(
  payload: WorkspaceFileWritePayload
): Promise<WorkspaceFileWriteResult> {
  try {
    const target = await resolveSafeWorkspaceWriteTarget(payload.path, payload.workspaceRoot, {
      createParentDirectories: true
    })
    if (payload.contentBase64 !== undefined) {
      await writeSafeWorkspaceFile(target, Buffer.from(payload.contentBase64, 'base64'))
    } else {
      await writeSafeWorkspaceFile(target, payload.content ?? '', { encoding: 'utf8' })
    }
    const written = await stat(target.path)
    return {
      ok: true,
      path: target.path,
      savedAt: new Date().toISOString(),
      revision: workspaceFileRevision(written)
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function writeWorkspaceDocxText(
  payload: WorkspaceDocxTextWritePayload
): Promise<WorkspaceDocxTextWriteResult> {
  try {
    if (payload.paragraphs.length === 0) {
      return { ok: false, message: 'No DOCX paragraphs were provided.' }
    }
    const target = await resolveSafeWorkspaceWriteTarget(payload.path, payload.workspaceRoot, {
      createParentDirectories: false
    })
    if (extensionFromName(target.path).toLowerCase() !== '.docx') {
      return { ok: false, message: 'DOCX text editing is only supported for .docx files.' }
    }
    const fileInfo = await stat(target.path)
    if (fileInfo.isDirectory()) {
      return { ok: false, message: 'Cannot edit a directory as DOCX.' }
    }
    if (fileInfo.size > MAX_DOCX_PREVIEW_BYTES) {
      return { ok: false, message: 'This DOCX file is too large to edit.' }
    }

    const bytes = await readFile(target.path)
    const zip = await JSZip.loadAsync(bytes)
    const documentFile = zip.file('word/document.xml')
    const documentXml = await documentFile?.async('string')
    if (!documentXml) return { ok: false, message: 'This DOCX file does not contain word/document.xml.' }

    const updated = replaceEditedDocxParagraphs(documentXml, payload.paragraphs)
    if (updated.updatedCount !== payload.paragraphs.length) {
      return {
        ok: false,
        message: `Only ${updated.updatedCount} of ${payload.paragraphs.length} DOCX paragraphs could be located.`
      }
    }
    zip.file('word/document.xml', updated.documentXml)
    const nextBytes = await zip.generateAsync({ type: 'nodebuffer' })
    await writeSafeWorkspaceFile(target, nextBytes)
    return {
      ok: true,
      path: target.path,
      savedAt: new Date().toISOString(),
      paragraphCount: updated.updatedCount
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function createWorkspaceFile(
  payload: WorkspaceFileCreatePayload
): Promise<WorkspaceFileCreateResult> {
  try {
    const target = await resolveSafeWorkspaceWriteTarget(payload.path, payload.workspaceRoot, {
      createParentDirectories: true
    })
    if (await pathExists(target.path)) {
      return { ok: false, message: 'File already exists.' }
    }
    await writeSafeWorkspaceFile(target, payload.content ?? '', { encoding: 'utf8', exclusive: true })
    return {
      ok: true,
      path: target.path,
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function createWorkspaceDirectory(
  payload: WorkspaceDirectoryCreatePayload
): Promise<WorkspaceDirectoryCreateResult> {
  try {
    const target = await resolveSafeWorkspaceWriteTarget(payload.path, payload.workspaceRoot, {
      createParentDirectories: true,
      targetKind: 'directory'
    })
    if (await pathExists(target.path)) {
      return { ok: false, message: 'Directory already exists.' }
    }
    await mkdir(target.path)
    const targetPath = await ensureSafeWorkspaceDirectory(target.path, payload.workspaceRoot)
    return {
      ok: true,
      path: targetPath,
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function buildWorkspaceImageName(now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `pasted-image-${iso}-${randomUUID().slice(0, 8)}.png`
}

function buildWorkspaceTextName(now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `pasted-text-${iso}-${randomUUID().slice(0, 8)}.txt`
}

async function availableWorkspaceWriteTarget(
  workspaceRoot: string,
  directory: string,
  name: string,
  policy?: WorkspaceFileConflictPolicy
) {
  const resolution = await resolveWorkspaceEntryConflict(workspaceRoot, directory, name, policy)
  if (resolution.action === 'skip') return resolution
  const target = await resolveSafeWorkspaceWriteTarget(resolution.path, workspaceRoot, {
    createParentDirectories: false
  })
  return {
    action: 'write' as const,
    target,
    overwrite: resolution.overwrite
  }
}

export async function readClipboardImage(): Promise<ClipboardImageReadResult> {
  try {
    const image = clipboard.readImage()
    if (image.isEmpty()) {
      return { ok: false, message: 'Clipboard does not currently contain an image.' }
    }

    const buffer = image.toPNG()
    if (!buffer.length) {
      return { ok: false, message: 'Clipboard image could not be encoded as PNG.' }
    }

    const size = image.getSize()
    return {
      ok: true,
      name: buildWorkspaceImageName(),
      mimeType: 'image/png',
      dataBase64: buffer.toString('base64'),
      byteSize: buffer.length,
      ...(size.width > 0 ? { width: size.width } : {}),
      ...(size.height > 0 ? { height: size.height } : {})
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function pasteWorkspaceClipboard(
  payload: WorkspaceClipboardPastePayload
): Promise<WorkspaceClipboardPasteResult> {
  try {
    const targetDirectory = await resolveWorkspaceDirectory({
      workspaceRoot: payload.workspaceRoot,
      ...(payload.targetDirectory.trim() ? { path: payload.targetDirectory } : {})
    })
    const clipboardFilePaths = readClipboardFilePaths()
    if (clipboardFilePaths.length > 0) {
      const targetWorkspaceRoot = await resolvedWorkspaceRoot(payload.workspaceRoot)
      const imported = await importWorkspaceEntries({
        sourcePaths: clipboardFilePaths,
        targetWorkspaceRoot: payload.workspaceRoot,
        targetDirectory: normalizePathSeparators(relative(targetWorkspaceRoot, targetDirectory)),
        conflictPolicy: payload.conflictPolicy
      })
      if (!imported.ok) return imported
      return {
        ok: true,
        kind: 'files',
        imported: imported.imported,
        pastedAt: imported.importedAt
      }
    }

    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      const buffer = image.toPNG()
      if (!buffer.length) {
        return { ok: false, message: 'Clipboard image could not be encoded as PNG.' }
      }
      const target = await availableWorkspaceWriteTarget(
        payload.workspaceRoot,
        targetDirectory,
        buildWorkspaceImageName(),
        payload.conflictPolicy
      )
      if (target.action === 'skip') {
        return {
          ok: true,
          kind: 'image',
          path: target.path,
          name: basename(target.path),
          pastedAt: new Date().toISOString(),
          skipped: true
        }
      }
      if (target.overwrite) await rm(target.target.path, { recursive: true, force: false })
      await writeSafeWorkspaceFile(target.target, buffer, { exclusive: !target.overwrite })
      return {
        ok: true,
        kind: 'image',
        path: target.target.path,
        name: basename(target.target.path),
        pastedAt: new Date().toISOString()
      }
    }

    const text = clipboard.readText()
    if (text.length > 0) {
      const target = await availableWorkspaceWriteTarget(
        payload.workspaceRoot,
        targetDirectory,
        buildWorkspaceTextName(),
        payload.conflictPolicy
      )
      if (target.action === 'skip') {
        return {
          ok: true,
          kind: 'text',
          path: target.path,
          name: basename(target.path),
          pastedAt: new Date().toISOString(),
          skipped: true
        }
      }
      if (target.overwrite) await rm(target.target.path, { recursive: true, force: false })
      await writeSafeWorkspaceFile(target.target, text, { encoding: 'utf8', exclusive: !target.overwrite })
      return {
        ok: true,
        kind: 'text',
        path: target.target.path,
        name: basename(target.target.path),
        pastedAt: new Date().toISOString()
      }
    }

    return { ok: false, message: 'Clipboard does not currently contain files, text, or an image.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function readClipboardFilePaths(): string[] {
  const formats = clipboardAvailableFormats()
  const paths = [
    ...filePathsFromUriList(readClipboardFormatText('text/uri-list', formats)),
    ...filePathsFromGnomeCopiedFiles(readClipboardFormatText('x-special/gnome-copied-files', formats)),
    ...filePathsFromBookmark(),
    ...filePathsFromNullSeparatedText(readClipboardBufferText('FileNameW', 'utf16le', formats)),
    ...filePathsFromNullSeparatedText(readClipboardBufferText('FileName', 'utf8', formats)),
    ...filePathsFromUriList(readClipboardBufferText('public.file-url', 'utf8', formats)),
    ...filePathsFromPropertyList(readClipboardBufferText('NSFilenamesPboardType', 'utf8', formats))
  ]
  return [...new Set(paths.map((path) => path.trim()).filter((path) => path && isAbsolute(path)))]
}

function clipboardAvailableFormats(): string[] {
  try {
    return typeof clipboard.availableFormats === 'function' ? clipboard.availableFormats() : []
  } catch {
    return []
  }
}

function readClipboardFormatText(format: string, formats: readonly string[]): string {
  if (!formats.includes(format) || typeof clipboard.read !== 'function') return ''
  try {
    return clipboard.read(format)
  } catch {
    return ''
  }
}

function readClipboardBufferText(
  format: string,
  encoding: BufferEncoding,
  formats: readonly string[]
): string {
  if (!formats.includes(format) || typeof clipboard.readBuffer !== 'function') return ''
  try {
    const buffer = clipboard.readBuffer(format)
    return buffer.length ? buffer.toString(encoding).replace(/\0+$/u, '') : ''
  } catch {
    return ''
  }
}

function filePathsFromBookmark(): string[] {
  if (typeof clipboard.readBookmark !== 'function') return []
  try {
    const bookmark = clipboard.readBookmark()
    return bookmark?.url ? filePathsFromUriList(bookmark.url) : []
  } catch {
    return []
  }
}

function filePathsFromGnomeCopiedFiles(value: string): string[] {
  const lines = value.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  return filePathsFromUriList(lines.filter((line) => line !== 'copy' && line !== 'cut').join('\n'))
}

function filePathsFromUriList(value: string): string[] {
  return value.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .flatMap((line) => {
      if (!line.startsWith('file:')) return []
      try {
        return [fileURLToPath(line)]
      } catch {
        return []
      }
    })
}

function filePathsFromNullSeparatedText(value: string): string[] {
  return value.split(/\0|\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && isAbsolute(line))
}

function filePathsFromPropertyList(value: string): string[] {
  const quotedValues = [...value.matchAll(/<string>(.*?)<\/string>|"([^"]+)"/gu)]
    .map((match) => (match[1] ?? match[2] ?? '').trim())
  return quotedValues.filter((path) => path && isAbsolute(path))
}

export async function saveWorkspaceClipboardImage(
  payload: WorkspaceClipboardImageSavePayload
): Promise<WorkspaceClipboardImageSaveResult> {
  try {
    const currentFilePath = await resolveOpenTargetPath(payload.currentFilePath, payload.workspaceRoot, {
      allowBasenameFallback: false
    })
    const image = clipboard.readImage()
    if (image.isEmpty()) {
      return { ok: false, message: 'Clipboard does not currently contain an image.' }
    }

    const buffer = image.toPNG()
    if (!buffer.length) {
      return { ok: false, message: 'Clipboard image could not be encoded as PNG.' }
    }

    const imageDirectory = payload.imageDirectory?.trim() || WORKSPACE_IMAGE_DIR
    const imageDir = await ensureSafeWorkspaceDirectory(imageDirectory, payload.workspaceRoot)

    const target = await resolveSafeWorkspaceWriteTarget(
      join(imageDir, buildWorkspaceImageName()),
      payload.workspaceRoot,
      { createParentDirectories: false }
    )
    await writeSafeWorkspaceFile(target, buffer, { exclusive: true })

    return {
      ok: true,
      path: target.path,
      markdownPath: normalizePathSeparators(relative(dirname(currentFilePath), target.path)),
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function renameWorkspaceEntry(
  payload: WorkspaceEntryRenamePayload
): Promise<WorkspaceEntryRenameResult> {
  try {
    const sourcePath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    await stat(sourcePath)
    const nextName = validateEntryName(payload.newName)
    const target = await resolveSafeWorkspaceWriteTarget(
      join(dirname(sourcePath), nextName),
      payload.workspaceRoot,
      { createParentDirectories: false }
    )
    const targetPath = target.path
    if (sourcePath === targetPath) {
      return {
        ok: true,
        path: targetPath,
        previousPath: sourcePath,
        renamedAt: new Date().toISOString()
      }
    }
    if (await pathExists(targetPath)) {
      return { ok: false, message: 'A file or directory with that name already exists.' }
    }
    await rename(sourcePath, targetPath)
    return {
      ok: true,
      path: targetPath,
      previousPath: sourcePath,
      renamedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function copyWorkspaceEntry(
  payload: WorkspaceEntryCopyPayload
): Promise<WorkspaceEntryCopyResult> {
  try {
    const sourcePath = await resolveTargetPathWithinWorkspace(payload.sourcePath, payload.sourceWorkspaceRoot)
    await stat(sourcePath)
    await ensureNotWorkspaceRoot(sourcePath, payload.sourceWorkspaceRoot, 'Copying')
    const targetDirectory = await resolveWorkspaceDirectory({
      workspaceRoot: payload.targetWorkspaceRoot,
      ...(payload.targetDirectory.trim() ? { path: payload.targetDirectory } : {})
    })
    const target = await resolveWorkspaceEntryConflict(
      payload.targetWorkspaceRoot,
      targetDirectory,
      basename(sourcePath),
      payload.conflictPolicy
    )
    if (target.action === 'skip') {
      return {
        ok: true,
        path: target.path,
        sourcePath,
        copiedAt: new Date().toISOString(),
        skipped: true
      }
    }
    const removedTarget = target.overwrite
      ? await removeOverwriteTarget(target.path, sourcePath)
      : false
    if (!removedTarget && target.overwrite) {
      return {
        ok: true,
        path: sourcePath,
        sourcePath,
        copiedAt: new Date().toISOString()
      }
    }
    await cp(sourcePath, target.path, {
      recursive: true,
      force: target.overwrite,
      errorOnExist: !target.overwrite
    })
    return {
      ok: true,
      path: target.path,
      sourcePath,
      copiedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function importWorkspaceEntries(
  payload: WorkspaceEntryImportPayload
): Promise<WorkspaceEntryImportResult> {
  try {
    const sourcePaths = [...new Set(payload.sourcePaths.map((path) => path.trim()).filter(Boolean))]
    if (sourcePaths.length === 0) return { ok: false, message: 'At least one source path is required.' }
    const targetDirectory = await resolveWorkspaceDirectory({
      workspaceRoot: payload.targetWorkspaceRoot,
      ...(payload.targetDirectory.trim() ? { path: payload.targetDirectory } : {})
    })
    const targetWorkspaceRoot = await resolvedWorkspaceRoot(payload.targetWorkspaceRoot)
    const imported: Extract<WorkspaceEntryImportResult, { ok: true }>['imported'] = []

    for (const sourcePath of sourcePaths) {
      if (!isAbsolute(sourcePath)) {
        return { ok: false, message: 'Only absolute local paths can be imported into the workspace.' }
      }
      const sourceStats = await stat(sourcePath)
      const sourceCanonical = await canonicalPath(sourcePath)
      if (sourceCanonical === targetWorkspaceRoot) {
        return { ok: false, message: 'Importing the workspace root into itself is not allowed.' }
      }
      if (sourceStats.isDirectory()) {
        const targetDirectoryCanonical = await canonicalPath(targetDirectory)
        if (targetDirectoryCanonical === sourceCanonical || targetDirectoryCanonical.startsWith(`${sourceCanonical}${sep}`)) {
          return { ok: false, message: 'Importing a directory into itself or one of its descendants is not allowed.' }
        }
      }
      const target = await resolveWorkspaceEntryConflict(
        payload.targetWorkspaceRoot,
        targetDirectory,
        basename(sourcePath),
        payload.conflictPolicy
      )
      if (target.action === 'skip') {
        imported.push({
          sourcePath,
          path: target.path,
          name: basename(target.path),
          type: sourceStats.isDirectory() ? 'directory' : 'file',
          skipped: true
        })
        continue
      }
      const removedTarget = target.overwrite
        ? await removeOverwriteTarget(target.path, sourcePath)
        : false
      if (!removedTarget && target.overwrite) {
        imported.push({
          sourcePath,
          path: sourcePath,
          name: basename(sourcePath),
          type: sourceStats.isDirectory() ? 'directory' : 'file'
        })
        continue
      }
      await cp(sourcePath, target.path, {
        recursive: sourceStats.isDirectory(),
        force: target.overwrite,
        errorOnExist: !target.overwrite
      })
      imported.push({
        sourcePath,
        path: target.path,
        name: basename(target.path),
        type: sourceStats.isDirectory() ? 'directory' : 'file'
      })
    }

    return {
      ok: true,
      imported,
      importedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function moveWorkspaceEntry(
  payload: WorkspaceEntryMovePayload
): Promise<WorkspaceEntryMoveResult> {
  try {
    const sourcePath = await resolveTargetPathWithinWorkspace(payload.sourcePath, payload.sourceWorkspaceRoot)
    await stat(sourcePath)
    await ensureNotWorkspaceRoot(sourcePath, payload.sourceWorkspaceRoot, 'Moving')
    const targetDirectory = await resolveWorkspaceDirectory({
      workspaceRoot: payload.targetWorkspaceRoot,
      ...(payload.targetDirectory.trim() ? { path: payload.targetDirectory } : {})
    })
    const directTarget = await resolveSafeWorkspaceWriteTarget(
      join(targetDirectory, basename(sourcePath)),
      payload.targetWorkspaceRoot,
      { createParentDirectories: false }
    )
    const directTargetPath = directTarget.path
    const sourceCanonical = await canonicalPath(sourcePath)
    const directTargetCanonical = await canonicalPath(directTargetPath)
    if (sourceCanonical === directTargetCanonical) {
      return {
        ok: true,
        path: sourcePath,
        previousPath: sourcePath,
        movedAt: new Date().toISOString()
      }
    }
    const target = await resolveWorkspaceEntryConflict(
      payload.targetWorkspaceRoot,
      targetDirectory,
      basename(sourcePath),
      payload.conflictPolicy
    )
    if (target.action === 'skip') {
      return {
        ok: true,
        path: sourcePath,
        previousPath: sourcePath,
        movedAt: new Date().toISOString(),
        skipped: true
      }
    }
    const removedTarget = target.overwrite
      ? await removeOverwriteTarget(target.path, sourcePath)
      : false
    if (!removedTarget && target.overwrite) {
      return {
        ok: true,
        path: sourcePath,
        previousPath: sourcePath,
        movedAt: new Date().toISOString()
      }
    }
    try {
      await rename(sourcePath, target.path)
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : ''
      if (code !== 'EXDEV') throw error
      await cp(sourcePath, target.path, {
        recursive: true,
        force: false,
        errorOnExist: true
      })
      await rm(sourcePath, { recursive: true, force: false })
    }
    return {
      ok: true,
      path: target.path,
      previousPath: sourcePath,
      movedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function deleteWorkspaceEntry(
  payload: WorkspaceEntryDeletePayload
): Promise<WorkspaceEntryDeleteResult> {
  try {
    const targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    const info = await stat(targetPath)
    await ensureNotWorkspaceRoot(targetPath, payload.workspaceRoot, 'Deleting')
    if (info.isDirectory()) {
      await rm(targetPath, { recursive: true })
    } else {
      await unlink(targetPath)
    }
    return {
      ok: true,
      path: targetPath,
      deletedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function resolveWorkspaceFile(
  payload: WorkspaceFileTarget
): Promise<WorkspaceFileResolveResult> {
  try {
    const normalizedPath = normalizeUserPath(payload.path)
    const expandedPath = expandHomePath(normalizedPath)
    if (!isAbsolute(expandedPath) && !payload.workspaceRoot?.trim()) {
      return {
        ok: false,
        message: 'Workspace root is required to resolve a relative file path.'
      }
    }

    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot, {
      allowBasenameFallback: false
    })
    const info = await stat(targetPath)
    return { ok: true, path: targetPath, kind: info.isDirectory() ? 'directory' : 'file' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
