import { z } from 'zod'
import {
  capabilityJsonValueSchema,
  type CapabilityJsonValue
} from './capability-broker'

export const CAPABILITY_TRANSPORT_ERROR_CONTRACT_VERSION = 1

export const capabilityTransportErrorCategorySchema = z.enum(['rejected', 'failed'])
export type CapabilityTransportErrorCategory = z.infer<
  typeof capabilityTransportErrorCategorySchema
>

export const capabilityTransportErrorSchema = z.object({
  code: z.string().trim().min(1).max(128).regex(/^[a-z][a-z0-9_]*$/u),
  message: z.string().trim().min(1).max(2_000),
  category: capabilityTransportErrorCategorySchema,
  retryable: z.boolean(),
  details: capabilityJsonValueSchema.optional()
}).strict()
export type CapabilityTransportErrorData = z.infer<typeof capabilityTransportErrorSchema>

export type CapabilityTransportEnvelope<Value> =
  | Readonly<{
      contractVersion: typeof CAPABILITY_TRANSPORT_ERROR_CONTRACT_VERSION
      ok: true
      payload: Value
    }>
  | Readonly<{
      contractVersion: typeof CAPABILITY_TRANSPORT_ERROR_CONTRACT_VERSION
      ok: false
      error: CapabilityTransportErrorData
    }>

const capabilityTransportEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({
    contractVersion: z.literal(CAPABILITY_TRANSPORT_ERROR_CONTRACT_VERSION),
    ok: z.literal(true),
    payload: z.unknown()
  }).strict(),
  z.object({
    contractVersion: z.literal(CAPABILITY_TRANSPORT_ERROR_CONTRACT_VERSION),
    ok: z.literal(false),
    error: capabilityTransportErrorSchema
  }).strict()
])

const MAX_DETAILS_DEPTH = 4
const MAX_DETAILS_ARRAY_ITEMS = 32
const MAX_DETAILS_OBJECT_KEYS = 32
const MAX_DETAILS_STRING_CHARACTERS = 1_024
const MAX_DETAILS_SERIALIZED_BYTES = 8 * 1_024
const UNSAFE_DETAIL_KEY_PARTS = new Set([
  'authorization',
  'cause',
  'connection',
  'credential',
  'directory',
  'endpoint',
  'file',
  'handle',
  'password',
  'path',
  'pathname',
  'secret',
  'token',
  'uri',
  'url'
])

const RETRYABLE_CODES = new Set([
  'observation_failed',
  'principal_changed',
  'principal_unavailable',
  'resource_retiring'
])

type StructuredCapabilityError = Readonly<{
  code?: unknown
  message?: unknown
  category?: unknown
  retryable?: unknown
  details?: unknown
}>

function safeDetails(value: unknown, depth = 0): CapabilityJsonValue | undefined {
  if (depth > MAX_DETAILS_DEPTH) return undefined
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return value.slice(0, MAX_DETAILS_STRING_CHARACTERS)
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DETAILS_ARRAY_ITEMS)
      .map((item) => safeDetails(item, depth + 1))
      .filter((item): item is CapabilityJsonValue => item !== undefined)
  }
  if (!value || typeof value !== 'object') return undefined

  const projected: Record<string, CapabilityJsonValue> = {}
  for (const [key, child] of Object.entries(value).slice(0, MAX_DETAILS_OBJECT_KEYS)) {
    const normalizedKeyParts = key
      .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
      .toLowerCase()
      .split(/[^a-z0-9]+/gu)
      .filter(Boolean)
    if (normalizedKeyParts.some((part) => UNSAFE_DETAIL_KEY_PARTS.has(part))) continue
    const safeChild = safeDetails(child, depth + 1)
    if (safeChild !== undefined) projected[key] = safeChild
  }
  return Object.keys(projected).length > 0 ? projected : undefined
}

function boundedDetails(value: unknown): CapabilityJsonValue | undefined {
  const projected = safeDetails(value)
  if (projected === undefined) return undefined
  return new TextEncoder().encode(JSON.stringify(projected)).byteLength <= MAX_DETAILS_SERIALIZED_BYTES
    ? projected
    : undefined
}

function normalizedMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const message = value.trim().slice(0, 2_000)
  return message || fallback
}

export function capabilityTransportSuccess<Value>(
  payload: Value
): CapabilityTransportEnvelope<Value> {
  return Object.freeze({
    contractVersion: CAPABILITY_TRANSPORT_ERROR_CONTRACT_VERSION,
    ok: true as const,
    payload
  })
}

export function capabilityTransportFailure(
  value: unknown
): CapabilityTransportEnvelope<never> {
  const error = value && typeof value === 'object'
    ? value as StructuredCapabilityError
    : undefined
  const category = capabilityTransportErrorCategorySchema.safeParse(error?.category)
  const codeIsValid = typeof error?.code === 'string'
    && /^[a-z][a-z0-9_]{0,127}$/u.test(error.code)
  const structured = codeIsValid && category.success
  const code = structured ? error.code as string : 'capability_transport_failed'
  const details = structured ? boundedDetails(error?.details) : undefined
  return Object.freeze({
    contractVersion: CAPABILITY_TRANSPORT_ERROR_CONTRACT_VERSION,
    ok: false as const,
    error: Object.freeze({
      code,
      message: structured
        ? normalizedMessage(
            error?.message,
            'The capability request failed before a safe result could be delivered.'
          )
        : 'The capability request failed before a safe result could be delivered.',
      category: structured ? category.data : 'failed',
      retryable: structured && typeof error?.retryable === 'boolean'
        ? error.retryable && code !== 'outcome_unknown'
        : RETRYABLE_CODES.has(code),
      ...(details === undefined ? {} : { details })
    })
  })
}

export class CapabilityTransportError extends Error {
  readonly code: string
  readonly category: CapabilityTransportErrorCategory
  readonly retryable: boolean
  readonly details?: CapabilityJsonValue

  constructor(data: CapabilityTransportErrorData) {
    const parsed = capabilityTransportErrorSchema.parse(data)
    super(parsed.message)
    this.name = 'CapabilityTransportError'
    this.code = parsed.code
    this.category = parsed.category
    this.retryable = parsed.retryable
    this.details = parsed.details
  }
}

export function unwrapCapabilityTransportEnvelope<Value>(value: unknown): Value {
  const parsed = capabilityTransportEnvelopeSchema.safeParse(value)
  if (!parsed.success) {
    throw new CapabilityTransportError({
      code: 'invalid_transport_response',
      message: 'The capability transport returned an invalid response.',
      category: 'failed',
      retryable: false
    })
  }
  if (!parsed.data.ok) throw new CapabilityTransportError(parsed.data.error)
  return parsed.data.payload as Value
}
