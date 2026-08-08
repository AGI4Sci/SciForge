import {
  defineTrustedDomainPackage,
  type DomainPackageProcess,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition: TrustedDomainPackageDefinition =
  defineTrustedDomainPackage(manifest as TrustedDomainPackageDefinitionInput)

export const EVIDENCE_DAG_DOMAIN_MODULE_ID = domainPackageDefinition.module.id
export const EVIDENCE_DAG_DOMAIN_PACKAGE_NAME = domainPackageDefinition.packageName

export const EVIDENCE_DAG_CAPABILITY_FACTORY_CONTRIBUTION = contributionFor(
  'main',
  'main.capability-factory'
)
export const EVIDENCE_DAG_RUNTIME_LIFECYCLE_CONTRIBUTION = contributionFor(
  'main',
  'main.runtime-lifecycle'
)
export const EVIDENCE_DAG_ARTIFACT_CONSUMER_CONTRIBUTION = contributionFor(
  'main',
  'main.artifact-consumer'
)
export const EVIDENCE_DAG_WRITE_EXPORT_ACTION_GUARD_CONTRIBUTION = contributionFor(
  'main',
  'main.action-guard'
)
export const EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-right-panel'
)
export const EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT =
  domainPackageDefinition.contributionContracts[
    EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  ]!
export const EVIDENCE_DAG_RENDERER_COMMAND_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.command'
)
export const EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.workbench-toolbar-action'
)
export const EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRACT =
  domainPackageDefinition.contributionContracts[
    EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  ]!
export const EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION = contributionFor(
  'renderer',
  'renderer.i18n-resource'
)

function contributionFor(process: DomainPackageProcess, kind: string) {
  const contribution = domainPackageDefinition.entrypoints
    .find((entrypoint) => entrypoint.process === process)
    ?.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) {
    throw new Error(`Evidence DAG manifest is missing ${process}:${kind}.`)
  }
  return contribution
}
