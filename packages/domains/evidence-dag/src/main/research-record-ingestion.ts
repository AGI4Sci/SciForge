import type { DomainAgentThreadDetail } from '@sciforge/domain-sdk/host'
import { recordHash } from './research-record-state.js'
export type RawResearchItem = Record<string, unknown> & { id: string; kind?: string; status?: string }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
/** Metadata already exposed by the public snapshot. Never copy summary,
 * reasoning, encrypted payloads or infer provider-internal context contents. */
export function visibleResearchContextBoundaries(turn: DomainAgentThreadDetail['turns'][number]) {
  return turn.artifacts.flatMap(value => {
    const item = record(value)
    if (item.kind !== 'compaction' || typeof item.id !== 'string') return []
    return [{ itemId: item.id, kind: 'compaction' as const,
      status: ['success', 'completed', 'failed', 'cancelled', 'running'].includes(String(item.status)) ? String(item.status) : 'unknown',
      occurredAt: typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : null }]
  })
}
export function researchSourceDigest(value: unknown): string {
  const item = record(value), principal = record(item.principalContext)
  if (Object.keys(principal).length === 2 && principal.identityVersion === 0 && principal.principal === null) {
    const normalized = { ...item }; delete normalized.principalContext
    return recordHash(normalized)
  }
  return recordHash(value)
}
/** Only public visible snapshots are available. Neither watermark nor array
 * position is a canonical event sequence or evidence of complete history. */
export function visibleResearchItems(turn: DomainAgentThreadDetail['turns'][number]): Map<string, RawResearchItem> {
  const items = new Map<string, RawResearchItem>()
  for (const value of turn.artifacts) {
    const item = record(value)
    if (typeof item.id !== 'string' || item.kind === 'reasoning' || item.kind === 'compaction') continue
    if (['pending', 'running'].includes(String(item.status ?? ''))) continue
    if (!['completed', 'failed', 'cancelled'].includes(turn.status ?? '') && item.kind === 'assistant_message') continue
    if (items.has(item.id) && researchSourceDigest(items.get(item.id)) !== researchSourceDigest(item)) throw new Error('Conflicting visible research source IDs.')
    items.set(item.id, item as RawResearchItem)
  }
  for (const message of turn.messages) if (!items.has(message.itemId) && (message.kind === 'user-message' || ['completed', 'failed', 'cancelled'].includes(turn.status ?? ''))) {
    items.set(message.itemId, { id: message.itemId, kind: message.kind, text: message.text, createdAt: message.occurredAt })
  }
  return items
}
