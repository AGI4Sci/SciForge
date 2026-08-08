import { lazy, type ReactElement } from 'react'
import { Layers3 } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  ARTIFACT_VERSIONS_RENDERER_COMMAND_CONTRIBUTION,
  ARTIFACT_VERSIONS_RENDERER_I18N_CONTRIBUTION,
  ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRACT,
  ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  ARTIFACT_VERSIONS_RENDERER_TOOLBAR_ACTION_CONTRACT,
  ARTIFACT_VERSIONS_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createArtifactVersionsCapabilityClient } from './artifact-versions-capability-client.js'
import {
  artifactVersionsI18nResourceContribution,
  type ArtifactVersionsI18nResourceContribution
} from './artifact-versions-messages.js'

const ArtifactVersionsPanel = lazy(() =>
  import('./ArtifactVersionsPanel.js').then((module) => ({
    default: module.ArtifactVersionsPanel
  }))
)

export type ArtifactVersionsRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>
export type ArtifactVersionsCommandContribution = DomainRendererCommandHandler
export type ArtifactVersionsToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof Layers3>
export type ArtifactVersionsRendererContribution =
  | ArtifactVersionsRightPanelContribution
  | ArtifactVersionsCommandContribution
  | ArtifactVersionsToolbarActionContribution
  | ArtifactVersionsI18nResourceContribution

export function createArtifactVersionsRightPanelContribution(
  host: DomainRendererHost
): ArtifactVersionsRightPanelContribution {
  const client = createArtifactVersionsCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ className, onCollapse, session }) => (
      <ArtifactVersionsPanel
        client={client}
        workspaceRoot={session.workspaceRoot ?? ''}
        className={className}
        onCollapse={onCollapse}
      />
    )
  })
}

export function createArtifactVersionsCommandContribution(
  host: DomainRendererHost
): ArtifactVersionsCommandContribution {
  return Object.freeze({
    execute: (context) => {
      if (!context.sessionId || !host.workbench) return
      host.workbench.openRightPanel({
        contributionId: ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
        sessionId: context.sessionId
      })
    },
    isAvailable: (context) => Boolean(
      host.workbench && context.sessionId?.trim() && context.workspaceRoot?.trim()
    ),
    isActive: (context) =>
      context.activeSurface?.kind === 'right-panel' &&
      context.activeSurface.contributionId ===
        ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ArtifactVersionsRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<ArtifactVersionsRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createArtifactVersionsRightPanelContribution(host)
      },
      {
        ...ARTIFACT_VERSIONS_RENDERER_COMMAND_CONTRIBUTION,
        value: createArtifactVersionsCommandContribution(host)
      },
      {
        ...ARTIFACT_VERSIONS_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: ARTIFACT_VERSIONS_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: Object.freeze({ icon: Layers3 })
      },
      {
        ...ARTIFACT_VERSIONS_RENDERER_I18N_CONTRIBUTION,
        value: artifactVersionsI18nResourceContribution
      }
    ]
  })
}

export * from './ArtifactVersionsPanel.js'
export * from './artifact-version-actions.js'
export * from './artifact-versions-capability-client.js'
export * from './artifact-versions-messages.js'
