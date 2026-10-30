import { once } from 'node:events'
import type { AddressInfo } from 'node:net'

import { describe, expect, it, vi } from 'vitest'

import type { FeedbackGatewayResult } from './contract.js'
import { createFeedbackGatewayServer } from './server.js'

const result: FeedbackGatewayResult = {
  schemaVersion: 1,
  idempotencyKey: 'feedback:thread-1234567890',
  issueNumber: 44,
  issueUrl: 'https://github.test/issues/44',
  assetUrls: ['https://assets.test/full.png'],
  createdAt: '2026-07-11T03:00:00.000Z'
}

async function withServer(
  options: Parameters<typeof createFeedbackGatewayServer>[0],
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = createFeedbackGatewayServer(options)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

describe('feedback gateway HTTP API', () => {
  it('accepts a client-compatible POST and exposes the stored result by idempotency key', async () => {
    const service = {
      submit: vi.fn(async () => result),
      get: vi.fn(async () => result)
    }
    await withServer({ service }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/feedback`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': result.idempotencyKey
        },
        body: JSON.stringify({ idempotencyKey: result.idempotencyKey })
      })
      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toEqual(result)

      const lookup = await fetch(`${baseUrl}/v1/feedback/${encodeURIComponent(result.idempotencyKey)}`)
      expect(lookup.status).toBe(200)
      await expect(lookup.json()).resolves.toEqual(result)
    })
    expect(service.submit).toHaveBeenCalledWith({ idempotencyKey: result.idempotencyKey })
    expect(service.get).toHaveBeenCalledWith(result.idempotencyKey)
  })

  it('supports optional bearer authentication while leaving health available', async () => {
    const service = { submit: vi.fn(), get: vi.fn() }
    await withServer({ service, authToken: 'gateway-secret' }, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/health`)).status).toBe(200)
      expect((await fetch(`${baseUrl}/v1/feedback/${encodeURIComponent(result.idempotencyKey)}`)).status).toBe(401)
      const authorized = await fetch(`${baseUrl}/v1/feedback/${encodeURIComponent(result.idempotencyKey)}`, {
        headers: { authorization: 'Bearer gateway-secret' }
      })
      expect(authorized.status).toBe(404)
    })
  })

  it('rejects mismatched idempotency headers and oversized packets', async () => {
    const service = { submit: vi.fn(), get: vi.fn() }
    await withServer({ service, maxBodyBytes: 1_024 }, async (baseUrl) => {
      const mismatch = await fetch(`${baseUrl}/v1/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'feedback:header-123456789' },
        body: JSON.stringify({ idempotencyKey: 'feedback:body-12345678901' })
      })
      expect(mismatch.status).toBe(400)

      const oversized = await fetch(`${baseUrl}/v1/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: 'x'.repeat(2_000) })
      })
      expect(oversized.status).toBe(413)
    })
    expect(service.submit).not.toHaveBeenCalled()
  })
})
