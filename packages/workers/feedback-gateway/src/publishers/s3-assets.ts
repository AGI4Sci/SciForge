import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'

import type { FeedbackAssetPublisher, FeedbackAssetPublishInput } from '../service.js'

type S3Sender = Pick<S3Client, 'send'>

export type S3ImmutableAssetPublisherOptions = {
  client: S3Sender
  bucket: string
  publicBaseUrl: string
  keyPrefix?: string
}

function normalizedPrefix(prefix: string | undefined): string {
  return (prefix ?? 'feedback').split('/').map((part) => part.trim()).filter(Boolean).join('/')
}

function publicObjectUrl(baseUrl: string, key: string): string {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  return new URL(encodedKey, base).toString()
}

function isAlreadyPublished(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return value.name === 'PreconditionFailed' || value.$metadata?.httpStatusCode === 412
}

export class S3ImmutableAssetPublisher implements FeedbackAssetPublisher {
  private readonly prefix: string

  constructor(private readonly options: S3ImmutableAssetPublisherOptions) {
    if (!options.bucket.trim()) throw new Error('S3 asset bucket is required.')
    new URL(options.publicBaseUrl)
    this.prefix = normalizedPrefix(options.keyPrefix)
  }

  async publish(input: FeedbackAssetPublishInput): Promise<{ url: string }> {
    const key = [this.prefix, input.digest.slice(0, 2), `${input.digest}.png`].filter(Boolean).join('/')
    try {
      await this.options.client.send(new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: input.bytes,
        ContentType: input.mimeType,
        CacheControl: 'public, max-age=31536000, immutable',
        Metadata: { 'sha256-digest': input.digest },
        IfNoneMatch: '*'
      }))
    } catch (error) {
      if (!isAlreadyPublished(error)) throw error
    }
    return { url: publicObjectUrl(this.options.publicBaseUrl, key) }
  }
}
