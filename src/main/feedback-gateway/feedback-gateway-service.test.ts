import { createHash } from 'node:crypto'
import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it, vi } from 'vitest'
import {
  FeedbackGatewayService,
  GitHubRestIssueAdapter,
  InMemoryFeedbackIdempotencyStore
} from './feedback-gateway-service'

function packet() {
  const canvas = createCanvas(10, 10)
  const bytes = canvas.encodeSync('png')
  return {
    schemaVersion: 1 as const,
    idempotencyKey: 'feedback:thread-1234567890',
    threadId: 'thread-1',
    repository: { owner: 'sciforge', name: 'sciforge' },
    title: 'Export is broken',
    body: 'The export button does not respond.',
    disclosure: {
      annotatedScreenshots: true,
      applicationEnvironment: false,
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
        width: 10,
        height: 10
      },
      dataBase64: bytes.toString('base64')
    }]
  }
}

describe('FeedbackGatewayService', () => {
  it('publishes verified evidence and creates one idempotent GitHub Issue', async () => {
    const assets = {
      publish: vi.fn(async () => ({ url: 'https://assets.sciforge.test/evidence.png' }))
    }
    const github = {
      createIssue: vi.fn(async () => ({
        issueNumber: 42,
        issueUrl: 'https://github.com/sciforge/sciforge/issues/42',
        author: 'octocat'
      }))
    }
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
  })

  it('rejects evidence whose immutable digest no longer matches', async () => {
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

  it('rejects reusing one idempotency key for changed content', async () => {
    const service = new FeedbackGatewayService({
      assets: { publish: async () => ({ url: 'https://assets.sciforge.test/evidence.png' }) },
      github: {
        createIssue: async () => ({
          issueNumber: 42,
          issueUrl: 'https://github.com/sciforge/sciforge/issues/42'
        })
      },
      idempotency: new InMemoryFeedbackIdempotencyStore()
    })
    await service.submit(packet())
    const changed = packet()
    changed.title = 'A different problem'

    await expect(service.submit(changed)).rejects.toThrow('reused for a different')
  })
})

describe('GitHubRestIssueAdapter', () => {
  it('creates an Issue with the narrow GitHub REST payload', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      number: 9,
      html_url: 'https://github.com/sciforge/sciforge/issues/9',
      user: { login: 'octocat' }
    })) as typeof fetch
    const adapter = new GitHubRestIssueAdapter({
      token: async () => 'installation-token',
      fetchImpl
    })

    await expect(adapter.createIssue({
      repository: { owner: 'sciforge', name: 'sciforge' },
      title: 'Title',
      body: 'Body',
      idempotencyKey: 'feedback:key-123456789'
    })).resolves.toEqual({
      issueNumber: 9,
      issueUrl: 'https://github.com/sciforge/sciforge/issues/9',
      author: 'octocat'
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/sciforge/sciforge/issues',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Title', body: 'Body' })
      })
    )
  })
})
