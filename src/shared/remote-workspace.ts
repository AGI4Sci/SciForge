import type {
  WorkspaceHostLifecycleMode,
  WorkspaceHostResume,
  WorkspaceLocator,
  WorkspaceNetworkEgressSelection
} from '@sciforge/domain-sdk/workspace-host'

export type RemoteWorkspaceViewPhase =
  | 'ready'
  | 'reconnecting'
  | 'offline'
  | 'degraded'
  | 'error'

export type RemoteWorkspaceEgressRouteView = Readonly<{
  id: string
  displayLabel: string
  kind: WorkspaceNetworkEgressSelection['mode']
  available: boolean
}>

export type RemoteWorkspaceViewSummary = Readonly<{
  /** Opaque attached Workspace Host session identity. */
  workspaceHostId: string
  locator: WorkspaceLocator
  displayLabel: string
  workspacePathLabel: string
  lifecycleMode: WorkspaceHostLifecycleMode
  phase: RemoteWorkspaceViewPhase
  reconnectAttempt?: number
  statusDetail?: string
  egressRoutes: readonly RemoteWorkspaceEgressRouteView[]
  selectedEgressRouteId: string
  capabilities: Readonly<{
    files: boolean
    terminal: boolean
    git: boolean
    runtime: boolean
    scientificPreview: boolean
  }>
}>

export type RemoteWorkspaceViewSnapshot = Readonly<{
  activeWorkspaceHostId?: string
  workspaces: readonly RemoteWorkspaceViewSummary[]
  updatedAt: string
}>

/**
 * The owning domain obtains this identity from a governed capability before
 * crossing the generic renderer-host boundary.
 */
export type RemoteWorkspaceAttachInput = Readonly<{
  providerId: string
  authorizedSessionId: string
  resume?: WorkspaceHostResume
}>

export type RemoteWorkspaceSessionInput = Readonly<{
  sessionId: string
}>

export type RemoteWorkspaceSelectInput = Readonly<{
  sessionId: string | null
}>

export type RemoteWorkspaceApi = Readonly<{
  list(): Promise<readonly RemoteWorkspaceViewSummary[]>
  get(): Promise<RemoteWorkspaceViewSnapshot>
  attach(input: RemoteWorkspaceAttachInput): Promise<RemoteWorkspaceViewSnapshot>
  select(input: RemoteWorkspaceSelectInput): Promise<RemoteWorkspaceViewSnapshot>
  reconnect(input: RemoteWorkspaceSessionInput): Promise<RemoteWorkspaceViewSnapshot>
  close(input: RemoteWorkspaceSessionInput): Promise<RemoteWorkspaceViewSnapshot>
  onSnapshotChanged(
    listener: (snapshot: RemoteWorkspaceViewSnapshot) => void
  ): () => void
}>
