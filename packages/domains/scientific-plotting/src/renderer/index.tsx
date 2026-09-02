import { lazy, type ReactElement } from 'react'
import { z } from 'zod'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererResourceNavigationValue,
  type DomainRendererWorkbenchRightPanelValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  SCIENTIFIC_PLOTTING_RENDERER_I18N_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
  SCIENTIFIC_PLOTTING_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRACT,
  SCIENTIFIC_PLOTTING_RENDERER_RIGHT_PANEL_CONTRIBUTION,
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
  manifestVersionId: z.string().startsWith('artifact-version:').optional(),
  figureVersionId: z.string().startsWith('artifact-version:').optional(),
  expectedDigest: z.string().trim().toLowerCase()
    .regex(/^sha256:[0-9a-f]{64}$/u)
    .optional()
}).strict().refine(
  (value) => Boolean(value.manifestVersionId || value.figureVersionId),
  { message: 'Scientific Plotting activation requires an exact manifest or Figure version.' }
)

export type ScientificPlottingRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>
export type ScientificPlottingRendererContribution =
  | ScientificPlottingRightPanelContribution
  | DomainRendererResourceNavigationValue
  | ScientificPlottingI18nResourceContribution

export function createScientificPlottingResourceNavigationContribution(): DomainRendererResourceNavigationValue {
  return Object.freeze({
    resolve: ({ resource }) => {
      const resourceId = resource.resourceId.trim()
      if (!resourceId) return null
      const payload = resource.resourceKind === 'scientific-plot-render-manifest'
        ? {
            manifestVersionId: resourceId,
            ...(resource.integrity?.expectedDigest
              ? { expectedDigest: resource.integrity.expectedDigest }
              : {})
          }
        : resource.resourceKind === 'scientific-plot'
          ? {
              figureVersionId: resourceId,
              ...(resource.integrity?.expectedDigest
                ? { expectedDigest: resource.integrity.expectedDigest }
                : {})
            }
          : null
      if (!payload) return null
      return Object.freeze({
        activation: Object.freeze({
          revision: 1,
          payload: Object.freeze(payload)
        })
      })
    }
  })
}

export function createScientificPlottingRightPanelContribution(
  host: DomainRendererHost
): ScientificPlottingRightPanelContribution {
  const client = createScientificPlottingCapabilityClient(host.capabilityInvoker)
  const openResource = host.workbench?.openResource
  return Object.freeze({
    render: ({ activation, className, onCollapse, session, surfaceId }) => {
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
          {...(parsedActivation.success && parsedActivation.data.figureVersionId
            ? { preferredFigureVersionId: parsedActivation.data.figureVersionId }
            : {})}
          {...(parsedActivation.success && parsedActivation.data.expectedDigest
            ? { preferredResourceDigest: parsedActivation.data.expectedDigest }
            : {})}
          {...(openResource
            ? {
                onOpenArtifactHistory: (ref) => {
                  if (!ref) return
                  openResource({
                    sessionId: session.id,
                    surfaceId,
                    resource: {
                      resourceKind: 'artifact-version',
                      resourceId: ref.versionId,
                      integrity: {
                        algorithm: 'sha256',
                        expectedDigest: `sha256:${ref.contentDigest}`
                      }
                    }
                  })
                }
              }
            : {})}
        />
      )
    }
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
        ...SCIENTIFIC_PLOTTING_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
        contract: SCIENTIFIC_PLOTTING_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
        value: createScientificPlottingResourceNavigationContribution()
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
