import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const CAPABILITY_RUNTIME_BRIDGE_VERSION = 1
export const CAPABILITY_RUNTIME_BRIDGE_SERVER_ID = 'sciforge_capabilities'
export const CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES = Object.freeze([
  'sciforge_discover',
  'sciforge_observe',
  'sciforge_invoke',
  'sciforge_events'
] as const)
export type CapabilityRuntimeBridgeToolName = typeof CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES[number]

export const CAPABILITY_RUNTIME_BRIDGE_CATALOG_FILE = 'catalog.json'
export const CAPABILITY_RUNTIME_BRIDGE_REQUESTS_DIR = 'requests'
export const CAPABILITY_RUNTIME_BRIDGE_RESPONSES_DIR = 'responses'
export const CAPABILITY_RUNTIME_BRIDGE_MAX_FILE_BYTES = 1024 * 1024
export const CAPABILITY_RUNTIME_BRIDGE_MAX_CLOCK_SKEW_MS = 30_000

export type CapabilityRuntimeBridgeToolDefinition = Readonly<{
  type: 'function'
  name: CapabilityRuntimeBridgeToolName
  description: string
  inputSchema: Record<string, unknown>
}>

export type CapabilityRuntimeBridgeContext = Readonly<{
  requestId: string
  threadId: string
  turnId: string
  callId?: string
  workspaceId?: string
}>

export type CapabilityRuntimeBridgeRequestPayload = Readonly<{
  version: typeof CAPABILITY_RUNTIME_BRIDGE_VERSION
  requestId: string
  createdAt: string
  nonce: string
  tool: CapabilityRuntimeBridgeToolName
  arguments: Record<string, unknown>
  context: CapabilityRuntimeBridgeContext
}>

export type CapabilityRuntimeBridgeRequest = CapabilityRuntimeBridgeRequestPayload & Readonly<{
  signature: string
}>

export type CapabilityRuntimeBridgeError = Readonly<{
  code: string
  message: string
  retryable: boolean
  details?: Record<string, unknown>
}>

export type CapabilityRuntimeBridgeResponsePayload = Readonly<{
  version: typeof CAPABILITY_RUNTIME_BRIDGE_VERSION
  requestId: string
  completedAt: string
  result: { ok: true; value: unknown } | { ok: false; error: CapabilityRuntimeBridgeError }
}>

export type CapabilityRuntimeBridgeResponse = CapabilityRuntimeBridgeResponsePayload & Readonly<{
  signature: string
}>

export type CapabilityRuntimeBridgeCatalogPayload = Readonly<{
  version: typeof CAPABILITY_RUNTIME_BRIDGE_VERSION
  generatedAt: string
  capabilityIds: readonly string[]
  tools: readonly CapabilityRuntimeBridgeToolDefinition[]
}>

export type CapabilityRuntimeBridgeCatalog = CapabilityRuntimeBridgeCatalogPayload & Readonly<{
  signature: string
}>

export function capabilityRuntimeBridgePaths(rootDir: string) {
  return {
    rootDir,
    catalog: join(rootDir, CAPABILITY_RUNTIME_BRIDGE_CATALOG_FILE),
    requests: join(rootDir, CAPABILITY_RUNTIME_BRIDGE_REQUESTS_DIR),
    responses: join(rootDir, CAPABILITY_RUNTIME_BRIDGE_RESPONSES_DIR)
  }
}

export function capabilityRuntimeBridgeRequestPath(rootDir: string, requestId: string): string {
  return join(capabilityRuntimeBridgePaths(rootDir).requests, `${safeRequestId(requestId)}.json`)
}

export function capabilityRuntimeBridgeResponsePath(rootDir: string, requestId: string): string {
  return join(capabilityRuntimeBridgePaths(rootDir).responses, `${safeRequestId(requestId)}.json`)
}

export function signCapabilityRuntimeBridgeRequest(
  secret: string,
  payload: CapabilityRuntimeBridgeRequestPayload
): CapabilityRuntimeBridgeRequest {
  return { ...payload, signature: signature(secret, payload) }
}

export function signCapabilityRuntimeBridgeResponse(
  secret: string,
  payload: CapabilityRuntimeBridgeResponsePayload
): CapabilityRuntimeBridgeResponse {
  return { ...payload, signature: signature(secret, payload) }
}

export function signCapabilityRuntimeBridgeCatalog(
  secret: string,
  payload: CapabilityRuntimeBridgeCatalogPayload
): CapabilityRuntimeBridgeCatalog {
  return { ...payload, signature: signature(secret, payload) }
}

export function parseCapabilityRuntimeBridgeRequest(
  value: unknown,
  secret: string,
  now = Date.now(),
  maxClockSkewMs = CAPABILITY_RUNTIME_BRIDGE_MAX_CLOCK_SKEW_MS
): CapabilityRuntimeBridgeRequest {
  const record = signedRecord(value, secret)
  assertVersion(record)
  const requestId = requiredOpaqueId(record.requestId, 'requestId')
  const createdAt = requiredTimestamp(record.createdAt, 'createdAt')
  if (Math.abs(now - Date.parse(createdAt)) > maxClockSkewMs) {
    throw new CapabilityRuntimeBridgeProtocolError('stale_bridge_request', 'The capability bridge request is outside the accepted time window.')
  }
  const nonce = requiredOpaqueId(record.nonce, 'nonce')
  const tool = bridgeToolName(record.tool)
  const argumentsValue = plainRecord(record.arguments, 'arguments')
  const contextValue = plainRecord(record.context, 'context')
  const context: CapabilityRuntimeBridgeContext = {
    requestId: requiredString(contextValue.requestId, 'context.requestId'),
    threadId: requiredString(contextValue.threadId, 'context.threadId'),
    turnId: requiredString(contextValue.turnId, 'context.turnId'),
    ...(optionalString(contextValue.callId) ? { callId: optionalString(contextValue.callId) } : {}),
    ...(optionalString(contextValue.workspaceId) ? { workspaceId: optionalString(contextValue.workspaceId) } : {})
  }
  return {
    version: CAPABILITY_RUNTIME_BRIDGE_VERSION,
    requestId,
    createdAt,
    nonce,
    tool,
    arguments: argumentsValue,
    context,
    signature: requiredString(record.signature, 'signature')
  }
}

export function parseCapabilityRuntimeBridgeResponse(
  value: unknown,
  secret: string,
  expectedRequestId?: string
): CapabilityRuntimeBridgeResponse {
  const record = signedRecord(value, secret)
  assertVersion(record)
  const requestId = requiredOpaqueId(record.requestId, 'requestId')
  if (expectedRequestId && requestId !== expectedRequestId) {
    throw new CapabilityRuntimeBridgeProtocolError('bridge_response_mismatch', 'The capability bridge response does not match the request.')
  }
  const completedAt = requiredTimestamp(record.completedAt, 'completedAt')
  const rawResult = plainRecord(record.result, 'result')
  let result: CapabilityRuntimeBridgeResponsePayload['result']
  if (rawResult.ok === true) {
    result = { ok: true, value: rawResult.value }
  } else if (rawResult.ok === false) {
    const rawError = plainRecord(rawResult.error, 'result.error')
    result = {
      ok: false,
      error: {
        code: requiredString(rawError.code, 'result.error.code'),
        message: requiredString(rawError.message, 'result.error.message'),
        retryable: rawError.retryable === true,
        ...(rawError.details === undefined ? {} : { details: plainRecord(rawError.details, 'result.error.details') })
      }
    }
  } else {
    throw new CapabilityRuntimeBridgeProtocolError('invalid_bridge_payload', 'Capability bridge response result.ok must be a boolean.')
  }
  return {
    version: CAPABILITY_RUNTIME_BRIDGE_VERSION,
    requestId,
    completedAt,
    result,
    signature: requiredString(record.signature, 'signature')
  }
}

export function parseCapabilityRuntimeBridgeCatalog(
  value: unknown,
  secret: string
): CapabilityRuntimeBridgeCatalog {
  const record = signedRecord(value, secret)
  assertVersion(record)
  const tools = Array.isArray(record.tools)
    ? record.tools.map(parseToolDefinition)
    : invalid('Capability bridge catalog tools must be an array.')
  const names = tools.map((tool) => tool.name)
  if (names.length !== CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES.length ||
      CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES.some((name) => !names.includes(name))) {
    throw new CapabilityRuntimeBridgeProtocolError(
      'invalid_bridge_catalog',
      'Capability bridge catalog must expose exactly the four SciForge meta-tools.'
    )
  }
  const capabilityIds = Array.isArray(record.capabilityIds)
    ? record.capabilityIds.map((entry, index) => requiredString(entry, `capabilityIds[${index}]`))
    : invalid('Capability bridge catalog capabilityIds must be an array.')
  return {
    version: CAPABILITY_RUNTIME_BRIDGE_VERSION,
    generatedAt: requiredTimestamp(record.generatedAt, 'generatedAt'),
    capabilityIds,
    tools,
    signature: requiredString(record.signature, 'signature')
  }
}

export async function atomicWriteCapabilityRuntimeBridgeJson(
  path: string,
  value: unknown
): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.${safeRequestId(`${process.pid}-${Date.now()}-${Math.random()}`)}.tmp`)
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

export class CapabilityRuntimeBridgeProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CapabilityRuntimeBridgeProtocolError'
  }
}

function signedRecord(value: unknown, secret: string): Record<string, unknown> {
  if (secret.length < 32) {
    throw new CapabilityRuntimeBridgeProtocolError('invalid_bridge_secret', 'Capability bridge authentication secret is invalid.')
  }
  const record = plainRecord(value, 'payload')
  const supplied = requiredString(record.signature, 'signature')
  const { signature: _signature, ...payload } = record
  const expected = signature(secret, payload)
  const suppliedBuffer = Buffer.from(supplied)
  const expectedBuffer = Buffer.from(expected)
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw new CapabilityRuntimeBridgeProtocolError('bridge_authentication_failed', 'Capability bridge authentication failed.')
  }
  return record
}

function signature(secret: string, value: unknown): string {
  return createHmac('sha256', secret).update(stableStringify(value)).digest('base64url')
}

function parseToolDefinition(value: unknown): CapabilityRuntimeBridgeToolDefinition {
  const record = plainRecord(value, 'tool')
  if (record.type !== 'function') invalid('Capability bridge tool type must be function.')
  return {
    type: 'function',
    name: bridgeToolName(record.name),
    description: requiredString(record.description, 'tool.description'),
    inputSchema: plainRecord(record.inputSchema, 'tool.inputSchema')
  }
}

function bridgeToolName(value: unknown): CapabilityRuntimeBridgeToolName {
  if (typeof value === 'string' && (CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES as readonly string[]).includes(value)) {
    return value as CapabilityRuntimeBridgeToolName
  }
  throw new CapabilityRuntimeBridgeProtocolError('unknown_bridge_tool', 'Unknown capability bridge tool.')
}

function assertVersion(record: Record<string, unknown>): void {
  if (record.version !== CAPABILITY_RUNTIME_BRIDGE_VERSION) {
    throw new CapabilityRuntimeBridgeProtocolError('unsupported_bridge_version', 'Unsupported capability bridge protocol version.')
  }
}

function plainRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CapabilityRuntimeBridgeProtocolError('invalid_bridge_payload', `${field} must be an object.`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CapabilityRuntimeBridgeProtocolError('invalid_bridge_payload', `${field} must be a non-empty string.`)
  }
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function requiredOpaqueId(value: unknown, field: string): string {
  const text = requiredString(value, field)
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(text)) {
    throw new CapabilityRuntimeBridgeProtocolError('invalid_bridge_payload', `${field} must be an opaque identifier.`)
  }
  return text
}

function requiredTimestamp(value: unknown, field: string): string {
  const text = requiredString(value, field)
  if (!Number.isFinite(Date.parse(text))) {
    throw new CapabilityRuntimeBridgeProtocolError('invalid_bridge_payload', `${field} must be an ISO timestamp.`)
  }
  return text
}

function safeRequestId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 128)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)])
  )
}

function invalid(message: string): never {
  throw new CapabilityRuntimeBridgeProtocolError('invalid_bridge_payload', message)
}
