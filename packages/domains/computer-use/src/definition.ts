import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const COMPUTER_USE_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const COMPUTER_USE_RUNTIME_LIFECYCLE_CONTRIBUTION =
  contributionFor('main.runtime-lifecycle')
export const COMPUTER_USE_RUNTIME_MCP_SERVER_CONTRIBUTION =
  contributionFor('main.runtime-mcp-server')
export const COMPUTER_USE_TRUSTED_METADATA_CONTRIBUTION =
  contributionFor('main.mcp-trusted-invocation-metadata')

function contributionFor(kind: string) {
  const contribution = domainPackageDefinition.entrypoints[0]?.contributions
    .find((candidate) => candidate.kind === kind)
  if (!contribution) throw new Error(`Computer Use manifest is missing main:${kind}.`)
  return contribution
}
