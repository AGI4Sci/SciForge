import { lazy, type ReactElement } from 'react'
import { History } from 'lucide-react'
import type {
  DomainRendererHost
} from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  GIT_CHECKPOINTS_RENDERER_COMMAND_CONTRIBUTION,
  GIT_CHECKPOINTS_RENDERER_I18N_CONTRIBUTION,
  GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRACT,
  GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  GIT_CHECKPOINTS_RENDERER_TOOLBAR_ACTION_CONTRACT,
  GIT_CHECKPOINTS_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import { createGitCheckpointsCapabilityClient } from './git-checkpoints-capability-client'
import {
  gitCheckpointsI18nResourceContribution,
  type GitCheckpointsI18nResourceContribution
} from './git-checkpoints-messages'

const GitCheckpointsPanel = lazy(() =>
  import('./GitCheckpointsPanel').then((module) => ({
    default: module.GitCheckpointsPanel
  }))
)

export type GitCheckpointsRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>
export type GitCheckpointsCommandContribution = DomainRendererCommandHandler
export type GitCheckpointsToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof History>

export type GitCheckpointsRendererContribution =
  | GitCheckpointsRightPanelContribution
  | GitCheckpointsCommandContribution
  | GitCheckpointsToolbarActionContribution
  | GitCheckpointsI18nResourceContribution

export function createGitCheckpointsRightPanelContribution(
  host: DomainRendererHost
): GitCheckpointsRightPanelContribution {
  const client = createGitCheckpointsCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ className, onCollapse, session }) => (
      <GitCheckpointsPanel
        client={client}
        sessionId={session.id}
        runtimeId={session.runtimeId}
        workspaceRoot={session.workspaceRoot ?? ''}
        className={className}
        onCollapse={onCollapse}
      />
    )
  })
}

export function createGitCheckpointsCommandContribution(
  host: DomainRendererHost
): GitCheckpointsCommandContribution {
  return Object.freeze({
    execute: (context) => {
      if (!context.sessionId || !host.workbench) return
      host.workbench.openRightPanel({
        contributionId: GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
        sessionId: context.sessionId
      })
    },
    isAvailable: (context) => Boolean(
      host.workbench &&
      context.sessionId?.trim() &&
      context.workspaceRoot?.trim()
    ),
    isActive: (context) =>
      context.activeSurface?.kind === 'right-panel' &&
      context.activeSurface.contributionId ===
        GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<GitCheckpointsRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<GitCheckpointsRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createGitCheckpointsRightPanelContribution(host)
      },
      {
        ...GIT_CHECKPOINTS_RENDERER_COMMAND_CONTRIBUTION,
        value: createGitCheckpointsCommandContribution(host)
      },
      {
        ...GIT_CHECKPOINTS_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: GIT_CHECKPOINTS_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: Object.freeze({ icon: History })
      },
      {
        ...GIT_CHECKPOINTS_RENDERER_I18N_CONTRIBUTION,
        value: gitCheckpointsI18nResourceContribution
      }
    ]
  })
}
