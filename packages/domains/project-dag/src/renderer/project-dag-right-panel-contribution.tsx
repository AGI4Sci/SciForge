import React, { lazy, type ReactElement } from 'react'
import { GitMerge } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  PROJECT_DAG_RENDERER_COMMAND_CONTRIBUTION,
  PROJECT_DAG_RENDERER_I18N_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
  PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  PROJECT_DAG_RENDERER_TOOLBAR_ACTION_CONTRACT,
  PROJECT_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
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

export type ProjectDagRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>

export type ProjectDagToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof GitMerge>

export type ProjectDagRendererContribution =
  | ProjectDagRightPanelContribution
  | DomainRendererCommandHandler
  | ProjectDagToolbarActionContribution
  | ProjectDagI18nResourceContribution

export function createProjectDagRightPanelContribution(
  host: DomainRendererHost
): ProjectDagRightPanelContribution {
  const client = createProjectDagCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ activation, ...context }) => (
      <ProjectDagPanel
        {...context}
        {...(activation
          ? {
              activation: {
                contributionId: PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
                ...activation
              }
            }
          : {})}
        client={client}
        workspacePreview={host.workspacePreview}
        workbench={host.workbench}
      />
    )
  })
}

export function createProjectDagCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  return createOpenRightPanelCommand(host, PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id)
}

export function createProjectDagToolbarActionContribution():
ProjectDagToolbarActionContribution {
  return Object.freeze({ icon: GitMerge })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ProjectDagRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<ProjectDagRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createProjectDagRightPanelContribution(host)
      },
      {
        ...PROJECT_DAG_RENDERER_COMMAND_CONTRIBUTION,
        value: createProjectDagCommand(host)
      },
      {
        ...PROJECT_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: PROJECT_DAG_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: createProjectDagToolbarActionContribution()
      },
      {
        ...PROJECT_DAG_RENDERER_I18N_CONTRIBUTION,
        value: projectDagI18nResourceContribution
      }
    ]
  })
}

function createOpenRightPanelCommand(
  host: DomainRendererHost,
  contributionId: string
): DomainRendererCommandHandler {
  return Object.freeze({
    execute: ({ sessionId, payload }) => {
      if (!sessionId || !host.workbench) return
      host.workbench.openRightPanel({
        contributionId,
        sessionId,
        ...(payload === undefined ? {} : {
          activation: { contributionId, revision: 1, payload }
        })
      })
    },
    isAvailable: () => Boolean(host.workbench),
    isActive: ({ activeSurface }) =>
      activeSurface?.kind === 'right-panel' &&
      activeSurface.contributionId === contributionId
  })
}
