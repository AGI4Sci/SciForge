import { randomUUID } from 'node:crypto'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { ARTIFACT_VERSION_DESCRIBE_V2_CONTRACT, ARTIFACT_VERSION_EVENT_LIST_CONTRACT,
  ARTIFACT_VERSIONS_CAPABILITY_IDS, artifactVersionRefreshInputV1Schema, artifactVersionRefreshResultV1Schema,
  artifactVersionRefV1Schema, type ArtifactVersionRefV1, type ArtifactVersionLifecycleEventV1
} from '@sciforge/domain-artifact-versions/contract'
import type { ResearchRecordState } from './research-record-state.js'
import type { ResearchRecordView } from '../research-record-contract.js'

export async function refreshResultMaterials(context: DomainMainRuntimeLifecycleContext, state: ResearchRecordState): Promise<void> {
  if (!state.resultBindings?.length) return
  await context.capabilities.invoke({ actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.refresh, effect: 'compute',
    inputSchema: artifactVersionRefreshInputV1Schema, outputSchema: artifactVersionRefreshResultV1Schema }, {},
  { workspaceId: state.workspaceRoot, idempotencyKey: `record-refresh:${randomUUID()}` })
}

/** Read-only projection. Source observation remains owned by Artifact Versions. */
export async function resultImpact(context: DomainMainRuntimeLifecycleContext, state: ResearchRecordState, nodeIds: Set<string>): Promise<NonNullable<ResearchRecordView['resultImpact']>> {
  const bindings = (state.resultBindings ?? []).filter(binding => nodeIds.has(binding.nodeId))
  if (!bindings.length) return []
  const events: ArtifactVersionLifecycleEventV1[] = []
  let complete = false, afterSequence = 0
  try {
    for (let page = 0; page < 16; page++) {
      const response = await context.capabilities.invoke(ARTIFACT_VERSION_EVENT_LIST_CONTRACT, { afterSequence, limit: 1000 }, { workspaceId: state.workspaceRoot })
      if (!response.ok) break
      events.push(...response.value.events)
      if (response.value.events.length < 1000) { complete = true; break }
      if (response.value.lastSequence <= afterSequence) break
      afterSequence = response.value.lastSequence
    }
  } catch { /* Unavailable authority is unknown. */ }
  type Status = 'requires-review' | 'no-recorded-impact' | 'unknown'
  const cache = new Map<string, { status: Status; reasons: string[] }>()
  let visited = 0
  const inspect = (ref: ArtifactVersionRefV1, ancestors = new Set<string>()): Promise<{ status: Status; reasons: string[] }> => {
    const key = JSON.stringify(artifactVersionRefV1Schema.parse(ref))
    if (ancestors.has(key) || ancestors.size >= 16 || ++visited > 512) return Promise.resolve({ status: 'unknown', reasons: ['dependency-traversal-limited'] })
    const cached = cache.get(key); if (cached) return Promise.resolve(cached)
    const work = (async () => {
      let status: Status = complete ? 'no-recorded-impact' : 'unknown'
      const reasons: string[] = complete ? [] : ['lifecycle-coverage-incomplete']
      try {
        const response = await context.capabilities.invoke(ARTIFACT_VERSION_DESCRIBE_V2_CONTRACT, { versionId: ref.versionId }, { workspaceId: state.workspaceRoot })
        if (!response.ok) return { status: 'unknown' as const, reasons: ['version-unavailable-or-denied'] }
        const actual = artifactVersionRefV1Schema.parse(response.value.ref)
        // Availability is mutable; immutable identity and access policy must match.
        if (JSON.stringify({ ...actual, availability: ref.availability }) !== key) return { status: 'unknown' as const, reasons: ['exact-version-identity-mismatch'] }
        const changed = events.some(event => event.artifactId === ref.artifactId && event.versionId === ref.versionId &&
          (event.type === 'artifact-content-changed' && event.detail.previousContentDigest === ref.contentDigest || event.type === 'artifact-missing'))
        if (!response.value.isCurrent || changed || actual.availability !== ref.availability) {
          status = 'requires-review'; reasons.push(`${ref.versionId}:material-changed-or-unavailable`)
        }
        const path = new Set(ancestors).add(key)
        for (const dependency of response.value.version.dependencies) {
          const child = await inspect(dependency.target, path)
          if (child.status === 'requires-review' || status !== 'requires-review' && child.status === 'unknown') status = child.status
          reasons.push(...child.reasons)
        }
      } catch { if (status !== 'requires-review') status = 'unknown'; reasons.push('version-check-unavailable') }
      const result = { status, reasons: [...new Set(reasons)].slice(0, 64) }
      cache.set(key, result)
      return result
    })()
    return work
  }
  return Promise.all(bindings.map(async binding => {
    const checks = await Promise.all([binding.result, ...binding.inputs].map(ref => inspect(ref)))
    const status: Status = checks.some(item => item.status === 'requires-review') ? 'requires-review' : checks.some(item => item.status === 'unknown') ? 'unknown' : 'no-recorded-impact'
    const presentations = await Promise.all(binding.presentations.map(async presentation => {
      const own = await inspect(presentation.artifact)
      return { ...presentation, status: status === 'requires-review' || own.status === 'requires-review' ? 'requires-review' as const : status === 'unknown' || own.status === 'unknown' ? 'unknown' as const : 'no-recorded-impact' as const }
    }))
    return { ...binding, status, reasons: [...new Set(checks.flatMap(item => item.reasons))].slice(0, 64), presentations }
  }))
}
