import { describe, expect, it, vi } from 'vitest'
import { importDomainWorkspaceAttachments } from './domain-workspace-attachments'
import { disposeSessionRightPanelWorkspace } from './session-right-panel-lifecycle'

const request = { runtimeId: 'codex', threadId: 'owned-session' }
const ownedThread = { id: 'owned-session', runtimeId: 'codex', workspace: '/workspace/owned' } as const
const successfulWrite = async () => ({ ok: true as const, path: '/workspace/owned/imported', savedAt: 'now', revision: '1' })

describe('generic Session workspace attachment import', () => {
  it('derives the exact Session directory and returns byte metadata without sending or changing context', async () => {
    const writeWorkspaceFile = vi.fn(successfulWrite)
    const bytes = new Uint8Array([0, 255, 13, 10])
    const files = [new File([bytes], 'dataset.parquet', { type: 'application/octet-stream' })]
    const imported = await importDomainWorkspaceAttachments({ ...request, files }, {
      getThreads: () => [ownedThread, { id: 'active-other', runtimeId: 'codex', workspace: '/workspace/other' }],
      writeWorkspaceFile
    })
    expect(imported).toMatchObject([{ name: 'dataset.parquet', byteCount: 4, mediaType: 'application/vnd.apache.parquet' }])
    expect(imported[0]!.relativePath).toMatch(/^\.sciforge\/uploads\/owned-session\//)
    expect(writeWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: '/workspace/owned', contentBase64: btoa(String.fromCharCode(...bytes)) }))
    expect(imported[0]).not.toHaveProperty('workspaceRoot')
    expect(imported[0]).not.toHaveProperty('content')
  })

  it.each([
    { threads: [] }, { threads: [{ ...ownedThread, runtimeId: 'claude' as const }] },
    { threads: [{ ...ownedThread, archived: true }] }, { threads: [{ ...ownedThread, workspace: '' }] }
  ])('refuses a missing, foreign or archived Session', async ({ threads }) => {
    const writeWorkspaceFile = vi.fn(successfulWrite)
    await expect(importDomainWorkspaceAttachments({ ...request, files: [new File(['a'], 'data.csv')] }, {
      getThreads: () => threads, writeWorkspaceFile
    })).rejects.toThrow('exact local Session')
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
  })

  it('does not bypass remote workspace transport limits through the local import path', async () => {
    const writeWorkspaceFile = vi.fn(successfulWrite)
    await expect(importDomainWorkspaceAttachments({ ...request, files: [new File(['data'], 'data.csv')] }, {
      getThreads: () => [{ ...ownedThread, workspaceLocator: {
        contractVersion: 1, hostSessionId: 'remote-session', path: '/workspace/owned'
      } }],
      writeWorkspaceFile
    })).rejects.toThrow('exact local Session')
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
  })

  it('does not write bytes after the Session is disposed while reading a file', async () => {
    const file = new File(['data'], 'dataset.csv')
    let resolveRead!: (value: ArrayBuffer) => void
    const read = { promise: new Promise<ArrayBuffer>(resolve => { resolveRead = resolve }) }
    vi.spyOn(file, 'arrayBuffer').mockReturnValue(read.promise)
    const writeWorkspaceFile = vi.fn(successfulWrite)
    const pending = importDomainWorkspaceAttachments({ ...request, files: [file] }, {
      getThreads: () => [ownedThread], writeWorkspaceFile
    })
    disposeSessionRightPanelWorkspace('owned-session')
    resolveRead(new TextEncoder().encode('data').buffer)
    await expect(pending).rejects.toThrow('workspace changed')
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
  })

  it('does not write bytes when the exact Session root changes during import', async () => {
    const file = new File(['data'], 'dataset.csv')
    let workspace: string = ownedThread.workspace
    vi.spyOn(file, 'arrayBuffer').mockImplementation(async () => {
      workspace = '/workspace/replaced'
      return new TextEncoder().encode('data').buffer
    })
    const writeWorkspaceFile = vi.fn(successfulWrite)
    await expect(importDomainWorkspaceAttachments({ ...request, files: [file] }, {
      getThreads: () => [{ ...ownedThread, workspace }], writeWorkspaceFile
    })).rejects.toThrow('workspace changed')
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
  })
})
