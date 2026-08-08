import { lazy, type ReactElement } from 'react'
import { BarChart3 } from 'lucide-react'
import { z } from 'zod'
import {
  ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION
} from '@sciforge/domain-artifact-versions/definition'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  SCIENTIFIC_PLOTTING_RENDERER_COMMAND_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_I18N_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRACT,
  SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_TOOLBAR_ACTION_CONTRACT,
  SCIENTIFIC_PLOTTING_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createScientificPlottingCapabilityClient } from './scientific-plotting-capability-client.js'
import {
  scientificPlottingI18nResourceContribution,
  type ScientificPlottingI18nResourceContribution
} from './scientific-plotting-messages.js'

const ScientificPlottingProvenancePanel = lazy(() =>
  import('./ScientificPlottingProvenancePanel.js').then((module) => ({
    default: module.ScientificPlottingProvenancePanel
  }))
)

export const scientificPlottingActivationSchema = z.object({
  manifestVersionId: z.string().startsWith('artifact-version:').optional()
}).strict()

export type ScientificPlottingRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>
export type ScientificPlottingToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof BarChart3>
export type ScientificPlottingRendererContribution =
  | ScientificPlottingRightPanelContribution
  | DomainRendererCommandHandler
  | ScientificPlottingToolbarActionContribution
  | ScientificPlottingI18nResourceContribution

export function createScientificPlottingRightPanelContribution(
  host: DomainRendererHost
): ScientificPlottingRightPanelContribution {
  const client = createScientificPlottingCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ activation, className, onCollapse, session }) => {
      const parsedActivation = scientificPlottingActivationSchema.safeParse(activation?.payload)
      return (
        <ScientificPlottingProvenancePanel
          client={client}
          workspaceRoot={session.workspaceRoot ?? ''}
          className={className}
          onCollapse={onCollapse}
          {...(parsedActivation.success && parsedActivation.data.manifestVersionId
            ? { preferredManifestVersionId: parsedActivation.data.manifestVersionId }
            : {})}
          {...(host.workbench
            ? {
                onOpenArtifactHistory: () => host.workbench?.openRightPanel({
                  contributionId: ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
                  sessionId: session.id
                })
              }
            : {})}
        />
      )
    }
  })
}

export function createScientificPlottingCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  return Object.freeze({
    execute: ({ sessionId, payload }) => {
      if (!sessionId || !host.workbench) return
      host.workbench.openRightPanel({
        contributionId: SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
        sessionId,
        ...(payload === undefined
          ? {}
          : {
              activation: {
                contributionId: SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
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
        SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ScientificPlottingRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<ScientificPlottingRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createScientificPlottingRightPanelContribution(host)
      },
      {
        ...SCIENTIFIC_PLOTTING_RENDERER_COMMAND_CONTRIBUTION,
        value: createScientificPlottingCommand(host)
      },
      {
        ...SCIENTIFIC_PLOTTING_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: SCIENTIFIC_PLOTTING_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: Object.freeze({ icon: BarChart3 })
      },
      {
        ...SCIENTIFIC_PLOTTING_RENDERER_I18N_CONTRIBUTION,
        value: scientificPlottingI18nResourceContribution
      }
    ]
  })
}

export * from './ScientificPlottingProvenancePanel.js'
export * from './scientific-plot-provenance.js'
export * from './scientific-plotting-capability-client.js'
export * from './scientific-plotting-messages.js'
