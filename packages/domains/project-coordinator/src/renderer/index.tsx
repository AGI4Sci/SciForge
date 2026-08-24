import React, { lazy, type ReactElement } from 'react'
import { ClipboardCheck } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'

import { projectCoordinatorActivationSchema } from '../contract.js'
import {
  PROJECT_COORDINATOR_I18N_CONTRIBUTION,
  PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION,
  PROJECT_COORDINATOR_RIGHT_PANEL_CONTRACT,
  PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION,
  PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRACT,
  PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createProjectCoordinatorRendererClient } from './project-coordinator-capability-client.js'
import {
  projectCoordinatorI18nResourceContribution,
  type ProjectCoordinatorI18nResourceContribution
} from './messages.js'

const ProjectCoordinatorPanel = lazy(() =>
  import('./ProjectCoordinatorPanel.js').then((module) => ({
    default: module.ProjectCoordinatorPanel
  }))
)

export type ProjectCoordinatorRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>
export type ProjectCoordinatorToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof ClipboardCheck>
export type ProjectCoordinatorRendererContribution =
  | ProjectCoordinatorRightPanelContribution
  | ProjectCoordinatorToolbarActionContribution
  | DomainRendererCommandHandler
  | ProjectCoordinatorI18nResourceContribution

export function createProjectCoordinatorRightPanelContribution(
  host: DomainRendererHost
): ProjectCoordinatorRightPanelContribution {
  const client = createProjectCoordinatorRendererClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ activation, className, onCollapse, session }) => {
      const parsedActivation = activation
        ? projectCoordinatorActivationSchema.safeParse(activation.payload)
        : undefined
      return (
        <ProjectCoordinatorPanel
          client={client}
          className={className}
          onCollapse={onCollapse}
          session={session}
          {...(parsedActivation?.success && parsedActivation.data.projectId
            ? { initialProjectId: parsedActivation.data.projectId }
            : {})}
        />
      )
    }
  })
}

export function createProjectCoordinatorOpenCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  return Object.freeze({
    execute: ({ sessionId, payload }) => {
      if (!sessionId || !host.workbench) return
      host.workbench.openRightPanel({
        contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
        sessionId,
        ...(payload === undefined
          ? {}
          : {
              activation: {
                contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
                revision: 1,
                payload: projectCoordinatorActivationSchema.parse(payload)
              }
            })
      })
    },
    isAvailable: ({ sessionId }) => Boolean(sessionId && host.workbench),
    isActive: ({ activeSurface }) =>
      activeSurface?.kind === 'right-panel' &&
      activeSurface.contributionId === PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ProjectCoordinatorRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<ProjectCoordinatorRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION,
        contract: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRACT,
        value: createProjectCoordinatorRightPanelContribution(host)
      },
      {
        ...PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION,
        value: createProjectCoordinatorOpenCommand(host)
      },
      {
        ...PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION,
        contract: PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRACT,
        value: Object.freeze({ icon: ClipboardCheck })
      },
      {
        ...PROJECT_COORDINATOR_I18N_CONTRIBUTION,
        value: projectCoordinatorI18nResourceContribution
      }
    ]
  })
}

export * from './ProjectCoordinatorPanel.js'
export * from './messages.js'
export * from './project-coordinator-capability-client.js'
