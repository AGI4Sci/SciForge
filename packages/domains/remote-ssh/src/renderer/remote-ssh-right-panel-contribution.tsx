import React, { lazy, type ReactElement } from 'react'
import { Server } from 'lucide-react'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import type {
  DomainRendererHost,
  DomainWorkbenchRightPanelRenderContext
} from '@sciforge/domain-sdk/host'
import { REMOTE_SSH_TARGET_RESOURCE_KIND } from '../contract'
import {
  REMOTE_SSH_RENDERER_I18N_CONTRIBUTION,
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

export type RemoteSshRightPanelRenderProps = DomainWorkbenchRightPanelRenderContext

/** Structural renderer value consumed by the host Workbench right-panel slot. */
export type RemoteSshRightPanelContribution = Readonly<{
  id: string
  mode: 'remote-ssh'
  title: string
  resourceKind: string
  render: (props: RemoteSshRightPanelRenderProps) => ReactElement
}>

export type RemoteSshToolbarActionContribution = Readonly<{
  icon: typeof Server
  isAvailable: () => boolean
}>

export type RemoteSshRendererContribution =
  | RemoteSshRightPanelContribution
  | RemoteSshToolbarActionContribution
  | RemoteSshI18nResourceContribution

export function createRemoteSshRightPanelContribution(
  host: DomainRendererHost
): RemoteSshRightPanelContribution {
  const capabilityClient = createRemoteSshCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    id: REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    mode: 'remote-ssh',
    title: 'Remote targets',
    resourceKind: REMOTE_SSH_TARGET_RESOURCE_KIND,
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

export function createRemoteSshToolbarActionContribution():
RemoteSshToolbarActionContribution {
  return Object.freeze({
    icon: Server,
    isAvailable: () => true
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<RemoteSshRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<RemoteSshRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        value: createRemoteSshRightPanelContribution(host)
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
