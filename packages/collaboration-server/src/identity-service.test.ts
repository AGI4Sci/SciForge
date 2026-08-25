import { describe, expect, it } from 'vitest'

import { AuthenticationService } from './auth.js'
import { IdentityService } from './identity-service.js'
import { CollaborationService } from './service.js'
import { createDeviceFixture } from './test-fixtures/device-fixture.mjs'
import { IdentityFakeRepository } from './test-fixtures/identity-repository.js'
import { createAgentCredentialBootstrap } from './test-fixtures/collaboration-identity.js'

const initialTime = '2026-08-18T12:00:00.000Z'

class Clock {
  private value = new Date(initialTime)
  now = () => new Date(this.value)
  tick(milliseconds: number) { this.value = new Date(this.value.getTime() + milliseconds) }
}

function verifiedIdentity(clock: Clock, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(clock.now().getTime() / 1_000)
  return {
    issuer: 'https://login-test.sciforge.cn/realms/SciForge', subject: 'oidc-sub-test-owner',
    audience: ['sciforge-cloud-api'], authorizedParty: 'sciforge-desktop', issuedAt: now,
    notBefore: now - 1, expiresAt: now + 300, authTime: now, preferredUsername: 'identity-owner',
    ...overrides
  }
}

async function expectServiceCode(work: () => Promise<unknown>, code: string) {
  await expect(work()).rejects.toMatchObject({ code })
}

describe('A OIDC, Device, and Agent server semantics', () => {
  it('converges concurrent first login by issuer and subject without merging equal email', async () => {
    const clock = new Clock()
    const repository = new IdentityFakeRepository()
    const identities = new IdentityService(repository, clock.now)
    const verified = verifiedIdentity(clock, { email: 'same@example.invalid' })

    const actors = await Promise.all(Array.from({ length: 24 }, () => identities.resolveOidcUser(verified)))
    expect(new Set(actors.map((actor) => actor.userId))).toHaveLength(1)
    expect(repository.state.users).toHaveLength(1)
    expect(repository.state.oidcIdentities).toHaveLength(1)

    const other = await identities.resolveOidcUser(verifiedIdentity(clock, {
      subject: 'oidc-sub-test-other', email: 'same@example.invalid'
    }))
    expect(other.userId).not.toBe(actors[0].userId)
    expect(repository.state.users).toHaveLength(2)
  })

  it('creates a Device only with an Ed25519 possession proof and binds the Agent to that Device', async () => {
    const clock = new Clock()
    const repository = new IdentityFakeRepository()
    const identities = new IdentityService(repository, clock.now)
    const collaboration = new CollaborationService({ repository, now: clock.now })
    const actor = await identities.resolveOidcUser(verifiedIdentity(clock))
    const enrollment = await identities.createDeviceEnrollment(actor, {
      installationId: 'ins_identity_test_0001', idempotencyKey: 'idem_device_enrollment_0001'
    })
    const fixture = createDeviceFixture({ ...enrollment, userId: actor.userId,
      installationId: 'ins_identity_test_0001', capabilitySummary: ['local-files'] })
    await expectServiceCode(() => identities.createDevice(actor, {
      ...fixture.deviceRequest, nonce: enrollment.nonce, signature: Buffer.alloc(64).toString('base64url'),
      idempotencyKey: 'idem_device_tampered_0001'
    }), 'validation_failed')

    const created = await identities.createDevice(actor, {
      ...fixture.deviceRequest, nonce: enrollment.nonce, idempotencyKey: 'idem_device_create_0001'
    })
    expect(repository.state.deviceEnrollments.get(enrollment.enrollmentId)).not.toHaveProperty('nonce')
    expect(repository.state.devices.get(created.device.deviceId)).not.toHaveProperty('signature')

    const bootstrap = createAgentCredentialBootstrap()
    const registered = await collaboration.registerAgent(actor, {
      deviceId: created.device.deviceId, displayName: 'Runtime Agent', nodeType: 'desktop',
      capabilities: ['runtime-exec'], credentialBootstrapPublicKey: bootstrap.publicKey,
      idempotencyKey: 'idem_agent_device_link_0001'
    })
    expect(registered.agent).toMatchObject({ deviceId: created.device.deviceId, ownerUserId: actor.userId })
    expect(registered.agent.capabilities).toEqual(['runtime-exec'])
    expect((await identities.listDevices(actor)).devices[0].capabilitySummary).toEqual(['local-files'])

    const authentication = new AuthenticationService(repository, clock.now)
    const credential = bootstrap.open(registered.sealedCredential!)
    const agentActor = await authentication.resolveBearer(credential)
    expect(agentActor).toMatchObject({ kind: 'agent_device', deviceId: created.device.deviceId })

    await identities.revokeDevice(actor, created.device.deviceId, 'idem_device_revoke_0001')
    await expectServiceCode(() => authentication.resolveBearer(credential), 'credential_revoked')
    if (agentActor.kind !== 'agent_device') throw new Error('Expected Agent actor')
    await expectServiceCode(() => collaboration.heartbeatAgent(agentActor, {
      expectedRevision: registered.agent.revision, connectionStatus: 'online',
      idempotencyKey: 'idem_device_revoked_stale_actor'
    }), 'credential_revoked')
  })

  it('keeps exact revoke replay read-only after recent authentication expires', async () => {
    const clock = new Clock()
    const repository = new IdentityFakeRepository()
    const identities = new IdentityService(repository, clock.now)
    const actor = await identities.resolveOidcUser(verifiedIdentity(clock))
    const enrollment = await identities.createDeviceEnrollment(actor, {
      installationId: 'ins_identity_revoke_replay', idempotencyKey: 'idem_device_revoke_replay_enrollment'
    })
    const fixture = createDeviceFixture({ ...enrollment, userId: actor.userId,
      installationId: 'ins_identity_revoke_replay' })
    const created = await identities.createDevice(actor, {
      ...fixture.deviceRequest, nonce: enrollment.nonce, idempotencyKey: 'idem_device_revoke_replay_create'
    })
    const key = 'idem_device_revoke_replay'
    const revoked = await identities.revokeDevice(actor, created.device.deviceId, key)
    clock.tick(301_000)
    await expect(identities.revokeDevice(actor, created.device.deviceId, key)).resolves.toEqual(revoked)
    await expectServiceCode(() => identities.revokeDevice(actor, created.device.deviceId,
      'idem_device_revoke_stale_new'), 'assurance_insufficient')
  })

  it('rejects locally inactive identities without auditing issuer or subject values', async () => {
    const clock = new Clock()
    const repository = new IdentityFakeRepository()
    const identities = new IdentityService(repository, clock.now)
    const verified = verifiedIdentity(clock, { subject: 'private-oidc-subject-marker' })
    const actor = await identities.resolveOidcUser(verified)
    const user = repository.state.users.get(actor.userId)
    repository.state.users.set(actor.userId, { ...user, status: 'suspended', revision: user.revision + 1 })
    await expectServiceCode(() => identities.resolveOidcUser(verified), 'credential_revoked')
    const audit = repository.state.auditEvents.at(-1)
    expect(audit).toMatchObject({ actorKind: 'oidc', outcome: 'rejected', metadata: { errorCode: 'credential_revoked' } })
    expect(JSON.stringify(audit)).not.toContain('private-oidc-subject-marker')
    expect(JSON.stringify(audit)).not.toContain(verified.issuer)
  })
})
