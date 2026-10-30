import { workspaceAttachmentSessionDirectory } from '@sciforge/domain-sdk/attachment-policy'
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

  it('keeps the .pdf extension when a very long imported file name is truncated', async () => {
    const writeWorkspaceFile = vi.fn(successfulWrite)
    const longName =
      '20260921T025827-5eac5298-3-JC-2 Treg-microglia_partnership_in_the_injured_spinal_cord_preserves_Treg_cell.pdf'
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], longName, { type: 'application/pdf' })

    const reference = await importComposerWorkspaceAttachment({ file }, {
      workspaceRoot: '/workspace',
      threadId: 'thread-1',
      writeWorkspaceFile
    })

    expect(reference.name.length).toBeGreaterThan(0)
    expect(reference.name).toMatch(/\.pdf$/u)
    expect(reference.relativePath).toMatch(/\.pdf$/u)
  })

  it('imports a PNG figure into the workspace with an image reference', async () => {
    const writeWorkspaceFile = vi.fn(successfulWrite)
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'figure.png', { type: 'image/png' })

    const reference = await importComposerWorkspaceAttachment({ file, path: '/tmp/figure.png' }, {
      workspaceRoot: '/workspace',
      threadId: 'thread-1',
      writeWorkspaceFile
    })

    expect(reference).toMatchObject({
      name: 'figure.png',
      workspaceRoot: '/workspace',
      kind: 'image',
      mimeType: 'image/png'
    })
    expect(reference.relativePath).toMatch(/^\.sciforge\/uploads\/thread-1\/.+figure\.png$/u)
  })
  it.each(['csv', 'tsv', 'json', 'xlsx', 'parquet', 'fasta'])(
    'copies %s data as original bytes without decoding text or adding model context', async (extension) => {
      const writeWorkspaceFile = vi.fn(successfulWrite)
      const bytes = new Uint8Array([0, 255, 128, 13, 10, 65])
      const file = new File([bytes], `data.${extension}`, { type: 'application/octet-stream' })
      const text = vi.spyOn(file, 'text')
      const reference = await importComposerWorkspaceAttachment({ file }, {
        workspaceRoot: '/workspace', threadId: 'thread-1', writeWorkspaceFile
      })
      expect(text).not.toHaveBeenCalled()
      const payload = writeWorkspaceFile.mock.calls[0]![0]
      expect(payload.content).toBeUndefined()
      expect(Uint8Array.from(atob(payload.contentBase64!), char => char.charCodeAt(0))).toEqual(bytes)
      expect(reference).not.toHaveProperty('content')
      expect(reference).not.toHaveProperty('textFallback')
      expect(reference.kind).toBeUndefined()
    }
  )

  it('rejects scientific files above 100 MiB before reading bytes, including existing workspace files', async () => {
    const file = new File(['data'], 'data.csv')
    Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 + 1 })
    const read = vi.spyOn(file, 'arrayBuffer')
    const writeWorkspaceFile = vi.fn(successfulWrite)
    await expect(importComposerWorkspaceAttachment({ file, path: '/workspace/data.csv' }, {
      workspaceRoot: '/workspace', threadId: 'thread-1', writeWorkspaceFile
    })).rejects.toThrow('104857600')
    expect(read).not.toHaveBeenCalled()
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
  })

  it.each([
    ['paper.pdf', 'application/pdf', 64 * 1024 * 1024],
    ['figure.png', 'image/png', 32 * 1024 * 1024],
    ['page.html', 'text/html', 64 * 1024 * 1024]
  ])('preserves the existing %s limit before reading content', async (name, type, limit) => {
    const file = new File(['data'], name, { type })
    Object.defineProperty(file, 'size', { value: limit + 1 })
    const read = vi.spyOn(file, 'arrayBuffer')
    const writeWorkspaceFile = vi.fn(successfulWrite)
    await expect(importComposerWorkspaceAttachment({ file }, {
      workspaceRoot: '/workspace', threadId: 'thread-1', writeWorkspaceFile
    })).rejects.toThrow(String(limit))
    expect(read).not.toHaveBeenCalled()
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
  })

  it('preserves Unicode scientific file names and their extension within the safe byte limit', async () => {
    const writeWorkspaceFile = vi.fn(successfulWrite)
    const file = new File(['a,b'], `${'实验数据'.repeat(30)}.csv`)
    const reference = await importComposerWorkspaceAttachment({ file }, {
      workspaceRoot: '/workspace', threadId: 'thread-1', writeWorkspaceFile
    })
    expect(reference.name).toMatch(/^实验数据.*\.csv$/u)
    expect(new TextEncoder().encode(reference.name).byteLength).toBeLessThanOrEqual(80)
    expect(reference.relativePath).toContain(reference.name)
  })

  it.each([
    ['  provider:workspace/session  ', '.sciforge/uploads/provider_workspace_session'],
    ['session-'.repeat(20), `.sciforge/uploads/${'session-'.repeat(20).slice(0, 80)}`]
  ])('writes %s attachments under the shared exact Session directory', async (threadId, expectedDirectory) => {
    const writeWorkspaceFile = vi.fn(successfulWrite)
    const file = new File(['a,b'], '数据.csv')
    const reference = await importComposerWorkspaceAttachment({ file }, {
      workspaceRoot: '/workspace', threadId, writeWorkspaceFile
    })
    expect(workspaceAttachmentSessionDirectory(threadId)).toBe(expectedDirectory)
    expect(reference.relativePath.slice(0, reference.relativePath.lastIndexOf('/'))).toBe(expectedDirectory)
    expect(writeWorkspaceFile.mock.calls[0]![0].path).toBe(reference.relativePath)
    expect(reference.name).toBe('数据.csv')
  })

  it.each(['.', '..', ' _.._ '])('rejects unsafe reserved Session owner %s before reading or writing bytes', async threadId => {
    const file = new File(['a,b'], 'data.csv')
    const read = vi.spyOn(file, 'arrayBuffer')
    const writeWorkspaceFile = vi.fn(successfulWrite)
    await expect(importComposerWorkspaceAttachment({ file }, {
      workspaceRoot: '/workspace', threadId, writeWorkspaceFile
    })).rejects.toThrow('safe directory')
    expect(read).not.toHaveBeenCalled()
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
  })

})
