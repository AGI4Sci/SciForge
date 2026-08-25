import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  deviceEnrollmentCreateResponseSchema,
  deviceListResponseSchema,
  deviceSchema,
  meResponseSchema,
  type Device,
  type DeviceCreateRequest,
  type DeviceEnrollmentCreateRequest,
  type DeviceEnrollmentCreateResponse,
  type DeviceListResponse,
  type DeviceRevokeRequest,
  type Ed25519PublicJwk,
  type MeResponse
} from '@sciforge/collaboration-contracts'
import type {
  CollaborationIdentityClient,
  IdentityAccessContext
} from './client.js'

type Enrollment = Readonly<{
  userId: string
  installationId: string
  nonce: string
  expiresAt: string
}>

type DeviceRegistration = Readonly<{
  publicKey: Ed25519PublicJwk
  capabilities: readonly string[]
}>

export class InMemoryCollaborationIdentityClient implements CollaborationIdentityClient {
  readonly adapter = new InMemoryIdentityInspection()
  readonly #usersByIdentity = new Map<string, MeResponse>()
  readonly #usersByAccessToken = new Map<string, string>()
  readonly #enrollments = new Map<string, Enrollment>()
  readonly #devices = new Map<string, Device>()

  async getCurrentUser(context: IdentityAccessContext): Promise<MeResponse> {
    const claims = context.verifiedClaims
    if (!claims) throw new TypeError('The local identity client requires verified OIDC claims.')
    const identityKey = `${claims.issuer}\u0000${claims.subject}`
    let user = this.#usersByIdentity.get(identityKey)
    if (!user) {
      const now = new Date().toISOString()
      const suffix = stableSuffix(identityKey)
      user = meResponseSchema.parse({
        schemaVersion: 1,
        type: 'me',
        userId: `usr_${suffix}`,
        displayName: claims.displayName ?? claims.email ?? claims.subject,
        status: 'active',
        oidcIdentityId: `oid_${suffix}`,
        issuer: claims.issuer,
        revision: 1,
        createdAt: now,
        updatedAt: now
      })
      this.#usersByIdentity.set(identityKey, user)
    }
    this.#usersByAccessToken.set(context.accessToken, user.userId)
    return user
  }

  async createDeviceEnrollment(
    context: IdentityAccessContext,
    input: DeviceEnrollmentCreateRequest
  ): Promise<DeviceEnrollmentCreateResponse> {
    const enrollmentId = `enr_${randomUUID().replaceAll('-', '')}`
    const enrollment = {
      userId: this.#requireUser(context),
      installationId: input.installationId,
      nonce: randomBytes(32).toString('base64url'),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    }
    this.#enrollments.set(enrollmentId, enrollment)
    return deviceEnrollmentCreateResponseSchema.parse({
      enrollmentId,
      nonce: enrollment.nonce,
      expiresAt: enrollment.expiresAt
    })
  }

  async createDevice(context: IdentityAccessContext, input: DeviceCreateRequest): Promise<Device> {
    const userId = this.#requireUser(context)
    const enrollment = this.#enrollments.get(input.enrollmentId)
    if (
      !enrollment ||
      enrollment.userId !== userId ||
      enrollment.installationId !== input.installationId ||
      enrollment.nonce !== input.nonce ||
      Date.parse(enrollment.expiresAt) <= Date.now()
    ) {
      throw new TypeError('The Device enrollment challenge is invalid or expired.')
    }
    const now = new Date().toISOString()
    const device = deviceSchema.parse({
      schemaVersion: 1,
      type: 'device',
      deviceId: `dev_${stableSuffix(`${userId}\u0000${input.installationId}`)}`,
      userId,
      installationId: input.installationId,
      displayName: input.displayName,
      platform: input.platform,
      publicKeyJwk: input.publicKeyJwk,
      capabilitySummary: input.capabilitySummary,
      status: 'active',
      revision: 1,
      createdAt: now,
      updatedAt: now
    })
    this.#devices.set(device.deviceId, device)
    this.adapter.record(device.deviceId, {
      publicKey: input.publicKeyJwk,
      capabilities: [...input.capabilitySummary]
    })
    this.#enrollments.delete(input.enrollmentId)
    return device
  }

  async listDevices(context: IdentityAccessContext): Promise<DeviceListResponse> {
    const userId = this.#requireUser(context)
    return deviceListResponseSchema.parse({
      devices: [...this.#devices.values()].filter((device) => device.userId === userId)
    })
  }

  async revokeDevice(context: IdentityAccessContext, input: DeviceRevokeRequest): Promise<Device> {
    const userId = this.#requireUser(context)
    const current = this.#devices.get(input.deviceId)
    if (!current || current.userId !== userId) {
      throw new TypeError('Device does not belong to the current user.')
    }
    const now = new Date().toISOString()
    const revoked = deviceSchema.parse({
      ...current,
      status: 'revoked',
      revokedAt: now,
      revision: current.revision + 1,
      updatedAt: now
    })
    this.#devices.set(revoked.deviceId, revoked)
    return revoked
  }

  #requireUser(context: IdentityAccessContext): string {
    const userId = this.#usersByAccessToken.get(context.accessToken)
    if (!userId) throw new TypeError('Call getCurrentUser before using the local identity client.')
    return userId
  }
}

export class InMemoryIdentityInspection {
  readonly #registrations = new Map<string, DeviceRegistration>()

  record(deviceId: string, registration: DeviceRegistration): void {
    this.#registrations.set(deviceId, registration)
  }

  getDesktopDeviceRegistration(deviceId: string): DeviceRegistration {
    const registration = this.#registrations.get(deviceId)
    if (!registration) throw new TypeError(`Unknown Device ${deviceId}.`)
    return registration
  }
}

function stableSuffix(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}
