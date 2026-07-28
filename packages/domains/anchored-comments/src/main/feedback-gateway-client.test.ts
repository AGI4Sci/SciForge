import { describe, expect, it, vi } from 'vitest'
import {
  FeedbackGatewayClient,
  configuredFeedbackGatewayToken,
  configuredFeedbackGatewayUrl
} from './feedback-gateway-client'

function packet() {
  return {
    schemaVersion: 1 as const,
    idempotencyKey: 'feedback:thread-1234567890',
    threadId: 'thread-1',
    repository: { owner: 'sciforge', name: 'sciforge' },
    title: 'Export button does not respond',
    body: 'Clicking the export button has no visible effect.',
    disclosure: {
      annotatedScreenshots: true,
      applicationEnvironment: true,
      logs: false,
      conversationExcerpt: false,
      workspacePaths: false,
      fileMetadata: false
    },
    environment: { appVersion: '1.2.3' }
  }
}

function gatewayResult() {
  return {
    schemaVersion: 1 as const,
    idempotencyKey: packet().idempotencyKey,
    issueNumber: 42,
    issueUrl: 'https://github.com/sciforge/sciforge/issues/42',
    author: 'octocat',
    assetUrls: [],
    createdAt: '2026-07-11T03:00:00.000Z'
  }
}

describe('FeedbackGatewayClient', () => {
  it('submits a validated packet with its stable idempotency key', async () => {
    const fetchImpl = vi.fn(async () => Response.json(gatewayResult())) as typeof fetch
    const client = new FeedbackGatewayClient({
      baseUrl: 'https://feedback.sciforge.test/',
      fetchImpl,
      authToken: 'session-token'
    })

    await expect(client.submit(packet())).resolves.toEqual({ ok: true, result: gatewayResult() })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://feedback.sciforge.test/v1/feedback',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'idempotency-key': packet().idempotencyKey,
          authorization: 'Bearer session-token'
        })
      })
    )
  })

  it('retries a transient POST with the same key', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ message: 'try again' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json(gatewayResult())) as typeof fetch
    const client = new FeedbackGatewayClient({
      baseUrl: 'https://feedback.sciforge.test',
      fetchImpl
    })

    await expect(client.submit(packet())).resolves.toMatchObject({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers).toMatchObject({
      'idempotency-key': packet().idempotencyKey
    })
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[1]?.[1]?.headers).toMatchObject({
      'idempotency-key': packet().idempotencyKey
    })
  })

  it('resolves an ambiguous timeout through the gateway status endpoint', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('timed out'))
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValueOnce(Response.json(gatewayResult())) as typeof fetch
    const client = new FeedbackGatewayClient({
      baseUrl: 'https://feedback.sciforge.test',
      fetchImpl,
      maxAttempts: 2
    })

    await expect(client.submit(packet())).resolves.toEqual({ ok: true, result: gatewayResult() })
    expect(fetchImpl).toHaveBeenLastCalledWith(
      `https://feedback.sciforge.test/v1/feedback/${encodeURIComponent(packet().idempotencyKey)}`,
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('does not retry a disclosure or authentication rejection', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ message: 'Not authorized' }, { status: 403 })) as typeof fetch
    const client = new FeedbackGatewayClient({
      baseUrl: 'https://feedback.sciforge.test',
      fetchImpl
    })

    await expect(client.submit(packet())).resolves.toEqual({
      ok: false,
      message: 'Not authorized',
      retryable: false
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('configuredFeedbackGatewayUrl', () => {
  it('requires HTTPS and accepts an unset gateway', () => {
    expect(configuredFeedbackGatewayUrl({})).toBeNull()
    expect(() => configuredFeedbackGatewayUrl({ SCIFORGE_FEEDBACK_GATEWAY_URL: 'http://feedback.test' }))
      .toThrow('must use HTTPS')
  })

  it('reads an optional gateway session token', () => {
    expect(configuredFeedbackGatewayToken({})).toBeNull()
    expect(configuredFeedbackGatewayToken({ SCIFORGE_FEEDBACK_GATEWAY_TOKEN: ' token ' }))
      .toBe('token')
  })
})
