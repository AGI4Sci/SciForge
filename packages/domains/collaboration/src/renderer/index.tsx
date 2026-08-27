import React, { lazy, type ReactElement } from 'react'
import { Inbox, Settings2, type LucideIcon } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchWorkspaceSectionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'

import {
  COLLABORATION_I18N_CONTRIBUTION,
  COLLABORATION_OPEN_COMMAND_CONTRIBUTION,
  COLLABORATION_RIGHT_PANEL_CONTRACT,
  COLLABORATION_RIGHT_PANEL_CONTRIBUTION,
  COLLABORATION_WORKSPACE_MY_WORK_CONTRACT,
  COLLABORATION_WORKSPACE_MY_WORK_CONTRIBUTION,
  COLLABORATION_WORKSPACE_SETTINGS_CONTRACT,
  COLLABORATION_WORKSPACE_SETTINGS_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createCollaborationRendererClient } from './collaboration-capability-client.js'
import {
  collaborationI18nResourceContribution,
  type CollaborationI18nResourceContribution
} from './collaboration-messages.js'

const CollaborationPanel = lazy(() =>
  import('./CollaborationPanel.js').then((module) => ({
    default: module.CollaborationPanel
  }))
)

export type CollaborationRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>

export type CollaborationWorkspaceSectionContribution =
  DomainRendererWorkbenchWorkspaceSectionValue<ReactElement, LucideIcon>

export type CollaborationRendererContribution =
  | CollaborationRightPanelContribution
  | CollaborationWorkspaceSectionContribution
  | DomainRendererCommandHandler
  | CollaborationI18nResourceContribution

export function createCollaborationRightPanelContribution(
  host: DomainRendererHost
): CollaborationRightPanelContribution {
  const client = createCollaborationRendererClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ className, onCollapse, session }) => (
      <CollaborationPanel
        client={client}
        className={className}
        onCollapse={onCollapse}
        session={session}
      />
    )
  })
}

export function createCollaborationOpenCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  return Object.freeze({
    execute: ({ sessionId, payload }) => {
      if (!sessionId || !host.workbench) return
      host.workbench.openRightPanel({
        contributionId: COLLABORATION_RIGHT_PANEL_CONTRIBUTION.id,
        sessionId,
        ...(payload === undefined
          ? {}
          : {
              activation: {
                contributionId: COLLABORATION_RIGHT_PANEL_CONTRIBUTION.id,
                revision: 1,
                payload
              }
            })
      })
    },
    isAvailable: ({ sessionId }) => Boolean(sessionId && host.workbench),
    isActive: ({ activeSurface }) =>
      activeSurface?.kind === 'right-panel' &&
      activeSurface.contributionId === COLLABORATION_RIGHT_PANEL_CONTRIBUTION.id
  })
}

export function createCollaborationWorkspaceSectionContribution(
  host: DomainRendererHost,
  view: 'work' | 'settings'
): CollaborationWorkspaceSectionContribution {
  const client = createCollaborationRendererClient(host.capabilityInvoker)
  return Object.freeze({
    icon: view === 'work' ? Inbox : Settings2,
    render: ({ className, session }) => (
      <CollaborationPanel
        client={client}
        className={className}
        embedded
        session={session}
        view={view}
      />
    )
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<CollaborationRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<CollaborationRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...COLLABORATION_RIGHT_PANEL_CONTRIBUTION,
        contract: COLLABORATION_RIGHT_PANEL_CONTRACT,
        value: createCollaborationRightPanelContribution(host)
      },
      {
        ...COLLABORATION_OPEN_COMMAND_CONTRIBUTION,
        value: createCollaborationOpenCommand(host)
      },
      {
        ...COLLABORATION_WORKSPACE_MY_WORK_CONTRIBUTION,
        contract: COLLABORATION_WORKSPACE_MY_WORK_CONTRACT,
        value: createCollaborationWorkspaceSectionContribution(host, 'work')
      },
      {
        ...COLLABORATION_WORKSPACE_SETTINGS_CONTRIBUTION,
        contract: COLLABORATION_WORKSPACE_SETTINGS_CONTRACT,
        value: createCollaborationWorkspaceSectionContribution(host, 'settings')
      },
      {
        ...COLLABORATION_I18N_CONTRIBUTION,
        value: collaborationI18nResourceContribution
      }
    ]
  })
}

export * from './CollaborationPanel.js'
export * from './collaboration-capability-client.js'
export * from './collaboration-messages.js'
