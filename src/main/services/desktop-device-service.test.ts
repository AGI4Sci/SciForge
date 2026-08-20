import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifiedOidcClaimsSchema } from '@sciforge/collaboration-contracts'
import { InMemoryCollaborationIdentityClient } from '@sciforge/collaboration-identity/testing'
import type { DesktopIdentityStatus } from '../../shared/desktop-identity'
import { DesktopDeviceService, cloudInstallationId } from './desktop-device-service'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function testDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-device-'))
  directories.push(directory)
  return directory
}

function signedInStatus(userId: string, externalIdentityId: string): DesktopIdentityStatus {
  return {
    state: 'signed-in',
    user: {
      userId,
      externalIdentityId,
      issuer: 'https://login.sciforge.example/realms/SciForge',
      subject: 'keycloak-user-001',
      displayName: 'Researcher One',
      email: 'researcher@example.invalid'
    },
    accessTokenExpiresAt: '2027-08-19T00:00:00.000Z'
  }
}

describe('DesktopDeviceService', () => {
  it('registers an Ed25519 Desktop, persists only an encrypted private key, and revokes it', async () => {
    const client = new InMemoryCollaborationIdentityClient()
    const token = 'local-access-token'
    const current = await client.getCurrentUser({
      accessToken: token,
      verifiedClaims: verifiedOidcClaimsSchema.parse({
        type: 'verified_oidc_claims',
        issuer: 'https://login.sciforge.example/realms/SciForge',
        subject: 'keycloak-user-001',
        audiences: ['sciforge-cloud-api'],
        issuedAt: '2026-08-19T00:00:00.000Z',
        expiresAt: '2027-08-19T00:00:00.000Z',
        email: 'researcher@example.invalid',
        displayName: 'Researcher One'
      })
    })
    const status = signedInStatus(current.user.userId, current.identity.externalIdentityId)
    const encryptString = vi.fn((value: string) => (
      Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`)
    ))
    const decryptString = vi.fn((value: Buffer) => {
      const encoded = value.toString().replace(/^sealed:/u, '')
      return Buffer.from(encoded, 'base64').toString()
    })
    const directory = await testDirectory()
    const service = new DesktopDeviceService({
      identity: {
        getStatus: () => status,
        getAccessToken: () => token,
        subscribe: () => () => undefined
      },
      client,
      installationSeed: 'sciforge-local-installation',
      userDataDir: directory,
      encryption: {
        state: () => 'available',
        encryptString,
        decryptString
      },
      appVersion: '0.2.17',
      platform: 'win32',
      architecture: 'x64',
      osVersion: '11',
      displayName: 'Lab Desktop'
    })

    const enrolled = await service.ensureRegistered()
    expect(enrolled.ok).toBe(true)
    expect(enrolled.status).toMatchObject({ state: 'active' })
    expect(enrolled.devices).toHaveLength(1)
    expect(enrolled.devices[0]).toMatchObject({
      displayName: 'Lab Desktop',
      status: 'active',
      platform: { os: 'windows', arch: 'x64' }
    })
    expect(encryptString).toHaveBeenCalledOnce()

    const registration = client.adapter.getDesktopDeviceRegistration(enrolled.devices[0]!.deviceId)
    expect(registration.publicKey).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA' })
    expect(registration.publicKey).not.toHaveProperty('d')
    const stored = await readFile(join(directory, 'collaboration-identity', 'device-key.json'), 'utf8')
    expect(stored).toContain('encryptedPrivateKey')
    expect(stored).not.toContain('"d"')

    const revoked = await service.revoke(enrolled.devices[0]!.deviceId)
    expect(revoked.ok).toBe(true)
    expect(revoked.status).toMatchObject({ state: 'revoked' })
    expect(revoked.devices[0]?.status).toBe('revoked')
    service.close()
  })

  it('derives a stable cloud installation ID from the existing Desktop installation seed', () => {
    expect(cloudInstallationId('sciforge-local-installation')).toBe(
      cloudInstallationId('sciforge-local-installation')
    )
    expect(cloudInstallationId('sciforge-local-installation')).toMatch(/^ins_[a-f0-9]{32}$/u)
  })
})
