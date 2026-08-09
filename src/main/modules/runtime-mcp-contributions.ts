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
  return Object.freeze(catalog.listContributions(
    MAIN_RUNTIME_MCP_SERVER_CONTRIBUTION_KIND,
    isDomainMainRuntimeMcpServerContribution
  ).map(({ value }) => value))
}

export function listMainMcpTrustedInvocationMetadataContributions(
  catalog: DomainModuleCatalog
): readonly DomainMcpTrustedInvocationMetadataContribution[] {
  return Object.freeze(catalog.listContributions(
    MAIN_MCP_TRUSTED_INVOCATION_METADATA_CONTRIBUTION_KIND,
    isDomainMcpTrustedInvocationMetadataContribution
  ).map(({ value }) => value))
}
