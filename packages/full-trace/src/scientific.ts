import {
  createEventId,
  type AgentTracePayload,
  type TraceEvent,
  type TraceEventInput,
  type TraceJsonValue
} from './schema.js'
import {
  sanitizeTraceValue
} from './redaction.js'

export const SCIENTIFIC_TRACE_SCHEMA_VERSION = 'sciforge.scientific-trace.v0.1' as const
export const SCIENTIFIC_TRACE_SOURCE = 'scientific-trace-collector' as const
export const SCIENTIFIC_TRACE_PII_REDACTION_MARKER = '[REDACTED_PII]' as const

export type ScientificTraceEventType =
  | 'TRACE_STARTED'
  | 'TRACE_COMPLETED'
  | 'USER_INPUT'
  | 'AGENT_ACTION'
  | 'AGENT_DECISION'
  | 'TOOL_CALL_REQUESTED'
  | 'TOOL_CALL_COMPLETED'
  | 'COMMAND_EXECUTION'
  | 'ARTIFACT_CREATED'
  | 'EVIDENCE_ATTACHED'
  | 'HUMAN_REVIEW_REQUESTED'
  | 'HUMAN_REVIEW_RECORDED'
  | 'ERROR_RECORDED'
  | 'JOB_SUBMITTED'
  | 'JOB_STARTED'
  | 'JOB_FINISHED'
  | 'JOB_FAILED'
  | 'JOB_CANCELLED'
  | 'JOB_RESUMED'
  | 'RESOURCE_USAGE_RECORDED'
  | 'COST_ESTIMATED'
  | 'EXPENSE_DRAFT_CREATED'
  | 'BUDGET_APPROVAL_REQUESTED'
  | 'BUDGET_APPROVAL_RECORDED'
  | 'DOCUMENT_VERSION_CREATED'
  | 'DAG_NODE_CREATED'
  | 'DAG_EDGE_CREATED'
  | 'VERIFIER_RESULT_RECORDED'
  | 'PLOT_CREATED'

export type ScientificTraceActor = {
  type: 'human' | 'agent' | 'tool' | 'system' | 'scheduler' | 'verifier'
  id?: string
  displayName?: string
}

export type ScientificTraceSource = {
  module: string
  provider?: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  requestId?: string
  idempotencyKey?: string
  clientId?: string
  sessionId?: string
  serverId?: string
  jobId?: string
}

export type ScientificTraceLinks = {
  inputs?: string[]
  artifacts?: string[]
  evidence?: string[]
  reviews?: string[]
  dagNodes?: string[]
  dagEdges?: string[]
  versions?: string[]
  costs?: string[]
  relatedEvents?: string[]
}

export type ScientificTraceEvent = {
  schemaVersion: typeof SCIENTIFIC_TRACE_SCHEMA_VERSION
  eventId: string
  traceId: string
  parentEventId?: string
  type: ScientificTraceEventType
  timestamp: string
  actor: ScientificTraceActor
  source: ScientificTraceSource
  payload: Record<string, unknown>
  links?: ScientificTraceLinks
}

export type ScientificTraceEventInput =
  Omit<ScientificTraceEvent, 'schemaVersion' | 'eventId' | 'timestamp'> &
  Partial<Pick<ScientificTraceEvent, 'schemaVersion' | 'eventId' | 'timestamp'>>

export type ScientificTraceValidationIssueCode =
  | 'MISSING_INPUT'
  | 'MISSING_EVIDENCE'
  | 'MISSING_ARTIFACT'
  | 'MISSING_HUMAN_REASON'
  | 'MISSING_PARENT_EVENT'
  | 'SECRET_DETECTED'
  | 'PII_DETECTED'
  | 'INVALID_SCHEMA'

export type ScientificTraceValidationIssue = {
  code: ScientificTraceValidationIssueCode
  severity: 'error' | 'warning'
  eventId?: string
  message: string
}

export type ScientificTraceValidationResult = {
  ok: boolean
  issues: ScientificTraceValidationIssue[]
}

export type ScientificTraceCollectResult = {
  eventId: string
  traceId: string
  stored: boolean
  warnings: ScientificTraceValidationIssue[]
  traceEvent: TraceEvent
}

export type ScientificTraceCollectorSink = {
  append(input: TraceEventInput<'agent_event'>): Promise<TraceEvent>
  appendMany?(inputs: readonly TraceEventInput<'agent_event'>[]): Promise<TraceEvent[]>
}

export class ScientificTraceValidationError extends Error {
  constructor(readonly issues: readonly ScientificTraceValidationIssue[]) {
    super(`Scientific trace validation failed: ${issues.map((issue) => issue.code).join(', ')}`)
    this.name = 'ScientificTraceValidationError'
  }
}

export class ScientificTraceCollector {
  constructor(private readonly sink: ScientificTraceCollectorSink) {}

  async collect(input: ScientificTraceEventInput): Promise<ScientificTraceCollectResult> {
    const event = prepareScientificTraceEvent(input)
    const validation = validateScientificTraceEvent(event)
    assertScientificTraceValidation(validation)
    const traceEvent = await this.sink.append(scientificTraceEventToTraceInput(event))
    return {
      eventId: event.eventId,
      traceId: event.traceId,
      stored: true,
      warnings: validation.issues.filter((issue) => issue.severity === 'warning'),
      traceEvent
    }
  }

  async collectMany(inputs: readonly ScientificTraceEventInput[]): Promise<ScientificTraceCollectResult[]> {
    const events = inputs.map((input) => prepareScientificTraceEvent(input))
    const validations = events.map((event) => validateScientificTraceEvent(event))
    for (const validation of validations) assertScientificTraceValidation(validation)
    const traceInputs = events.map((event) => scientificTraceEventToTraceInput(event))
    const traceEvents = this.sink.appendMany
      ? await this.sink.appendMany(traceInputs)
      : await Promise.all(traceInputs.map((input) => this.sink.append(input)))
    return events.map((event, index) => ({
      eventId: event.eventId,
      traceId: event.traceId,
      stored: true,
      warnings: validations[index]?.issues.filter((issue) => issue.severity === 'warning') ?? [],
      traceEvent: traceEvents[index] as TraceEvent
    }))
  }
}

export function prepareScientificTraceEvent(input: ScientificTraceEventInput): ScientificTraceEvent {
  const normalized: ScientificTraceEvent = {
    ...input,
    schemaVersion: input.schemaVersion ?? SCIENTIFIC_TRACE_SCHEMA_VERSION,
    eventId: input.eventId ?? createEventId(),
    timestamp: input.timestamp ?? new Date().toISOString()
  }
  return sanitizeScientificTraceEvent(normalized)
}

export function sanitizeScientificTraceEvent(event: ScientificTraceEvent): ScientificTraceEvent {
  const secretSanitized = sanitizeTraceValue(event)
  const piiSanitized = sanitizeScientificPiiValue(secretSanitized)
  return piiSanitized as unknown as ScientificTraceEvent
}

export function validateScientificTraceEvent(input: unknown): ScientificTraceValidationResult {
  const issues: ScientificTraceValidationIssue[] = []
  if (!isRecord(input)) {
    issues.push(errorIssue('INVALID_SCHEMA', undefined, 'Scientific trace event must be an object.'))
    return validationResult(issues)
  }

  const event = input as Partial<ScientificTraceEvent>
  const eventId = typeof event.eventId === 'string' ? event.eventId : undefined
  if (event.schemaVersion !== SCIENTIFIC_TRACE_SCHEMA_VERSION) {
    issues.push(errorIssue('INVALID_SCHEMA', eventId, 'Unsupported scientific trace schema version.'))
  }
  if (!nonEmptyString(event.eventId)) {
    issues.push(errorIssue('INVALID_SCHEMA', eventId, 'eventId is required.'))
  }
  if (!nonEmptyString(event.traceId)) {
    issues.push(errorIssue('INVALID_SCHEMA', eventId, 'traceId is required.'))
  }
  if (!isScientificTraceEventType(event.type)) {
    issues.push(errorIssue('INVALID_SCHEMA', eventId, 'Unsupported scientific trace event type.'))
  }
  if (!nonEmptyString(event.timestamp) || Number.isNaN(Date.parse(event.timestamp))) {
    issues.push(errorIssue('INVALID_SCHEMA', eventId, 'timestamp must be a valid ISO-8601 string.'))
  }
  if (!isValidActor(event.actor)) {
    issues.push(errorIssue('INVALID_SCHEMA', eventId, 'actor.type is required and must be supported.'))
  }
  if (!isValidSource(event.source)) {
    issues.push(errorIssue('INVALID_SCHEMA', eventId, 'source.module is required.'))
  }
  if (!isRecord(event.payload)) {
    issues.push(errorIssue('INVALID_SCHEMA', eventId, 'payload must be an object.'))
  }

  if (isScientificTraceEventType(event.type) && !isRootScientificEventType(event.type) && !nonEmptyString(event.parentEventId)) {
    issues.push(errorIssue('MISSING_PARENT_EVENT', eventId, `${event.type} must reference a parentEventId.`))
  }

  if (event.type === 'USER_INPUT' && !hasUserInput(event)) {
    issues.push(errorIssue('MISSING_INPUT', eventId, 'USER_INPUT must include payload.text, payload.inputRef, or links.inputs.'))
  }

  if (isArtifactEventType(event.type) && !hasArtifact(event)) {
    issues.push(errorIssue('MISSING_ARTIFACT', eventId, `${event.type} must identify the created artifact or version.`))
  }

  if (isArtifactEventType(event.type) && !hasArtifactIntegrity(event)) {
    issues.push(errorIssue('MISSING_ARTIFACT', eventId, `${event.type} must include a hash/checksum or noHashReason.`))
  }

  if (event.type === 'EVIDENCE_ATTACHED' && !hasEvidence(event)) {
    issues.push(errorIssue('MISSING_EVIDENCE', eventId, 'EVIDENCE_ATTACHED must include an evidence reference and target.'))
  }

  if (event.type === 'HUMAN_REVIEW_RECORDED' && !hasHumanReviewReason(event)) {
    issues.push(errorIssue('MISSING_HUMAN_REASON', eventId, 'HUMAN_REVIEW_RECORDED must include payload.reason.'))
  }

  if (containsSecretLikeValue(input)) {
    issues.push({
      code: 'SECRET_DETECTED',
      severity: 'warning',
      ...(eventId ? { eventId } : {}),
      message: 'Credential-shaped data was detected and must be sanitized before persistence.'
    })
  }

  if (containsPiiValue(input)) {
    issues.push(errorIssue('PII_DETECTED', eventId, 'PII-shaped data was detected and must not enter trace.'))
  }

  return validationResult(issues)
}

export function validateScientificTraceClosure(events: readonly ScientificTraceEvent[]): ScientificTraceValidationResult {
  const issues: ScientificTraceValidationIssue[] = []
  const eventIds = new Set(events.map((event) => event.eventId))

  if (!events.some((event) => event.type === 'USER_INPUT' && hasUserInput(event))) {
    issues.push(errorIssue('MISSING_INPUT', undefined, 'Trace must include at least one valid USER_INPUT event.'))
  }

  if (!events.some((event) => isArtifactEventType(event.type) && hasArtifact(event))) {
    issues.push(errorIssue('MISSING_ARTIFACT', undefined, 'Trace must include at least one Artifact-producing event.'))
  }

  if (!events.some((event) => event.type === 'EVIDENCE_ATTACHED' && hasEvidence(event))) {
    issues.push(errorIssue('MISSING_EVIDENCE', undefined, 'Trace must include at least one EVIDENCE_ATTACHED event.'))
  }

  if (!events.some((event) => event.type === 'HUMAN_REVIEW_RECORDED' && hasHumanReviewReason(event))) {
    issues.push(errorIssue(
      'MISSING_HUMAN_REASON',
      undefined,
      'Trace must include at least one HUMAN_REVIEW_RECORDED event with a reason.'
    ))
  }

  for (const event of events) {
    if (isRootScientificEventType(event.type)) continue
    if (!event.parentEventId || !eventIds.has(event.parentEventId)) {
      issues.push(errorIssue(
        'MISSING_PARENT_EVENT',
        event.eventId,
        `${event.type} must reference an existing parent event.`
      ))
    }
  }

  for (const event of events) {
    if (event.type === 'HUMAN_REVIEW_RECORDED' && !hasHumanReviewReason(event)) {
      issues.push(errorIssue('MISSING_HUMAN_REASON', event.eventId, 'Human review must include a reason.'))
    }
  }

  return validationResult(issues)
}

export function scientificTraceEventToTraceInput(event: ScientificTraceEvent): TraceEventInput<'agent_event'> {
  const payload: AgentTracePayload = {
    eventKind: agentTraceEventKindForScientificEvent(event.type),
    event
  }
  return {
    traceId: event.traceId,
    source: SCIENTIFIC_TRACE_SOURCE,
    kind: 'agent_event',
    timestamp: event.timestamp,
    payload,
    ...(event.source.runtimeId ? { runtimeId: event.source.runtimeId } : {}),
    ...(event.source.threadId ? { threadId: event.source.threadId } : {}),
    ...(event.source.turnId ? { turnId: event.source.turnId } : {}),
    ...(event.source.requestId ? { requestId: event.source.requestId } : {})
  }
}

export function agentTraceEventKindForScientificEvent(
  type: ScientificTraceEventType
): TraceEventInput<'agent_event'>['payload']['eventKind'] {
  if (type.startsWith('TOOL_CALL') || type === 'COMMAND_EXECUTION') return 'tool'
  if (
    type.startsWith('HUMAN_REVIEW') ||
    type.startsWith('BUDGET_APPROVAL')
  ) return 'approval'
  if (type === 'RESOURCE_USAGE_RECORDED' || type === 'COST_ESTIMATED') return 'usage'
  if (type === 'ERROR_RECORDED') return 'error'
  return 'lifecycle'
}

function assertScientificTraceValidation(validation: ScientificTraceValidationResult): void {
  if (!validation.ok) {
    throw new ScientificTraceValidationError(validation.issues.filter((issue) => issue.severity === 'error'))
  }
}

function isScientificTraceEventType(value: unknown): value is ScientificTraceEventType {
  return typeof value === 'string' && SCIENTIFIC_TRACE_EVENT_TYPES.has(value as ScientificTraceEventType)
}

function isRootScientificEventType(type: ScientificTraceEventType): boolean {
  return type === 'TRACE_STARTED' || type === 'USER_INPUT'
}

function isArtifactEventType(type: unknown): type is ScientificTraceEventType {
  return typeof type === 'string' && ARTIFACT_EVENT_TYPES.has(type as ScientificTraceEventType)
}

function isValidActor(value: unknown): value is ScientificTraceActor {
  return isRecord(value) &&
    typeof value.type === 'string' &&
    ACTOR_TYPES.has(value.type as ScientificTraceActor['type'])
}

function isValidSource(value: unknown): value is ScientificTraceSource {
  return isRecord(value) && nonEmptyString(value.module)
}

function hasUserInput(event: Partial<ScientificTraceEvent>): boolean {
  const payload = isRecord(event.payload) ? event.payload : {}
  return nonEmptyString(payload.text) ||
    nonEmptyString(payload.inputRef) ||
    nonEmptyArray(event.links?.inputs)
}

function hasArtifact(event: Partial<ScientificTraceEvent>): boolean {
  const payload = isRecord(event.payload) ? event.payload : {}
  return nonEmptyArray(event.links?.artifacts) ||
    nonEmptyString(payload.artifactId) ||
    nonEmptyString(payload.plotId) ||
    nonEmptyString(payload.documentId) ||
    nonEmptyString(payload.versionId) ||
    nonEmptyString(payload.draftId) ||
    nonEmptyString(payload.path) ||
    nonEmptyString(payload.uri) ||
    nonEmptyString(payload.storageRef)
}

function hasArtifactIntegrity(event: Partial<ScientificTraceEvent>): boolean {
  const payload = isRecord(event.payload) ? event.payload : {}
  return nonEmptyString(payload.sha256) ||
    nonEmptyString(payload.checksum) ||
    nonEmptyString(payload.hash) ||
    nonEmptyString(payload.contentHash) ||
    nonEmptyString(payload.noHashReason)
}

function hasEvidence(event: Partial<ScientificTraceEvent>): boolean {
  const payload = isRecord(event.payload) ? event.payload : {}
  const hasEvidenceReference = nonEmptyArray(event.links?.evidence) || nonEmptyString(payload.evidenceId)
  const hasEvidenceTarget = nonEmptyString(payload.target) ||
    nonEmptyArray(event.links?.artifacts) ||
    nonEmptyArray(event.links?.dagNodes)
  return hasEvidenceReference && nonEmptyString(payload.evidenceType) && hasEvidenceTarget
}

function hasHumanReviewReason(event: Partial<ScientificTraceEvent>): boolean {
  const payload = isRecord(event.payload) ? event.payload : {}
  return nonEmptyString(payload.reason)
}

function sanitizeScientificPiiValue(value: TraceJsonValue): TraceJsonValue {
  if (typeof value === 'string') return sanitizePiiText(value)
  if (Array.isArray(value)) return value.map((entry) => sanitizeScientificPiiValue(entry))
  if (!isRecord(value)) return value
  const result: Record<string, TraceJsonValue> = {}
  for (const [name, entry] of Object.entries(value)) {
    result[name] = isPiiFieldName(name)
      ? SCIENTIFIC_TRACE_PII_REDACTION_MARKER
      : sanitizeScientificPiiValue(entry)
  }
  return result
}

function sanitizePiiText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, SCIENTIFIC_TRACE_PII_REDACTION_MARKER)
    .replace(CHINA_MAINLAND_PHONE_PATTERN, SCIENTIFIC_TRACE_PII_REDACTION_MARKER)
    .replace(CHINA_ID_CARD_PATTERN, SCIENTIFIC_TRACE_PII_REDACTION_MARKER)
}

function containsPiiValue(value: unknown): boolean {
  if (typeof value === 'string') return sanitizePiiText(value) !== value
  if (Array.isArray(value)) return value.some((entry) => containsPiiValue(entry))
  if (!isRecord(value)) return false
  return Object.entries(value).some(([name, entry]) => {
    if (!isPiiFieldName(name)) return containsPiiValue(entry)
    return entry !== SCIENTIFIC_TRACE_PII_REDACTION_MARKER
  })
}

function containsSecretLikeValue(value: unknown): boolean {
  return JSON.stringify(sanitizeTraceValue(value)) !== JSON.stringify(value)
}

function isPiiFieldName(name: string): boolean {
  return PII_FIELD_NAMES.has(name.toLowerCase().replaceAll(/[^a-z0-9\u4e00-\u9fa5]/g, ''))
}

function errorIssue(
  code: ScientificTraceValidationIssueCode,
  eventId: string | undefined,
  message: string
): ScientificTraceValidationIssue {
  return {
    code,
    severity: 'error',
    ...(eventId ? { eventId } : {}),
    message
  }
}

function validationResult(issues: ScientificTraceValidationIssue[]): ScientificTraceValidationResult {
  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nonEmptyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SCIENTIFIC_TRACE_EVENT_TYPES = new Set<ScientificTraceEventType>([
  'TRACE_STARTED',
  'TRACE_COMPLETED',
  'USER_INPUT',
  'AGENT_ACTION',
  'AGENT_DECISION',
  'TOOL_CALL_REQUESTED',
  'TOOL_CALL_COMPLETED',
  'COMMAND_EXECUTION',
  'ARTIFACT_CREATED',
  'EVIDENCE_ATTACHED',
  'HUMAN_REVIEW_REQUESTED',
  'HUMAN_REVIEW_RECORDED',
  'ERROR_RECORDED',
  'JOB_SUBMITTED',
  'JOB_STARTED',
  'JOB_FINISHED',
  'JOB_FAILED',
  'JOB_CANCELLED',
  'JOB_RESUMED',
  'RESOURCE_USAGE_RECORDED',
  'COST_ESTIMATED',
  'EXPENSE_DRAFT_CREATED',
  'BUDGET_APPROVAL_REQUESTED',
  'BUDGET_APPROVAL_RECORDED',
  'DOCUMENT_VERSION_CREATED',
  'DAG_NODE_CREATED',
  'DAG_EDGE_CREATED',
  'VERIFIER_RESULT_RECORDED',
  'PLOT_CREATED'
])

const ACTOR_TYPES = new Set<ScientificTraceActor['type']>([
  'human',
  'agent',
  'tool',
  'system',
  'scheduler',
  'verifier'
])

const ARTIFACT_EVENT_TYPES = new Set<ScientificTraceEventType>([
  'ARTIFACT_CREATED',
  'PLOT_CREATED',
  'DOCUMENT_VERSION_CREATED',
  'EXPENSE_DRAFT_CREATED'
])

const PII_FIELD_NAMES = new Set([
  'email',
  'mail',
  'phone',
  'phonenumber',
  'mobile',
  'mobilenumber',
  'idcard',
  'idnumber',
  'identitynumber',
  'ssn',
  'address',
  'homeaddress',
  'personaladdress',
  '\u90ae\u7bb1',
  '\u624b\u673a\u53f7',
  '\u7535\u8bdd',
  '\u8eab\u4efd\u8bc1',
  '\u4f4f\u5740',
  '\u5bb6\u5ead\u4f4f\u5740',
  '\u5730\u5740'
])

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const CHINA_MAINLAND_PHONE_PATTERN = /\b1[3-9]\d{9}\b/g
const CHINA_ID_CARD_PATTERN = /\b\d{17}[\dXx]\b/g
