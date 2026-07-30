import type { RemoteWorkspaceApi } from '@shared/remote-workspace'

export type RemoteWorkspaceClient = Pick<
  RemoteWorkspaceApi,
  'list' | 'get' | 'select' | 'reconnect' | 'onSnapshotChanged'
> & Readonly<{
  /** False only when the preload bridge is unavailable in the current host. */
  supported?: boolean
}>

export type {
  RemoteWorkspaceEgressRouteView,
  RemoteWorkspaceViewPhase,
  RemoteWorkspaceViewSnapshot,
  RemoteWorkspaceViewSummary
} from '@shared/remote-workspace'
