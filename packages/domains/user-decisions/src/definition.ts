import { defineTrustedDomainPackage, type TrustedDomainPackageDefinitionInput } from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition = defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const USER_DECISIONS_RENDERER_I18N_CONTRIBUTION = contributionFor(
  'renderer.i18n-resource'
)

function contributionFor(kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === 'renderer')
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) throw new Error(`User decisions manifest is missing renderer:${kind}.`)
  return contribution
}
