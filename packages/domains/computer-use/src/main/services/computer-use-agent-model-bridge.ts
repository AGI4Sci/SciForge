import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import type {
  DomainMainAgentCanonicalObservation,
  DomainMainAgentExecutionHost
} from '@sciforge/domain-sdk'

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
      ...(prepared.canonicalObservation
        ? { canonicalObservation: prepared.canonicalObservation }
        : {}),
      workspaceRoot: options.workspaceRoot,
      allowedTools: [],
      mode: 'plan',
      signal: controller.signal
    })
    const text = result.text.trim()
    if (!text) throw new Error('Host Agent returned an empty Computer Use planning response.')
    if (prepared.forcedFunction) {
      const argumentsValue = parseForcedFunctionResult(text, prepared.forcedFunction.name)
      sendJson(response, 200, {
        output_text: '',
        output: [{
          type: 'function_call',
          id: `fc_${randomUUID()}`,
          call_id: `call_${randomUUID()}`,
          name: prepared.forcedFunction.name,
          arguments: JSON.stringify(argumentsValue)
        }]
      })
      return
    }
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
  forcedFunction: { name: string; parameters: unknown } | null
  canonicalObservation: DomainMainAgentCanonicalObservation | null
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
  const metadata = objectRecord(body.metadata)
  const semanticObservation = metadata?.sciforge_observation_mode === 'semantic'
  if (imageUrls.length === 0 && !semanticObservation) {
    throw new Error('Computer Use planning request requires a screenshot or trusted semantic observation.')
  }
  if (imageUrls.length > 4) throw new Error('Computer Use planning request exceeds the four-image limit.')
  if (semanticObservation) {
    prompt.push(
      '# Observation mode',
      'The current semantic tree in the conversation is the canonical target-bound observation. No screenshot is expected for this UI Automation request.'
    )
  }
  const canonicalObservation = semanticObservation
    ? canonicalObservationFromMetadata(metadata)
    : null
  const forcedFunction = forcedFunctionFromRequest(body)
  prompt.push('# Output constraint')
  if (forcedFunction) {
    prompt.push(
      `Return exactly one JSON object with this shape: {"name":${JSON.stringify(forcedFunction.name)},"arguments":{...}}.`,
      'The arguments must satisfy this JSON Schema:',
      JSON.stringify(forcedFunction.parameters),
      'Do not use Markdown, prose, XML, or an actual tool call.'
    )
  } else {
    prompt.push('Return exactly the response format requested in the instructions. Do not call tools.')
  }
  const text = prompt.join('\n\n')
  if (text.length > 1_000_000) throw new Error('Computer Use planning prompt exceeds the 1 MB text limit.')
  return { prompt: text, imageUrls, forcedFunction, canonicalObservation }
}

function canonicalObservationFromMetadata(
  metadata: Record<string, unknown> | null
): DomainMainAgentCanonicalObservation {
  const value = objectRecord(metadata?.sciforge_semantic_observation)
  const targetId = typeof value?.targetId === 'string' ? value.targetId.trim() : ''
  const revisionValue = value?.revision
  const revision = typeof revisionValue === 'string' || typeof revisionValue === 'number'
    ? String(revisionValue).trim()
    : ''
  const rawTree = Array.isArray(value?.semanticTree) ? value.semanticTree : null
  const semanticTree = rawTree?.every((node) => objectRecord(node) !== null)
    ? rawTree as Array<Record<string, unknown>>
    : null
  if (!targetId || targetId.length > 1_024 || !revision || revision.length > 256 || !semanticTree) {
    throw new Error('Trusted semantic observation metadata is missing or invalid.')
  }
  if (semanticTree.length > 256 || JSON.stringify(semanticTree).length > 64_000) {
    throw new Error('Trusted semantic observation metadata exceeds its bounded limits.')
  }
  return {
    kind: 'target-semantic-tree',
    targetId,
    revision,
    semanticTree
  }
}

function forcedFunctionFromRequest(body: Record<string, unknown>): {
  name: string
  parameters: unknown
} | null {
  const choice = objectRecord(body.tool_choice)
  if (choice?.type !== 'function' || typeof choice.name !== 'string' || !choice.name) return null
  const tools = Array.isArray(body.tools) ? body.tools : []
  for (const candidate of tools) {
    const tool = objectRecord(candidate)
    if (tool?.type === 'function' && tool.name === choice.name) {
      return { name: choice.name, parameters: tool.parameters ?? {} }
    }
  }
  throw new Error(`Forced Computer Use function ${choice.name} is not declared.`)
}

function parseForcedFunctionResult(text: string, expectedName: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Host Agent did not return the required JSON function result.')
  }
  const result = objectRecord(parsed)
  const argumentsValue = objectRecord(result?.arguments)
  if (result?.name !== expectedName || !argumentsValue) {
    throw new Error('Host Agent returned an invalid forced function result.')
  }
  return argumentsValue
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
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
