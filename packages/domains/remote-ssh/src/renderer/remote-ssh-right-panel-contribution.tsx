import React, { lazy, type ReactElement } from 'react'
import { Server } from 'lucide-react'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import { REMOTE_SSH_TARGET_RESOURCE_KIND } from '../contract'
import {
  REMOTE_SSH_RENDERER_I18N_CONTRIBUTION,
  REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION,
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

export type RemoteSshRightPanelRenderProps = Readonly<{
  className: string
  onCollapse: () => void
  workspaceRoot: string
}>

/** Structural renderer value consumed by the host Workbench right-panel slot. */
export type RemoteSshRightPanelContribution = Readonly<{
  id: string
  mode: 'remote-ssh'
  label: string
  icon: typeof Server
  title: string
  resourceKind: string
  isAvailable: () => boolean
  render: (props: RemoteSshRightPanelRenderProps) => ReactElement
}>

export type RemoteSshRendererContribution =
  | RemoteSshRightPanelContribution
  | RemoteSshI18nResourceContribution

export function createRemoteSshRightPanelContribution(
  host: DomainRendererHost
): RemoteSshRightPanelContribution {
  const capabilityClient = createRemoteSshCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    id: REMOTE_SSH_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    mode: 'remote-ssh',
    label: 'rightPanelRemoteSsh',
    icon: Server,
    title: 'Remote targets',
    resourceKind: REMOTE_SSH_TARGET_RESOURCE_KIND,
    isAvailable: () => true,
    render: ({ className, onCollapse, workspaceRoot }): ReactElement => (
      <RemoteSshPanel
        capabilityClient={capabilityClient}
        workspaceId={workspaceRoot}
        className={className}
        onCollapse={onCollapse}
        openExternal={host.openExternal}
      />
    )
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
        ...REMOTE_SSH_RENDERER_I18N_CONTRIBUTION,
        value: remoteSshI18nResourceContribution
      }
    ]
  })
}
