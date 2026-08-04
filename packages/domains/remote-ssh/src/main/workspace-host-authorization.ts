import { randomBytes } from 'node:crypto'
import {
  REMOTE_SSH_WORKSPACE_HOST_PROVIDER_ID,
  remoteSshWorkspaceHostSessionIdSchema,
  remoteSshWorkspaceHostSessionOpenInputSchema,
  type RemoteSshWorkspaceHostSessionOpenInput,
  type RemoteSshWorkspaceHostSessionOpenResult
} from '../contract.js'
import { RemoteWorkspaceSshError } from './workspace-server-deployment.js'

const DEFAULT_AUTHORIZATION_TTL_MS = 15 * 60_000

export type RemoteSshAuthorizedWorkspaceHostSession = Readonly<{
  id: string
  workspaceId: string
  targetId: string
  targetRevision: string
  targetDisplayName: string
  workspaceRoot: string
  egress: RemoteSshWorkspaceHostSessionOpenInput['egress']
  authorizedAt: string
  expiresAt: string
}>

export class RemoteSshWorkspaceHostAuthorizationStore {
  private readonly sessions = new Map<string, RemoteSshAuthorizedWorkspaceHostSession>()
  private readonly claimed = new Set<string>()

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = DEFAULT_AUTHORIZATION_TTL_MS
  ) {}

  authorize(input: Readonly<{
    workspaceId: string
    targetId: string
    targetRevision: string
    targetDisplayName: string
    request: RemoteSshWorkspaceHostSessionOpenInput
  }>): RemoteSshWorkspaceHostSessionOpenResult {
    const request = remoteSshWorkspaceHostSessionOpenInputSchema.parse(input.request)
    this.pruneExpired()
    const id = remoteSshWorkspaceHostSessionIdSchema.parse(
      `ssh_whs_${randomBytes(24).toString('base64url')}`
    )
    const authorizedAt = this.now()
    const session: RemoteSshAuthorizedWorkspaceHostSession = Object.freeze({
      id,
      workspaceId: input.workspaceId,
      targetId: input.targetId,
      targetRevision: input.targetRevision,
      targetDisplayName: input.targetDisplayName,
      workspaceRoot: request.workspaceRoot,
      egress: request.egress,
      authorizedAt: authorizedAt.toISOString(),
      expiresAt: new Date(authorizedAt.getTime() + this.ttlMs).toISOString()
    })
    this.sessions.set(id, session)
    return {
      providerId: REMOTE_SSH_WORKSPACE_HOST_PROVIDER_ID,
      authorizedSessionId: id
    }
  }

  acquire(id: string): RemoteSshAuthorizedWorkspaceHostSession {
    const normalized = remoteSshWorkspaceHostSessionIdSchema.parse(id)
    this.pruneExpired()
    const session = this.sessions.get(normalized)
    if (!session || this.claimed.has(normalized)) {
      throw new RemoteWorkspaceSshError(
        'workspace_server_session_unauthorized',
        'Remote Workspace authorization is missing, expired, or already attached.'
      )
    }
    this.claimed.add(normalized)
    return session
  }

  requireActive(id: string): RemoteSshAuthorizedWorkspaceHostSession {
    const normalized = remoteSshWorkspaceHostSessionIdSchema.parse(id)
    const session = this.sessions.get(normalized)
    if (!session || !this.claimed.has(normalized)) {
      throw new RemoteWorkspaceSshError(
        'workspace_server_session_unauthorized',
        'Remote Workspace authorization is no longer active.'
      )
    }
    return session
  }

  revoke(id: string): void {
    const normalized = remoteSshWorkspaceHostSessionIdSchema.parse(id)
    this.sessions.delete(normalized)
    this.claimed.delete(normalized)
  }

  clear(): void {
    this.sessions.clear()
    this.claimed.clear()
  }

  private pruneExpired(): void {
    const now = this.now().getTime()
    for (const [id, session] of this.sessions) {
      if (!this.claimed.has(id) && Date.parse(session.expiresAt) <= now) {
        this.sessions.delete(id)
        this.claimed.delete(id)
      }
    }
  }
}
