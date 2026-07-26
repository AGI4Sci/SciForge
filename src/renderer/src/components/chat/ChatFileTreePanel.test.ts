import { describe, expect, it } from 'vitest'
import { WORKSPACE_PREVIEW_DRAG_SOURCE_MIME } from '@shared/workspace-preview'
import {
  containingFolderPath,
  composerReferenceFromWorkspaceReference,
  fileTreeCopyContentFromReadResult,
  fileTreeExternalImportPayload,
  fileTreeWorkspaceDropDecision,
  fileTreeWorkspaceDropDecisionForDrag,
  fileTreeWorkspaceDropDecisionFromDragData,
  fileTreeWorkspaceDropPayload,
  isPdfWorkspaceReference,
  renamedRelativePath,
  rewriteRenamedPath,
  shouldProcessInitialDirectory,
  workspaceChildPath
} from './ChatFileTreePanel'
import {
  WORKSPACE_REFERENCE_DRAG_MIME,
  workspaceReferenceDragPayload,
  writeWorkspaceReferenceDragData
} from '../../lib/workspace-reference-drag'

describe('ChatFileTreePanel helpers', () => {
  it('shows automatic naming only for PDF workspace references', () => {
    expect(isPdfWorkspaceReference({
      workspaceRoot: '/tmp/workspace',
      relativePath: 'papers/2603.10165v2.pdf',
      name: '2603.10165v2.pdf',
      kind: 'file'
    })).toBe(true)
    expect(isPdfWorkspaceReference({
      workspaceRoot: '/tmp/workspace',
      relativePath: 'notes/readme.md',
      name: 'readme.md',
      kind: 'text'
    })).toBe(false)
  })

  it('converts shared workspace references into composer references', () => {
    expect(composerReferenceFromWorkspaceReference({
      workspaceRoot: '/tmp/workspace',
      relativePath: 'src',
      name: 'src',
      kind: 'directory'
    })).toEqual({
      path: 'src',
      relativePath: 'src',
      name: 'src',
      workspaceRoot: '/tmp/workspace',
      kind: 'directory'
    })

    expect(composerReferenceFromWorkspaceReference({
      workspaceRoot: '/tmp/workspace',
      relativePath: 'assets/panel.png',
      name: 'panel.png',
      kind: 'image',
      mimeType: 'image/png',
      size: 128
    })).toEqual({
      path: 'assets/panel.png',
      relativePath: 'assets/panel.png',
      name: 'panel.png',
      workspaceRoot: '/tmp/workspace',
      kind: 'image',
      mimeType: 'image/png',
      modelRouterObject: true
    })
  })

  it('derives renamed workspace paths without moving entries between directories', () => {
    expect(renamedRelativePath('pdfs/old.pdf', 'new.pdf')).toBe('pdfs/new.pdf')
    expect(renamedRelativePath('old.pdf', 'new.pdf')).toBe('new.pdf')
  })

  it('builds normalized child paths for new workspace entries', () => {
    expect(workspaceChildPath('', 'notes/new.md')).toBe('notes/new.md')
    expect(workspaceChildPath('papers', '/drafts\\\\new.md')).toBe('papers/drafts/new.md')
    expect(workspaceChildPath('/workspace/project', 'assets')).toBe('/workspace/project/assets')
  })

  it('derives the containing folder target for file tree entries', () => {
    expect(containingFolderPath('texts/paper.pdf', '/workspace/project')).toBe('texts')
    expect(containingFolderPath('texts', '/workspace/project')).toBe('/workspace/project')
    expect(containingFolderPath('paper.pdf', '/workspace/project')).toBe('/workspace/project')
  })

  it('rewrites descendant paths when a directory is renamed', () => {
    expect(rewriteRenamedPath('pdfs/nested/file.pdf', 'pdfs', 'papers')).toBe('papers/nested/file.pdf')
    expect(rewriteRenamedPath('pdfs', 'pdfs', 'papers')).toBe('papers')
    expect(rewriteRenamedPath('pdfs-other/file.pdf', 'pdfs', 'papers')).toBe('pdfs-other/file.pdf')
  })

  it('processes initial directory requests only once per nonce', () => {
    const request = { workspaceRoot: '/workspace/project-a', path: 'src', nonce: 3 }

    expect(shouldProcessInitialDirectory(null, request)).toBe(true)
    expect(shouldProcessInitialDirectory(2, request)).toBe(true)
    expect(shouldProcessInitialDirectory(3, request)).toBe(false)
    expect(shouldProcessInitialDirectory(3, null)).toBe(false)
  })

  it('serializes workspace file references into shared drag source payloads', () => {
    const payload = workspaceReferenceDragPayload({
      workspaceRoot: '',
      relativePath: 'texts/paper.pdf',
      name: 'paper.pdf',
      kind: 'pdf',
      mimeType: 'application/pdf',
      size: 128
    }, '/workspace/project')

    expect(payload).toMatchObject({
      version: 1,
      workspaceRoot: '/workspace/project',
      reference: {
        workspaceRoot: '/workspace/project',
        relativePath: 'texts/paper.pdf',
        name: 'paper.pdf',
        kind: 'pdf'
      },
      source: {
        kind: 'workspace-file',
        path: 'texts/paper.pdf',
        displayName: 'paper.pdf',
        mimeType: 'application/pdf',
        size: 128,
        supportedActions: ['copy-path', 'attach-to-session']
      }
    })
  })

  it('writes workspace references to custom drag MIME data and text fallback', () => {
    const data: Record<string, string> = {}
    const transfer = {
      effectAllowed: '',
      setData: (format: string, value: string) => {
        data[format] = value
      }
    }

    const payload = writeWorkspaceReferenceDragData(transfer, {
      workspaceRoot: '/workspace/project',
      relativePath: 'results',
      name: 'results',
      kind: 'directory'
    }, '/fallback')

    expect(transfer.effectAllowed).toBe('copyMove')
    expect(payload.source).toMatchObject({
      kind: 'workspace-directory',
      path: 'results',
      displayName: 'results'
    })
    expect(JSON.parse(data[WORKSPACE_PREVIEW_DRAG_SOURCE_MIME])).toEqual(payload.source)
    expect(JSON.parse(data[WORKSPACE_REFERENCE_DRAG_MIME])).toEqual(payload)
    expect(data['text/plain']).toBe('results')
  })

  it('derives safe workspace tree drop decisions for move, copy, and invalid directory targets', () => {
    const source = {
      workspaceRoot: '/workspace/project',
      relativePath: 'texts/paper.pdf',
      name: 'paper.pdf',
      kind: 'pdf' as const
    }

    expect(fileTreeWorkspaceDropDecision({
      source,
      targetDirectory: 'archive',
      targetWorkspaceRoot: '/workspace/project'
    })).toEqual({
      action: 'move',
      sourcePath: 'texts/paper.pdf',
      sourceWorkspaceRoot: '/workspace/project',
      targetDirectory: 'archive',
      targetWorkspaceRoot: '/workspace/project'
    })
    expect(fileTreeWorkspaceDropDecision({
      source,
      targetDirectory: 'archive',
      targetWorkspaceRoot: '/workspace/project',
      copyRequested: true
    })?.action).toBe('copy')
    expect(fileTreeWorkspaceDropDecision({
      source,
      targetDirectory: 'archive',
      targetWorkspaceRoot: '/workspace/other'
    })?.action).toBe('copy')
    expect(fileTreeWorkspaceDropDecision({
      source,
      targetDirectory: 'texts',
      targetWorkspaceRoot: '/workspace/project'
    })).toBeNull()
    expect(fileTreeWorkspaceDropDecision({
      source: {
        workspaceRoot: '/workspace/project',
        relativePath: 'texts',
        name: 'texts',
        kind: 'directory'
      },
      targetDirectory: 'texts/nested',
      targetWorkspaceRoot: '/workspace/project'
    })).toBeNull()
    expect(fileTreeWorkspaceDropDecision({
      source: {
        workspaceRoot: '/workspace/project',
        relativePath: 'texts',
        name: 'texts',
        kind: 'directory'
      },
      targetDirectory: 'texts',
      targetWorkspaceRoot: '/workspace/project',
      copyRequested: true
    })).toBeNull()
  })

  it('derives workspace tree drop decisions from serialized drag data', () => {
    const data: Record<string, string> = {}
    writeWorkspaceReferenceDragData({
      setData: (format: string, value: string) => {
        data[format] = value
      }
    }, {
      workspaceRoot: '/workspace/project',
      relativePath: 'results/table.csv',
      name: 'table.csv',
      kind: 'text',
      mimeType: 'text/csv'
    }, '/fallback')

    expect(fileTreeWorkspaceDropDecisionFromDragData({
      types: [WORKSPACE_REFERENCE_DRAG_MIME],
      getData: (format) => data[format] ?? ''
    }, {
      targetDirectory: 'archive',
      targetWorkspaceRoot: '/workspace/project'
    })).toMatchObject({
      action: 'move',
      sourcePath: 'results/table.csv',
      targetDirectory: 'archive'
    })
  })

  it('uses the in-memory drag source while Chromium protects custom data during dragover', () => {
    expect(fileTreeWorkspaceDropDecisionForDrag({
      workspaceRoot: '/workspace/project',
      reference: {
        workspaceRoot: '/workspace/project',
        relativePath: 'source/test-move.txt',
        name: 'test-move.txt',
        kind: 'text'
      }
    }, {
      types: [WORKSPACE_REFERENCE_DRAG_MIME],
      getData: () => ''
    }, {
      targetDirectory: 'destination',
      targetWorkspaceRoot: '/workspace/project'
    })).toEqual({
      action: 'move',
      sourcePath: 'source/test-move.txt',
      sourceWorkspaceRoot: '/workspace/project',
      targetDirectory: 'destination',
      targetWorkspaceRoot: '/workspace/project'
    })
  })

  it('removes renderer-only action metadata before invoking strict workspace IPC', () => {
    expect(fileTreeWorkspaceDropPayload({
      action: 'move',
      sourcePath: 'source/test-move.txt',
      sourceWorkspaceRoot: '/workspace/project',
      targetDirectory: 'destination',
      targetWorkspaceRoot: '/workspace/project'
    })).toEqual({
      sourcePath: 'source/test-move.txt',
      sourceWorkspaceRoot: '/workspace/project',
      targetDirectory: 'destination',
      targetWorkspaceRoot: '/workspace/project'
    })
  })

  it('builds external file import payloads from dropped files', () => {
    const files = {
      length: 4,
      0: { name: 'a.csv' } as File,
      1: { name: 'b.csv' } as File,
      2: { name: 'duplicate.csv' } as File,
      3: { name: 'missing.txt' } as File
    }
    const paths = new Map<File, string>([
      [files[0], '/tmp/a.csv'],
      [files[1], '/tmp/b.csv'],
      [files[2], '/tmp/a.csv'],
      [files[3], '']
    ])

    expect(fileTreeExternalImportPayload({
      files,
      getPathForFile: (file) => paths.get(file) ?? '',
      targetDirectory: 'incoming/',
      targetWorkspaceRoot: ' /workspace/project '
    })).toEqual({
      sourcePaths: ['/tmp/a.csv', '/tmp/b.csv'],
      targetDirectory: 'incoming',
      targetWorkspaceRoot: '/workspace/project'
    })
    expect(fileTreeExternalImportPayload({
      files: { length: 1, 0: { name: 'missing.txt' } as File },
      getPathForFile: () => '',
      targetDirectory: '',
      targetWorkspaceRoot: '/workspace/project'
    })).toBeNull()
  })

  it('extracts copyable text content from supported workspace read results', () => {
    expect(fileTreeCopyContentFromReadResult({
      ok: true,
      kind: 'text',
      path: '/workspace/project/notes.txt',
      content: 'hello',
      mimeType: 'text/plain',
      size: 5,
      truncated: false
    })).toEqual({ ok: true, content: 'hello' })
    expect(fileTreeCopyContentFromReadResult({
      ok: true,
      kind: 'docx',
      path: '/workspace/project/report.docx',
      content: 'report text',
      paragraphs: [],
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 2048,
      truncated: false,
      mtimeMs: 1
    })).toEqual({ ok: true, content: 'report text' })
  })

  it('rejects unsupported or unsafe file tree copy content results', () => {
    expect(fileTreeCopyContentFromReadResult({
      ok: true,
      kind: 'text',
      path: '/workspace/project/large.log',
      content: 'partial',
      mimeType: 'text/plain',
      size: 2_000_000,
      truncated: true
    })).toEqual({ ok: false, reason: 'truncated' })
    expect(fileTreeCopyContentFromReadResult({
      ok: true,
      kind: 'pdf',
      path: '/workspace/project/paper.pdf',
      content: '',
      dataBase64: '',
      mimeType: 'application/pdf',
      size: 1024,
      truncated: false,
      mtimeMs: 1
    })).toEqual({ ok: false, reason: 'unsupported' })
    expect(fileTreeCopyContentFromReadResult({
      ok: false,
      message: 'Cannot preview a directory.'
    })).toEqual({ ok: false, reason: 'read-error', message: 'Cannot preview a directory.' })
  })
})
