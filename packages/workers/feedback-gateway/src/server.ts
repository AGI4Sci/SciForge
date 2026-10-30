import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { ZodError } from 'zod'

import { GitHubAdapterError } from './adapters/github-issues.js'
import { IdempotencyConflictError, type FeedbackGatewayService } from './service.js'

export const FEEDBACK_GATEWAY_SERVICE_ID = 'sciforge.feedback-gateway'
export const FEEDBACK_GATEWAY_SERVICE_VERSION = '0.1.0'
export const DEFAULT_MAX_BODY_BYTES = 75 * 1024 * 1024

export type FeedbackGatewayHttpOptions = {
  service: Pick<FeedbackGatewayService, 'submit' | 'get'>
  authToken?: string
  maxBodyBytes?: number
  now?: () => Date
}

class RequestBodyTooLargeError extends Error {}

export function createFeedbackGatewayServer(options: FeedbackGatewayHttpOptions): Server {
  const maxBodyBytes = Math.max(1_024, Math.min(options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES, 100 * 1024 * 1024))
  const now = options.now ?? (() => new Date())
  return createServer((request, response) => {
    handle(request, response, options, maxBodyBytes, now).catch((error) => sendError(response, error))
  })
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: FeedbackGatewayHttpOptions,
  maxBodyBytes: number,
  now: () => Date
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  if (request.method === 'GET' && url.pathname === '/health') {
    return sendJson(response, 200, {
      ok: true,
      service: FEEDBACK_GATEWAY_SERVICE_ID,
      version: FEEDBACK_GATEWAY_SERVICE_VERSION,
      checkedAt: now().toISOString()
    })
  }
  if (!authorized(request, options.authToken)) {
    return sendJson(response, 401, { message: 'Unauthorized.', retryable: false })
  }
  if (request.method === 'POST' && url.pathname === '/v1/feedback') {
    const contentType = request.headers['content-type'] ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return sendJson(response, 415, { message: 'Content-Type must be application/json.', retryable: false })
    }
    const body = await readJson(request, maxBodyBytes)
    const headerKey = firstHeader(request.headers['idempotency-key'])
    const bodyKey = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { idempotencyKey?: unknown }).idempotencyKey
      : undefined
    if (headerKey && headerKey !== bodyKey) {
      return sendJson(response, 400, { message: 'Idempotency-Key header does not match the feedback packet.', retryable: false })
    }
    const result = await options.service.submit(body)
    return sendJson(response, 201, result)
  }
  if (request.method === 'GET' && url.pathname.startsWith('/v1/feedback/')) {
    const encodedKey = url.pathname.slice('/v1/feedback/'.length)
    let key: string
    try {
      key = decodeURIComponent(encodedKey)
    } catch {
      return sendJson(response, 400, { message: 'Invalid idempotency key.', retryable: false })
    }
    if (key.length < 16 || key.length > 256 || key.includes('/')) {
      return sendJson(response, 400, { message: 'Invalid idempotency key.', retryable: false })
    }
    const result = await options.service.get(key)
    return result
      ? sendJson(response, 200, result)
      : sendJson(response, 404, { message: 'Feedback submission was not found.', retryable: false })
  }
  return sendJson(response, 404, { message: `No route for ${request.method} ${url.pathname}.`, retryable: false })
}

function authorized(request: IncomingMessage, expected: string | undefined): boolean {
  if (!expected) return true
  const authorization = firstHeader(request.headers.authorization)
  if (!authorization?.startsWith('Bearer ')) return false
  const supplied = Buffer.from(authorization.slice('Bearer '.length))
  const configured = Buffer.from(expected)
  return supplied.byteLength === configured.byteLength && timingSafeEqual(supplied, configured)
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const declaredLength = Number(firstHeader(request.headers['content-length']))
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) throw new RequestBodyTooLargeError()
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += bytes.byteLength
    if (length > maxBodyBytes) throw new RequestBodyTooLargeError()
    chunks.push(bytes)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new SyntaxError('Request body must be valid JSON.')
  }
}

function sendError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  if (error instanceof RequestBodyTooLargeError) {
    return sendJson(response, 413, { message: 'Feedback packet is too large.', retryable: false })
  }
  if (error instanceof SyntaxError || error instanceof ZodError) {
    return sendJson(response, 400, {
      message: error instanceof ZodError ? 'Feedback packet failed schema validation.' : error.message,
      retryable: false
    })
  }
  if (error instanceof IdempotencyConflictError) {
    return sendJson(response, 409, { message: error.message, retryable: false })
  }
  if (error instanceof GitHubAdapterError) {
    const status = error.upstreamStatus === 403 && !error.retryable ? 403 : 502
    return sendJson(response, status, { message: error.message, retryable: error.retryable })
  }
  const message = error instanceof Error ? error.message : 'Unexpected feedback gateway failure.'
  return sendJson(response, 500, { message: message.slice(0, 2_000), retryable: true })
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  response.end(JSON.stringify(body))
}
