import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { FeedbackGatewayService, IdempotencyConflictError, InMemoryFeedbackIdempotencyStore } from './service.js'

function packet() {
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('test-png')])
  return {
    schemaVersion: 1 as const,
    idempotencyKey: 'feedback:thread-1234567890',
    threadId: 'thread-1',
    repository: { owner: 'XingYu-Zhong', name: 'SciForge' },
    title: 'Export button is unresponsive',
    body: 'The selected export button does not respond.',
    disclosure: {
      annotatedScreenshots: true,
      applicationEnvironment: true,
      logs: false,
      conversationExcerpt: false,
      workspacePaths: false,
      fileMetadata: false
    },
    screenshots: [{
      kind: 'full_window' as const,
      asset: {
        digest: createHash('sha256').update(bytes).digest('hex'),
        mimeType: 'image/png' as const,
        byteLength: bytes.byteLength,
        width: 100,
        height: 100
      },
      dataBase64: bytes.toString('base64')
    }],
    environment: { appVersion: '0.1.0', platform: 'darwin' }
  }
}

describe('FeedbackGatewayService', () => {
  it('publishes verified assets and creates exactly one Issue across concurrent retries', async () => {
    const assets = { publish: vi.fn(async () => ({ url: 'https://assets.sciforge.test/evidence.png' })) }
    const github = { createIssue: vi.fn(async () => ({
      issueNumber: 42,
      issueUrl: 'https://github.com/XingYu-Zhong/SciForge/issues/42',
      author: 'sciforge-bot'
    })) }
    const service = new FeedbackGatewayService({
      assets,
      github,
      idempotency: new InMemoryFeedbackIdempotencyStore(),
      now: () => new Date('2026-07-11T03:00:00.000Z')
    })

    const [first, retry] = await Promise.all([service.submit(packet()), service.submit(packet())])

    expect(first).toEqual(retry)
    expect(first).toMatchObject({ issueNumber: 42, assetUrls: ['https://assets.sciforge.test/evidence.png'] })
    expect(assets.publish).toHaveBeenCalledTimes(1)
    expect(github.createIssue).toHaveBeenCalledTimes(1)
    expect(github.createIssue).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('![Annotated SciForge window](https://assets.sciforge.test/evidence.png)')
    }))
    expect(github.createIssue.mock.calls[0]?.[0].body).toContain('## Environment')
  })

  it('returns a persisted result on later retries', async () => {
    const store = new InMemoryFeedbackIdempotencyStore()
    const github = { createIssue: vi.fn(async () => ({ issueNumber: 1, issueUrl: 'https://github.test/issues/1' })) }
    const service = new FeedbackGatewayService({
      assets: { publish: vi.fn(async () => ({ url: 'https://assets.test/1.png' })) },
      github,
      idempotency: store
    })
    const first = await service.submit(packet())
    const restarted = new FeedbackGatewayService({
      assets: { publish: vi.fn() },
      github: { createIssue: vi.fn() },
      idempotency: store
    })

    await expect(restarted.submit(packet())).resolves.toEqual(first)
    await expect(restarted.get(packet().idempotencyKey)).resolves.toEqual(first)
    expect(github.createIssue).toHaveBeenCalledTimes(1)
  })

  it('rejects changed payloads that reuse an idempotency key', async () => {
    const service = new FeedbackGatewayService({
      assets: { publish: vi.fn(async () => ({ url: 'https://assets.test/1.png' })) },
      github: { createIssue: vi.fn(async () => ({ issueNumber: 1, issueUrl: 'https://github.test/issues/1' })) },
      idempotency: new InMemoryFeedbackIdempotencyStore()
    })
    await service.submit(packet())
    await expect(service.submit({ ...packet(), title: 'Different title' })).rejects.toBeInstanceOf(IdempotencyConflictError)
  })

  it('rejects evidence whose digest no longer matches', async () => {
    const value = packet()
    value.screenshots[0]!.asset.digest = 'b'.repeat(64)
    const assets = { publish: vi.fn() }
    const github = { createIssue: vi.fn() }
    const service = new FeedbackGatewayService({
      assets,
      github,
      idempotency: new InMemoryFeedbackIdempotencyStore()
    })

    await expect(service.submit(value)).rejects.toThrow('digest verification')
    expect(assets.publish).not.toHaveBeenCalled()
    expect(github.createIssue).not.toHaveBeenCalled()
  })
})
