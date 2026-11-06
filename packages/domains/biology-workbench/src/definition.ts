import {
  defineTrustedDomainPackage,
  type DomainPackageContributionDeclaration,
  type DomainPackageProcess,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import { MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND } from '@sciforge/domain-sdk/capability-eval'
import {
  MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
  RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
} from '@sciforge/domain-sdk/workspace-preview'
import {
  WORKSPACE_SERVER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
} from '@sciforge/domain-sdk/workspace-server'
import manifest from '../sciforge.domain.json' with { type: 'json' }

/**
 * Merged Biology Workbench definition.
 *
 * One package, two internal submodules:
 *   - workbench/: the persistent Biology Room state service and its eight
 *     `biology-room.*` capabilities (IDs, scopes, effects and the on-disk
 *     layout are unchanged from `@sciforge/domain-biology-room`).
 *   - preview/: the six life-science workspace-preview slots, their renderers,
 *     lifecycle prewarm and the headless workspace-server entry (unchanged from
 *     `@sciforge/domain-life-science-preview`).
 *
 * The manifest is the single source of truth; every contribution list below is
 * derived from it so a declaration/implementation drift fails at import time.
 */
export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const BIOLOGY_WORKBENCH_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const BIOLOGY_WORKBENCH_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

/** Kept as the workbench-native module id so capability ownership stays explicit. */
export const BIOLOGY_ROOM_DOMAIN_MODULE_ID = BIOLOGY_WORKBENCH_DOMAIN_MODULE_ID

export const BIOLOGY_ROOM_CAPABILITY_FACTORY_CONTRIBUTION = contributionsFor(
  'main',
  'main.capability-factory'
)[0]!

export const BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRIBUTION = contributionsFor(
  'main',
  MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND
)[0]!

export const BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRACT =
  domainPackageDefinition.contributionContracts[BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRIBUTION.id]!

export const LIFE_SCIENCE_PREVIEW_MAIN_CONTRIBUTIONS = previewContributionsFor(
  'main',
  MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
)

export const LIFE_SCIENCE_PREVIEW_RENDERER_CONTRIBUTIONS = previewContributionsFor(
  'renderer',
  RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
)

export const LIFE_SCIENCE_PREVIEW_WORKSPACE_SERVER_CONTRIBUTIONS = previewContributionsFor(
  'workspace-server',
  WORKSPACE_SERVER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
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
const workspaceServerContributionIds = LIFE_SCIENCE_PREVIEW_WORKSPACE_SERVER_CONTRIBUTIONS.map(
  (contribution) => contribution.id
)
if (
  JSON.stringify(LIFE_SCIENCE_PREVIEW_CONTRIBUTION_IDS) !== JSON.stringify(rendererContributionIds) ||
  JSON.stringify(LIFE_SCIENCE_PREVIEW_CONTRIBUTION_IDS) !== JSON.stringify(workspaceServerContributionIds)
) {
  throw new Error(
    'Biology Workbench preview main, renderer, and workspace-server contribution IDs must match exactly.'
  )
}

function previewContributionsFor(
  process: DomainPackageProcess,
  kind: string
): readonly DomainPackageContributionDeclaration[] {
  const contributions = contributionsFor(process, kind)
  if (contributions.length === 0) {
    throw new Error(`Biology Workbench ${process} entrypoint declares no ${kind} contributions.`)
  }
  for (const contribution of contributions) {
    if (!Object.hasOwn(domainPackageDefinition.contributionContracts, contribution.id)) {
      throw new Error(
        `Biology Workbench ${process} contribution ${contribution.id} has no canonical contract.`
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
    throw new Error(`Biology Workbench manifest is missing its ${process} entrypoint.`)
  }
  return entrypoint.contributions.filter((contribution) => contribution.kind === kind)
}