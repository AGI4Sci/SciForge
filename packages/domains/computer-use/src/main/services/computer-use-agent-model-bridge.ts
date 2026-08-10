import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk'

const MAX_REQUEST_BYTES = 32 * 1024 * 1024

export type ComputerUseAgentModelBridge = Readonly<{
  baseUrl: string
  token: string
  close: () => Promise<void>
}>

export async function startComputerUseAgentModelBridge(options: Readonly<{
  agentExecution: DomainMainAgentExecutionHost
  workspaceRoot: string
}>): Promise<ComputerUseAgentModelBridge> {
  const token = randomBytes(32).toString('base64url')
  const server = createServer((request, response) => {
    void handleRequest(request, response, token, options).catch((error) => {
      sendJson(response, 502, {
        error: {
          code: 'computer_use_planner_unavailable',
          message: error instanceof Error ? error.message : String(error)
        }
      })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('Computer Use agent model bridge did not bind a TCP port.')
  }
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    token,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections?.()
    })
  })
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  options: Readonly<{
    agentExecution: DomainMainAgentExecutionHost
    workspaceRoot: string
  }>
): Promise<void> {
  if (request.method !== 'POST' || request.url !== '/v1/responses') {
    sendJson(response, 404, { error: { code: 'not_found', message: 'Route not found.' } })
    return
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    sendJson(response, 401, { error: { code: 'unauthorized', message: 'Invalid bridge credential.' } })
    return
  }
  const body = await readJsonBody(request)
  if (body.stream === true) {
    sendJson(response, 400, {
      error: { code: 'unsupported_streaming', message: 'Computer Use planner requires stream=false.' }
    })
    return
  }
  const prepared = prepareAgentExecution(body)
  const controller = new AbortController()
  const abort = (): void => controller.abort(new Error('Computer Use planner request was cancelled.'))
  request.once('aborted', abort)
  response.once('close', abort)
  try {
    const result = await options.agentExecution.run({
      runtimeId: 'codex',
      prompt: prepared.prompt,
      imageUrls: prepared.imageUrls,
      workspaceRoot: options.workspaceRoot,
      allowedTools: [],
      mode: 'plan',
      signal: controller.signal
    })
    const text = result.text.trim()
    if (!text) throw new Error('Host Agent returned an empty Computer Use planning response.')
    sendJson(response, 200, {
      output_text: text,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }]
      }]
    })
  } finally {
    request.off('aborted', abort)
    response.off('close', abort)
  }
}

function prepareAgentExecution(body: Record<string, unknown>): {
  prompt: string
  imageUrls: string[]
} {
  const prompt: string[] = []
  const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : ''
  if (instructions) prompt.push('# Instructions', instructions)
  prompt.push('# Conversation')
  const imageUrls: string[] = []
  const input = Array.isArray(body.input) ? body.input : []
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const role = record.role === 'assistant' ? 'assistant' : 'user'
    const parts: string[] = []
    const content = Array.isArray(record.content) ? record.content : []
    for (const part of content) {
      if (!part || typeof part !== 'object' || Array.isArray(part)) continue
      const value = part as Record<string, unknown>
      if (
        (value.type === 'input_text' || value.type === 'output_text') &&
        typeof value.text === 'string'
      ) {
        parts.push(value.text)
      } else if (value.type === 'input_image' && typeof value.image_url === 'string') {
        assertDataImageUrl(value.image_url)
        imageUrls.push(value.image_url)
        parts.push(`[attached image ${imageUrls.length}]`)
      }
    }
    prompt.push(`## ${role}`, parts.join('\n'))
  }
  if (imageUrls.length === 0) throw new Error('Computer Use planning request requires a screenshot.')
  if (imageUrls.length > 4) throw new Error('Computer Use planning request exceeds the four-image limit.')
  prompt.push(
    '# Output constraint',
    'Return exactly the response format requested in the instructions. Do not call tools.'
  )
  const text = prompt.join('\n\n')
  if (text.length > 1_000_000) throw new Error('Computer Use planning prompt exceeds the 1 MB text limit.')
  return { prompt: text, imageUrls }
}

function assertDataImageUrl(value: string): void {
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    throw new Error('Computer Use planning images must be base64 PNG, JPEG, or WebP data URLs.')
  }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_REQUEST_BYTES) {
    throw new Error('Computer Use planner request exceeds the 32 MB limit.')
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += value.length
    if (length > MAX_REQUEST_BYTES) throw new Error('Computer Use planner request exceeds the 32 MB limit.')
    chunks.push(value)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Computer Use planner request must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.writableEnded || response.destroyed) return
  const payload = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(payload.length),
    'cache-control': 'no-store'
  })
  response.end(payload)
}
