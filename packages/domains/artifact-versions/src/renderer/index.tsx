import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererResearchSummaryValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  artifactVersionListInputV2Schema,
  artifactVersionListResultV2Schema,
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  type ArtifactVersionListInputV2,
  type ArtifactVersionResultV1,
  type ArtifactVersionListV2
} from '../contract.js'
import {
  ARTIFACT_VERSIONS_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION,
  ARTIFACT_VERSIONS_RENDERER_RESEARCH_SUMMARY_CONTRACT,
  domainPackageDefinition
} from '../definition.js'

const listContract = Object.freeze({
  actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.listV2,
  effect: 'read' as const,
  inputSchema: artifactVersionListInputV2Schema,
  outputSchema: artifactVersionListResultV2Schema
})

export function createArtifactVersionsResearchSummaryContribution(
  host: DomainRendererHost
): DomainRendererResearchSummaryValue {
  return Object.freeze({
    provide: async ({ scope }) => {
      if (scope.kind !== 'workspace' || !scope.id.trim()) {
        return { status: 'unavailable' as const, reason: 'Artifact scope is unavailable.' }
      }
      try {
        const result = await host.capabilityInvoker.invoke<
          ArtifactVersionListInputV2,
          ArtifactVersionResultV1<ArtifactVersionListV2>
        >(listContract, { currentOnly: true, limit: 8 }, { workspaceId: scope.id })
        if (!result.ok) return { status: 'unavailable' as const, reason: result.issue.message }
        const items = result.value.items
        return {
          status: 'available' as const,
          title: 'Recent artifacts',
          items: [{
            label: 'Versions',
            value: String(items.length),
            tone: items.length ? 'positive' as const : 'neutral' as const
          }],
          actions: items.map((item) => ({
            label: item.artifact.label ?? item.artifact.artifactId,
            resource: {
              resourceKind: 'artifact-version',
              resourceId: item.version.versionId,
              integrity: {
                algorithm: 'sha256' as const,
                expectedDigest: `sha256:${item.ref.contentDigest}`
              }
            }
          }))
        }
      } catch {
        return { status: 'unavailable' as const, reason: 'Artifact owner is unavailable.' }
      }
    }
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<DomainRendererResearchSummaryValue> {
  return defineTrustedRendererDomainPackageEntry<DomainRendererResearchSummaryValue>({
    definition: domainPackageDefinition,
    contributions: [{
      ...ARTIFACT_VERSIONS_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION,
      contract: ARTIFACT_VERSIONS_RENDERER_RESEARCH_SUMMARY_CONTRACT,
      value: createArtifactVersionsResearchSummaryContribution(host)
    }]
  })
}
