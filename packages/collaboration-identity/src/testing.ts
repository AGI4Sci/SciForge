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
  type DeviceRecord,
  type DeviceRevokeRequest,
  type MeResponse
} from '@sciforge/collaboration-contracts'
import { InMemoryCollaborationIdentityAdapter } from '@sciforge/collaboration-contracts/testing'
import type {
  CollaborationIdentityClient,
  IdentityAccessContext
} from './client.js'

export class InMemoryCollaborationIdentityClient implements CollaborationIdentityClient {
  readonly #adapter: InMemoryCollaborationIdentityAdapter
  readonly #usersByAccessToken = new Map<string, string>()

  constructor(adapter = new InMemoryCollaborationIdentityAdapter()) {
    this.#adapter = adapter
  }

  get adapter(): InMemoryCollaborationIdentityAdapter {
    return this.#adapter
  }

  async getCurrentUser(context: IdentityAccessContext): Promise<MeResponse> {
    if (!context.verifiedClaims) {
      throw new TypeError('The local identity adapter requires verified OIDC claims.')
    }
    const exchanged = this.#adapter.exchangeOidc(context.verifiedClaims)
    this.#usersByAccessToken.set(context.accessToken, exchanged.user.userId)
    return meResponseSchema.parse({
      schemaVersion: 1,
      type: 'me',
      userId: exchanged.user.userId,
      displayName: exchanged.user.displayName,
      status: 'active',
      oidcIdentityId: exchanged.identity.externalIdentityId.replace(/^xid_/u, 'oid_'),
      issuer: exchanged.identity.issuer,
      revision: exchanged.user.revision,
      createdAt: exchanged.user.createdAt,
      updatedAt: exchanged.user.updatedAt
    })
  }

  async createDeviceEnrollment(
    context: IdentityAccessContext,
    input: DeviceEnrollmentCreateRequest
  ): Promise<DeviceEnrollmentCreateResponse> {
    const challenge = this.#adapter.startDeviceEnrollment(
      this.#requireUser(context),
      input.installationId
    )
    return deviceEnrollmentCreateResponseSchema.parse({
      enrollmentId: challenge.enrollmentId,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt
    })
  }

  async createDevice(
    context: IdentityAccessContext,
    input: DeviceCreateRequest
  ): Promise<Device> {
    const record = this.#adapter.registerDesktopDevice(this.#requireUser(context), {
      enrollmentId: input.enrollmentId,
      installationId: input.installationId,
      displayName: input.displayName,
      platform: input.platform,
      publicKey: input.publicKeyJwk,
      capabilities: input.capabilitySummary,
      proof: { alg: 'EdDSA', signature: input.signature }
    })
    return this.#toDevice(record)
  }

  async listDevices(context: IdentityAccessContext): Promise<DeviceListResponse> {
    const snapshot = this.#adapter.getIdentitySnapshot(this.#requireUser(context))
    return deviceListResponseSchema.parse({
      devices: snapshot.devices.map((device) => this.#toDevice(device))
    })
  }

  async revokeDevice(context: IdentityAccessContext, input: DeviceRevokeRequest): Promise<Device> {
    const userId = this.#requireUser(context)
    const device = this.#adapter.getIdentitySnapshot(userId).devices.find(
      (candidate) => candidate.deviceId === input.deviceId
    )
    if (!device) throw new TypeError('Device does not belong to the current user.')
    return this.#toDevice(this.#adapter.revokeDevice(input.deviceId))
  }

  #toDevice(record: DeviceRecord): Device {
    const registration = this.#adapter.getDesktopDeviceRegistration(record.deviceId)
    return deviceSchema.parse({
      schemaVersion: record.schemaVersion,
      type: 'device',
      deviceId: record.deviceId,
      userId: record.userId,
      installationId: record.installationId,
      displayName: record.displayName,
      platform: record.platform,
      publicKeyJwk: record.publicKey,
      capabilitySummary: registration.capabilities,
      status: record.status === 'revoked' ? 'revoked' : 'active',
      revision: record.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.revokedAt ? { revokedAt: record.revokedAt } : {})
    })
  }

  #requireUser(context: IdentityAccessContext): string {
    const userId = this.#usersByAccessToken.get(context.accessToken)
    if (!userId) throw new TypeError('Call getCurrentUser before using the local identity adapter.')
    return userId
  }
}
