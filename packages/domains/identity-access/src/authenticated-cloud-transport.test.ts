import { describe, expect, it } from 'vitest'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  authenticatedCloudRequestSchema,
  authenticatedCloudResponseSchema,
  defineAuthenticatedCloudTransport
} from './authenticated-cloud-transport.js'

describe('authenticated Cloud transport contract', () => {
  it('contains no path, header, token, credential, or secret surface', () => {
    const valid = {
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload: { type: 'project.list' }
    } as const
    expect(authenticatedCloudRequestSchema.parse(valid)).toEqual(valid)

    for (const forbidden of [
      { accessToken: 'secret' },
      { authorization: 'Bearer secret' },
      { headers: { authorization: 'secret' } },
      { path: '/v1/commands' },
      { url: 'https://cloud.example.test/v1/commands' },
      { credential: 'secret' },
      { payload: { nested: { refresh_token: 'secret' } } },
      { payload: { nested: { password: 'secret' } } }
    ]) {
      expect(authenticatedCloudRequestSchema.safeParse({ ...valid, ...forbidden }).success).toBe(false)
    }
  })

  it('uses strict bounded JSON response envelopes', () => {
    const response = {
      contractVersion: 1,
      status: 200,
      body: { protocolVersion: '1.0', type: 'project.listed' }
    } as const
    expect(authenticatedCloudResponseSchema.parse(response)).toEqual(response)
    expect(authenticatedCloudResponseSchema.safeParse({
      ...response,
      authorization: 'secret'
    }).success).toBe(false)
  })

  it('validates provider status and provider output', async () => {
    const transport = defineAuthenticatedCloudTransport({
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.example.test',
        userId: 'usr_CloudUser000001',
        deviceId: 'dev_CloudDevice0001'
      }),
      execute: async () => ({ contractVersion: 1, status: 200, body: { ok: true } })
    })
    expect(transport.status()).toEqual({
      state: 'ready',
      baseUrl: 'https://cloud.example.test',
      userId: 'usr_CloudUser000001',
      deviceId: 'dev_CloudDevice0001'
    })
    await expect(transport.execute({
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload: {}
    })).resolves.toMatchObject({ status: 200, body: { ok: true } })

    const drifted = defineAuthenticatedCloudTransport({
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.example.test',
        userId: 'usr_CloudUser000001',
        deviceId: 'dev_CloudDevice0001'
      }),
      execute: async () => ({ contractVersion: 1, status: 200, body: null, token: 'secret' } as never)
    })
    await expect(drifted.execute({
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload: {}
    })).rejects.toBeDefined()
  })
})
