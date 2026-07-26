import { lazy, type ReactElement } from 'react'
import { GitMerge } from 'lucide-react'
import type {
  DomainRendererHost,
  DomainWorkbenchRightPanelRenderContext
} from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import { PROJECT_DAG_RESOURCE_KIND } from '../contract'
import {
  PROJECT_DAG_RENDERER_I18N_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import { createProjectDagCapabilityClient } from './project-dag-capability-client'
import {
  projectDagI18nResourceContribution,
  type ProjectDagI18nResourceContribution
} from './project-dag-messages'

const ProjectDagPanel = lazy(() =>
  import('./ProjectDagPanel').then((module) => ({
    default: module.ProjectDagPanel
  }))
)

export type ProjectDagRightPanelContribution = Readonly<{
  id: string
  mode: 'project-dag'
  label: string
  icon: typeof GitMerge
  title: string
  resourceKind: typeof PROJECT_DAG_RESOURCE_KIND
  isAvailable: () => boolean
  render: (context: DomainWorkbenchRightPanelRenderContext) => ReactElement
}>

export type ProjectDagRendererContribution =
  | ProjectDagRightPanelContribution
  | ProjectDagI18nResourceContribution

export function createProjectDagRightPanelContribution(
  host: DomainRendererHost
): ProjectDagRightPanelContribution {
  const client = createProjectDagCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    id: PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    mode: 'project-dag',
    label: 'rightPanelProjectDag',
    icon: GitMerge,
    title: 'Project DAG',
    resourceKind: PROJECT_DAG_RESOURCE_KIND,
    isAvailable: () => true,
    render: (context) => (
      <ProjectDagPanel
        {...context}
        client={client}
        workspacePreview={host.workspacePreview}
        workbench={host.workbench}
      />
    )
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ProjectDagRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<ProjectDagRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        value: createProjectDagRightPanelContribution(host)
      },
      {
        ...PROJECT_DAG_RENDERER_I18N_CONTRIBUTION,
        value: projectDagI18nResourceContribution
      }
    ]
  })
}
