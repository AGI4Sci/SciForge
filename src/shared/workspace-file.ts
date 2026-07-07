export type WorkspaceFileTarget = {
  path: string
  workspaceRoot?: string
  line?: number
  column?: number
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

export type WorkspaceEntryCopyPayload = {
  sourcePath: string
  sourceWorkspaceRoot: string
  targetDirectory: string
  targetWorkspaceRoot: string
}

export type WorkspaceEntryMovePayload = {
  sourcePath: string
  sourceWorkspaceRoot: string
  targetDirectory: string
  targetWorkspaceRoot: string
}

export type WorkspaceEntryDeletePayload = {
  path: string
  workspaceRoot: string
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

export type WorkspaceEntryCopyResult =
  | {
      ok: true
      path: string
      sourcePath: string
      copiedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceEntryMoveResult =
  | {
      ok: true
      path: string
      previousPath: string
      movedAt: string
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
