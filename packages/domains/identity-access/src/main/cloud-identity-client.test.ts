import { describe, expect, it, vi } from 'vitest'
import {
  CloudIdentityClientError,
  HttpCloudIdentityClient
} from './cloud-identity-client.js'

describe('main-private Cloud identity client', () => {
  it('sends Device write idempotency in both the header and strict JSON body', async () => {
    const accessToken = ['access', 'token'].join('-')
    const idempotencyKey = 'idem_device_enrollment_0001'
    const fetchImpl = vi.fn(async () => Response.json({
      enrollmentId: 'enr_Enrollment0001',
      nonce: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      expiresAt: '2026-08-19T04:05:00.000Z'
    })) as unknown as typeof fetch
    const client = new HttpCloudIdentityClient({
      baseUrl: 'https://cloud.example.test',
      fetchImpl
    })

    await client.createDeviceEnrollment(
      { accessToken },
      { installationId: 'ins_Desktop000001', idempotencyKey }
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://cloud.example.test/v1/device-enrollments',
      {
        method: 'POST',
        headers: {
          authorization: ['Bearer', accessToken].join(' '),
          accept: 'application/json',
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey
        },
        body: JSON.stringify({ installationId: 'ins_Desktop000001', idempotencyKey })
      }
    )
  })

  it('keeps the OIDC access token inside the main-private request boundary', async () => {
    const accessToken = ['access', 'token'].join('-')
    const expected = {
      schemaVersion: 1,
      type: 'me',
      userId: 'usr_CloudUser000001',
      displayName: 'Cloud Person',
      status: 'active',
      oidcIdentityId: 'oid_CloudIdent0001',
      issuer: 'https://login.example.test/realms/SciForge',
      revision: 1,
      createdAt: '2026-08-19T04:00:00.000Z',
      updatedAt: '2026-08-19T04:00:00.000Z'
    }
    const fetchImpl = vi.fn(async () => Response.json(expected)) as unknown as typeof fetch
    const client = new HttpCloudIdentityClient({
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

  it('normalizes the canonical Cloud error envelope', async () => {
    const client = new HttpCloudIdentityClient({
      baseUrl: 'https://cloud.example.test',
      fetchImpl: vi.fn(async () => Response.json({
        requestId: 'req_CloudError0001',
        error: {
          code: 'IDENTITY_CONFLICT',
          message: 'This identity belongs to another user.'
        }
      }, { status: 409 })) as unknown as typeof fetch
    })

    await expect(client.getCurrentUser({ accessToken: 'access-token' })).rejects.toEqual(
      expect.objectContaining<Partial<CloudIdentityClientError>>({
        code: 'identity_conflict',
        requestId: 'req_CloudError0001',
        httpStatus: 409
      })
    )
  })
})
