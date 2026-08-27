import { digestSecret } from './crypto.js'
import { CollaborationServiceError, fail } from './errors.js'
import type { IdentityService } from './identity-service.js'
import type { Assurance, StoredEndpoint } from './model.js'
import { OidcVerificationError, type OidcAccessTokenVerifier } from './oidc.js'
import type { CollaborationReadRepository } from './repository.js'
import type { AgentActor, AuthContext, HumanEndpointActor, OidcUserActor, UserActor } from './actor.js'

export type OidcUserResolver = Readonly<{
  isCandidate(token: string): boolean
  resolve(token: string): Promise<OidcUserActor>
}>

export class StrictOidcUserResolver implements OidcUserResolver {
  constructor(private readonly verifier: OidcAccessTokenVerifier, private readonly identities: IdentityService) {}

  isCandidate(token: string): boolean { return token.split('.').length === 3 }

  async resolve(token: string): Promise<OidcUserActor> {
    try {
      return await this.identities.resolveOidcUser(await this.verifier.verifyAccessToken(token))
    } catch (error) {
      if (error instanceof CollaborationServiceError) throw error
      if (error instanceof OidcVerificationError) {
        if (error.code === 'oidc_discovery_unavailable' || error.code === 'oidc_jwks_unavailable') {
          fail('resource_offline', 'The configured OIDC authentication dependency is unavailable.', { retryable: true })
        }
        fail('authentication_required', 'The OIDC access token is not valid.')
      }
      fail('authentication_required', 'The OIDC access token could not be verified.')
    }
  }
}

export function requireOidcUserActor(actor: AuthContext): OidcUserActor {
  if (actor.kind !== 'user' || actor.authentication !== 'oidc') {
    fail('permission_denied', 'This operation requires an OIDC User actor.')
  }
  return actor
}

export type PermissionOperation =
  | 'personal_message'
  | 'project_input'
  | 'task_create'
  | 'task_update'
  | 'human_needed'
  | 'human_answer'
  | 'capability_approval'
  | 'project_read'
  | 'project_admin'
  | 'record_submit'
  | 'record_accept'

export type PermissionFacts = {
  actor: AuthContext
  operation: PermissionOperation
  targetUserId?: string
  resourceOwnerUserId?: string
  senderAllowedByProjection?: boolean
  projectMember?: boolean
  projectRole?: 'owner' | 'member' | 'observer'
  coordinatorAgentId?: string
  assigneeAgentId?: string
  requiredAssurance?: Assurance
  remoteApprovalAllowed?: boolean
}

const assuranceRank: Record<Assurance, number> = {
  basic: 0,
  verified: 1,
  device: 2,
  strong: 3
}

export function authorize(facts: PermissionFacts): void {
  const { actor } = facts
  if (actor.kind === 'system') return
  if (facts.requiredAssurance && assuranceRank[actor.assurance] < assuranceRank[facts.requiredAssurance]) {
    fail('assurance_insufficient', 'The actor endpoint does not meet the required assurance level.')
  }
  switch (facts.operation) {
    case 'personal_message':
      if ((actor.kind !== 'user' && actor.kind !== 'human_endpoint') ||
          (actor.userId !== facts.resourceOwnerUserId && !facts.senderAllowedByProjection)) {
        fail('permission_denied', 'Personal messages may only target an explicitly owned or shared projection.')
      }
      return
    case 'project_input':
      if ((actor.kind !== 'user' && actor.kind !== 'human_endpoint') || !facts.projectMember) {
        fail('permission_denied', 'Only an active Project member may submit Project input.')
      }
      return
    case 'task_create':
      if (actor.kind !== 'agent_device' || actor.agentId !== facts.coordinatorAgentId) {
        fail('permission_denied', 'Only the active Coordinator Agent may create tasks.')
      }
      return
    case 'task_update':
      if (actor.kind !== 'agent_device' || actor.agentId !== facts.assigneeAgentId) {
        fail('permission_denied', 'Only the current assignee Agent may update this task.')
      }
      return
    case 'human_needed':
      if (actor.kind !== 'agent_device' || actor.agentId !== facts.assigneeAgentId || !facts.projectMember) {
        fail('permission_denied', 'Only the current assignee may request a decision from a Project member.')
      }
      return
    case 'human_answer':
      if ((actor.kind !== 'user' && actor.kind !== 'human_endpoint') || actor.userId !== facts.targetUserId) {
        fail('permission_denied', 'A HumanNeeded request may only be answered by its authenticated target User.')
      }
      return
    case 'capability_approval':
      if (actor.kind === 'human_endpoint' && !facts.remoteApprovalAllowed) {
        fail('permission_denied', 'This capability remains pending for desktop approval.')
      }
      if (actor.kind !== 'user' && actor.kind !== 'human_endpoint') {
        fail('permission_denied', 'Capability approval requires an authenticated human actor.')
      }
      if (actor.userId !== facts.targetUserId) fail('permission_denied', 'The approval belongs to another user.')
      return
    case 'project_read':
      if (!facts.projectMember) fail('permission_denied', 'Only active Project members may read this Project.')
      return
    case 'project_admin':
      if (actor.kind !== 'user' || facts.projectRole !== 'owner') {
        fail('permission_denied', 'This Project operation requires its Owner OIDC User Principal.')
      }
      return
    case 'record_submit':
      if (!facts.projectMember || (actor.kind !== 'user' && actor.kind !== 'agent_device')) {
        fail('permission_denied', 'Only a Project member or its Agent may submit a candidate record.')
      }
      return
    case 'record_accept':
      if (actor.kind === 'agent_device') {
        if (actor.agentId !== facts.coordinatorAgentId) fail('permission_denied', 'Only the Coordinator Agent may accept this record.')
      } else if (actor.kind === 'user') {
        if (facts.projectRole !== 'owner') fail('permission_denied', 'Only the Project owner may accept this record.')
      } else {
        fail('permission_denied', 'This endpoint cannot accept a formal Project record.')
      }
  }
}

export class AuthenticationService {
  constructor(
    private readonly repository: CollaborationReadRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly oidc?: OidcUserResolver
  ) {}

  async resolveRequestActor(request: import('node:http').IncomingMessage): Promise<UserActor | AgentActor> {
    const authorization = firstHeader(request.headers.authorization)
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
    return this.resolveBearer(token)
  }

  async resolveBearer(token: string | undefined): Promise<UserActor | AgentActor> {
    if (!token || token.length < 16 || token.length > 16 * 1024 || /\s/u.test(token)) {
      fail('authentication_required', 'A valid bearer credential is required.')
    }
    if (token.split('.').length === 3) {
      if (!this.oidc || !this.oidc.isCandidate(token)) fail('authentication_required', 'OIDC User authentication is not configured.')
      return this.oidc.resolve(token)
    }
    if (token.length > 512) fail('authentication_required', 'The bearer credential is not recognized.')
    const credential = await this.repository.getCredentialByDigest(digestSecret(token))
    if (!credential) fail('authentication_required', 'The bearer credential is not recognized.')
    if (credential.revokedAt || (credential.expiresAt && credential.expiresAt <= this.now().toISOString())) {
      fail('credential_revoked', 'The bearer credential has expired or was revoked.')
    }
    const user = await this.repository.getUser(credential.subjectUserId)
    if (!user || user.status !== 'active') fail('credential_revoked', 'The user principal is not active.')
    const agentId = credential.subjectAgentId
    if (!agentId) fail('authentication_required', 'The Agent machine credential has no Agent subject.')
    const agent = await this.repository.getAgent(agentId)
    if (!agent || agent.status !== 'active' || agent.ownerUserId !== user.userId || agent.credentialGeneration !== credential.generation) {
      fail('credential_revoked', 'The Agent machine identity is no longer active.')
    }
    const device = await this.repository.getDevice(agent.deviceId)
    if (!device || device.status !== 'active' || device.userId !== user.userId) {
      fail('credential_revoked', 'The Agent Device is no longer active.')
    }
    return {
      kind: 'agent_device',
      actorKey: `agent:${agent.agentId}:credential:${credential.credentialId}`,
      userId: user.userId,
      agentId: agent.agentId,
      deviceId: device.deviceId,
      credentialId: credential.credentialId,
      credentialGeneration: credential.generation,
      assurance: 'device'
    }
  }

  async resolveProviderIdentity(provider: string, realmId: string, providerUserId: string): Promise<HumanEndpointActor> {
    const endpoint = await this.repository.getEndpointByProviderIdentity(provider, realmId, providerUserId)
    return this.endpointActor(endpoint)
  }

  private async endpointActor(endpoint: StoredEndpoint | null): Promise<HumanEndpointActor> {
    if (!endpoint || endpoint.status !== 'active') fail('authentication_required', 'The provider identity is not actively bound.')
    const user = await this.repository.getUser(endpoint.userId)
    if (!user || user.status !== 'active') fail('credential_revoked', 'The endpoint owner is not active.')
    if (endpoint.assurance === 'basic') fail('assurance_insufficient', 'The human endpoint is not verified.')
    return {
      kind: 'human_endpoint',
      actorKey: `endpoint:${endpoint.humanEndpointId}:revision:${endpoint.revision}`,
      userId: endpoint.userId,
      humanEndpointId: endpoint.humanEndpointId,
      assurance: endpoint.assurance,
    }
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
