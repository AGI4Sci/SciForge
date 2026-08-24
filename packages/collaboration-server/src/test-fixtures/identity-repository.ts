// @ts-expect-error The canonical JavaScript test adapter intentionally has no production declaration surface.
import { FakeCollaborationRepository } from '../../../../test-fixtures/collaboration/fake-adapters.mjs'

export class IdentityFakeRepository extends FakeCollaborationRepository {
  declare state: Record<string, any>
  private tail: Promise<unknown> = Promise.resolve()

  constructor() {
    super()
    Object.assign(this.state, {
      oidcIdentities: new Map(),
      deviceEnrollments: new Map(),
      devices: new Map()
    })
  }

  transaction<T>(work: (repository: this) => Promise<T>): Promise<T> {
    const result = this.tail.then(() => super.transaction(work))
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  async lockOidcIdentity() {}
  async getUserForUpdate(userId: string) { return structuredClone(this.state.users.get(userId) ?? null) }
  async getOidcIdentity(identityId: string) { return structuredClone(this.state.oidcIdentities.get(identityId) ?? null) }
  async getOidcIdentityByIssuerSubject(issuer: string, subject: string) {
    return structuredClone([...this.state.oidcIdentities.values()].find((value) => (
      value.issuer === issuer && value.subject === subject
    )) ?? null)
  }
  async getOidcIdentityByIssuerSubjectForUpdate(issuer: string, subject: string) {
    return this.getOidcIdentityByIssuerSubject(issuer, subject)
  }
  async insertOidcIdentity(identity: Record<string, unknown>) {
    this.state.oidcIdentities.set(identity.identityId, structuredClone(identity))
  }
  async getDeviceEnrollment(enrollmentId: string) {
    return structuredClone(this.state.deviceEnrollments.get(enrollmentId) ?? null)
  }
  async getDeviceEnrollmentForUpdate(enrollmentId: string) { return this.getDeviceEnrollment(enrollmentId) }
  async insertDeviceEnrollment(enrollment: Record<string, unknown>) {
    this.state.deviceEnrollments.set(enrollment.enrollmentId, structuredClone(enrollment))
  }
  async consumeDeviceEnrollment(enrollmentId: string, consumedAt: string, expectedRevision: number) {
    const enrollment = this.state.deviceEnrollments.get(enrollmentId)
    if (!enrollment || enrollment.status !== 'pending' || enrollment.revision !== expectedRevision ||
        enrollment.expiresAt <= consumedAt) return false
    this.state.deviceEnrollments.set(enrollmentId, {
      ...enrollment, status: 'consumed', consumedAt, revision: expectedRevision + 1, updatedAt: consumedAt
    })
    return true
  }
  async getDevice(deviceId: string) { return structuredClone(this.state.devices.get(deviceId) ?? null) }
  async getDeviceForUpdate(deviceId: string) { return this.getDevice(deviceId) }
  async getDeviceByInstallation(installationId: string) {
    return structuredClone([...this.state.devices.values()].find((value) => value.installationId === installationId) ?? null)
  }
  async listDevicesForUser(userId: string) {
    return structuredClone([...this.state.devices.values()].filter((value) => value.userId === userId))
  }
  async insertDevice(device: Record<string, unknown>) { this.state.devices.set(device.deviceId, structuredClone(device)) }
  async updateDevice(device: Record<string, unknown>, expectedRevision: number) {
    const current = this.state.devices.get(device.deviceId)
    if (!current || current.revision !== expectedRevision) throw new Error('fake device revision conflict')
    this.state.devices.set(device.deviceId, structuredClone(device))
  }
  async listAgentsForDevice(deviceId: string) {
    return structuredClone([...this.state.agents.values()].filter((value) => value.deviceId === deviceId))
  }
  async getCredential(credentialId: string) {
    return structuredClone(this.state.credentials.get(credentialId) ?? null)
  }
  async revokeAgentCredentialsForDevice(deviceId: string, revokedAt: string) {
    const agentIds = new Set([...this.state.agents.values()].filter((value) => value.deviceId === deviceId)
      .map((value) => value.agentId))
    let count = 0
    for (const credential of this.state.credentials.values()) {
      if (credential.kind === 'agent_device' && agentIds.has(credential.subjectAgentId) && !credential.revokedAt) {
        credential.revokedAt = revokedAt
        count += 1
      }
    }
    return count
  }
}
