export const MCP_WRITE_AUDIT_SCHEMA_VERSION = 'sciforge.mcp.write-audit.v1' as const

export interface McpWriteControlInput {
  dry_run?: boolean
  preview?: boolean
  confirmed?: boolean
  confirmation_id?: string | null
}

export interface McpWriteControl {
  dryRun: boolean
  preview: boolean
  confirmed: boolean
  confirmationId?: string
}

export interface McpWriteConfirmationRequired {
  required: true
  code: 'confirmation_required'
  worker: string
  tool: string
  action: string
  destructive: boolean
  message: string
  confirmationField: 'confirmed'
  confirmationIdField: 'confirmation_id'
  dryRunField: 'dry_run'
  previewField: 'preview'
  confirmationId?: string
}

export interface McpWriteAuditRecord {
  auditId: string
  sequence: number
  timestamp: string
  schemaVersion: typeof MCP_WRITE_AUDIT_SCHEMA_VERSION
  worker: string
  tool: string
  action: string
  outcome: 'success' | 'rejected' | 'failed'
  ok: boolean
  destructive: boolean
  dryRun: boolean
  preview: boolean
  confirmed: boolean
  confirmationId?: string
  errorCode?: string
  reason?: string
  input?: unknown
  confirmationRequired?: McpWriteConfirmationRequired
}

export type McpWriteAuditRecordInput = Omit<
  McpWriteAuditRecord,
  'auditId' | 'sequence' | 'timestamp' | 'schemaVersion'
>

export interface McpWriteAuditRecorder {
  record(input: McpWriteAuditRecordInput): McpWriteAuditRecord
  records(): McpWriteAuditRecord[]
}

export interface InMemoryMcpWriteAuditRecorderOptions {
  nowIso?: () => string
  nextId?: (prefix: string) => string
  maxRecords?: number
}

export class InMemoryMcpWriteAuditRecorder implements McpWriteAuditRecorder {
  private readonly entries: McpWriteAuditRecord[] = []
  private readonly nowIso: () => string
  private readonly nextId: (prefix: string) => string
  private readonly maxRecords: number
  private sequence = 0

  constructor(options: InMemoryMcpWriteAuditRecorderOptions = {}) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.nextId = options.nextId ?? ((prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`)
    this.maxRecords = Math.max(1, Math.floor(options.maxRecords ?? 500))
  }

  record(input: McpWriteAuditRecordInput): McpWriteAuditRecord {
    const record: McpWriteAuditRecord = {
      auditId: this.nextId('mcp_write_audit'),
      sequence: ++this.sequence,
      timestamp: this.nowIso(),
      schemaVersion: MCP_WRITE_AUDIT_SCHEMA_VERSION,
      ...input
    }
    this.entries.push(record)
    while (this.entries.length > this.maxRecords) this.entries.shift()
    return record
  }

  records(): McpWriteAuditRecord[] {
    return [...this.entries]
  }
}

export function mcpWriteControlFromInput(input: unknown): McpWriteControl {
  const record = asRecord(input)
  const legacyConfirmation = stringValue(record.confirmation)
  const confirmationId = stringValue(record.confirmation_id) ?? legacyConfirmation
  return {
    dryRun: record.dry_run === true,
    preview: record.preview === true,
    confirmed: record.confirmed === true || Boolean(legacyConfirmation),
    ...(confirmationId ? { confirmationId } : {})
  }
}

export function mcpWriteIsPreview(control: McpWriteControl): boolean {
  return control.dryRun || control.preview
}

export function mcpWriteNeedsConfirmation(control: McpWriteControl): boolean {
  return !mcpWriteIsPreview(control) && !control.confirmed
}

export function mcpWriteConfirmationRequired(options: {
  worker: string
  tool: string
  action: string
  destructive: boolean
  confirmationId?: string
}): McpWriteConfirmationRequired {
  return {
    required: true,
    code: 'confirmation_required',
    worker: options.worker,
    tool: options.tool,
    action: options.action,
    destructive: options.destructive,
    message: `${options.tool} requires explicit user confirmation before making changes. Use dry_run or preview to inspect the operation without side effects.`,
    confirmationField: 'confirmed',
    confirmationIdField: 'confirmation_id',
    dryRunField: 'dry_run',
    previewField: 'preview',
    ...(options.confirmationId ? { confirmationId: options.confirmationId } : {})
  }
}

export function mcpWriteRedactedInput(input: unknown): unknown {
  return redactValue(input, undefined, 0)
}

function redactValue(value: unknown, key: string | undefined, depth: number): unknown {
  if (key && isSensitiveKey(key)) return '[REDACTED]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (depth >= 6) return '[MaxDepth]'
  if (Array.isArray(value)) {
    const values = value.slice(0, 20).map((item) => redactValue(item, undefined, depth + 1))
    return value.length > 20 ? [...values, `[${value.length - 20} more item(s)]`] : values
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50)
    for (const [entryKey, entryValue] of entries) {
      output[entryKey] = redactValue(entryValue, entryKey, depth + 1)
    }
    const extraKeys = Object.keys(value as Record<string, unknown>).length - entries.length
    if (extraKeys > 0) output.__truncatedKeys = extraKeys
    return output
  }
  return String(value)
}

function redactString(value: string): string {
  const redacted = value
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[-_ ]?key|token|secret|password)\s*[:=]\s*[^,\s;]+/gi, '$1=[REDACTED]')
  return redacted.length > 512 ? `${redacted.slice(0, 512)}...[truncated]` : redacted
}

function isSensitiveKey(key: string): boolean {
  return /authorization|password|passwd|secret|token|api[-_]?key|credential|cookie|session/i.test(key)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
