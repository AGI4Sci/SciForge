import { Buffer } from 'node:buffer'

export type ProjectedEvidenceTraceItem = Readonly<Record<string, unknown>>

// Host visibility is authoritative. Locators remain provenance data, never
// authority to open a file. Redact values only at explicit secret fields.
const SECRET_KEY = /^(?:authorization|cookie|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|credentials)$/i

function decodeCompleteUtf8(value: string, expectedLength: unknown): string | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return undefined
  let bytes: Buffer
  try { bytes = Buffer.from(value, 'base64') } catch { return undefined }
  if (bytes.toString('base64') !== value) return undefined
  if (Number.isInteger(expectedLength) && bytes.byteLength !== expectedLength) return undefined
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return undefined }
}

function normalize(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    const text = value.trim()
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      try { return normalize(JSON.parse(text), key) } catch { /* retain opaque text */ }
    }
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => normalize(entry))
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(source)) {
    result[name] = SECRET_KEY.test(name) ? '<redacted-secret>' : normalize(entry, name)
  }
  if (typeof result.dataBase64 === 'string') {
    const decodedText = decodeCompleteUtf8(result.dataBase64, result.length)
    if (decodedText !== undefined) {
      const safe = normalize(decodedText)
      result.decodedText = typeof safe === 'string' ? safe : JSON.stringify(safe)
      // Never leave an encoded copy of an explicitly redacted JSON field.
      // Re-encode the sanitized data only when normalization changed it.
      if (result.decodedText !== decodedText) {
        const sanitized = Buffer.from(result.decodedText as string, 'utf8')
        result.dataBase64 = sanitized.toString('base64')
        result.length = sanitized.byteLength
      }
    }
  }
  return result
}

function detailOutput(detail: unknown): unknown {
  const normalized = normalize(detail)
  if (normalized && typeof normalized === 'object') return normalized
  return detail
}

/**
 * Convert the Host's visibility-filtered Agent items into the neutral trace
 * consumed by the package extractor. This never opens a locator/path; nested
 * receipts are parsed as data and only complete UTF-8 base64 is decoded.
 */
export function projectEvidenceTrace(items: readonly Record<string, unknown>[]): ProjectedEvidenceTraceItem[] {
  return items.flatMap((item, index): ProjectedEvidenceTraceItem[] => {
    const id = typeof item.id === 'string' && item.id.trim() ? item.id : `host-item-${index}`
    // Neutral execution envelopes already have a public extractor type.
    if (typeof item.type === 'string') return [normalize(item) as ProjectedEvidenceTraceItem]
    const kind = typeof item.kind === 'string' ? item.kind : 'message'
    if (kind === 'tool') {
      return [{
        ...normalize(item) as Record<string, unknown>,
        id,
        type: 'tool_result',
        tool_name: typeof item.toolName === 'string' ? item.toolName : typeof item.summary === 'string' ? item.summary : 'tool',
        ...(item.status === undefined ? {} : { status: item.status }),
        output: detailOutput(item.detail ?? item.output ?? item.result ?? item.text ?? null),
      }]
    }
    const text = typeof item.text === 'string' ? normalize(item.text) : typeof item.summary === 'string' ? normalize(item.summary) : undefined
    // Metadata-only Host records can carry pinned Artifact Version provenance.
    // Keep them as data; do not infer authority or fabricate assertion text.
    if (!text) return [{ ...normalize(item) as Record<string, unknown>, id, type: kind, content: normalize(item) }]
    return [{ ...normalize(item) as Record<string, unknown>, id, type: kind === 'user_message' ? 'message' : kind, ...(kind === 'user_message' ? { role: 'user' } : {}), content: text }]
  })
}
