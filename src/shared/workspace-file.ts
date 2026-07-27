import { z } from 'zod'
import type {
  WorkspacePreviewAnchor,
  WorkspacePreviewIntegrityExpectation,
  WorkspaceStructuredSelection
} from './workspace-preview'

export type WorkspaceFileTarget = {
  path: string
  workspaceRoot?: string
  line?: number
  column?: number
  selection?: WorkspaceStructuredSelection
  anchor?: WorkspacePreviewAnchor
  integrity?: WorkspacePreviewIntegrityExpectation
}

export type WorkspaceEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  ext: string
}

export type WorkspaceDirectoryTarget = {
  path?: string
  workspaceRoot: string
}

export type WorkspaceFileWritePayload = {
  path: string
  workspaceRoot?: string
  content?: string
  contentBase64?: string
}

export type WorkspaceDocxTextParagraphWrite = {
  index: number
  text: string
}

export type WorkspaceDocxTextWritePayload = {
  path: string
  workspaceRoot?: string
  paragraphs: WorkspaceDocxTextParagraphWrite[]
}

export type WorkspaceFileCreatePayload = {
  path: string
  workspaceRoot: string
  content?: string
}

export type WorkspaceDirectoryCreatePayload = {
  path: string
  workspaceRoot: string
}

export type WorkspaceEntryRenamePayload = {
  path: string
  workspaceRoot: string
  newName: string
}

export type WorkspacePdfRenameSuggestionPayload = {
  path: string
  workspaceRoot: string
}

export const workspaceFileConflictStrategySchema = z.enum(['ask', 'overwrite', 'rename', 'skip', 'merge'])
export type WorkspaceFileConflictStrategy = z.infer<typeof workspaceFileConflictStrategySchema>

export const workspaceFileConflictPolicySchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('ask')
  }).strict(),
  z.object({
    strategy: z.literal('overwrite')
  }).strict(),
  z.object({
    strategy: z.literal('rename'),
    renameTemplate: z.string().trim().min(1).max(256).optional(),
    maxAttempts: z.number().int().min(1).max(10_000).optional()
  }).strict(),
  z.object({
    strategy: z.literal('skip')
  }).strict(),
  z.object({
    strategy: z.literal('merge')
  }).strict()
])
export type WorkspaceFileConflictPolicy = z.infer<typeof workspaceFileConflictPolicySchema>

export type WorkspaceEntryCopyPayload = {
  sourcePath: string
  sourceWorkspaceRoot: string
  targetDirectory: string
  targetWorkspaceRoot: string
  conflictPolicy?: WorkspaceFileConflictPolicy
}

export type WorkspaceEntryImportPayload = {
  sourcePaths: string[]
  targetDirectory: string
  targetWorkspaceRoot: string
  conflictPolicy?: WorkspaceFileConflictPolicy
}

export type WorkspaceEntryMovePayload = {
  sourcePath: string
  sourceWorkspaceRoot: string
  targetDirectory: string
  targetWorkspaceRoot: string
  conflictPolicy?: WorkspaceFileConflictPolicy
}

export type WorkspaceEntryDeletePayload = {
  path: string
  workspaceRoot: string
}

export type WorkspaceClipboardPastePayload = {
  workspaceRoot: string
  targetDirectory: string
  conflictPolicy?: WorkspaceFileConflictPolicy
}

export type WorkspaceFileWatchPayload = {
  path: string
  workspaceRoot: string
}

export type WorkspaceClipboardImageSavePayload = {
  workspaceRoot: string
  currentFilePath: string
  imageDirectory?: string
}

export type ClipboardImageReadResult =
  | {
      ok: true
      name: string
      mimeType: string
      dataBase64: string
      byteSize: number
      width?: number
      height?: number
    }
  | { ok: false; message: string }

export type WorkspaceFilePreviewKind = 'text' | 'pdf' | 'docx'

export type WorkspaceFileReadTextResult = {
  ok: true
  kind: 'text'
  path: string
  content: string
  mimeType: string
  size: number
  truncated: boolean
  line?: number
  column?: number
}

export type WorkspaceFileReadPdfResult = {
  ok: true
  kind: 'pdf'
  path: string
  content: ''
  dataBase64: string
  mimeType: 'application/pdf'
  size: number
  truncated: false
  mtimeMs: number
  line?: number
  column?: number
}

export type WorkspaceDocxParagraph = {
  id: string
  index: number
  text: string
  style?: string
}

export type WorkspaceFileReadDocxResult = {
  ok: true
  kind: 'docx'
  path: string
  content: string
  paragraphs: WorkspaceDocxParagraph[]
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  size: number
  truncated: false
  mtimeMs: number
  line?: number
  column?: number
}

export type WorkspaceFileReadResult =
  | WorkspaceFileReadTextResult
  | WorkspaceFileReadPdfResult
  | WorkspaceFileReadDocxResult
  | { ok: false; message: string }

export type WorkspaceImageReadResult =
  | {
      ok: true
      path: string
      dataUrl: string
      mimeType: string
      size: number
    }
  | { ok: false; message: string }

export type WorkspaceHtmlPreviewResult =
  | {
      ok: true
      path: string
      workspaceRoot: string
      url: string
      size: number
      mtimeMs: number
    }
  | { ok: false; message: string }

export type WorkspaceFileResolveResult =
  | {
      ok: true
      path: string
      kind?: 'file' | 'directory'
    }
  | { ok: false; message: string }

export type WorkspaceDirectoryListResult =
  | {
      ok: true
      root: string
      entries: WorkspaceEntry[]
    }
  | { ok: false; message: string }

export type WorkspaceFileWriteResult =
  | {
      ok: true
      path: string
      savedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceDocxTextWriteResult =
  | {
      ok: true
      path: string
      savedAt: string
      paragraphCount: number
    }
  | { ok: false; message: string }

export type WorkspaceFileCreateResult =
  | {
      ok: true
      path: string
      createdAt: string
    }
  | { ok: false; message: string }

export type WorkspaceDirectoryCreateResult =
  | {
      ok: true
      path: string
      createdAt: string
    }
  | { ok: false; message: string }

export type WorkspaceEntryRenameResult =
  | {
      ok: true
      path: string
      previousPath: string
      renamedAt: string
    }
  | { ok: false; message: string }

export type WorkspacePdfRenameSuggestionResult =
  | {
      ok: true
      suggestedName: string
      title: string
      source: 'metadata' | 'first-page'
    }
  | { ok: false; message: string }

export type WorkspaceEntryCopyResult =
  | {
      ok: true
      path: string
      sourcePath: string
      copiedAt: string
      skipped?: boolean
    }
  | { ok: false; message: string }

export type WorkspaceEntryImportItemResult = {
  sourcePath: string
  path: string
  name: string
  type: 'file' | 'directory'
  skipped?: boolean
}

export type WorkspaceEntryImportResult =
  | {
      ok: true
      imported: WorkspaceEntryImportItemResult[]
      importedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceEntryMoveResult =
  | {
      ok: true
      path: string
      previousPath: string
      movedAt: string
      skipped?: boolean
    }
  | { ok: false; message: string }

export type WorkspaceEntryDeleteResult =
  | {
      ok: true
      path: string
      deletedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceFileWatchResult =
  | {
      ok: true
      watchId: string
      kind?: WorkspaceFilePreviewKind
      path: string
      content: string
      dataBase64?: string
      mimeType?: string
      size: number
      truncated: boolean
      mtimeMs?: number
      startedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceClipboardImageSaveResult =
  | {
      ok: true
      path: string
      markdownPath: string
      createdAt: string
    }
  | { ok: false; message: string }

export type WorkspaceClipboardPasteResult =
  | {
      ok: true
      kind: 'image' | 'text'
      path: string
      name: string
      pastedAt: string
      skipped?: boolean
    }
  | {
      ok: true
      kind: 'files'
      imported: WorkspaceEntryImportItemResult[]
      pastedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceFileChangePayload =
  | {
      ok: true
      watchId: string
      workspaceRoot: string
      kind?: WorkspaceFilePreviewKind
      path: string
      content: string
      dataBase64?: string
      mimeType?: string
      size: number
      truncated: boolean
      mtimeMs?: number
      changedAt: string
    }
  | {
      ok: false
      watchId: string
      workspaceRoot: string
      path: string
      message: string
      changedAt: string
    }
