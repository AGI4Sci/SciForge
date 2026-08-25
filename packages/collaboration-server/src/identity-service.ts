import {
  deviceCreateRequestSchema,
  deviceEnrollmentCreateRequestSchema,
  deviceListResponseSchema,
  deviceResponseSchema,
  meResponseSchema,
  type Device,
  type DeviceCreateRequest,
  type DeviceEnrollmentCreateRequest,
  type DeviceEnrollmentCreateResponse,
  type DeviceListResponse,
  type DeviceResponse,
  type MeResponse
} from '@sciforge/collaboration-contracts'

import type { OidcUserActor } from './actor.js'
import { newId, safeAuditMetadata, stableDigest } from './crypto.js'
import { CollaborationServiceError, fail } from './errors.js'
import { enrollmentNonceDigest, issueEnrollmentNonce, verifyDeviceEnrollmentProof } from './identity-crypto.js'
import type { StoredAuditEvent, StoredDevice, StoredOidcIdentity, StoredReceipt, StoredUser } from './model.js'
import type { VerifiedOidcIdentity } from './oidc.js'
import type { CollaborationRepository, CollaborationTransaction } from './repository.js'

const IDENTITY_SCHEMA_VERSION = 1 as const
const FIVE_MINUTES_MS = 5 * 60_000
const RECEIPT_TTL_MS = 30 * 86_400_000

type IdentityCommandResult<T extends Record<string, unknown>> = Readonly<{
  response: T
  receiptResponse?: Record<string, unknown>
  resourceKind?: string
  resourceId?: string
}>

export class IdentityService {
  private readonly now: () => Date

  constructor(private readonly repository: CollaborationRepository, now?: () => Date) {
    this.now = now ?? (() => new Date())
  }

  async resolveOidcUser(verified: VerifiedOidcIdentity): Promise<OidcUserActor> {
    const at = this.timestamp()
    const resolved = await this.repository.transaction(async (tx) => {
      await tx.lockOidcIdentity(verified.issuer, verified.subject)
      const existing = await tx.getOidcIdentityByIssuerSubjectForUpdate(verified.issuer, verified.subject)
      if (existing) {
        const user = await tx.getUserForUpdate(existing.userId)
        const active = existing.status === 'active' && user?.status === 'active'
        await tx.insertAudit({
          auditEventId: newId('audit'), actorKind: 'oidc', ...(user ? { actorUserId: user.userId } : {}),
          action: 'oidc.user.resolve', resourceKind: 'oidc_identity', resourceId: existing.identityId,
          outcome: active ? 'accepted' : 'rejected', metadata: active ? {} : { errorCode: 'credential_revoked' },
          createdAt: at
        })
        return { user, identity: existing }
      }

      const user: StoredUser = {
        userId: newId('usr'), displayName: oidcDisplayName(verified), status: 'active', revision: 1,
        createdAt: at, updatedAt: at
      }
      const identity: StoredOidcIdentity = {
        identityId: newId('oid'), userId: user.userId, issuer: verified.issuer, subject: verified.subject,
        ...(verified.email ? { emailAtLinkTime: verified.email } : {}), status: 'active', revision: 1,
        createdAt: at, updatedAt: at
      }
      await tx.insertUser(user)
      await tx.insertOidcIdentity(identity)
      await tx.insertAudit({
        auditEventId: newId('audit'), actorKind: 'oidc', actorUserId: user.userId,
        action: 'oidc.user.jit', resourceKind: 'oidc_identity', resourceId: identity.identityId,
        outcome: 'accepted', metadata: {}, createdAt: at
      })
      return { user, identity }
    })
    if (!resolved.user || resolved.user.status !== 'active' || resolved.identity.status !== 'active') {
      fail('credential_revoked', 'The local OIDC identity is not active.')
    }
    return oidcUserActor(resolved.user, resolved.identity, verified.authTime, verified.expiresAt)
  }

  async me(actor: OidcUserActor): Promise<MeResponse> {
    const [user, identity] = await Promise.all([
      this.repository.getUser(actor.userId), this.repository.getOidcIdentity(actor.identityId)
    ])
    if (!user || user.status !== 'active' || !identity || identity.status !== 'active' ||
        identity.userId !== user.userId || identity.issuer !== actor.issuer || identity.subject !== actor.subject) {
      fail('credential_revoked', 'The local OIDC identity is not active.')
    }
    return meResponseSchema.parse({
      schemaVersion: IDENTITY_SCHEMA_VERSION, type: 'me', userId: user.userId, displayName: user.displayName,
      status: 'active', oidcIdentityId: identity.identityId, issuer: identity.issuer, revision: user.revision,
      createdAt: user.createdAt, updatedAt: user.updatedAt
    })
  }

  async createDeviceEnrollment(
    actor: OidcUserActor,
    rawInput: DeviceEnrollmentCreateRequest
  ): Promise<DeviceEnrollmentCreateResponse> {
    const parsed = deviceEnrollmentCreateRequestSchema.safeParse(rawInput)
    if (!parsed.success) fail('validation_failed', 'The Device enrollment request is invalid.')
    const input = parsed.data
    const nonce = issueEnrollmentNonce()
    const result = await this.execute(actor, 'device.enrollment.create', input.idempotencyKey, {
      installationId: input.installationId
    }, async (tx, at) => {
      const enrollmentId = newId('enr')
      const expiresAt = new Date(new Date(at).getTime() + FIVE_MINUTES_MS).toISOString()
      await tx.insertDeviceEnrollment({
        enrollmentId, userId: actor.userId, installationId: input.installationId,
        nonceDigest: enrollmentNonceDigest(nonce), status: 'pending', revision: 1,
        expiresAt, createdAt: at, updatedAt: at
      })
      return {
        response: { enrollmentId, nonce, expiresAt },
        receiptResponse: { enrollmentId, expiresAt, replayed: true },
        resourceKind: 'device_enrollment', resourceId: enrollmentId
      }
    })
    if (typeof result.nonce !== 'string') {
      fail('idempotency_conflict', 'Enrollment nonce material is returned only once; create a new enrollment.')
    }
    return { enrollmentId: String(result.enrollmentId), nonce: result.nonce, expiresAt: String(result.expiresAt) }
  }

  async createDevice(actor: OidcUserActor, rawInput: DeviceCreateRequest): Promise<DeviceResponse> {
    const parsed = deviceCreateRequestSchema.safeParse(rawInput)
    if (!parsed.success) fail('validation_failed', 'The Device creation request is invalid.')
    const input = parsed.data
    const response = await this.execute(actor, 'device.create', input.idempotencyKey, input, async (tx, at) => {
      const enrollment = await tx.getDeviceEnrollmentForUpdate(input.enrollmentId)
      if (!enrollment || enrollment.userId !== actor.userId) {
        fail('not_found', 'The Device enrollment was not found for this User.')
      }
      if (enrollment.installationId !== input.installationId) {
        fail('identity_conflict', 'The Device enrollment belongs to a different installation.')
      }
      if (enrollment.expiresAt <= at || enrollment.status === 'expired') {
        fail('request_expired', 'The Device enrollment has expired.')
      }
      if (enrollment.status !== 'pending' || enrollment.consumedAt) {
        fail('invalid_state_transition', 'The Device enrollment was already used.')
      }
      if (enrollmentNonceDigest(input.nonce) !== enrollment.nonceDigest) {
        fail('validation_failed', 'The Device enrollment proof is invalid.')
      }
      verifyDeviceEnrollmentProof({
        facts: {
          enrollmentId: enrollment.enrollmentId, nonce: input.nonce, userId: actor.userId,
          installationId: enrollment.installationId, expiresAt: enrollment.expiresAt
        },
        publicKeyJwk: input.publicKeyJwk,
        signature: input.signature
      })

      await tx.lockIdempotency('device-installation', input.installationId)
      if (await tx.getDeviceByInstallation(input.installationId)) {
        fail('identity_conflict', 'The installation already belongs to a Device.')
      }
      const device: StoredDevice = {
        deviceId: newId('dev'), userId: actor.userId, installationId: input.installationId,
        displayName: input.displayName, platform: input.platform, publicKeyJwk: input.publicKeyJwk,
        capabilitySummary: [...input.capabilitySummary], status: 'active', revision: 1,
        createdAt: at, updatedAt: at
      }
      await tx.insertDevice(device)
      if (!await tx.consumeDeviceEnrollment(enrollment.enrollmentId, at, enrollment.revision)) {
        fail('revision_conflict', 'The Device enrollment was consumed concurrently.')
      }
      return { response: { device: publicDevice(device) }, resourceKind: 'device', resourceId: device.deviceId }
    })
    return deviceResponseSchema.parse(response)
  }

  async listDevices(actor: OidcUserActor): Promise<DeviceListResponse> {
    return deviceListResponseSchema.parse({ devices: (await this.repository.listDevicesForUser(actor.userId)).map(publicDevice) })
  }

  async revokeDevice(actor: OidcUserActor, deviceId: string, idempotencyKey: string): Promise<DeviceResponse> {
    const response = await this.execute(actor, 'device.revoke', idempotencyKey, { deviceId }, async (tx, at) => {
      const device = await tx.getDeviceForUpdate(deviceId)
      if (!device || device.userId !== actor.userId) fail('not_found', 'The Device was not found for this User.')
      if (device.status === 'revoked') {
        return { response: { device: publicDevice(device) }, resourceKind: 'device', resourceId: device.deviceId }
      }
      const revoked: StoredDevice = {
        ...device, status: 'revoked', revision: device.revision + 1, updatedAt: at, revokedAt: at
      }
      await tx.updateDevice(revoked, device.revision)
      await tx.revokeAgentCredentialsForDevice(device.deviceId, at)
      return { response: { device: publicDevice(revoked) }, resourceKind: 'device', resourceId: device.deviceId }
    }, () => this.requireRecentAuthentication(actor))
    return deviceResponseSchema.parse(response)
  }

  async recordRejectedBoundary(actor: OidcUserActor, operation: string, error: CollaborationServiceError): Promise<void> {
    if (error.auditRecorded) return
    await this.repository.transaction((tx) => tx.insertAudit(
      rejectedAudit(actor, operation, error.code, this.timestamp())
    ))
    error.auditRecorded = true
  }

  private requireRecentAuthentication(actor: OidcUserActor): void {
    const ageSeconds = Math.floor(this.now().getTime() / 1_000) - actor.authTime
    if (!Number.isSafeInteger(actor.authTime) || ageSeconds < 0 || ageSeconds > 300) {
      fail('assurance_insufficient', 'Recent OIDC authentication is required for this operation.')
    }
  }

  private async execute<T extends Record<string, unknown>>(
    actor: OidcUserActor,
    operation: string,
    idempotencyKey: string,
    request: unknown,
    work: (tx: CollaborationTransaction, at: string) => Promise<IdentityCommandResult<T>>,
    beforeFirstExecution?: () => void
  ): Promise<Record<string, unknown>> {
    const actorKey = actor.actorKey
    const requestDigest = stableDigest(request)
    const at = this.timestamp()
    try {
      return await this.repository.transaction(async (tx) => {
        await tx.lockIdempotency(actorKey, idempotencyKey)
        const existing = await tx.getReceipt(actorKey, idempotencyKey)
        if (existing) {
          if (existing.operation !== operation || existing.requestDigest !== requestDigest) {
            fail('idempotency_conflict', 'The idempotency key was already used for a different request.')
          }
          return existing.response
        }
        beforeFirstExecution?.()
        const result = await work(tx, at)
        await tx.insertAudit(acceptedAudit(actor, operation, result, idempotencyKey, at))
        const receipt: StoredReceipt = {
          receiptId: `rcp_${stableDigest({ actorKey, idempotencyKey }).slice(0, 24)}`,
          actorKey, idempotencyKey, requestDigest, operation,
          resourceKind: result.resourceKind, resourceId: result.resourceId,
          response: result.receiptResponse ?? result.response, createdAt: at,
          expiresAt: new Date(new Date(at).getTime() + RECEIPT_TTL_MS).toISOString()
        }
        await tx.insertReceipt(receipt)
        return result.response
      })
    } catch (error) {
      const serviceError = error instanceof CollaborationServiceError ? error : undefined
      const recorded = await this.repository.transaction((tx) => tx.insertAudit(
        rejectedAudit(actor, operation, serviceError?.code ?? 'internal_error', this.timestamp(), idempotencyKey)
      )).then(() => true).catch(() => false)
      if (serviceError && recorded) serviceError.auditRecorded = true
      throw error
    }
  }

  private timestamp(): string {
    const timestamp = this.now().toISOString()
    if (timestamp === 'Invalid Date') throw new Error('Identity clock is invalid.')
    return timestamp
  }
}

function oidcDisplayName(verified: VerifiedOidcIdentity): string {
  const value = verified.displayName ?? verified.preferredUsername ?? 'SciForge User'
  return value.trim().slice(0, 200) || 'SciForge User'
}

function oidcUserActor(
  user: StoredUser,
  identity: StoredOidcIdentity,
  authTime: number,
  expiresAt: number
): OidcUserActor {
  return {
    kind: 'user', authentication: 'oidc', actorKey: `oidc:${identity.identityId}`,
    userId: user.userId, identityId: identity.identityId, issuer: identity.issuer,
    subject: identity.subject, authTime, expiresAt, assurance: 'verified'
  }
}

function publicDevice(device: StoredDevice): Device {
  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION, type: 'device', deviceId: device.deviceId, userId: device.userId,
    installationId: device.installationId, displayName: device.displayName, platform: device.platform,
    publicKeyJwk: device.publicKeyJwk, capabilitySummary: [...device.capabilitySummary], status: device.status,
    revision: device.revision, createdAt: device.createdAt, updatedAt: device.updatedAt,
    ...(device.revokedAt ? { revokedAt: device.revokedAt } : {})
  }
}

function acceptedAudit(
  actor: OidcUserActor,
  operation: string,
  result: IdentityCommandResult<Record<string, unknown>>,
  idempotencyKey: string,
  at: string
): StoredAuditEvent {
  return {
    auditEventId: newId('audit'), actorKind: 'user', actorUserId: actor.userId, action: operation,
    resourceKind: result.resourceKind, resourceId: result.resourceId, outcome: 'accepted',
    metadata: safeAuditMetadata({ idempotencyKeyDigest: stableDigest(idempotencyKey) }), createdAt: at
  }
}

function rejectedAudit(
  actor: OidcUserActor,
  operation: string,
  errorCode: string,
  at: string,
  idempotencyKey?: string
): StoredAuditEvent {
  return {
    auditEventId: newId('audit'), actorKind: 'user', actorUserId: actor.userId, action: operation,
    outcome: 'rejected', metadata: safeAuditMetadata({ errorCode,
      ...(idempotencyKey ? { idempotencyKeyDigest: stableDigest(idempotencyKey) } : {}) }), createdAt: at
  }
}
