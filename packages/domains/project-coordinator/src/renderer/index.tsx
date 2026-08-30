import React, { lazy, type ReactElement } from 'react'
import { Workflow } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererComposerContextProvider,
  type DomainRendererWorkbenchNavigationSectionValue,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'

import { projectCoordinatorActivationSchema } from '../contract.js'
import type { ProjectCoordinatorArtifactReviewPrepareInput } from '../contract.js'
import {
  PROJECT_COORDINATOR_COMPOSER_CONTEXT_CONTRACT,
  PROJECT_COORDINATOR_COMPOSER_CONTEXT_CONTRIBUTION,
  PROJECT_COORDINATOR_I18N_CONTRIBUTION,
  PROJECT_COORDINATOR_NAVIGATION_SECTION_CONTRACT,
  PROJECT_COORDINATOR_NAVIGATION_SECTION_CONTRIBUTION,
  PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION,
  PROJECT_COORDINATOR_RIGHT_PANEL_CONTRACT,
  PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION,
  PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRACT,
  PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createProjectCoordinatorRendererClient } from './project-coordinator-capability-client.js'
import {
  createProjectCoordinatorComposerContextProvider
} from './composer-context-provider.js'
import {
  ProjectCoordinatorNavigationSection
} from './ProjectCoordinatorNavigationSection.js'
import {
  projectCoordinatorI18nResourceContribution,
  type ProjectCoordinatorI18nResourceContribution
} from './messages.js'
import { collectProjectCoordinatorWorkspaceSections } from './workspace-sections.js'

const ProjectCoordinatorPanel = lazy(() =>
  import('./ProjectCoordinatorPanel.browser.js')
)

export type ProjectCoordinatorRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>
export type ProjectCoordinatorToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof Workflow>
export type ProjectCoordinatorNavigationSectionContribution =
  DomainRendererWorkbenchNavigationSectionValue<ReactElement>
export type ProjectCoordinatorRendererContribution =
  | ProjectCoordinatorRightPanelContribution
  | ProjectCoordinatorToolbarActionContribution
  | ProjectCoordinatorNavigationSectionContribution
  | DomainRendererComposerContextProvider
  | DomainRendererCommandHandler
  | ProjectCoordinatorI18nResourceContribution

export function createProjectCoordinatorRightPanelContribution(
  host: DomainRendererHost
): ProjectCoordinatorRightPanelContribution {
  const client = createProjectCoordinatorRendererClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ activation, active, className, focused, onCollapse, session, surfaceId }) => {
      const parsedActivation = activation
        ? projectCoordinatorActivationSchema.safeParse(activation.payload)
        : undefined
      const workspaceSections = collectProjectCoordinatorWorkspaceSections(host)
      return (
        <ProjectCoordinatorPanel
          client={client}
          className={className}
          onCollapse={onCollapse}
          session={session}
          visibleContext={host.visibleContext}
          active={active}
          focused={focused}
          surfaceId={surfaceId}
          workspaceSections={workspaceSections}
          {...(host.workbench?.openResource ? {
            onOpenArtifact: async (input: ProjectCoordinatorArtifactReviewPrepareInput) => {
              if (!session.workspaceRoot) {
                throw new Error('Artifact review requires an exact Workspace binding.')
              }
              const prepared = await client.prepareArtifactReview(input, {
                workspaceId: session.workspaceRoot
              })
              if (host.workbench?.canOpenResource &&
                  !host.workbench.canOpenResource(prepared.resource.kind)) {
                throw new Error('The Content Space resource review surface is unavailable.')
              }
              const opened = host.workbench?.openResource?.({
                sessionId: session.id,
                placement: 'new',
                resource: {
                  resourceKind: prepared.resource.kind,
                  resourceId: prepared.resource.resourceRef,
                  resourceRef: prepared.resource.resourceRef
                }
              })
              if (!opened) {
                throw new Error('The Content Space resource review surface could not be opened.')
              }
            }
          } : {})}
          {...(parsedActivation?.success && parsedActivation.data.projectId
            ? { initialProjectId: parsedActivation.data.projectId }
            : {})}
          {...(parsedActivation?.success && parsedActivation.data.view
            ? { initialView: parsedActivation.data.view }
            : {})}
          {...(activation ? { activationRevision: activation.revision } : {})}
        />
      )
    }
  })
}

export function createProjectCoordinatorOpenCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  let activationRevision = 0
  return Object.freeze({
    execute: ({ sessionId, payload }) => {
      if (!sessionId || !host.workbench) return
      const parsedPayload = payload === undefined
        ? undefined
        : projectCoordinatorActivationSchema.parse(payload)
      if (parsedPayload) activationRevision += 1
      host.workbench.openRightPanel({
        contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
        sessionId,
        ...(parsedPayload === undefined
          ? {}
          : {
              activation: {
                contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
                revision: activationRevision,
                payload: parsedPayload
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

export function createProjectCoordinatorNavigationSectionContribution(
  host: DomainRendererHost,
  openCommand: DomainRendererCommandHandler = createProjectCoordinatorOpenCommand(host)
): ProjectCoordinatorNavigationSectionContribution {
  const client = createProjectCoordinatorRendererClient(host.capabilityInvoker)
  return Object.freeze({
    render: (context) => (
      <ProjectCoordinatorNavigationSection
        client={client}
        context={context}
        onCreateProject={() => openCommand.execute({
          sessionId: context.session.id,
          payload: { view: 'create' }
        })}
        onOpenProject={(projectId, view) => openCommand.execute({
          sessionId: context.session.id,
          payload: { projectId, view }
        })}
        onActivateProject={(projectId, sessionId) => {
          context.selectSession(sessionId)
          openCommand.execute({
            sessionId,
            // A pending activation is emitted when the coordinator Session is
            // created.  Re-acknowledging it during a later workspace refresh
            // (for example after assigning a Worker) must return to the
            // Project workflow surface rather than replacing the user's
            // task-dispatch context with the overview dashboard.
            payload: { projectId, view: 'projects' }
          })
        }}
      />
    )
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ProjectCoordinatorRendererContribution> {
  const openCommand = createProjectCoordinatorOpenCommand(host)
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
        value: openCommand
      },
      {
        ...PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION,
        contract: PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRACT,
        value: Object.freeze({ icon: Workflow })
      },
      {
        ...PROJECT_COORDINATOR_NAVIGATION_SECTION_CONTRIBUTION,
        contract: PROJECT_COORDINATOR_NAVIGATION_SECTION_CONTRACT,
        value: createProjectCoordinatorNavigationSectionContribution(host, openCommand)
      },
      {
        ...PROJECT_COORDINATOR_COMPOSER_CONTEXT_CONTRIBUTION,
        contract: PROJECT_COORDINATOR_COMPOSER_CONTEXT_CONTRACT,
        value: createProjectCoordinatorComposerContextProvider(
          createProjectCoordinatorRendererClient(host.capabilityInvoker)
        )
      },
      {
        ...PROJECT_COORDINATOR_I18N_CONTRIBUTION,
        value: projectCoordinatorI18nResourceContribution
      }
    ]
  })
}

export * from './ProjectCoordinatorPanel.js'
export * from './ProjectCoordinatorNavigationSection.js'
export * from './ProjectCoordinatorSidebarSection.js'
export * from './composer-context-provider.js'
export * from './messages.js'
export * from './project-coordinator-capability-client.js'
export * from './workspace-sections.js'
export * from './panel-context.js'
