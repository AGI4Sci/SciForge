import type { ZodType } from 'zod'
import { ZulipProviderError, isZulipProviderError } from './errors.js'
import { redactZulipDiagnostic } from './redaction.js'

export type ZulipCredentialResolver = () => Promise<{ apiKey: string }>
export type ZulipFetch = (input: string, init?: RequestInit) => Promise<Response>

export type ZulipProviderDiagnostic = {
  level: 'debug' | 'info' | 'warn' | 'error'
  code: string
  message: string
  detail?: unknown
}

export type ZulipDiagnosticLogger = (diagnostic: ZulipProviderDiagnostic) => void

export type ZulipHttpClientOptions = {
  realmUrl: string
  botEmail: string
  resolveCredential: ZulipCredentialResolver
  fetch?: ZulipFetch
  logger?: ZulipDiagnosticLogger
  sleep?: (milliseconds: number) => Promise<void>
  maxResponseBytes?: number
  maxAttempts?: number
  initialRetryDelayMs?: number
  maxRetryDelayMs?: number
}

export type ZulipRequestOptions<T> = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: URLSearchParams
  body?: URLSearchParams
  schema: ZodType<T>
  signal?: AbortSignal
  retry?: 'never' | 'safe'
}

function normalizeRealmUrl(raw: string): string {
  const value = raw.trim()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('A valid Zulip realm URL is required.')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Zulip realm URL must use HTTPS (HTTP is allowed only for loopback testing).')
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Zulip realm URL contains unsupported components.')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url.href
}

function normalizeBotEmail(raw: string): string {
  const value = raw.trim()
  if (!value || !value.includes('@') || value.length > 320) {
    throw new TypeError('A valid Zulip bot email is required.')
  }
  return value
}

function basicAuthorization(email: string, apiKey: string): string {
  return `Basic ${Buffer.from(`${email}:${apiKey}`, 'utf8').toString('base64')}`
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, Math.ceil(seconds * 1_000))
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.max(0, Math.min(60_000, date - Date.now()))
}

function statusError(
  status: number,
  statusText: string,
  retryAfterMs?: number,
  providerCode?: string
): ZulipProviderError {
  if (status === 400 && providerCode === 'BAD_EVENT_QUEUE_ID') {
    return new ZulipProviderError('queue_expired', 'Zulip event queue expired.', { status })
  }
  if (status === 401) {
    return new ZulipProviderError('authentication_failed', 'Zulip rejected the provider credential.', { status })
  }
  if (status === 403) {
    return new ZulipProviderError('permission_denied', 'Zulip denied the provider operation.', { status })
  }
  if (status === 404) return new ZulipProviderError('not_found', 'The Zulip resource was not found.', { status })
  if (status === 429) {
    return new ZulipProviderError('rate_limited', 'Zulip rate-limited the provider operation.', {
      status,
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs })
    })
  }
  if (status >= 500) {
    return new ZulipProviderError('provider_unavailable', 'Zulip is temporarily unavailable.', {
      status,
      retryable: true
    })
  }
  return new ZulipProviderError(
    'invalid_payload',
    `Zulip rejected the request (${status} ${statusText || 'HTTP error'}).`,
    { status }
  )
}

export class ZulipHttpClient {
  readonly realmId: string
  readonly botEmail: string
  private readonly baseUrl: string
  private readonly resolveCredential: ZulipCredentialResolver
  private readonly fetch: ZulipFetch
  private readonly logger: ZulipDiagnosticLogger | undefined
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly maxResponseBytes: number
  private readonly maxAttempts: number
  private readonly initialRetryDelayMs: number
  private readonly maxRetryDelayMs: number

  constructor(options: ZulipHttpClientOptions) {
    this.baseUrl = normalizeRealmUrl(options.realmUrl)
    this.realmId = this.baseUrl.replace(/\/$/, '')
    this.botEmail = normalizeBotEmail(options.botEmail)
    this.resolveCredential = options.resolveCredential
    this.fetch = options.fetch ?? fetch
    this.logger = options.logger
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.maxResponseBytes = options.maxResponseBytes ?? 2_000_000
    this.maxAttempts = options.maxAttempts ?? 3
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 500
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 5_000
  }

  async request<T>(path: string, options: ZulipRequestOptions<T>): Promise<T> {
    const attempts = options.retry === 'safe' ? this.maxAttempts : 1
    let lastError: unknown
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.requestOnce(path, options)
      } catch (error) {
        lastError = error
        const retryable = isZulipProviderError(error) && error.retryable
        if (!retryable || attempt === attempts || options.signal?.aborted) throw error
        const delayMs = error.retryAfterMs ?? Math.min(
          this.maxRetryDelayMs,
          this.initialRetryDelayMs * (2 ** Math.max(0, attempt - 1))
        )
        this.emit({
          level: 'warn',
          code: 'zulip.request.retry',
          message: 'Retrying a safe Zulip provider request.',
          detail: { attempt, delayMs, errorCode: error.code, status: error.status }
        })
        await this.sleep(delayMs)
      }
    }
    throw lastError
  }

  private async requestOnce<T>(path: string, options: ZulipRequestOptions<T>): Promise<T> {
    if (options.signal?.aborted) throw new ZulipProviderError('aborted', 'Zulip request was aborted.')
    const credential = await this.resolveCredential()
    const apiKey = credential.apiKey.trim()
    if (!apiKey) throw new ZulipProviderError('authentication_failed', 'Zulip provider credential is unavailable.')

    const relativePath = path.replace(/^\/+/, '')
    const url = new URL(relativePath, this.baseUrl)
    if (options.query) url.search = options.query.toString()
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: basicAuthorization(this.botEmail, apiKey)
    })
    if (options.body) headers.set('Content-Type', 'application/x-www-form-urlencoded')

    let response: Response
    try {
      response = await this.fetch(url.toString(), {
        method: options.method ?? 'GET',
        headers,
        ...(options.body ? { body: options.body } : {}),
        ...(options.signal ? { signal: options.signal } : {})
      })
    } catch (error) {
      if (options.signal?.aborted) throw new ZulipProviderError('aborted', 'Zulip request was aborted.')
      throw new ZulipProviderError('provider_unavailable', 'Could not reach Zulip.', {
        retryable: true,
        cause: error
      })
    }

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > this.maxResponseBytes) {
      throw new ZulipProviderError('payload_too_large', 'Zulip response exceeds the provider limit.', {
        status: response.status
      })
    }
    const raw = await response.text()
    if (utf8Bytes(raw) > this.maxResponseBytes) {
      throw new ZulipProviderError('payload_too_large', 'Zulip response exceeds the provider limit.', {
        status: response.status
      })
    }
    if (!response.ok) {
      let providerCode: string | undefined
      try {
        const errorBody = JSON.parse(raw) as { code?: unknown }
        if (typeof errorBody.code === 'string') providerCode = errorBody.code
      } catch {
        // HTTP status remains authoritative when Zulip returns a non-JSON error page.
      }
      throw statusError(
        response.status,
        response.statusText,
        parseRetryAfter(response.headers.get('retry-after')),
        providerCode
      )
    }

    let parsed: unknown
    try {
      parsed = raw ? JSON.parse(raw) : {}
    } catch (error) {
      throw new ZulipProviderError('invalid_payload', 'Zulip returned invalid JSON.', {
        status: response.status,
        cause: error
      })
    }
    const validated = options.schema.safeParse(parsed)
    if (!validated.success) {
      throw new ZulipProviderError('invalid_payload', 'Zulip returned a response outside the provider contract.', {
        status: response.status,
        detail: validated.error.issues.map((issue) => ({ code: issue.code, path: issue.path.slice(0, 8) }))
      })
    }
    return validated.data
  }

  private emit(diagnostic: ZulipProviderDiagnostic): void {
    if (!this.logger) return
    this.logger({
      ...diagnostic,
      ...(diagnostic.detail === undefined ? {} : { detail: redactZulipDiagnostic(diagnostic.detail) })
    })
  }
}
