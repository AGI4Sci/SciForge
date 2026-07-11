import { createHash } from 'node:crypto'
import {
  feedbackGatewayResultSchema,
  productFeedbackPacketSchema,
  type FeedbackGatewayResult,
  type ProductFeedbackPacket
} from '../../shared/anchored-comments'

export type FeedbackAssetPublishInput = {
  name: string
  mimeType: 'image/png'
  digest: string
  bytes: Uint8Array
}

export type FeedbackAssetPublisher = {
  publish: (input: FeedbackAssetPublishInput) => Promise<{ url: string }>
}

export type GitHubIssueCreateInput = {
  repository: ProductFeedbackPacket['repository']
  title: string
  body: string
  idempotencyKey: string
}

export type GitHubIssueAdapter = {
  createIssue: (input: GitHubIssueCreateInput) => Promise<{
    issueNumber: number
    issueUrl: string
    author?: string
  }>
}

export type StoredFeedbackSubmission = {
  requestDigest: string
  result: FeedbackGatewayResult
}

export type FeedbackIdempotencyStore = {
  get: (idempotencyKey: string) => Promise<StoredFeedbackSubmission | null>
  put: (idempotencyKey: string, value: StoredFeedbackSubmission) => Promise<void>
}

export class InMemoryFeedbackIdempotencyStore implements FeedbackIdempotencyStore {
  private readonly values = new Map<string, StoredFeedbackSubmission>()

  async get(idempotencyKey: string): Promise<StoredFeedbackSubmission | null> {
    return this.values.get(idempotencyKey) ?? null
  }

  async put(idempotencyKey: string, value: StoredFeedbackSubmission): Promise<void> {
    const existing = this.values.get(idempotencyKey)
    if (existing && existing.requestDigest !== value.requestDigest) {
      throw new Error('Idempotency key was reused for a different feedback packet.')
    }
    this.values.set(idempotencyKey, structuredClone(value))
  }
}

export type FeedbackGatewayServiceOptions = {
  assets: FeedbackAssetPublisher
  github: GitHubIssueAdapter
  idempotency: FeedbackIdempotencyStore
  now?: () => Date
}

function packetDigest(packet: ProductFeedbackPacket): string {
  return createHash('sha256').update(JSON.stringify(packet)).digest('hex')
}

function verifiedScreenshotBytes(
  screenshot: NonNullable<ProductFeedbackPacket['screenshots']>[number]
): Uint8Array {
  if (!screenshot.dataBase64) throw new Error(`Screenshot ${screenshot.kind} is missing image bytes.`)
  const bytes = Buffer.from(screenshot.dataBase64, 'base64')
  if (bytes.byteLength !== screenshot.asset.byteLength) {
    throw new Error(`Screenshot ${screenshot.kind} byte length does not match its asset reference.`)
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== screenshot.asset.digest) {
    throw new Error(`Screenshot ${screenshot.kind} failed digest verification.`)
  }
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`Screenshot ${screenshot.kind} is not a PNG image.`)
  }
  return bytes
}

function issueBody(packet: ProductFeedbackPacket, assets: Array<{ kind: string; url: string }>): string {
  const imageSection = assets.length > 0
    ? `\n\n## Visual evidence\n\n${assets.map((asset) => (
        `![${asset.kind === 'focused' ? 'Focused commented region' : 'Annotated SciForge window'}](${asset.url})`
      )).join('\n\n')}`
    : ''
  return `${packet.body}${imageSection}\n\n---\nSciForge feedback id: \`${packet.idempotencyKey}\``
}

export class FeedbackGatewayService {
  private readonly options: FeedbackGatewayServiceOptions
  private readonly inFlight = new Map<string, Promise<FeedbackGatewayResult>>()

  constructor(options: FeedbackGatewayServiceOptions) {
    this.options = options
  }

  async submit(input: unknown): Promise<FeedbackGatewayResult> {
    const packet = productFeedbackPacketSchema.parse(input)
    const digest = packetDigest(packet)
    const existing = await this.options.idempotency.get(packet.idempotencyKey)
    if (existing) {
      if (existing.requestDigest !== digest) {
        throw new Error('Idempotency key was reused for a different feedback packet.')
      }
      return feedbackGatewayResultSchema.parse(existing.result)
    }

    const active = this.inFlight.get(packet.idempotencyKey)
    if (active) return active
    const task = this.create(packet, digest).finally(() => {
      if (this.inFlight.get(packet.idempotencyKey) === task) {
        this.inFlight.delete(packet.idempotencyKey)
      }
    })
    this.inFlight.set(packet.idempotencyKey, task)
    return task
  }

  async get(idempotencyKey: string): Promise<FeedbackGatewayResult | null> {
    const stored = await this.options.idempotency.get(idempotencyKey)
    return stored ? feedbackGatewayResultSchema.parse(stored.result) : null
  }

  private async create(packet: ProductFeedbackPacket, requestDigest: string): Promise<FeedbackGatewayResult> {
    const published: Array<{ kind: string; url: string }> = []
    for (const screenshot of packet.screenshots ?? []) {
      const bytes = verifiedScreenshotBytes(screenshot)
      const result = await this.options.assets.publish({
        name: `${packet.idempotencyKey.replace(/[^a-zA-Z0-9._-]/g, '_')}-${screenshot.kind}.png`,
        mimeType: 'image/png',
        digest: screenshot.asset.digest,
        bytes
      })
      published.push({ kind: screenshot.kind, url: new URL(result.url).toString() })
    }

    const issue = await this.options.github.createIssue({
      repository: packet.repository,
      title: packet.title,
      body: issueBody(packet, published),
      idempotencyKey: packet.idempotencyKey
    })
    const result = feedbackGatewayResultSchema.parse({
      schemaVersion: 1,
      idempotencyKey: packet.idempotencyKey,
      issueNumber: issue.issueNumber,
      issueUrl: issue.issueUrl,
      ...(issue.author ? { author: issue.author } : {}),
      assetUrls: published.map((asset) => asset.url),
      createdAt: (this.options.now ?? (() => new Date()))().toISOString()
    })
    await this.options.idempotency.put(packet.idempotencyKey, { requestDigest, result })
    return result
  }
}

export type GitHubRestIssueAdapterOptions = {
  token: () => Promise<string>
  fetchImpl?: typeof fetch
  apiBaseUrl?: string
}

export class GitHubRestIssueAdapter implements GitHubIssueAdapter {
  constructor(private readonly options: GitHubRestIssueAdapterOptions) {}

  async createIssue(input: GitHubIssueCreateInput): Promise<{
    issueNumber: number
    issueUrl: string
    author?: string
  }> {
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.')
    const apiBase = (this.options.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '')
    const response = await fetchImpl(
      `${apiBase}/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.name)}/issues`,
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${await this.options.token()}`,
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28'
        },
        body: JSON.stringify({ title: input.title, body: input.body })
      }
    )
    const body = await response.json().catch(() => undefined) as {
      number?: unknown
      html_url?: unknown
      user?: { login?: unknown }
      message?: unknown
    } | undefined
    if (!response.ok) {
      const message = typeof body?.message === 'string' ? body.message : `GitHub returned HTTP ${response.status}.`
      throw new Error(message)
    }
    if (!Number.isInteger(body?.number) || typeof body?.html_url !== 'string') {
      throw new Error('GitHub returned an invalid Issue response.')
    }
    const author = typeof body.user?.login === 'string' ? body.user.login : undefined
    return {
      issueNumber: body.number as number,
      issueUrl: body.html_url,
      ...(author ? { author } : {})
    }
  }
}
