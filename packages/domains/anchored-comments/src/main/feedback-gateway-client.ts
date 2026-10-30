import {
  feedbackGatewayResultSchema,
  productFeedbackPacketSchema,
  type FeedbackGatewayResult,
  type FeedbackSubmissionResult,
  type ProductFeedbackPacket
} from '../contract'

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_ATTEMPTS = 2

export type FeedbackGatewayClientOptions = {
  baseUrl: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxAttempts?: number
  authToken?: string
}

function normalizeGatewayBaseUrl(value: string): string {
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:') {
    throw new Error('SciForge feedback gateway must use HTTPS.')
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

function responseMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const message = (body as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message.slice(0, 2_000)
  }
  return `Feedback gateway request failed with HTTP ${status}.`
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) return undefined
  return response.json().catch(() => undefined)
}

export class FeedbackGatewayClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly maxAttempts: number
  private readonly authToken: string | null

  constructor(options: FeedbackGatewayClientOptions) {
    this.baseUrl = normalizeGatewayBaseUrl(options.baseUrl)
    const fetchImpl = options.fetchImpl ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.')
    this.fetchImpl = fetchImpl
    this.timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 120_000))
    this.maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 3))
    this.authToken = options.authToken?.trim() || null
  }

  async submit(unparsed: unknown): Promise<FeedbackSubmissionResult> {
    let packet: ProductFeedbackPacket
    try {
      packet = productFeedbackPacketSchema.parse(unparsed)
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Invalid feedback packet.',
        retryable: false
      }
    }

    let lastMessage = 'The feedback gateway did not respond.'
    let retryable = true
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/v1/feedback`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'idempotency-key': packet.idempotencyKey,
            ...(this.authToken ? { authorization: `Bearer ${this.authToken}` } : {})
          },
          body: JSON.stringify(packet),
          signal: AbortSignal.timeout(this.timeoutMs)
        })
        const body = await readJson(response)
        if (response.ok) {
          const parsed = feedbackGatewayResultSchema.safeParse(body)
          if (!parsed.success) {
            return {
              ok: false,
              message: 'Feedback gateway returned an invalid success response.',
              retryable: false
            }
          }
          if (parsed.data.idempotencyKey !== packet.idempotencyKey) {
            return {
              ok: false,
              message: 'Feedback gateway returned a mismatched idempotency key.',
              retryable: false
            }
          }
          return { ok: true, result: parsed.data }
        }
        retryable = retryableStatus(response.status)
        lastMessage = responseMessage(response.status, body)
        if (!retryable) break
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : 'Feedback gateway request failed.'
        retryable = true
      }
    }

    // A POST timeout can happen after GitHub accepted the Issue. Resolve the
    // stable key once before reporting a retryable failure to the renderer.
    if (retryable) {
      const existing = await this.getByIdempotencyKey(packet.idempotencyKey)
      if (existing) return { ok: true, result: existing }
    }
    return { ok: false, message: lastMessage.slice(0, 2_000), retryable }
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<FeedbackGatewayResult | null> {
    if (!idempotencyKey.trim() || idempotencyKey.length > 256) return null
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/v1/feedback/${encodeURIComponent(idempotencyKey)}`,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            ...(this.authToken ? { authorization: `Bearer ${this.authToken}` } : {})
          },
          signal: AbortSignal.timeout(this.timeoutMs)
        }
      )
      if (response.status === 404 || !response.ok) return null
      const parsed = feedbackGatewayResultSchema.safeParse(await readJson(response))
      if (!parsed.success || parsed.data.idempotencyKey !== idempotencyKey) return null
      return parsed.data
    } catch {
      return null
    }
  }
}

export function configuredFeedbackGatewayUrl(environment: NodeJS.ProcessEnv = process.env): string | null {
  const value = environment.SCIFORGE_FEEDBACK_GATEWAY_URL?.trim()
  if (!value) return null
  return normalizeGatewayBaseUrl(value)
}

export function configuredFeedbackGatewayToken(environment: NodeJS.ProcessEnv = process.env): string | null {
  return environment.SCIFORGE_FEEDBACK_GATEWAY_TOKEN?.trim() || null
}
