import { createHash } from 'node:crypto'

import {
  FEEDBACK_SCHEMA_VERSION,
  feedbackGatewayResultSchema,
  productFeedbackPacketSchema,
  type FeedbackGatewayResult,
  type ProductFeedbackPacket,
  type StoredFeedbackSubmission
} from './contract.js'

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

export type FeedbackIdempotencyStore = {
  get: (idempotencyKey: string) => Promise<StoredFeedbackSubmission | null>
  put: (value: StoredFeedbackSubmission) => Promise<void>
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was reused for a different feedback packet.')
    this.name = 'IdempotencyConflictError'
  }
}

export class InMemoryFeedbackIdempotencyStore implements FeedbackIdempotencyStore {
  private readonly values = new Map<string, StoredFeedbackSubmission>()

  async get(idempotencyKey: string): Promise<StoredFeedbackSubmission | null> {
    const value = this.values.get(idempotencyKey)
    return value ? structuredClone(value) : null
  }

  async put(value: StoredFeedbackSubmission): Promise<void> {
    const existing = this.values.get(value.idempotencyKey)
    if (existing && existing.requestDigest !== value.requestDigest) throw new IdempotencyConflictError()
    this.values.set(value.idempotencyKey, structuredClone(value))
  }
}

export type FeedbackGatewayServiceOptions = {
  assets: FeedbackAssetPublisher
  github: GitHubIssueAdapter
  idempotency: FeedbackIdempotencyStore
  now?: () => Date
}

function requestDigest(packet: ProductFeedbackPacket): string {
  return createHash('sha256').update(JSON.stringify(packet)).digest('hex')
}

function screenshotBytes(
  screenshot: NonNullable<ProductFeedbackPacket['screenshots']>[number]
): Uint8Array {
  if (!screenshot.dataBase64) throw new Error(`Screenshot ${screenshot.kind} is missing image bytes.`)
  const bytes = Buffer.from(screenshot.dataBase64, 'base64')
  if (bytes.toString('base64') !== screenshot.dataBase64.replace(/\s/g, '')) {
    throw new Error(`Screenshot ${screenshot.kind} is not valid base64.`)
  }
  if (bytes.byteLength !== screenshot.asset.byteLength) {
    throw new Error(`Screenshot ${screenshot.kind} byte length does not match its asset reference.`)
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== screenshot.asset.digest) {
    throw new Error(`Screenshot ${screenshot.kind} failed digest verification.`)
  }
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (bytes.byteLength < pngSignature.byteLength || !Buffer.from(bytes.subarray(0, 8)).equals(pngSignature)) {
    throw new Error(`Screenshot ${screenshot.kind} is not a PNG image.`)
  }
  return bytes
}

function markdownCodeBlock(value: string): string {
  return '```text\n' + value.replace(/```/g, '``\\`') + '\n```'
}

function diagnosticSections(packet: ProductFeedbackPacket): string[] {
  const sections: string[] = []
  if (packet.environment) {
    const rows = Object.entries(packet.environment)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `- **${key.replace(/[*_`]/g, '\\$&')}**: ${value.replace(/\r?\n/g, ' ')}`)
    sections.push(`## Environment\n\n${rows.join('\n')}`)
  }
  if (packet.logs) sections.push(`<details>\n<summary>Selected logs</summary>\n\n${markdownCodeBlock(packet.logs)}\n\n</details>`)
  if (packet.conversationExcerpt) {
    sections.push(`<details>\n<summary>Selected conversation excerpt</summary>\n\n${markdownCodeBlock(packet.conversationExcerpt)}\n\n</details>`)
  }
  if (packet.workspacePaths) {
    sections.push(`<details>\n<summary>Selected workspace paths</summary>\n\n${markdownCodeBlock(packet.workspacePaths.join('\n'))}\n\n</details>`)
  }
  if (packet.fileMetadata) {
    sections.push(`<details>\n<summary>Selected file metadata</summary>\n\n${markdownCodeBlock(JSON.stringify(packet.fileMetadata, null, 2))}\n\n</details>`)
  }
  return sections
}

export function idempotencyMarker(idempotencyKey: string): string {
  return `sciforge-feedback:${createHash('sha256').update(idempotencyKey).digest('hex')}`
}

export function renderIssueBody(
  packet: ProductFeedbackPacket,
  assets: Array<{ kind: 'full_window' | 'focused'; url: string }>
): string {
  const images = assets.map((asset) => {
    const label = asset.kind === 'focused' ? 'Focused commented region' : 'Annotated SciForge window'
    return `![${label}](${asset.url})`
  })
  const sections = [packet.body]
  if (images.length > 0) sections.push(`## Visual evidence\n\n${images.join('\n\n')}`)
  sections.push(...diagnosticSections(packet))
  sections.push(`---\n<!-- ${idempotencyMarker(packet.idempotencyKey)} -->\nGenerated from an approved SciForge product-feedback packet.`)
  return sections.join('\n\n')
}

export class FeedbackGatewayService {
  private readonly inFlight = new Map<string, Promise<FeedbackGatewayResult>>()

  constructor(private readonly options: FeedbackGatewayServiceOptions) {}

  async submit(input: unknown): Promise<FeedbackGatewayResult> {
    const packet = productFeedbackPacketSchema.parse(input)
    const digest = requestDigest(packet)
    const existing = await this.options.idempotency.get(packet.idempotencyKey)
    if (existing) {
      if (existing.requestDigest !== digest) throw new IdempotencyConflictError()
      return feedbackGatewayResultSchema.parse(existing.result)
    }

    const active = this.inFlight.get(packet.idempotencyKey)
    if (active) return active
    const pending = this.create(packet, digest).finally(() => {
      if (this.inFlight.get(packet.idempotencyKey) === pending) this.inFlight.delete(packet.idempotencyKey)
    })
    this.inFlight.set(packet.idempotencyKey, pending)
    return pending
  }

  async get(idempotencyKey: string): Promise<FeedbackGatewayResult | null> {
    const stored = await this.options.idempotency.get(idempotencyKey)
    return stored ? feedbackGatewayResultSchema.parse(stored.result) : null
  }

  private async create(packet: ProductFeedbackPacket, digest: string): Promise<FeedbackGatewayResult> {
    const assets: Array<{ kind: 'full_window' | 'focused'; url: string }> = []
    for (const screenshot of packet.screenshots ?? []) {
      const bytes = screenshotBytes(screenshot)
      const published = await this.options.assets.publish({
        name: `${screenshot.asset.digest}-${screenshot.kind}.png`,
        mimeType: 'image/png',
        digest: screenshot.asset.digest,
        bytes
      })
      assets.push({ kind: screenshot.kind, url: new URL(published.url).toString() })
    }

    const issue = await this.options.github.createIssue({
      repository: packet.repository,
      title: packet.title,
      body: renderIssueBody(packet, assets),
      idempotencyKey: packet.idempotencyKey
    })
    const result = feedbackGatewayResultSchema.parse({
      schemaVersion: FEEDBACK_SCHEMA_VERSION,
      idempotencyKey: packet.idempotencyKey,
      issueNumber: issue.issueNumber,
      issueUrl: issue.issueUrl,
      ...(issue.author ? { author: issue.author } : {}),
      assetUrls: assets.map(({ url }) => url),
      createdAt: (this.options.now ?? (() => new Date()))().toISOString()
    })
    await this.options.idempotency.put({ idempotencyKey: packet.idempotencyKey, requestDigest: digest, result })
    return result
  }
}
