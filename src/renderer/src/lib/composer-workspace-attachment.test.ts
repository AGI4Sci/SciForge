import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileWritePayload } from '@shared/workspace-file'

import { importComposerWorkspaceAttachment } from './composer-workspace-attachment'

function successfulWrite(_payload: WorkspaceFileWritePayload) {
  return Promise.resolve({
    ok: true as const,
    path: '/workspace/.sciforge/uploads/imported',
    savedAt: '2026-08-24T00:00:00.000Z',
    revision: 'revision-1'
  })
}

describe('composer workspace attachment import', () => {
  it('copies an external HTML file byte-for-byte and returns a text reference', async () => {
    const writeWorkspaceFile = vi.fn(successfulWrite)
    const file = new File(['<!doctype html><title>SciForge</title>'], 'paper.html', { type: 'text/html' })

    const reference = await importComposerWorkspaceAttachment({ file, path: '/tmp/paper.html' }, {
      workspaceRoot: '/workspace',
      threadId: 'thread-1',
      writeWorkspaceFile
    })

    expect(writeWorkspaceFile).toHaveBeenCalledOnce()
    expect(writeWorkspaceFile.mock.calls[0]?.[0]).toMatchObject({
      workspaceRoot: '/workspace',
      contentBase64: btoa('<!doctype html><title>SciForge</title>')
    })
    expect(reference).toMatchObject({
      name: 'paper.html',
      workspaceRoot: '/workspace',
      kind: 'text',
      mimeType: 'text/html'
    })
    expect(reference.relativePath).toMatch(/^\.sciforge\/uploads\/thread-1\/.+-paper\.html$/u)
  })

  it('preserves MHTML archive bytes and returns an ordinary file reference', async () => {
    const writeWorkspaceFile = vi.fn(successfulWrite)
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255])
    const file = new File([bytes], 'saved-page.mhtml', { type: 'multipart/related' })

    const reference = await importComposerWorkspaceAttachment({ file }, {
      workspaceRoot: '/workspace',
      threadId: null,
      writeWorkspaceFile
    })

    const payload = writeWorkspaceFile.mock.calls[0]?.[0]
    expect(payload?.content).toBeUndefined()
    expect(payload?.contentBase64).toBe(btoa(String.fromCharCode(...bytes)))
    expect(reference).toMatchObject({
      name: 'saved-page.mhtml',
      kind: 'file',
      mimeType: 'multipart/related'
    })
  })

  it('references a supported file already inside the workspace without copying it', async () => {
    const writeWorkspaceFile = vi.fn(successfulWrite)
    const file = new File(['<html></html>'], 'notes.htm', { type: 'text/html' })

    const reference = await importComposerWorkspaceAttachment({
      file,
      path: '/workspace/references/notes.htm'
    }, {
      workspaceRoot: '/workspace',
      threadId: 'thread-1',
      writeWorkspaceFile
    })

    expect(writeWorkspaceFile).not.toHaveBeenCalled()
    expect(reference).toEqual({
      path: 'references/notes.htm',
      relativePath: 'references/notes.htm',
      name: 'notes.htm',
      workspaceRoot: '/workspace',
      kind: 'text',
      mimeType: 'text/html'
    })
  })
})
