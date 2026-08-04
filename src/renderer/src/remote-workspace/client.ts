import type {
  RemoteWorkspaceApi,
  RemoteWorkspaceSelectInput,
  RemoteWorkspaceSessionInput
} from '@shared/remote-workspace'
import type {
  RemoteWorkspaceClient,
  RemoteWorkspaceViewSnapshot
} from './types'

type SciForgeWithRemoteWorkspace = Window['sciforge'] & {
  remoteWorkspace?: RemoteWorkspaceApi
}

const EMPTY_SNAPSHOT: RemoteWorkspaceViewSnapshot = {
  workspaces: [],
  updatedAt: new Date(0).toISOString()
}

function remoteWorkspaceBridge(): RemoteWorkspaceApi | undefined {
  if (typeof window === 'undefined') return undefined
  return (window.sciforge as SciForgeWithRemoteWorkspace).remoteWorkspace
}

/**
 * Thin renderer adapter for the attached Workspace Host session IPC surface.
 */
export class BrowserRemoteWorkspaceClient implements RemoteWorkspaceClient {
  get supported(): boolean {
    const bridge = remoteWorkspaceBridge()
    return Boolean(
      bridge &&
      typeof bridge.list === 'function' &&
      typeof bridge.get === 'function' &&
      typeof bridge.select === 'function' &&
      typeof bridge.reconnect === 'function' &&
      typeof bridge.onSnapshotChanged === 'function'
    )
  }

  async list(): Promise<RemoteWorkspaceViewSnapshot['workspaces']> {
    return remoteWorkspaceBridge()?.list() ?? []
  }

  async get(): Promise<RemoteWorkspaceViewSnapshot> {
    return remoteWorkspaceBridge()?.get() ?? EMPTY_SNAPSHOT
  }

  select(input: RemoteWorkspaceSelectInput): Promise<RemoteWorkspaceViewSnapshot> {
    return remoteWorkspaceBridge()?.select(input) ?? Promise.resolve(EMPTY_SNAPSHOT)
  }

  reconnect(input: RemoteWorkspaceSessionInput): Promise<RemoteWorkspaceViewSnapshot> {
    return remoteWorkspaceBridge()?.reconnect(input) ?? Promise.resolve(EMPTY_SNAPSHOT)
  }

  onSnapshotChanged(listener: (snapshot: RemoteWorkspaceViewSnapshot) => void): () => void {
    return remoteWorkspaceBridge()?.onSnapshotChanged(listener) ?? (() => undefined)
  }
}

export const rendererRemoteWorkspaceClient = new BrowserRemoteWorkspaceClient()
