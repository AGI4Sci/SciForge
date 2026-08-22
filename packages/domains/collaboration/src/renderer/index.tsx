import React, { lazy, type ReactElement } from 'react'
import { UsersRound } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'

import {
  COLLABORATION_I18N_CONTRIBUTION,
  COLLABORATION_OPEN_COMMAND_CONTRIBUTION,
  COLLABORATION_RIGHT_PANEL_CONTRACT,
  COLLABORATION_RIGHT_PANEL_CONTRIBUTION,
  COLLABORATION_TOOLBAR_ACTION_CONTRACT,
  COLLABORATION_TOOLBAR_ACTION_CONTRIBUTION,
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

export type CollaborationToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof UsersRound>

export type CollaborationRendererContribution =
  | CollaborationRightPanelContribution
  | CollaborationToolbarActionContribution
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

export function createCollaborationToolbarAction():
CollaborationToolbarActionContribution {
  return Object.freeze({ icon: UsersRound })
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
        ...COLLABORATION_TOOLBAR_ACTION_CONTRIBUTION,
        contract: COLLABORATION_TOOLBAR_ACTION_CONTRACT,
        value: createCollaborationToolbarAction()
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
