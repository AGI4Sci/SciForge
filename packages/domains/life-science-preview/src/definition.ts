import {
  defineTrustedDomainPackage,
  type DomainPackageContributionDeclaration,
  type DomainPackageProcess,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import {
  MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
  RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
} from '@sciforge/domain-sdk/workspace-preview'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const LIFE_SCIENCE_PREVIEW_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const LIFE_SCIENCE_PREVIEW_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const LIFE_SCIENCE_PREVIEW_MAIN_CONTRIBUTIONS = previewContributionsFor(
  'main',
  MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
)

export const LIFE_SCIENCE_PREVIEW_RENDERER_CONTRIBUTIONS = previewContributionsFor(
  'renderer',
  RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
)

export const LIFE_SCIENCE_PREVIEW_RENDERER_LIFECYCLE_CONTRIBUTIONS = contributionsFor(
  'renderer',
  'renderer.lifecycle'
)

export const LIFE_SCIENCE_PREVIEW_CONTRIBUTION_IDS = Object.freeze(
  LIFE_SCIENCE_PREVIEW_MAIN_CONTRIBUTIONS.map((contribution) => contribution.id)
)

const rendererContributionIds = LIFE_SCIENCE_PREVIEW_RENDERER_CONTRIBUTIONS.map(
  (contribution) => contribution.id
)
if (JSON.stringify(LIFE_SCIENCE_PREVIEW_CONTRIBUTION_IDS) !== JSON.stringify(rendererContributionIds)) {
  throw new Error('Life Science Preview main and renderer contribution IDs must match exactly.')
}

function previewContributionsFor(
  process: DomainPackageProcess,
  kind: string
): readonly DomainPackageContributionDeclaration[] {
  const contributions = contributionsFor(process, kind)
  if (contributions.length === 0) {
    throw new Error(`Life Science Preview ${process} entrypoint declares no ${kind} contributions.`)
  }
  for (const contribution of contributions) {
    if (!Object.hasOwn(domainPackageDefinition.contributionContracts, contribution.id)) {
      throw new Error(
        `Life Science Preview ${process} contribution ${contribution.id} has no canonical contract.`
      )
    }
  }
  return contributions
}

function contributionsFor(
  process: DomainPackageProcess,
  kind: string
): readonly DomainPackageContributionDeclaration[] {
  const entrypoint = domainPackageDefinition.entrypoints.find(
    (candidate) => candidate.process === process
  )
  if (!entrypoint) {
    throw new Error(`Life Science Preview manifest is missing its ${process} entrypoint.`)
  }
  const contributions = entrypoint.contributions.filter(
    (contribution) => contribution.kind === kind
  )
  return contributions
}
