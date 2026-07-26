import type {
  DomainAgentArtifactEvent,
  DomainAgentThreadDetail
} from '@sciforge/domain-sdk/host'

export function evidenceTraceFromArtifactEvent(
  event: DomainAgentArtifactEvent
): readonly Readonly<Record<string, unknown>>[] {
  return event.artifacts.map((artifact, index) =>
    artifactTraceItem(artifact, `${event.turnId}:artifact:${index}`, {
      turnId: event.turnId,
      occurredAt: event.occurredAt,
      targetWatermark: event.targetWatermark
    })
  )
}

export function evidenceTraceFromThread(
  detail: DomainAgentThreadDetail
): readonly Readonly<Record<string, unknown>>[] {
  const trace: Record<string, unknown>[] = []
  for (const [index, artifact] of detail.artifacts.entries()) {
    trace.push(artifactTraceItem(artifact, `thread:${detail.id}:artifact:${index}`, {
      targetWatermark: detail.watermark
    }))
  }
  for (const turn of detail.turns) {
    for (const [index, artifact] of turn.artifacts.entries()) {
      trace.push(artifactTraceItem(artifact, `${turn.id}:artifact:${index}`, {
        turnId: turn.id,
        ...(turn.completedAt ? { occurredAt: turn.completedAt } : {}),
        targetWatermark: detail.watermark
      }))
    }
  }
  const unique = new Map<string, Record<string, unknown>>()
  for (const item of trace) unique.set(String(item.id), item)
  return [...unique.values()]
}

function artifactTraceItem(
  value: unknown,
  fallbackId: string,
  metadata: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const artifact = record(value)
  const copy = artifact
    ? structuredClone(artifact) as Record<string, unknown>
    : {
        type: 'agent_artifact',
        content: primitiveValue(value)
      }
  const id = stringValue(copy.id) ?? fallbackId
  return {
    ...copy,
    id,
    source_item_id: stringValue(copy.source_item_id) ?? id,
    sciforgeEvidenceEvent: metadata
  }
}

function primitiveValue(value: unknown): string | number | boolean | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
