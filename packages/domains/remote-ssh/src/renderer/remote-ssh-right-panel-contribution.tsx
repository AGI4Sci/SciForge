import React, { lazy, type ReactElement } from 'react'
import { Server } from 'lucide-react'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchRightPanelRenderContext,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  REMOTE_SSH_RENDERER_COMMAND_CONTRIBUTION,
  REMOTE_SSH_RENDERER_I18N_CONTRIBUTION,
  REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRACT,
  REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  REMOTE_SSH_RENDERER_TOOLBAR_ACTION_CONTRACT,
  REMOTE_SSH_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import { createRemoteSshCapabilityClient } from './remote-ssh-capability-client'
import {
  remoteSshI18nResourceContribution,
  type RemoteSshI18nResourceContribution
} from './remote-ssh-messages'

const RemoteSshPanel = lazy(() =>
  import('./RemoteSshPanel').then((module) => ({ default: module.RemoteSshPanel }))
)

export type RemoteSshRightPanelRenderProps =
  DomainRendererWorkbenchRightPanelRenderContext

/** Structural renderer value consumed by the host Workbench right-panel slot. */
export type RemoteSshRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>

export type RemoteSshToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof Server>

export type RemoteSshRendererContribution =
  | RemoteSshRightPanelContribution
  | DomainRendererCommandHandler
  | RemoteSshToolbarActionContribution
  | RemoteSshI18nResourceContribution

export function createRemoteSshRightPanelContribution(
  host: DomainRendererHost
): RemoteSshRightPanelContribution {
  const capabilityClient = createRemoteSshCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ className, onCollapse, session }): ReactElement => (
      <RemoteSshPanel
        capabilityClient={capabilityClient}
        workspaceId={session.workspaceRoot ?? ''}
        className={className}
        onCollapse={onCollapse}
        openExternal={host.openExternal}
      />
    )
  })
}

export function createRemoteSshCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  return createOpenRightPanelCommand(host, REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION.id)
}

export function createRemoteSshToolbarActionContribution():
RemoteSshToolbarActionContribution {
  return Object.freeze({ icon: Server })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<RemoteSshRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<RemoteSshRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createRemoteSshRightPanelContribution(host)
      },
      {
        ...REMOTE_SSH_RENDERER_COMMAND_CONTRIBUTION,
        value: createRemoteSshCommand(host)
      },
      {
        ...REMOTE_SSH_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: REMOTE_SSH_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: createRemoteSshToolbarActionContribution()
      },
      {
        ...REMOTE_SSH_RENDERER_I18N_CONTRIBUTION,
        value: remoteSshI18nResourceContribution
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
