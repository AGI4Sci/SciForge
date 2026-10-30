import { createHash } from 'node:crypto'
import { z } from 'zod'

/** The only states a Host may publish for delivery after a provider turn. */
export const DeliveryAuditStatusSchema = z.enum([
  'delivered',
  'needs_continuation',
  'blocked'
])
export type DeliveryAuditStatus = z.infer<typeof DeliveryAuditStatusSchema>

const pathSchema = z.string().trim().min(1).max(8_192)
const jsonSchemaSchema = z.record(z.string().min(1).max(192), z.unknown())

const childSchema = z.object({
  id: z.string().trim().min(1).max(512),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'blocked'])
}).strict()

const requiredFileSchema = z.object({
  path: pathSchema,
  effect: z.enum(['created', 'modified', 'deleted']).optional()
}).strict()

const requiredReceiptSchema = z.object({
  path: pathSchema,
  operation: z.enum(['add', 'update', 'delete']).optional()
}).strict()

/**
 * A deliberately small structural view of the host-authenticated file effects
 * and patch receipts. Keeping this contract structural makes it usable by both
 * Codex and Claude adapters without importing either provider's protocol.
 */
const fileEffectSchema = z.object({
  kind: z.enum(['created', 'modified', 'deleted']),
  path: pathSchema
}).passthrough()

const fileEffectsSchema = z.object({
  contractVersion: z.literal(1),
  effects: z.array(fileEffectSchema),
  issues: z.array(z.object({
    code: z.string().trim().min(1).max(256),
    blocking: z.literal(true),
    message: z.string().trim().min(1).max(4_096),
    path: pathSchema.optional()
  }).passthrough())
}).passthrough()

const completionCheckObservationSchema = z.union([
  z.object({ ok: z.literal(true), passed: z.boolean(), clean: z.boolean() }).passthrough(),
  z.object({ ok: z.literal(false) }).passthrough()
])

const filePatchReceiptSchema = z.object({
  contractVersion: z.literal(1),
  kind: z.literal('host-authenticated-file-patch'),
  issuer: z.literal('sciforge.agent-runtime-host'),
  source: z.literal('codex-app-server-file-change'),
  callId: z.string().trim().min(1).max(512),
  executorSequence: z.number().int().positive(),
  path: pathSchema,
  operation: z.enum(['add', 'update', 'delete']),
  patchFormat: z.enum(['full-content', 'unified-hunks']),
  patchText: z.string().max(4 * 1024 * 1024),
  patchDigest: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict()

export const DeliveryAuditInputSchema = z.object({
  providerTurnState: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).default('completed'),
  /** Structured provider output. Natural-language text is intentionally ignored. */
  output: z.unknown().optional(),
  /** Provider-neutral JSON Schema supplied with the logical work request. */
  outputSchema: jsonSchemaSchema.optional(),
  /** Host-captured workspace effects at the terminal turn boundary. */
  fileEffects: fileEffectsSchema.optional(),
  /** Host-authenticated executor receipts (currently emitted by Codex). */
  filePatchReceipts: z.array(filePatchReceiptSchema).max(256).optional(),
  /** Child-agent lifecycle facts captured by the Host. */
  children: z.array(childSchema).max(256).optional(),
  /** Result of the read-only workspace completion-check capability. */
  completionChecks: completionCheckObservationSchema.optional(),
  requiredFiles: z.array(requiredFileSchema).max(128).optional(),
  requiredReceipts: z.array(requiredReceiptSchema).max(128).optional(),
  /** Require at least one positive, host-observable delivery assertion. */
  requireEvidence: z.boolean().default(true)
}).strict()
export type DeliveryAuditInput = z.input<typeof DeliveryAuditInputSchema>
export type ParsedDeliveryAuditInput = z.output<typeof DeliveryAuditInputSchema>

export type DeliveryAuditFinding = Readonly<{
  code:
  | 'invalid_contract'
  | 'output_missing'
  | 'output_schema_mismatch'
  | 'child_incomplete'
  | 'child_failed'
  | 'provider_turn_failed'
  | 'file_effect_capture_issue'
  | 'required_file_missing'
  | 'required_receipt_missing'
  | 'completion_check_failed'
  | 'completion_check_unavailable'
  | 'no_delivery_evidence'
  | 'invalid_receipt'
  severity: 'blocking' | 'warning'
  message: string
  path?: string
  childId?: string
  expected?: unknown
  actual?: unknown
}>

export type DeliveryAuditResult = Readonly<{
  ok: true
  status: DeliveryAuditStatus
  /** Alias used by Host work state reducers. */
  deliveryState: DeliveryAuditStatus
  canAutoContinue: boolean
  findings: readonly DeliveryAuditFinding[]
  evidence: Readonly<{
    outputSchemaValidated: boolean | null
    childrenTerminal: boolean | null
    completionChecksPassed: boolean | null
    requiredFilesSatisfied: boolean | null
    requiredReceiptsSatisfied: boolean | null
    positiveEvidence: boolean
  }>
  /** Stable digest for idempotent persistence and event deduplication. */
  evidenceDigest: string
}>

/**
 * Audits delivery using only structured Host evidence. A provider saying
 * "done" in natural language has no effect on this result.
 */
export function auditDelivery(input: DeliveryAuditInput): DeliveryAuditResult {
  const parsed = DeliveryAuditInputSchema.safeParse(input)
  if (!parsed.success) {
    return result('blocked', [{
      code: 'invalid_contract',
      severity: 'blocking',
      message: `Delivery audit contract is invalid: ${parsed.error.message}`
    }], emptyEvidence(), false)
  }
  return auditParsedDelivery(parsed.data)
}

export function auditParsedDelivery(input: ParsedDeliveryAuditInput): DeliveryAuditResult {
  const findings: DeliveryAuditFinding[] = []
  let outputSchemaValidated: boolean | null = input.outputSchema ? false : null
  let childrenTerminal: boolean | null = input.children ? true : null
  let completionChecksPassed: boolean | null = input.completionChecks
    ? input.completionChecks.ok && input.completionChecks.passed
    : null
  let requiredFilesSatisfied: boolean | null = input.requiredFiles ? false : null
  let requiredReceiptsSatisfied: boolean | null = input.requiredReceipts ? false : null
  let positiveEvidence = false

  if (input.providerTurnState === 'queued' || input.providerTurnState === 'running') {
    findings.push({ code: 'child_incomplete', severity: 'blocking', message: `Provider turn is still ${input.providerTurnState}.` })
  } else if (input.providerTurnState === 'failed' || input.providerTurnState === 'cancelled') {
    findings.push({ code: 'provider_turn_failed', severity: 'blocking', message: `Provider turn ended in ${input.providerTurnState}.` })
  }

  if (input.outputSchema) {
    if (input.output === undefined) {
      findings.push({ code: 'output_missing', severity: 'blocking', message: 'Structured provider output is required by outputSchema.' })
    } else {
      const issues = validateJsonSchema(input.output, input.outputSchema)
      if (issues.length > 0) {
        findings.push({
          code: 'output_schema_mismatch',
          severity: 'blocking',
          message: `Structured provider output does not satisfy outputSchema (${issues.length} assertion${issues.length === 1 ? '' : 's'} failed).`,
          expected: input.outputSchema,
          actual: issues.slice(0, 8)
        })
      } else {
        outputSchemaValidated = true
        positiveEvidence = true
      }
    }
  }

  if (input.children) {
    for (const child of input.children) {
      if (child.status === 'failed' || child.status === 'cancelled' || child.status === 'blocked') {
        childrenTerminal = false
        findings.push({
          code: 'child_failed', severity: 'blocking', childId: child.id,
          message: `Child agent ${child.id} ended in ${child.status}.`
        })
      } else if (child.status !== 'completed') {
        childrenTerminal = false
        findings.push({
          code: 'child_incomplete', severity: 'blocking', childId: child.id,
          message: `Child agent ${child.id} is still ${child.status}.`
        })
      }
    }
  }

  if (input.fileEffects) {
    if (input.fileEffects.issues.length > 0) {
      for (const issue of input.fileEffects.issues) {
        findings.push({
          code: 'file_effect_capture_issue', severity: 'blocking', path: issue.path,
          message: issue.message
        })
      }
    }
  }

  if (input.filePatchReceipts) {
    const invalidReceipt = input.filePatchReceipts.find((receipt) => {
      const digest = createHash('sha256').update(receipt.patchText).digest('hex')
      return digest !== receipt.patchDigest
    })
    if (invalidReceipt) {
      findings.push({ code: 'invalid_receipt', severity: 'blocking', path: invalidReceipt.path, message: `File patch receipt digest does not match ${invalidReceipt.path}.` })
    } else if (input.filePatchReceipts.length > 0) {
      positiveEvidence = true
    }
  }

  if (input.requiredFiles) {
    const effects = input.fileEffects?.effects ?? []
    const checksPass = input.completionChecks?.ok === true && input.completionChecks.passed
    const missing = input.requiredFiles.filter((required) => {
      const effectObserved = effects.some((effect) => effect.path === required.path && (!required.effect || effect.kind === required.effect))
      const receiptObserved = (input.filePatchReceipts ?? []).some((receipt) => receipt.path === required.path && (!required.effect || receipt.operation === ({ created: 'add', modified: 'update', deleted: 'delete' } as const)[required.effect]))
      return !(checksPass || effectObserved || receiptObserved)
    })
    requiredFilesSatisfied = missing.length === 0
    for (const required of missing) {
      findings.push({ code: 'required_file_missing', severity: 'blocking', path: required.path, message: `Required delivery file has no verified workspace evidence: ${required.path}` })
    }
    if (requiredFilesSatisfied) positiveEvidence = true
  }

  if (input.requiredReceipts) {
    const receipts = input.filePatchReceipts ?? []
    const missing = input.requiredReceipts.filter((required) => !receipts.some((receipt) => receipt.path === required.path && (!required.operation || receipt.operation === required.operation)))
    requiredReceiptsSatisfied = missing.length === 0
    for (const required of missing) {
      findings.push({ code: 'required_receipt_missing', severity: 'blocking', path: required.path, message: `Required executor receipt is missing: ${required.path}` })
    }
    if (requiredReceiptsSatisfied) positiveEvidence = true
  }

  if (input.completionChecks) {
    if (!input.completionChecks.ok) {
      findings.push({ code: 'completion_check_unavailable', severity: 'blocking', message: 'Workspace completion checks were unavailable.' })
    } else if (!input.completionChecks.passed) {
      findings.push({ code: 'completion_check_failed', severity: 'blocking', message: 'Workspace completion checks did not establish delivery.' })
    } else {
      positiveEvidence = true
    }
  }

  if (input.requireEvidence && !positiveEvidence) {
    findings.push({ code: 'no_delivery_evidence', severity: 'blocking', message: 'No structured delivery evidence was supplied.' })
  }

  const hardBlocked = findings.some((finding) => finding.code === 'invalid_contract' || finding.code === 'provider_turn_failed' || finding.code === 'invalid_receipt' || finding.code === 'file_effect_capture_issue' || finding.code === 'completion_check_unavailable')
  const status: DeliveryAuditStatus = hardBlocked
    ? 'blocked'
    : findings.length > 0
      ? 'needs_continuation'
      : 'delivered'
  return result(status, findings, {
    outputSchemaValidated,
    childrenTerminal,
    completionChecksPassed,
    requiredFilesSatisfied,
    requiredReceiptsSatisfied,
    positiveEvidence
  }, status === 'needs_continuation')
}

function result(
  status: DeliveryAuditStatus,
  findings: readonly DeliveryAuditFinding[],
  evidence: DeliveryAuditResult['evidence'],
  canAutoContinue: boolean
): DeliveryAuditResult {
  const stable = { status, findings, evidence }
  return Object.freeze({
    ok: true,
    status,
    deliveryState: status,
    canAutoContinue,
    findings: Object.freeze([...findings]),
    evidence,
    evidenceDigest: createHash('sha256').update(canonicalJson(stable)).digest('hex')
  })
}

function emptyEvidence(): DeliveryAuditResult['evidence'] {
  return {
    outputSchemaValidated: null,
    childrenTerminal: null,
    completionChecksPassed: null,
    requiredFilesSatisfied: null,
    requiredReceiptsSatisfied: null,
    positiveEvidence: false
  }
}

type SchemaIssue = { path: string; message: string }

/** Bounded JSON Schema subset sufficient for agent output contracts. */
function validateJsonSchema(value: unknown, schema: Record<string, unknown>, path = '$', depth = 0): SchemaIssue[] {
  if (depth > 24) return [{ path, message: 'schema nesting exceeds audit limit' }]
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(candidate, value))) return [{ path, message: 'value is not in enum' }]
  if ('const' in schema && !deepEqual(schema.const, value)) return [{ path, message: 'value does not equal const' }]
  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some((candidate) => isRecord(candidate) && validateJsonSchema(value, candidate, path, depth + 1).length === 0)) return [{ path, message: 'value matches none of anyOf' }]
    return []
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => isRecord(candidate) && validateJsonSchema(value, candidate, path, depth + 1).length === 0).length
    if (matches !== 1) return [{ path, message: `value matches ${matches} oneOf branches` }]
    return []
  }
  const type = typeof schema.type === 'string' ? schema.type : undefined
  if (type && !matchesType(value, type)) return [{ path, message: `expected ${type}` }]
  const issues: SchemaIssue[] = []
  if (type === 'object' && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []
    for (const key of required) if (!(key in value)) issues.push({ path: `${path}.${key}`, message: 'required property is missing' })
    for (const [key, child] of Object.entries(properties)) if (key in value && isRecord(child)) issues.push(...validateJsonSchema(value[key], child, `${path}.${key}`, depth + 1))
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in properties)) issues.push({ path: `${path}.${key}`, message: 'additional property is not allowed' })
  }
  if (type === 'array' && Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) issues.push({ path, message: 'too few items' })
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) issues.push({ path, message: 'too many items' })
    if (isRecord(schema.items)) value.slice(0, 256).forEach((item, index) => issues.push(...validateJsonSchema(item, schema.items as Record<string, unknown>, `${path}[${index}]`, depth + 1)))
  }
  if (type === 'string' && typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) issues.push({ path, message: 'string is too short' })
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) issues.push({ path, message: 'string is too long' })
    if (typeof schema.pattern === 'string' && schema.pattern.length <= 512) {
      try { if (!new RegExp(schema.pattern).test(value)) issues.push({ path, message: 'string does not match pattern' }) } catch { issues.push({ path, message: 'invalid schema pattern' }) }
    }
  }
  if ((type === 'number' || type === 'integer') && typeof value === 'number') {
    if (type === 'integer' && !Number.isInteger(value)) issues.push({ path, message: 'expected integer' })
    if (typeof schema.minimum === 'number' && value < schema.minimum) issues.push({ path, message: 'number is below minimum' })
    if (typeof schema.maximum === 'number' && value > schema.maximum) issues.push({ path, message: 'number is above maximum' })
  }
  return issues
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isRecord(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'string') return typeof value === 'string'
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
