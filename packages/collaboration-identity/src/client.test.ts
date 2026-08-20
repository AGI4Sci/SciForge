import { describe, expect, it, vi } from 'vitest'
import {
  CollaborationIdentityClientError,
  HttpCollaborationIdentityClient
} from './client.js'
import { InMemoryCollaborationIdentityClient } from './testing.js'

const claims = {
  type: 'verified_oidc_claims' as const,
  issuer: 'https://login-test.sciforge.cn/realms/SciForge',
  subject: 'keycloak-user-123',
  audiences: ['sciforge-cloud-api'],
  issuedAt: '2026-08-19T04:00:00.000Z',
  expiresAt: '2099-08-19T04:05:00.000Z',
  email: 'person@example.com',
  displayName: 'Cloud Person'
}

describe('collaboration identity clients', () => {
  it('uses the verified OIDC identity for stable local JIT provisioning', async () => {
    const client = new InMemoryCollaborationIdentityClient()
    const first = await client.getCurrentUser({ accessToken: 'local-token', verifiedClaims: claims })
    const second = await client.getCurrentUser({ accessToken: 'local-token', verifiedClaims: claims })

    expect(second.userId).toBe(first.userId)
    expect(second).toMatchObject({
      userId: first.userId,
      issuer: claims.issuer,
      status: 'active'
    })
  })

  it('sends A Device write idempotency in both the header and JSON body', async () => {
    const idempotencyKey = 'idem_device_enrollment_0001'
    const fetchImpl = vi.fn(async () => Response.json({
      enrollmentId: 'enr_Enrollment0001',
      nonce: 'a'.repeat(43),
      expiresAt: '2026-08-19T04:05:00.000Z'
    })) as unknown as typeof fetch
    const client = new HttpCollaborationIdentityClient({
      baseUrl: 'https://cloud.example.test',
      fetchImpl
    })

    await client.createDeviceEnrollment(
      { accessToken: 'access-token' },
      { installationId: 'ins_Desktop000001', idempotencyKey }
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://cloud.example.test/v1/device-enrollments',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer access-token',
          accept: 'application/json',
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey
        },
        body: JSON.stringify({ installationId: 'ins_Desktop000001', idempotencyKey })
      }
    )
  })

  it('calls GET /v1/me with the OIDC access token', async () => {
    const accessToken = ['access', 'token'].join('-')
    const local = new InMemoryCollaborationIdentityClient()
    const expected = await local.getCurrentUser({ accessToken: 'local-token', verifiedClaims: claims })
    const fetchImpl = vi.fn(async () => Response.json(expected)) as unknown as typeof fetch
    const client = new HttpCollaborationIdentityClient({
      baseUrl: 'https://cloud.example.test/',
      fetchImpl
    })

    await expect(client.getCurrentUser({ accessToken })).resolves.toEqual(expected)
    expect(fetchImpl).toHaveBeenCalledWith('https://cloud.example.test/v1/me', {
      method: 'GET',
      headers: {
        authorization: ['Bearer', accessToken].join(' '),
        accept: 'application/json'
      }
    })
  })

  it('normalizes the frozen cloud error envelope', async () => {
    const accessToken = ['access', 'token'].join('-')
    const client = new HttpCollaborationIdentityClient({
      baseUrl: 'https://cloud.example.test',
      fetchImpl: vi.fn(async () => Response.json({
        error: {
          code: 'IDENTITY_CONFLICT',
          message: 'This identity belongs to another user.',
          requestId: 'req_CloudError0001'
        }
      }, { status: 409 })) as unknown as typeof fetch
    })

    await expect(client.getCurrentUser({ accessToken })).rejects.toEqual(
      expect.objectContaining<Partial<CollaborationIdentityClientError>>({
        code: 'identity_conflict',
        requestId: 'req_CloudError0001',
        httpStatus: 409
      })
    )
  })
})
