import {
  WORKSPACE_INTEL_MAX_LIST_LIMIT,
  createWorkspaceIntelService,
  type WorkspaceIntelFailure,
  type WorkspaceReference,
  type WorkspaceReferenceKind,
  type WorkspaceReferencePreviewResult
} from '../../../packages/workers/workspace-intel/src/index.js'
import type {
  AgentRuntimeWorkspaceReference,
  AgentRuntimeWorkspaceReferencePreview
} from '../../shared/agent-runtime-contract'

const MAX_DIRECTORY_CHILDREN = 300
const MAX_SUMMARY_CHARS = 8_000
const IGNORED_REFERENCE_NAMES = new Set(['.DS_Store', '.git', 'node_modules'])

type WorkspaceReferencePreviewSuccess = Extract<WorkspaceReferencePreviewResult, { ok: true }>

export class WorkspaceReferenceService {
  private readonly workspaceIntel = createWorkspaceIntelService({
    maxListEntries: WORKSPACE_INTEL_MAX_LIST_LIMIT,
    maxPreviewChars: MAX_SUMMARY_CHARS
  })

  async list(input: {
    workspaceRoot: string
    path?: string
    recursive?: boolean
    limit?: number
  }): Promise<{ ok: true; references: AgentRuntimeWorkspaceReference[] } | { ok: false; message: string }> {
    try {
      return await this.listReferences({
        workspaceRoot: input.workspaceRoot,
        path: input.path,
        recursive: input.recursive === true,
        limit: listLimit(input.limit)
      })
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async preview(input: {
    workspaceRoot: string
    path: string
  }): Promise<{ ok: true; preview: AgentRuntimeWorkspaceReferencePreview } | { ok: false; message: string }> {
    try {
      const result = await this.workspaceIntel.referencePreview({
        workspaceRoot: input.workspaceRoot,
        path: input.path,
        maxChars: MAX_SUMMARY_CHARS
      })
      if (!result.ok) return failure(result)

      const reference = toAgentRuntimeReference(result.workspaceRoot, result.reference, 'preview')
      if (result.preview.kind === 'directory') {
        const list = await this.listReferences({
          workspaceRoot: result.workspaceRoot,
          path: result.preview.relativePath,
          recursive: false,
          limit: MAX_DIRECTORY_CHILDREN
        })
        if (!list.ok) return list
        return {
          ok: true,
          preview: {
            reference,
            contentSummary: `Directory with ${list.references.length} visible entries.`,
            children: list.references
          }
        }
      }

      return {
        ok: true,
        preview: previewFromWorkspaceIntel(result, reference)
      }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  private async listReferences(input: {
    workspaceRoot: string
    path?: string
    recursive: boolean
    limit: number
  }): Promise<{ ok: true; references: AgentRuntimeWorkspaceReference[] } | { ok: false; message: string }> {
    const references: AgentRuntimeWorkspaceReference[] = []
    const pageLimit = Math.min(WORKSPACE_INTEL_MAX_LIST_LIMIT, Math.max(input.limit, MAX_DIRECTORY_CHILDREN))
    let cursor: string | undefined

    while (references.length < input.limit) {
      const result = await this.workspaceIntel.referenceList({
        workspaceRoot: input.workspaceRoot,
        path: input.path,
        recursive: input.recursive,
        limit: pageLimit,
        includeHidden: true,
        ...(cursor ? { cursor } : {})
      })
      if (!result.ok) return failure(result)

      for (const reference of result.references) {
        if (!isVisibleReference(reference)) continue
        references.push(toAgentRuntimeReference(result.workspaceRoot, reference, 'list'))
        if (references.length >= input.limit) break
      }

      if (!result.nextCursor || result.nextCursor === cursor) break
      cursor = result.nextCursor
    }

    return { ok: true, references }
  }
}

function previewFromWorkspaceIntel(
  result: WorkspaceReferencePreviewSuccess,
  reference: AgentRuntimeWorkspaceReference
): AgentRuntimeWorkspaceReferencePreview {
  const preview = result.preview
  if (preview.kind === 'image') {
    return {
      reference,
      contentSummary: `Image ${reference.relativePath} (${preview.mimeType ?? 'image/*'}, ${formatBytes(preview.size ?? 0)}).`
    }
  }
  if (preview.kind === 'pdf') {
    return {
      reference,
      contentSummary: `PDF ${reference.relativePath} (${formatBytes(preview.size ?? 0)}).`
    }
  }
  return {
    reference,
    contentSummary: preview.contentSummary,
    ...(preview.content !== undefined ? { content: preview.content } : {}),
    ...(preview.kind === 'text' || preview.truncated ? { truncated: preview.truncated } : {})
  }
}

function toAgentRuntimeReference(
  workspaceRoot: string,
  reference: WorkspaceReference,
  context: 'list' | 'preview'
): AgentRuntimeWorkspaceReference {
  return {
    workspaceRoot,
    relativePath: reference.relativePath,
    name: reference.name,
    kind: context === 'list' ? listReferenceKind(reference.kind) : previewReferenceKind(reference.kind),
    ...(reference.size !== undefined ? { size: reference.size } : {}),
    ...(reference.mimeType ? { mimeType: reference.mimeType } : {})
  }
}

function listReferenceKind(kind: WorkspaceReferenceKind): AgentRuntimeWorkspaceReference['kind'] {
  if (kind === 'directory' || kind === 'image' || kind === 'pdf') return kind
  return 'file'
}

function previewReferenceKind(kind: WorkspaceReferenceKind): AgentRuntimeWorkspaceReference['kind'] {
  if (kind === 'directory' || kind === 'image' || kind === 'pdf' || kind === 'text') return kind
  return 'file'
}

function isVisibleReference(reference: WorkspaceReference): boolean {
  return reference.kind !== 'symlink' && !IGNORED_REFERENCE_NAMES.has(reference.name)
}

function listLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return MAX_DIRECTORY_CHILDREN
  return Math.max(1, Math.min(Math.floor(limit ?? MAX_DIRECTORY_CHILDREN), WORKSPACE_INTEL_MAX_LIST_LIMIT))
}

function failure(error: WorkspaceIntelFailure): { ok: false; message: string } {
  return { ok: false, message: error.error.message }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
