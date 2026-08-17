import {
  MAIN_MCP_TRUSTED_INVOCATION_METADATA_CONTRIBUTION_KIND,
  MAIN_RUNTIME_MCP_SERVER_CONTRIBUTION_KIND,
  isDomainMcpTrustedInvocationMetadataContribution,
  isDomainMainRuntimeMcpServerContribution,
  type DomainMcpTrustedInvocationMetadataContribution,
  type DomainMainRuntimeMcpServerContribution
} from '@sciforge/domain-sdk/host'
import type { DomainModuleCatalog } from './catalog'

export function listMainRuntimeMcpServerContributions(
  catalog: DomainModuleCatalog
): readonly DomainMainRuntimeMcpServerContribution[] {
  const values = catalog.listContributions(
    MAIN_RUNTIME_MCP_SERVER_CONTRIBUTION_KIND,
    isDomainMainRuntimeMcpServerContribution
  ).map(({ value }) => value)
  assertUnique(values.map((value) => value.serverId), 'runtime MCP server id')
  return Object.freeze(values)
}

export function listMainMcpTrustedInvocationMetadataContributions(
  catalog: DomainModuleCatalog
): readonly DomainMcpTrustedInvocationMetadataContribution[] {
  const values = catalog.listContributions(
    MAIN_MCP_TRUSTED_INVOCATION_METADATA_CONTRIBUTION_KIND,
    isDomainMcpTrustedInvocationMetadataContribution
  ).map(({ value }) => value)
  assertUnique(values.flatMap((value) => value.tools.map((tool) => (
    `${value.serverId}\0${tool}\0${value.metadataKey}`
  ))), 'trusted invocation metadata binding')
  return Object.freeze(values)
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value.replaceAll('\0', '/')}`)
    seen.add(value)
  }
}
