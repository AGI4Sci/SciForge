import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import { useChatStore } from '../store/chat-store'
import { useWriteWorkspaceStore } from './write-workspace-store'

const REMOTE_LOCATOR: WorkspaceLocator = {
  contractVersion: 1,
  hostSessionId: 'remote-session-1',
  path: '/cluster/write'
}

function installSciForge(overrides: Partial<Window['sciforge']>): void {
  vi.stubGlobal('window', {
    sciforge: overrides
  })
}

function activateTextFile(path = '/tmp/write/draft.md'): void {
  useWriteWorkspaceStore.setState({
    activeFilePath: path,
    activeFileKind: 'text',
    fileContent: 'old content',
    fileError: null,
    fileLoading: false,
    saveStatus: 'saved'
  })
}

afterEach(() => {
  useWriteWorkspaceStore.getState().resetWorkspace()
  useChatStore.setState({ workspaceLocator: null })
  vi.unstubAllGlobals()
})

describe('write workspace store', () => {
  it('reports read errors when syncing the active text file from disk', async () => {
    installSciForge({
      readWorkspaceFile: vi.fn(async () => {
        throw new Error('read failed')
      })
    })
    activateTextFile()

    const result = await useWriteWorkspaceStore.getState().syncActiveFileFromDisk('/tmp/write')

    expect(result).toBe(false)
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileError: 'read failed',
      saveStatus: 'error'
    })
  })

  it('does not apply late read errors after the active text file changes', async () => {
    installSciForge({
      readWorkspaceFile: vi.fn(async () => {
        useWriteWorkspaceStore.setState({ activeFilePath: '/tmp/write/next.md' })
        throw new Error('late read failed')
      })
    })
    activateTextFile()

    const result = await useWriteWorkspaceStore.getState().syncActiveFileFromDisk('/tmp/write')

    expect(result).toBe(false)
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      activeFilePath: '/tmp/write/next.md',
      fileError: null,
      saveStatus: 'saved'
    })
  })

  it('stores read revisions and advances them after a guarded save', async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      kind: 'text' as const,
      path: '/cluster/write/draft.md',
      content: 'remote content',
      mimeType: 'text/markdown',
      size: 14,
      truncated: false,
      revision: 'revision-1'
    }))
    const writeWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      path: '/cluster/write/draft.md',
      savedAt: '2026-07-30T00:00:00.000Z',
      revision: 'revision-2'
    }))
    installSciForge({ readWorkspaceFile, writeWorkspaceFile })
    useChatStore.setState({ workspaceLocator: REMOTE_LOCATOR })
    useWriteWorkspaceStore.setState({
      workspaceRoot: REMOTE_LOCATOR.path,
      pinnedWorkspaceLocator: REMOTE_LOCATOR
    })
    activateTextFile('/cluster/write/draft.md')

    await expect(
      useWriteWorkspaceStore.getState().syncActiveFileFromDisk(
        REMOTE_LOCATOR.path,
        { animate: false }
      )
    ).resolves.toBe(true)
    expect(useWriteWorkspaceStore.getState().fileRevision).toBe('revision-1')

    useWriteWorkspaceStore.getState().setFileContent('edited content')
    await expect(
      useWriteWorkspaceStore.getState().flushSave(REMOTE_LOCATOR.path)
    ).resolves.toBe(true)

    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      path: '/cluster/write/draft.md',
      workspaceRoot: '/cluster/write',
      content: 'edited content',
      expectedRevision: 'revision-1',
      workspaceLocator: REMOTE_LOCATOR
    })
    expect(useWriteWorkspaceStore.getState().fileRevision).toBe('revision-2')
  })

  it('refuses to save when the active session no longer owns the pinned path', async () => {
    const writeWorkspaceFile = vi.fn()
    installSciForge({ writeWorkspaceFile })
    useChatStore.setState({
      workspaceLocator: { ...REMOTE_LOCATOR, hostSessionId: 'remote-session-2' }
    })
    useWriteWorkspaceStore.setState({
      workspaceRoot: REMOTE_LOCATOR.path,
      pinnedWorkspaceLocator: REMOTE_LOCATOR,
      fileRevision: 'revision-1'
    })
    activateTextFile('/cluster/write/draft.md')
    useWriteWorkspaceStore.getState().setFileContent('must not be misrouted')

    await expect(
      useWriteWorkspaceStore.getState().flushSave(REMOTE_LOCATOR.path)
    ).resolves.toBe(false)

    expect(writeWorkspaceFile).not.toHaveBeenCalled()
    expect(useWriteWorkspaceStore.getState().fileError).toContain('session changed')
  })
})
