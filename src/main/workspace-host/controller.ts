import {
  WORKSPACE_HOST_OPERATIONS,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'

import type {
  RemoteWorkspaceAttachInput,
  RemoteWorkspaceEgressRouteView,
  RemoteWorkspaceSelectInput,
  RemoteWorkspaceSessionInput,
  RemoteWorkspaceViewPhase,
  RemoteWorkspaceViewSnapshot,
  RemoteWorkspaceViewSummary
} from '../../shared/remote-workspace'
import type {
  WorkspaceHostConnectionSnapshot
} from '../../shared/workspace-host-state'
import {
  WorkspaceHostSessionManager
} from './session-manager'

export type RemoteWorkspaceControllerOptions = Readonly<{
  now?: () => Date
}>

/**
 * Renderer-safe selection/controller over already-authorized Workspace Hosts.
 *
 * Remote targets are never listed here. An owning domain first mints an opaque
 * authorizedSessionId through its governed capability, then hands that identity
 * to attach().
 */
export class RemoteWorkspaceController {
  readonly #listeners = new Set<(snapshot: RemoteWorkspaceViewSnapshot) => void>()
  readonly #sessionSubscriptions = new Map<string, () => void>()
  readonly #now: () => Date
  #activeSessionId?: string

  constructor(
    private readonly sessions: WorkspaceHostSessionManager,
    options: RemoteWorkspaceControllerOptions = {}
  ) {
    this.#now = options.now ?? (() => new Date())
  }

  list(): readonly RemoteWorkspaceViewSummary[] {
    return this.#snapshot().workspaces
  }

  get(): RemoteWorkspaceViewSnapshot {
    return this.#snapshot()
  }

  subscribe(listener: (snapshot: RemoteWorkspaceViewSnapshot) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#snapshot())
    return () => this.#listeners.delete(listener)
  }

  async attach(input: RemoteWorkspaceAttachInput): Promise<RemoteWorkspaceViewSnapshot> {
    const providerId = requireOpaqueId(input.providerId, 'providerId')
    const authorizedSessionId = requireOpaqueId(
      input.authorizedSessionId,
      'authorizedSessionId'
    )
    const attached = await this.sessions.attach({
      providerId,
      authorizedSessionId,
      ...(input.resume ? { resume: input.resume } : {})
    })
    const sessionId = attached.session.sessionId
    this.#sessionSubscriptions.get(sessionId)?.()
    this.#sessionSubscriptions.set(
      sessionId,
      this.sessions.subscribeSnapshot(sessionId, () => this.#publish())
    )
    this.#activeSessionId = sessionId
    this.#publish()
    return this.#snapshot()
  }

  select(input: RemoteWorkspaceSelectInput): RemoteWorkspaceViewSnapshot {
    const sessionId = input.sessionId === null
      ? undefined
      : requireOpaqueId(input.sessionId, 'sessionId')
    if (sessionId) this.#requireAttached(sessionId)
    this.#activeSessionId = sessionId
    this.#publish()
    return this.#snapshot()
  }

  async reconnect(input: RemoteWorkspaceSessionInput): Promise<RemoteWorkspaceViewSnapshot> {
    const sessionId = requireOpaqueId(input.sessionId, 'sessionId')
    this.#requireAttached(sessionId)
    await this.sessions.reconnect(sessionId)
    this.#activeSessionId = sessionId
    this.#publish()
    return this.#snapshot()
  }

  async close(input: RemoteWorkspaceSessionInput): Promise<RemoteWorkspaceViewSnapshot> {
    const sessionId = requireOpaqueId(input.sessionId, 'sessionId')
    this.#requireAttached(sessionId)
    await this.sessions.close(sessionId, 'Remote workspace closed by the user.')
    this.#sessionSubscriptions.get(sessionId)?.()
    this.#sessionSubscriptions.delete(sessionId)
    if (this.#activeSessionId === sessionId) this.#activeSessionId = undefined
    this.#publish()
    return this.#snapshot()
  }

  #requireAttached(sessionId: string): WorkspaceHostConnectionSnapshot {
    const snapshot = this.sessions.get(sessionId)
    if (!snapshot || snapshot.phase === 'closed') {
      throw new Error(`Workspace Host session ${sessionId} is not attached.`)
    }
    return snapshot
  }

  #snapshot(): RemoteWorkspaceViewSnapshot {
    const workspaces = this.sessions.list()
      .filter(({ phase }) => phase !== 'closed')
      .map(rendererSummary)
      .sort((left, right) => (
        left.displayLabel.localeCompare(right.displayLabel) ||
        left.workspacePathLabel.localeCompare(right.workspacePathLabel)
      ))
    const active = this.#activeSessionId &&
      workspaces.some(({ workspaceHostId }) => workspaceHostId === this.#activeSessionId)
      ? this.#activeSessionId
      : undefined
    return Object.freeze({
      ...(active ? { activeWorkspaceHostId: active } : {}),
      workspaces: Object.freeze(workspaces),
      updatedAt: this.#now().toISOString()
    })
  }

  #publish(): void {
    const snapshot = this.#snapshot()
    for (const listener of this.#listeners) listener(snapshot)
  }
}

function rendererSummary(
  connection: WorkspaceHostConnectionSnapshot
): RemoteWorkspaceViewSummary {
  const session = connection.session
  return Object.freeze({
    workspaceHostId: session.sessionId,
    locator: session.locator,
    displayLabel: safeDisplayLabel(connection.ownerDisplayName),
    workspacePathLabel: safeDisplayLabel(session.locator.path),
    lifecycleMode: session.lifecycleMode,
    phase: connectionPhase(connection),
    ...(connection.reconnectAttempt === undefined
      ? {}
      : { reconnectAttempt: connection.reconnectAttempt }),
    ...(connection.failure
      ? { statusDetail: safeDisplayLabel(connection.failure.message) }
      : {}),
    egressRoutes: egressRoutes(session),
    selectedEgressRouteId: session.egress.mode,
    capabilities: capabilitySummary(session)
  })
}

function connectionPhase(snapshot: WorkspaceHostConnectionSnapshot): RemoteWorkspaceViewPhase {
  switch (snapshot.phase) {
    case 'attaching':
    case 'connected':
      return 'ready'
    case 'reconnecting':
      return 'reconnecting'
    case 'replay-required':
      return 'degraded'
    case 'closed':
      return 'offline'
    case 'failed':
      return snapshot.failure?.retryable ? 'offline' : 'error'
  }
}

function capabilitySummary(session: WorkspaceHostSession) {
  const operations = new Set(session.capabilities.map(({ operation }) => operation))
  return Object.freeze({
    files: operations.has(WORKSPACE_HOST_OPERATIONS.directoryList) &&
      operations.has(WORKSPACE_HOST_OPERATIONS.fileRead),
    terminal: operations.has(WORKSPACE_HOST_OPERATIONS.processCreate),
    git: operations.has(WORKSPACE_HOST_OPERATIONS.versionControlStatus),
    runtime: operations.has(WORKSPACE_HOST_OPERATIONS.runtimeInvoke),
    scientificPreview: operations.has(WORKSPACE_HOST_OPERATIONS.previewInvoke)
  })
}

function egressRoutes(session: WorkspaceHostSession): readonly RemoteWorkspaceEgressRouteView[] {
  const mode = session.egress.mode
  return Object.freeze([Object.freeze({
    id: mode,
    displayLabel: egressLabel(mode),
    kind: mode,
    available: session.egress.status === 'ready' || session.egress.status === 'disabled'
  })])
}

function egressLabel(mode: WorkspaceHostSession['egress']['mode']): string {
  if (mode === 'local') return 'Local device'
  if (mode === 'remote-target') return 'Authorized remote target'
  return 'No network egress'
}

function requireOpaqueId(input: string, name: string): string {
  const normalized = input.trim()
  if (!normalized || normalized.length > 256) {
    throw new TypeError(`${name} must be a non-empty opaque identifier.`)
  }
  return normalized
}

function safeDisplayLabel(input: string): string {
  return Array.from(input, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      ? ' '
      : character
  })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 256)
}
