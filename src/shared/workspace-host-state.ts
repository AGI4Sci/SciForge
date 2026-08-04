import type {
  WorkspaceHostFailure,
  WorkspaceHostSession,
  WorkspaceLocator
} from '@sciforge/domain-sdk/workspace-host'

export const WORKSPACE_HOST_CONNECTION_PHASES = [
  'attaching',
  'connected',
  'reconnecting',
  'replay-required',
  'failed',
  'closed'
] as const

export type WorkspaceHostConnectionPhase =
  typeof WORKSPACE_HOST_CONNECTION_PHASES[number]

/**
 * Serializable, renderer-safe state for one attached Workspace Host.
 *
 * Provider authorization identities and transport details intentionally do not
 * cross this boundary. Human-facing target labels are supplied separately by
 * the owning domain package.
 */
export type WorkspaceHostConnectionSnapshot = Readonly<{
  providerId: string
  ownerId: string
  ownerDisplayName: string
  locator: WorkspaceLocator
  session: WorkspaceHostSession
  phase: WorkspaceHostConnectionPhase
  lastAcknowledgedSequence: number
  reconnectAttempt?: number
  failure?: WorkspaceHostFailure
  updatedAt: string
}>

export type WorkspaceHostPlacement = Readonly<{
  locator: WorkspaceLocator
  session: WorkspaceHostSession
}>
