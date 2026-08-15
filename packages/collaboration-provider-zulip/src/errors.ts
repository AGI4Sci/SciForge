export type ZulipProviderErrorCode =
  | 'authentication_failed'
  | 'permission_denied'
  | 'not_found'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'invalid_payload'
  | 'payload_too_large'
  | 'invalid_locator'
  | 'locator_missing'
  | 'locator_ambiguous'
  | 'locator_revision_mismatch'
  | 'delivery_uncertain'
  | 'retry_exhausted'
  | 'queue_expired'
  | 'aborted'

export type ZulipProviderErrorOptions = {
  retryable?: boolean
  retryAfterMs?: number
  status?: number
  detail?: unknown
  cause?: unknown
}

export class ZulipProviderError extends Error {
  readonly code: ZulipProviderErrorCode
  readonly retryable: boolean
  readonly retryAfterMs?: number
  readonly status?: number
  readonly detail?: unknown

  constructor(code: ZulipProviderErrorCode, message: string, options: ZulipProviderErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ZulipProviderError'
    this.code = code
    this.retryable = options.retryable ?? false
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs
    if (options.status !== undefined) this.status = options.status
    if (options.detail !== undefined) this.detail = options.detail
  }
}

export function isZulipProviderError(error: unknown): error is ZulipProviderError {
  return error instanceof ZulipProviderError
}
