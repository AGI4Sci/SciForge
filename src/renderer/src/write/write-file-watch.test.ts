import { describe, expect, it, vi } from 'vitest'
import type {
  WorkspaceFileChangePayload,
  WorkspaceFileWatchResult
} from '@shared/workspace-file'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import { useChatStore } from '../store/chat-store'
import { startWriteWorkspaceFileWatch } from './write-file-watch'

const REMOTE_LOCATOR: WorkspaceLocator = {
  contractVersion: 1,
  hostSessionId: 'remote-session-1',
  path: '/cluster/write'
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function createApi(result: WorkspaceFileWatchResult | Promise<WorkspaceFileWatchResult>) {
  let handler: ((payload: WorkspaceFileChangePayload) => void) | null = null
  const off = vi.fn()
  const api = {
    watchWorkspaceFile: vi.fn(async () => result),
    unwatchWorkspaceFile: vi.fn(async () => true),
    onWorkspaceFileChanged: vi.fn((nextHandler: (payload: WorkspaceFileChangePayload) => void) => {
      handler = nextHandler
      return off
    })
  }
  return {
    api,
    emit: (payload: WorkspaceFileChangePayload) => handler?.(payload),
    off
  }
}

describe('write file watch helper', () => {
  it('applies the initial text snapshot returned by the watcher', async () => {
    const { api } = createApi({
      ok: true,
      watchId: 'watch-1',
      path: '/tmp/app/draft.md',
      content: 'fresh content',
      size: 13,
      truncated: false,
      revision: 'revision-1',
      startedAt: '2026-01-01T00:00:00.000Z'
    })
    const onTextSnapshot = vi.fn()

    startWriteWorkspaceFileWatch({
      api,
      workspaceRoot: '/tmp/app',
      path: '/tmp/app/draft.md',
      kind: 'text',
      onTextSnapshot,
      onImageChanged: vi.fn(),
      onError: vi.fn()
    })
    await flushPromises()

    expect(onTextSnapshot).toHaveBeenCalledWith({
      path: '/tmp/app/draft.md',
      content: 'fresh content',
      size: 13,
      truncated: false,
      revision: 'revision-1',
      animate: false
    })
  })

  it('reports watcher start failures', async () => {
    const { api } = createApi({ ok: false, message: 'cannot watch file' })
    const onError = vi.fn()

    startWriteWorkspaceFileWatch({
      api,
      workspaceRoot: '/tmp/app',
      path: '/tmp/app/draft.md',
      kind: 'text',
      onTextSnapshot: vi.fn(),
      onImageChanged: vi.fn(),
      onError
    })
    await flushPromises()

    expect(onError).toHaveBeenCalledWith('cannot watch file')
  })

  it('routes matching text change events and ignores other watches', async () => {
    const { api, emit } = createApi({
      ok: true,
      watchId: 'watch-1',
      path: '/tmp/app/draft.md',
      content: 'initial',
      size: 7,
      truncated: false,
      revision: 'revision-1',
      startedAt: '2026-01-01T00:00:00.000Z'
    })
    const onTextSnapshot = vi.fn()

    startWriteWorkspaceFileWatch({
      api,
      workspaceRoot: '/tmp/app',
      path: '/tmp/app/draft.md',
      kind: 'text',
      onTextSnapshot,
      onImageChanged: vi.fn(),
      onError: vi.fn()
    })
    await flushPromises()
    onTextSnapshot.mockClear()

    emit({
      ok: true,
      watchId: 'watch-other',
      workspaceRoot: '/tmp/app',
      path: '/tmp/app/draft.md',
      content: 'ignored',
      size: 7,
      truncated: false,
      revision: 'revision-other',
      changedAt: '2026-01-01T00:00:01.000Z'
    })
    emit({
      ok: true,
      watchId: 'watch-1',
      workspaceRoot: '/tmp/app',
      path: '/tmp/app/draft.md',
      content: 'changed',
      size: 7,
      truncated: false,
      revision: 'revision-2',
      changedAt: '2026-01-01T00:00:02.000Z'
    })
    emit({
      ok: false,
      watchId: 'watch-1',
      workspaceRoot: '/tmp/app',
      path: '/tmp/app/draft.md',
      message: 'read failed',
      changedAt: '2026-01-01T00:00:03.000Z'
    })

    expect(onTextSnapshot).toHaveBeenCalledTimes(2)
    expect(onTextSnapshot).toHaveBeenNthCalledWith(1, {
      path: '/tmp/app/draft.md',
      content: 'changed',
      size: 7,
      truncated: false,
      revision: 'revision-2',
      animate: true
    })
    expect(onTextSnapshot).toHaveBeenNthCalledWith(2, {
      path: '/tmp/app/draft.md',
      message: 'read failed',
      animate: false
    })
  })

  it('unwatches delayed starts after disposal without applying snapshots', async () => {
    const delayed = deferred<WorkspaceFileWatchResult>()
    const { api, off } = createApi(delayed.promise)
    const onTextSnapshot = vi.fn()

    const dispose = startWriteWorkspaceFileWatch({
      api,
      workspaceRoot: '/tmp/app',
      path: '/tmp/app/draft.md',
      kind: 'text',
      onTextSnapshot,
      onImageChanged: vi.fn(),
      onError: vi.fn()
    })
    dispose()
    delayed.resolve({
      ok: true,
      watchId: 'watch-late',
      path: '/tmp/app/draft.md',
      content: 'late',
      size: 4,
      truncated: false,
      revision: 'revision-late',
      startedAt: '2026-01-01T00:00:00.000Z'
    })
    await flushPromises()

    expect(off).toHaveBeenCalled()
    expect(api.unwatchWorkspaceFile).toHaveBeenCalledWith('watch-late')
    expect(onTextSnapshot).not.toHaveBeenCalled()
  })

  it('pins watch placement and rejects events after a same-path session switch', async () => {
    useChatStore.setState({ workspaceLocator: REMOTE_LOCATOR })
    const { api, emit } = createApi({
      ok: true,
      watchId: 'watch-remote',
      path: '/cluster/write/draft.md',
      content: 'initial',
      size: 7,
      truncated: false,
      revision: 'revision-1',
      startedAt: '2026-07-30T00:00:00.000Z'
    })
    const onTextSnapshot = vi.fn()
    const onError = vi.fn()

    startWriteWorkspaceFileWatch({
      api,
      workspaceRoot: REMOTE_LOCATOR.path,
      path: '/cluster/write/draft.md',
      kind: 'text',
      onTextSnapshot,
      onImageChanged: vi.fn(),
      onError
    })
    await flushPromises()

    expect(api.watchWorkspaceFile).toHaveBeenCalledWith({
      workspaceRoot: '/cluster/write',
      path: '/cluster/write/draft.md',
      workspaceLocator: REMOTE_LOCATOR
    })
    expect(onTextSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 'revision-1' })
    )
    onTextSnapshot.mockClear()
    useChatStore.setState({
      workspaceLocator: { ...REMOTE_LOCATOR, hostSessionId: 'remote-session-2' }
    })
    emit({
      ok: true,
      watchId: 'watch-remote',
      workspaceRoot: REMOTE_LOCATOR.path,
      path: '/cluster/write/draft.md',
      content: 'wrong session',
      size: 13,
      truncated: false,
      revision: 'revision-2',
      changedAt: '2026-07-30T00:00:01.000Z'
    })

    expect(onTextSnapshot).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('session changed'))
    useChatStore.setState({ workspaceLocator: null })
  })
})
