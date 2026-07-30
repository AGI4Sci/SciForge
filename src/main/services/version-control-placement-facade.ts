import { randomUUID } from 'node:crypto'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import type {
  VersionControlCreateReferenceInput,
  VersionControlCreateReferenceOutput,
  VersionControlCreateSnapshotInput,
  VersionControlDiffInput,
  VersionControlListSnapshotsInput,
  VersionControlListSnapshotsOutput,
  VersionControlReadFileInput,
  VersionControlReadFileOutput,
  VersionControlRestoreInput,
  VersionControlRestoreOutput,
  VersionControlSnapshot,
  VersionControlStatusOutput,
  VersionControlTextOutput
} from '@sciforge/domain-sdk/version-control'
import {
  requireWorkspaceLocatorRoot
} from './workspace-host-path'
import type { WorkspacePlacementRouter } from './workspace-placement-router'
import type {
  VersionControlWorkspaceService,
  VersionControlWorkspaceSession
} from './version-control-workspace-service'

export type VersionControlPlacementFacadeOptions = Readonly<{
  local: VersionControlWorkspaceService
  workspacePlacement: Pick<
    WorkspacePlacementRouter,
    'versionControlStatus' | 'versionControlDiff'
  >
}>

/**
 * Owner-scoped version-control facade. Local sessions remain owned by the
 * canonical Git service; remote sessions carry an immutable Workspace Host
 * locator and expose only operations implemented by that host contract.
 */
export class VersionControlPlacementFacade {
  readonly #local: VersionControlWorkspaceService
  readonly #workspacePlacement: VersionControlPlacementFacadeOptions['workspacePlacement']
  readonly #remoteSessions = new Map<string, VersionControlWorkspaceSession>()

  constructor(options: VersionControlPlacementFacadeOptions) {
    this.#local = options.local
    this.#workspacePlacement = options.workspacePlacement
  }

  async open(
    ownerId: string,
    ownerAudience: 'ui' | 'agent' | 'system',
    workspaceRoot: string,
    locator?: WorkspaceLocator
  ): Promise<VersionControlWorkspaceSession> {
    if (!locator) return this.#local.open(ownerId, ownerAudience, workspaceRoot)

    const parsed = requireWorkspaceLocatorRoot(locator, workspaceRoot)
    const normalizedOwner = ownerId.trim()
    if (!normalizedOwner) throw new Error('Version-control workspace requires an owner.')
    const existing = [...this.#remoteSessions.values()].find((session) =>
      session.ownerId === normalizedOwner &&
      session.ownerAudience === ownerAudience &&
      session.workspaceId === parsed.path &&
      sameWorkspaceLocator(session.workspaceLocator, parsed)
    )
    if (existing) return existing

    const session: VersionControlWorkspaceSession = Object.freeze({
      resourceId: `version-control-${randomUUID()}`,
      ownerId: normalizedOwner,
      ownerAudience,
      workspaceId: parsed.path,
      workspaceRoot: parsed.path,
      repositoryRoot: parsed.path,
      workspaceLocator: parsed
    })
    this.#remoteSessions.set(session.resourceId, session)
    return session
  }

  requireSession(
    ownerId: string,
    ownerAudience: 'ui' | 'agent' | 'system',
    resourceId: string,
    workspaceRoot: string
  ): VersionControlWorkspaceSession {
    const remote = this.#remoteSessions.get(resourceId)
    if (!remote) {
      return this.#local.requireSession(ownerId, ownerAudience, resourceId, workspaceRoot)
    }
    if (
      remote.ownerId !== ownerId ||
      remote.ownerAudience !== ownerAudience ||
      remote.workspaceId !== workspaceRoot
    ) {
      throw new Error('Version-control workspace is unavailable to this caller.')
    }
    return remote
  }

  status(session: VersionControlWorkspaceSession): Promise<VersionControlStatusOutput> {
    if (!session.workspaceLocator) return this.#local.status(session)
    return this.#workspacePlacement.versionControlStatus(session.workspaceLocator)
  }

  diff(
    session: VersionControlWorkspaceSession,
    input: VersionControlDiffInput
  ): Promise<VersionControlTextOutput> {
    if (!session.workspaceLocator) return this.#local.diff(session, input)
    return this.#workspacePlacement.versionControlDiff(session.workspaceLocator, input)
  }

  async createSnapshot(
    session: VersionControlWorkspaceSession,
    input: VersionControlCreateSnapshotInput,
    expectedRevision: string
  ): Promise<VersionControlSnapshot> {
    this.#requireLocal(session, 'Creating remote snapshots')
    return await this.#local.createSnapshot(session, input, expectedRevision)
  }

  async createReference(
    session: VersionControlWorkspaceSession,
    input: VersionControlCreateReferenceInput,
    expectedRevision: string
  ): Promise<VersionControlCreateReferenceOutput> {
    this.#requireLocal(session, 'Creating remote references')
    return await this.#local.createReference(session, input, expectedRevision)
  }

  async listSnapshots(
    session: VersionControlWorkspaceSession,
    input: VersionControlListSnapshotsInput
  ): Promise<VersionControlListSnapshotsOutput> {
    this.#requireLocal(session, 'Listing remote snapshots')
    return await this.#local.listSnapshots(session, input)
  }

  async readFile(
    session: VersionControlWorkspaceSession,
    input: VersionControlReadFileInput
  ): Promise<VersionControlReadFileOutput> {
    this.#requireLocal(session, 'Reading files from remote revisions')
    return await this.#local.readFile(session, input)
  }

  async restore(
    session: VersionControlWorkspaceSession,
    input: VersionControlRestoreInput,
    expectedRevision: string
  ): Promise<VersionControlRestoreOutput> {
    this.#requireLocal(session, 'Restoring remote version-control workspaces')
    return await this.#local.restore(session, input, expectedRevision)
  }

  #requireLocal(session: VersionControlWorkspaceSession, action: string): void {
    if (session.workspaceLocator) {
      throw new Error(`${action} is not supported by the Workspace Host contract.`)
    }
  }
}

function sameWorkspaceLocator(
  left: WorkspaceLocator | undefined,
  right: WorkspaceLocator
): boolean {
  return Boolean(
    left &&
    left.hostSessionId === right.hostSessionId &&
    left.path === right.path
  )
}
