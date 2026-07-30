import { randomBytes } from 'node:crypto'
import {
  remoteSshEgressSessionIdSchema,
  type RemoteSshEgressSessionOpenResult
} from '../contract.js'
import { RemoteWorkspaceSshError } from './workspace-server-deployment.js'

const DEFAULT_EGRESS_AUTHORIZATION_TTL_MS = 15 * 60_000

export type RemoteSshAuthorizedEgressTarget = Readonly<{
  id: string
  workspaceId: string
  targetId: string
  targetRevision: string
  authorizedAt: string
  expiresAt: string
}>

export class RemoteSshEgressAuthorizationStore {
  private readonly sessions = new Map<string, RemoteSshAuthorizedEgressTarget>()
  private readonly claimed = new Set<string>()

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = DEFAULT_EGRESS_AUTHORIZATION_TTL_MS
  ) {}

  authorize(input: Readonly<{
    workspaceId: string
    targetId: string
    targetRevision: string
  }>): RemoteSshEgressSessionOpenResult {
    this.pruneExpired()
    const id = remoteSshEgressSessionIdSchema.parse(
      `ssh_egs_${randomBytes(24).toString('base64url')}`
    )
    const authorizedAt = this.now()
    const expiresAt = new Date(authorizedAt.getTime() + this.ttlMs)
    this.sessions.set(id, Object.freeze({
      id,
      workspaceId: input.workspaceId,
      targetId: input.targetId,
      targetRevision: input.targetRevision,
      authorizedAt: authorizedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    }))
    return { authorizedSessionId: id, expiresAt: expiresAt.toISOString() }
  }

  acquire(id: string, workspaceId: string): RemoteSshAuthorizedEgressTarget {
    const normalized = remoteSshEgressSessionIdSchema.parse(id)
    this.pruneExpired()
    const session = this.sessions.get(normalized)
    if (!session || session.workspaceId !== workspaceId || this.claimed.has(normalized)) {
      throw new RemoteWorkspaceSshError(
        'workspace_server_session_unauthorized',
        'Remote SSH egress authorization is missing, expired, already attached, or belongs to another workspace.'
      )
    }
    this.claimed.add(normalized)
    return session
  }

  requireActive(id: string, workspaceId: string): RemoteSshAuthorizedEgressTarget {
    const normalized = remoteSshEgressSessionIdSchema.parse(id)
    const session = this.sessions.get(normalized)
    if (!session || session.workspaceId !== workspaceId || !this.claimed.has(normalized)) {
      throw new RemoteWorkspaceSshError(
        'workspace_server_session_unauthorized',
        'Remote SSH egress authorization is no longer active.'
      )
    }
    return session
  }

  revoke(id: string): void {
    const normalized = remoteSshEgressSessionIdSchema.parse(id)
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
      }
    }
  }
}
