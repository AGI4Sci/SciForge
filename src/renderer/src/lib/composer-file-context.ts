import type {
  AgentRuntimeWorkspaceReference,
  AgentRuntimeWorkspaceReferencePreview
} from '../../../shared/agent-runtime-contract'
import type { WorkspaceFileReadResult } from '../../../shared/workspace-file'
import type {
  ComposerFileContextEntry,
  ComposerFileReference
} from './composer-file-references'

export type ComposerWorkspaceReferenceListResult =
  | { ok: true; references: AgentRuntimeWorkspaceReference[] }
  | { ok: false; message: string }

export type ComposerWorkspaceReferencePreviewResult =
  | { ok: true; preview: AgentRuntimeWorkspaceReferencePreview }
  | { ok: false; message: string }

export type ComposerFileContextReader = {
  listWorkspaceReferences(input: {
    workspaceRoot: string
    path?: string
    recursive?: boolean
    limit?: number
  }): Promise<ComposerWorkspaceReferenceListResult>
  readWorkspaceFile(input: {
    workspaceRoot: string
    path: string
  }): Promise<WorkspaceFileReadResult>
}

export type ComposerFileContextOptions = {
  maxCharsPerFile?: number
  maxTotalChars?: number
  maxDirectoryFiles?: number
}

const DEFAULT_MAX_CHARS_PER_FILE = 60_000
const DEFAULT_MAX_TOTAL_CHARS = 180_000
const DEFAULT_MAX_DIRECTORY_FILES = 40

export async function readComposerFileContextEntries(
  references: readonly ComposerFileReference[],
  workspaceRoot: string,
  reader: ComposerFileContextReader,
  options: ComposerFileContextOptions = {}
): Promise<ComposerFileContextEntry[]> {
  const entries: ComposerFileContextEntry[] = []
  const pendingReferences = [...references]
  const maxCharsPerFile = options.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE
  const maxTotalChars = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS
  const maxDirectoryFiles = options.maxDirectoryFiles ?? DEFAULT_MAX_DIRECTORY_FILES
  let remainingChars = maxTotalChars

  while (pendingReferences.length > 0) {
    const reference = pendingReferences.shift()!
    const referenceWorkspaceRoot = reference.workspaceRoot?.trim() || workspaceRoot
    if (remainingChars <= 0) break

    if (reference.kind === 'directory') {
      const result = await reader.listWorkspaceReferences({
        workspaceRoot: referenceWorkspaceRoot,
        path: reference.relativePath || reference.path,
        recursive: true,
        limit: maxDirectoryFiles + 20
      })
      if (!result.ok) throw composerFileReadError(reference.relativePath, result.message)
      const children = result.references
        .filter((child) => child.kind !== 'directory')
        .slice(0, maxDirectoryFiles)
      if (children.length === 0) {
        const content = `Directory reference: ${reference.relativePath}\nNo previewable files were found in this directory.`
        entries.push({ relativePath: reference.relativePath, workspaceRoot: referenceWorkspaceRoot, content })
        remainingChars -= content.length
        continue
      }
      const summary = `Directory reference: ${reference.relativePath}\nExpanded files: ${children.map((child) => child.relativePath).join(', ')}`
      entries.push({
        relativePath: reference.relativePath,
        workspaceRoot: referenceWorkspaceRoot,
        content: summary,
        ...(result.references.length > children.length ? { truncated: true } : {})
      })
      remainingChars -= summary.length
      pendingReferences.unshift(...children.map((child) => ({
        path: child.relativePath,
        relativePath: child.relativePath,
        name: child.name,
        workspaceRoot: child.workspaceRoot || referenceWorkspaceRoot,
        kind: child.kind,
        ...(child.mimeType ? { mimeType: child.mimeType } : {})
      })))
      continue
    }

    if (reference.modelRouterObject) {
      const label = reference.kind === 'image' ? 'Workspace image' : 'Scientific workspace file'
      const guidance = reference.kind === 'image'
        ? 'This image is attached through the active runtime\'s supported local-image or structured-object input.'
        : 'This file is attached as a structured workspace reference. Use its workspace path with the available document tools.'
      const content = [`${label}: ${reference.relativePath}`, guidance].join('\n')
      entries.push({ relativePath: reference.relativePath, workspaceRoot: referenceWorkspaceRoot, content })
      remainingChars -= content.length
      continue
    }

    if (reference.kind === 'image') {
      const content = [
        `Workspace image: ${reference.relativePath}`,
        'This image is referenced by workspace-relative path. Ask the user for a visual selection or attach it directly when visual inspection is required.'
      ].join('\n')
      entries.push({ relativePath: reference.relativePath, workspaceRoot: referenceWorkspaceRoot, content })
      remainingChars -= content.length
      continue
    }

    const result = await reader.readWorkspaceFile({
      workspaceRoot: referenceWorkspaceRoot,
      path: reference.relativePath || reference.path
    })
    if (!result.ok) throw composerFileReadError(reference.relativePath, result.message)
    if (result.kind === 'pdf') {
      const content = [
        `PDF document: ${reference.relativePath}`,
        'This file is available through the workspace PDF reader. Use selected PDF quotes when provided; otherwise ask for the relevant page or excerpt.'
      ].join('\n')
      entries.push({ relativePath: reference.relativePath, workspaceRoot: referenceWorkspaceRoot, content })
      remainingChars -= content.length
      continue
    }

    const clipped = clipComposerFileContext(result.content, remainingChars, result.truncated, maxCharsPerFile)
    remainingChars -= clipped.consumed
    entries.push({
      relativePath: reference.relativePath,
      workspaceRoot: referenceWorkspaceRoot,
      content: clipped.content,
      ...(clipped.truncated ? { truncated: true } : {})
    })
  }

  return entries
}

function clipComposerFileContext(
  content: string,
  remainingTotalChars: number,
  sourceTruncated: boolean,
  maxCharsPerFile: number
): { content: string; consumed: number; truncated: boolean } {
  const limit = Math.max(0, Math.min(maxCharsPerFile, remainingTotalChars))
  if (content.length <= limit) {
    return { content, consumed: content.length, truncated: sourceTruncated }
  }
  const suffix = '\n...[truncated]'
  const clipped = `${content.slice(0, Math.max(0, limit - suffix.length))}${suffix}`
  return { content: clipped, consumed: clipped.length, truncated: true }
}

function composerFileReadError(path: string, message: string): Error {
  return new Error(`Failed to read workspace reference "${path}": ${message}`)
}
