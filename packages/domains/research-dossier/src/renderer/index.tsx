import { lazy, type ReactElement } from 'react'
import { LibraryBig } from 'lucide-react'

import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererResourceNavigationValue,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'

import {
  RESEARCH_DOSSIER_RENDERER_COMMAND_CONTRIBUTION,
  RESEARCH_DOSSIER_RENDERER_I18N_CONTRIBUTION,
  RESEARCH_DOSSIER_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
  RESEARCH_DOSSIER_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
  RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRACT,
  RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  RESEARCH_DOSSIER_RENDERER_TOOLBAR_ACTION_CONTRACT,
  RESEARCH_DOSSIER_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createResearchDossierActivation } from '../contract.js'
import { createResearchDossierCapabilityClient } from './research-dossier-capability-client.js'
import {
  researchDossierI18nResourceContribution,
  type ResearchDossierI18nResourceContribution
} from './research-dossier-messages.js'

const ResearchDossierPanel = lazy(() =>
  import('./ResearchDossierPanel.js').then((module) => ({
    default: module.ResearchDossierPanel
  }))
)

export type ResearchDossierRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>
export type ResearchDossierToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof LibraryBig>
export type ResearchDossierRendererContribution =
  | ResearchDossierRightPanelContribution
  | DomainRendererCommandHandler
  | ResearchDossierToolbarActionContribution
  | ResearchDossierI18nResourceContribution
  | DomainRendererResourceNavigationValue

export function createResearchDossierResourceNavigationContribution():
  DomainRendererResourceNavigationValue {
  return Object.freeze({
    resolve: ({ resource }) => {
      const resourceId = resource.resourceId.trim()
      if (!resourceId) return null
      const target = resource.resourceKind === 'artifact-version'
        ? { kind: 'artifact-version' as const, versionId: resourceId }
        : resource.resourceKind === 'compute-run'
          ? { kind: 'compute-run' as const, runId: resourceId }
          : null
      if (!target) return null
      const activation = createResearchDossierActivation(target, {
        ...(resource.integrity?.expectedDigest
          ? { expectedDigest: resource.integrity.expectedDigest }
          : {})
      })
      return Object.freeze({
        activation: Object.freeze({
          revision: activation.revision,
          payload: activation.payload
        })
      })
    }
  })
}

export function createResearchDossierRightPanelContribution(
  host: DomainRendererHost
): ResearchDossierRightPanelContribution {
  const client = createResearchDossierCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ activation, ...context }) => (
      <ResearchDossierPanel
        {...context}
        {...(activation
          ? {
              activation: {
                contributionId: RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
                ...activation
              }
            }
          : {})}
        client={client}
        workbench={host.workbench}
        workspacePreview={host.workspacePreview}
      />
    )
  })
}

export function createResearchDossierCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  return Object.freeze({
    execute: ({ sessionId, payload }) => {
      if (!sessionId || !host.workbench) return
      host.workbench.openRightPanel({
        contributionId: RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
        sessionId,
        ...(payload === undefined
          ? {}
          : {
              activation: {
                contributionId: RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
                revision: 1,
                payload
              }
            })
      })
    },
    isAvailable: ({ sessionId, workspaceRoot }) => Boolean(
      host.workbench && sessionId?.trim() && workspaceRoot?.trim()
    ),
    isActive: ({ activeSurface }) =>
      activeSurface?.kind === 'right-panel' &&
      activeSurface.contributionId ===
        RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ResearchDossierRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<ResearchDossierRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createResearchDossierRightPanelContribution(host)
      },
      {
        ...RESEARCH_DOSSIER_RENDERER_COMMAND_CONTRIBUTION,
        value: createResearchDossierCommand(host)
      },
      {
        ...RESEARCH_DOSSIER_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: RESEARCH_DOSSIER_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: Object.freeze({ icon: LibraryBig })
      },
      {
        ...RESEARCH_DOSSIER_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
        contract: RESEARCH_DOSSIER_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
        value: createResearchDossierResourceNavigationContribution()
      },
      {
        ...RESEARCH_DOSSIER_RENDERER_I18N_CONTRIBUTION,
        value: researchDossierI18nResourceContribution
      }
    ]
  })
}

export * from './ResearchDossierPanel.js'
export * from './research-dossier-capability-client.js'
export * from './research-dossier-loader.js'
export * from './research-dossier-messages.js'
export * from './research-dossier-model.js'
