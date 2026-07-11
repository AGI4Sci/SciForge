import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PutObjectCommand } from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StoredFeedbackSubmission } from './contract.js'
import { S3ImmutableAssetPublisher } from './publishers/s3-assets.js'
import { IdempotencyConflictError } from './service.js'
import { FileFeedbackIdempotencyStore } from './stores/file-idempotency.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function record(requestDigest = 'a'.repeat(64)): StoredFeedbackSubmission {
  return {
    idempotencyKey: 'feedback:thread-1234567890',
    requestDigest,
    result: {
      schemaVersion: 1,
      idempotencyKey: 'feedback:thread-1234567890',
      issueNumber: 8,
      issueUrl: 'https://github.test/issues/8',
      assetUrls: ['https://assets.test/feedback/aa/asset.png'],
      createdAt: '2026-07-11T03:00:00.000Z'
    }
  }
}

describe('FileFeedbackIdempotencyStore', () => {
  it('persists an atomic result that can be read after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'feedback-store-'))
    temporaryDirectories.push(directory)
    const store = new FileFeedbackIdempotencyStore(directory)
    await store.put(record())

    await expect(new FileFeedbackIdempotencyStore(directory).get(record().idempotencyKey)).resolves.toEqual(record())
    await expect(store.put(record('b'.repeat(64)))).rejects.toBeInstanceOf(IdempotencyConflictError)
  })
})

describe('S3ImmutableAssetPublisher', () => {
  it('publishes a content-addressed object with an immutable write precondition', async () => {
    const send = vi.fn(async () => ({}))
    const publisher = new S3ImmutableAssetPublisher({
      client: { send } as never,
      bucket: 'feedback-assets',
      publicBaseUrl: 'https://assets.sciforge.test/',
      keyPrefix: 'approved-feedback'
    })
    const digest = 'a'.repeat(64)

    await expect(publisher.publish({ name: 'ignored.png', mimeType: 'image/png', digest, bytes: new Uint8Array([1]) }))
      .resolves.toEqual({ url: `https://assets.sciforge.test/approved-feedback/aa/${digest}.png` })
    const command = send.mock.calls[0]?.[0]
    expect(command).toBeInstanceOf(PutObjectCommand)
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: 'feedback-assets',
      Key: `approved-feedback/aa/${digest}.png`,
      IfNoneMatch: '*',
      CacheControl: 'public, max-age=31536000, immutable'
    })
  })

  it('treats S3 precondition failure as an already published immutable object', async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error('exists'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } })
    })
    const publisher = new S3ImmutableAssetPublisher({
      client: { send } as never,
      bucket: 'feedback-assets',
      publicBaseUrl: 'https://assets.sciforge.test/'
    })

    await expect(publisher.publish({
      name: 'same.png',
      mimeType: 'image/png',
      digest: 'b'.repeat(64),
      bytes: new Uint8Array([1])
    })).resolves.toMatchObject({ url: expect.stringContaining('b'.repeat(64)) })
  })
})
