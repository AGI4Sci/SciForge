import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const PAPER_RADAR_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const PAPER_RADAR_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const PAPER_RADAR_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main', 'main.capability-factory'
)
export const PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION = contributionFor(
  'renderer', 'renderer.workbench-right-panel'
)
export const PAPER_RADAR_RENDERER_I18N_CONTRIBUTION = contributionFor(
  'renderer', 'renderer.i18n-resource'
)

function contributionFor(process: 'main' | 'renderer', kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) throw new Error(`Paper Radar manifest is missing ${process}:${kind}.`)
  return contribution
}
