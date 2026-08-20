import {
  currentDevicesResponseSchema,
  currentUserResponseSchema,
  type CurrentDevicesResponse,
  type CurrentUserResponse,
  type DesktopDeviceRegistration,
  type DeviceEnrollmentChallenge,
  type DeviceEnrollmentStart,
  type DeviceRecord
} from '@sciforge/collaboration-contracts'
import { InMemoryCollaborationIdentityAdapter } from '@sciforge/collaboration-contracts/testing'
import type {
  CollaborationIdentityClient,
  IdentityAccessContext
} from './client.js'

export class InMemoryCollaborationIdentityClient implements CollaborationIdentityClient {
  readonly #adapter: InMemoryCollaborationIdentityAdapter
  readonly #usersByAccessToken = new Map<string, string>()
  #requestSequence = 0

  constructor(adapter = new InMemoryCollaborationIdentityAdapter()) {
    this.#adapter = adapter
  }

  get adapter(): InMemoryCollaborationIdentityAdapter {
    return this.#adapter
  }

  async getCurrentUser(context: IdentityAccessContext): Promise<CurrentUserResponse> {
    if (!context.verifiedClaims) {
      throw new TypeError('The local identity adapter requires verified OIDC claims.')
    }
    const exchanged = this.#adapter.exchangeOidc(context.verifiedClaims)
    this.#usersByAccessToken.set(context.accessToken, exchanged.user.userId)
    return currentUserResponseSchema.parse({
      protocolVersion: exchanged.protocolVersion,
      requestId: exchanged.requestId,
      type: 'identity.me',
      user: exchanged.user,
      identity: exchanged.identity
    })
  }

  async startDeviceEnrollment(
    context: IdentityAccessContext,
    input: DeviceEnrollmentStart
  ): Promise<DeviceEnrollmentChallenge> {
    return this.#adapter.startDeviceEnrollment(this.#requireUser(context), input.installationId)
  }

  async registerDevice(
    context: IdentityAccessContext,
    input: DesktopDeviceRegistration
  ): Promise<DeviceRecord> {
    return this.#adapter.registerDesktopDevice(this.#requireUser(context), input)
  }

  async listDevices(context: IdentityAccessContext): Promise<CurrentDevicesResponse> {
    const snapshot = this.#adapter.getIdentitySnapshot(this.#requireUser(context))
    return currentDevicesResponseSchema.parse({
      protocolVersion: '1.0',
      requestId: `req_LocalDevice${(++this.#requestSequence).toString().padStart(4, '0')}`,
      type: 'identity.devices',
      devices: snapshot.devices
    })
  }

  async revokeDevice(context: IdentityAccessContext, deviceId: string): Promise<DeviceRecord> {
    const userId = this.#requireUser(context)
    const device = this.#adapter.getIdentitySnapshot(userId).devices.find((candidate) => candidate.deviceId === deviceId)
    if (!device) throw new TypeError('Device does not belong to the current user.')
    return this.#adapter.revokeDevice(deviceId)
  }

  #requireUser(context: IdentityAccessContext): string {
    const userId = this.#usersByAccessToken.get(context.accessToken)
    if (!userId) throw new TypeError('Call getCurrentUser before using the local identity adapter.')
    return userId
  }
}
