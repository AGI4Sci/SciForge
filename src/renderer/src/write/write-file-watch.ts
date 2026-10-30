import type {
  WorkspaceFileChangePayload,
  WorkspaceFileWatchPayload,
  WorkspaceFileWatchResult
} from '@shared/workspace-file'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import {
  assertPinnedWorkspaceLocator,
  pinWorkspaceLocator,
  withPinnedWorkspaceLocator
} from '../remote-workspace/placement'

type WriteFileWatchApi = {
  watchWorkspaceFile: (payload: WorkspaceFileWatchPayload) => Promise<WorkspaceFileWatchResult>
  unwatchWorkspaceFile: (watchId: string) => Promise<boolean>
  onWorkspaceFileChanged: (handler: (payload: WorkspaceFileChangePayload) => void) => () => void
}

type TextSnapshot = {
  path: string
  content?: string
  size?: number
  truncated?: boolean
  revision?: string
  message?: string
  animate: boolean
}

type StartWriteFileWatchOptions = {
  api: WriteFileWatchApi
  workspaceRoot: string
  path: string
  kind: 'text' | 'image'
  workspaceLocator?: WorkspaceLocator | null
  onTextSnapshot: (snapshot: TextSnapshot) => void
  onImageChanged: (path: string) => void
  onError: (message: string) => void
}

export function startWriteWorkspaceFileWatch(options: StartWriteFileWatchOptions): () => void {
  let cancelled = false
  let watchId = ''
  const pinnedWorkspaceLocator =
    options.workspaceLocator === undefined
      ? pinWorkspaceLocator(options.workspaceRoot)
      : options.workspaceLocator

  const unwatch = (id: string): void => {
    void options.api.unwatchWorkspaceFile(id).catch(() => undefined)
  }

  const handleTextSnapshot = (snapshot: Omit<TextSnapshot, 'animate'> & { animate?: boolean }): void => {
    options.onTextSnapshot({
      ...snapshot,
      animate: snapshot.animate ?? true
    })
  }

  const offChanged = options.api.onWorkspaceFileChanged((payload) => {
    if (!watchId || payload.watchId !== watchId) return
    try {
      assertPinnedWorkspaceLocator(options.workspaceRoot, pinnedWorkspaceLocator)
    } catch (error) {
      options.onError(error instanceof Error ? error.message : String(error))
      return
    }
    if (options.kind === 'image') {
      options.onImageChanged(payload.path)
      return
    }
    if (payload.ok) {
      handleTextSnapshot({
        path: payload.path,
        content: payload.content,
        size: payload.size,
        truncated: payload.truncated,
        revision: payload.revision,
        animate: true
      })
      return
    }
    handleTextSnapshot({
      path: payload.path,
      message: payload.message,
      animate: false
    })
  })

  let watchPayload: WorkspaceFileWatchPayload
  try {
    watchPayload = withPinnedWorkspaceLocator(
      {
        path: options.path,
        workspaceRoot: options.workspaceRoot
      },
      pinnedWorkspaceLocator
    )
  } catch (error) {
    offChanged()
    options.onError(error instanceof Error ? error.message : String(error))
    return () => undefined
  }

  void options.api.watchWorkspaceFile(watchPayload).then((result) => {
    if (cancelled) {
      if (result.ok) unwatch(result.watchId)
      return
    }
    try {
      assertPinnedWorkspaceLocator(options.workspaceRoot, pinnedWorkspaceLocator)
    } catch (error) {
      if (result.ok) unwatch(result.watchId)
      options.onError(error instanceof Error ? error.message : String(error))
      return
    }
    if (!result.ok) {
      options.onError(result.message)
      return
    }
    watchId = result.watchId
    if (options.kind === 'image') {
      options.onImageChanged(result.path)
      return
    }
    handleTextSnapshot({
      path: result.path,
      content: result.content,
      size: result.size,
      truncated: result.truncated,
      revision: result.revision,
      animate: false
    })
  }).catch((error) => {
    if (!cancelled) {
      options.onError(error instanceof Error ? error.message : String(error))
    }
  })

  return () => {
    cancelled = true
    offChanged()
    if (watchId) unwatch(watchId)
  }
}
