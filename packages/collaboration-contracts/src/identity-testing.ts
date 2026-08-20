import { createPublicKey, verify } from 'node:crypto'

import {
  createCollaborationError,
  type CollaborationError,
  type CollaborationErrorCode
} from './errors.js'
import {
  agentNodeSchema,
  userPrincipalSchema,
  type AgentNode,
  type UserPrincipal
} from './entities.js'
import {
  collaborationIdentitySnapshotSchema,
  desktopDeviceRegistrationSchema,
  deviceEnrollmentChallengeSchema,
  deviceEnrollmentProofMessage,
  deviceEnrollmentStartSchema,
  deviceRecordSchema,
  identityAuditEventSchema,
  oidcExchangeResponseSchema,
  oidcExternalIdentitySchema,
  oidcIdentityKey,
  verifiedOidcClaimsSchema,
  type CollaborationIdentitySnapshot,
  type DesktopDeviceRegistration,
  type DeviceEnrollmentChallenge,
  type DeviceRecord,
  type IdentityAuditEvent,
  type OidcExchangeResponse,
  type OidcExternalIdentity,
  type VerifiedOidcClaims
} from './identity.js'

type PendingDeviceEnrollment = {
  challenge: DeviceEnrollmentChallenge
  status: 'pending' | 'consumed' | 'expired'
}

export class CollaborationIdentityMockError extends Error {
  readonly collaborationError: CollaborationError

  constructor(code: CollaborationErrorCode, message: string) {
    super(message)
    this.name = 'CollaborationIdentityMockError'
    this.collaborationError = createCollaborationError(code, message)
  }
}

export class InMemoryCollaborationIdentityAdapter {
  private userSequence = 0
  private identitySequence = 0
  private deviceSequence = 0
  private agentSequence = 0
  private enrollmentSequence = 0
  private requestSequence = 0
  private readonly users = new Map<string, UserPrincipal>()
  private readonly identities = new Map<string, OidcExternalIdentity>()
  private readonly devices = new Map<string, DeviceRecord>()
  private readonly agents = new Map<string, AgentNode>()
  private readonly deviceRegistrations = new Map<string, DesktopDeviceRegistration>()
  private readonly deviceAgentLinks = new Map<string, string>()
  private readonly deviceEnrollments = new Map<string, PendingDeviceEnrollment>()
  private readonly auditEvents: IdentityAuditEvent[] = []

  constructor(private readonly now: () => Date = () => new Date()) {}

  exchangeOidc(rawClaims: VerifiedOidcClaims): OidcExchangeResponse {
    const claims = verifiedOidcClaimsSchema.parse(rawClaims)
    const at = this.timestamp()
    if (Date.parse(claims.expiresAt) <= this.now().getTime()) {
      throw new CollaborationIdentityMockError('expired', 'The OIDC access token has expired.')
    }
    const key = oidcIdentityKey(claims)
    const existing = this.identities.get(key)
    if (existing) {
      if (existing.status !== 'active') {
        throw new CollaborationIdentityMockError('credential_revoked', 'The OIDC identity has been revoked.')
      }
      const user = this.requireActiveUser(existing.userId)
      return this.exchangeResponse(user, existing)
    }

    const userId = this.nextId('usr', 'User', ++this.userSequence)
    const user = userPrincipalSchema.parse({
      schemaVersion: 1,
      type: 'user_principal',
      userId,
      displayName: claims.displayName ?? claims.email ?? `OIDC User ${this.userSequence}`,
      status: 'active',
      revision: 1,
      createdAt: at,
      updatedAt: at
    })
    const identity = oidcExternalIdentitySchema.parse({
      schemaVersion: 1,
      type: 'oidc_external_identity',
      externalIdentityId: this.nextId('xid', 'Ident', ++this.identitySequence),
      userId,
      issuer: claims.issuer,
      subject: claims.subject,
      ...(claims.email ? { emailAtLinkTime: claims.email } : {}),
      status: 'active',
      verifiedAt: at,
      revision: 1,
      createdAt: at,
      updatedAt: at
    })
    this.users.set(user.userId, user)
    this.identities.set(key, identity)
    return this.exchangeResponse(user, identity)
  }

  revokeOidcIdentity(externalIdentityId: string): OidcExternalIdentity {
    const entry = [...this.identities.entries()].find(([, identity]) => (
      identity.externalIdentityId === externalIdentityId
    ))
    if (!entry) throw new CollaborationIdentityMockError('not_found', 'OIDC identity was not found.')
    const [key, identity] = entry
    if (identity.status === 'revoked') return identity
    const at = this.timestamp()
    const revoked = oidcExternalIdentitySchema.parse({
      ...identity,
      status: 'revoked',
      revokedAt: at,
      revision: identity.revision + 1,
      updatedAt: at
    })
    this.identities.set(key, revoked)
    this.audit(identity.userId, 'oidc', 'oidc.revoked', { externalIdentityId })
    return revoked
  }

  startDeviceEnrollment(
    userId: string,
    installationId: string,
    ttlMilliseconds = 5 * 60_000
  ): DeviceEnrollmentChallenge {
    this.requireActiveUser(userId)
    const start = deviceEnrollmentStartSchema.parse({ installationId })
    const sequence = ++this.enrollmentSequence
    const challenge = deviceEnrollmentChallengeSchema.parse({
      protocolVersion: '1.0',
      requestId: this.nextRequestId(),
      type: 'device.enrollment.challenge',
      enrollmentId: this.nextId('enr', 'Device', sequence),
      userId,
      installationId: start.installationId,
      nonce: Buffer.alloc(32, sequence % 256).toString('base64url'),
      expiresAt: new Date(this.now().getTime() + ttlMilliseconds).toISOString()
    })
    this.deviceEnrollments.set(challenge.enrollmentId, { challenge, status: 'pending' })
    this.audit(userId, 'desktop', 'device.enrollment.started')
    return challenge
  }

  registerDesktopDevice(userId: string, rawRegistration: DesktopDeviceRegistration): DeviceRecord {
    this.requireActiveUser(userId)
    const registration = desktopDeviceRegistrationSchema.parse(rawRegistration)
    const pending = this.deviceEnrollments.get(registration.enrollmentId)
    if (!pending || pending.status !== 'pending') {
      throw new CollaborationIdentityMockError('expired', 'The Device enrollment is invalid or already consumed.')
    }
    if (Date.parse(pending.challenge.expiresAt) <= this.now().getTime()) {
      pending.status = 'expired'
      throw new CollaborationIdentityMockError('expired', 'The Device enrollment has expired.')
    }
    if (
      pending.challenge.userId !== userId ||
      pending.challenge.installationId !== registration.installationId
    ) {
      throw new CollaborationIdentityMockError('identity_conflict', 'The Device enrollment owner does not match.')
    }
    const key = createPublicKey({ key: registration.publicKey, format: 'jwk' })
    const signature = Buffer.from(registration.proof.signature, 'base64url')
    if (!verify(null, Buffer.from(deviceEnrollmentProofMessage(pending.challenge)), key, signature)) {
      throw new CollaborationIdentityMockError('authentication_required', 'The Device possession proof is invalid.')
    }
    const existing = [...this.devices.values()].find((device) => (
      device.installationId === registration.installationId
    ))
    if (existing) {
      if (existing.userId !== userId) {
        throw new CollaborationIdentityMockError('identity_conflict', 'This installation belongs to another user.')
      }
      return existing
    }
    const at = this.timestamp()
    const device = deviceRecordSchema.parse({
      schemaVersion: 1,
      type: 'device',
      deviceId: this.nextId('dev', 'Desktop', ++this.deviceSequence),
      userId,
      installationId: registration.installationId,
      displayName: registration.displayName,
      platform: registration.platform,
      publicKey: registration.publicKey,
      status: 'active',
      activatedAt: at,
      revision: 1,
      createdAt: at,
      updatedAt: at
    })
    this.devices.set(device.deviceId, device)
    this.deviceRegistrations.set(device.deviceId, registration)
    pending.status = 'consumed'
    this.audit(userId, 'desktop', 'device.registered', { deviceId: device.deviceId })
    return device
  }

  registerDesktopAgent(userId: string, deviceId: string): AgentNode {
    this.requireActiveUser(userId)
    const device = this.devices.get(deviceId)
    if (!device) throw new CollaborationIdentityMockError('not_found', 'Device was not found.')
    if (device.userId !== userId) {
      throw new CollaborationIdentityMockError('identity_conflict', 'This Device belongs to another user.')
    }
    if (device.status !== 'active') {
      throw new CollaborationIdentityMockError('credential_revoked', 'This Device is not active.')
    }
    const linkedAgentId = this.deviceAgentLinks.get(deviceId)
    if (linkedAgentId) return this.agents.get(linkedAgentId)!
    const registration = this.deviceRegistrations.get(deviceId)!
    const at = this.timestamp()
    const agent = agentNodeSchema.parse({
      schemaVersion: 1,
      type: 'agent_node',
      agentId: this.nextId('agt', 'Desktop', ++this.agentSequence),
      ownerUserId: userId,
      installationId: device.installationId,
      displayName: device.displayName,
      nodeType: 'desktop',
      capabilities: registration.capabilities,
      lifecycleStatus: 'active',
      connectionStatus: 'offline',
      credentialVersion: 1,
      revision: 1,
      createdAt: at,
      updatedAt: at
    })
    this.agents.set(agent.agentId, agent)
    this.deviceAgentLinks.set(deviceId, agent.agentId)
    this.audit(userId, 'desktop', 'agent.registered', { agentId: agent.agentId })
    return agent
  }

  revokeDevice(deviceId: string): DeviceRecord {
    const device = this.devices.get(deviceId)
    if (!device) throw new CollaborationIdentityMockError('not_found', 'Device was not found.')
    if (device.status === 'revoked') return device
    const at = this.timestamp()
    const revoked = deviceRecordSchema.parse({
      ...device,
      status: 'revoked',
      revokedAt: at,
      revision: device.revision + 1,
      updatedAt: at
    })
    this.devices.set(deviceId, revoked)
    const agentId = this.deviceAgentLinks.get(deviceId)
    if (agentId) this.revokeAgent(agentId)
    this.audit(device.userId, 'desktop', 'device.revoked', { deviceId })
    return revoked
  }

  revokeAgent(agentId: string): AgentNode {
    const agent = this.agents.get(agentId)
    if (!agent) throw new CollaborationIdentityMockError('not_found', 'Agent was not found.')
    if (agent.lifecycleStatus === 'revoked') return agent
    const at = this.timestamp()
    const revoked = agentNodeSchema.parse({
      ...agent,
      lifecycleStatus: 'revoked',
      connectionStatus: 'offline',
      revokedAt: at,
      revision: agent.revision + 1,
      updatedAt: at
    })
    this.agents.set(agentId, revoked)
    this.audit(agent.ownerUserId, 'desktop', 'agent.revoked', { agentId })
    return revoked
  }

  getDesktopDeviceRegistration(deviceId: string): DesktopDeviceRegistration {
    const registration = this.deviceRegistrations.get(deviceId)
    if (!registration) throw new CollaborationIdentityMockError('not_found', 'Device registration was not found.')
    return desktopDeviceRegistrationSchema.parse(registration)
  }

  getIdentitySnapshot(userId: string): CollaborationIdentitySnapshot {
    const user = this.requireActiveUser(userId)
    return collaborationIdentitySnapshotSchema.parse({
      protocolVersion: '1.0',
      requestId: this.nextRequestId(),
      type: 'identity.snapshot',
      user,
      oidcIdentities: [...this.identities.values()].filter((identity) => identity.userId === userId),
      humanEndpoints: [],
      devices: [...this.devices.values()].filter((device) => device.userId === userId),
      deviceAgentLinks: [...this.deviceAgentLinks.entries()]
        .filter(([deviceId]) => this.devices.get(deviceId)?.userId === userId)
        .map(([deviceId, agentId]) => ({ deviceId, agentId })),
      agents: [...this.agents.values()].filter((agent) => agent.ownerUserId === userId)
    })
  }

  listAuditEvents(): readonly IdentityAuditEvent[] {
    return [...this.auditEvents]
  }

  private exchangeResponse(user: UserPrincipal, identity: OidcExternalIdentity): OidcExchangeResponse {
    this.audit(user.userId, 'oidc', 'oidc.exchanged', { externalIdentityId: identity.externalIdentityId })
    return oidcExchangeResponseSchema.parse({
      protocolVersion: '1.0',
      requestId: this.nextRequestId(),
      type: 'oidc.exchanged',
      user,
      identity,
      userCredential: `user_mock_${user.userId}_${'x'.repeat(32)}`
    })
  }

  private requireActiveUser(userId: string): UserPrincipal {
    const user = this.users.get(userId)
    if (!user) throw new CollaborationIdentityMockError('not_found', 'User was not found.')
    if (user.status !== 'active') throw new CollaborationIdentityMockError('credential_revoked', 'User is not active.')
    return user
  }

  private audit(
    userId: string,
    source: IdentityAuditEvent['source'],
    action: IdentityAuditEvent['action'],
    targets: Pick<IdentityAuditEvent, 'externalIdentityId' | 'humanEndpointId' | 'deviceId' | 'agentId'> = {}
  ): void {
    this.auditEvents.push(identityAuditEventSchema.parse({
      requestId: this.nextRequestId(),
      actorUserId: userId,
      source,
      action,
      ...targets,
      occurredAt: this.timestamp()
    }))
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private nextRequestId(): string {
    return this.nextId('req', 'IdentReq', ++this.requestSequence)
  }

  private nextId(prefix: string, label: string, sequence: number): string {
    return `${prefix}_${label}${sequence.toString().padStart(12, '0')}`
  }
}
