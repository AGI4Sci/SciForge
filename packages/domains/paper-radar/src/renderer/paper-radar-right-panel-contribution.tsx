import React, { lazy, type ReactElement } from 'react'
import { Newspaper } from 'lucide-react'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import type {
  DomainRendererHost,
  DomainWorkbenchRightPanelRenderContext
} from '@sciforge/domain-sdk/host'
import {
  PAPER_RADAR_RENDERER_I18N_CONTRIBUTION,
  PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  PAPER_RADAR_RENDERER_TOOLBAR_ACTION_CONTRACT,
  PAPER_RADAR_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import { createPaperRadarCapabilityClient } from './paper-radar-capability-client'
import {
  paperRadarI18nResourceContribution,
  type PaperRadarI18nResourceContribution
} from './paper-radar-messages'

const PaperRadarPanel = lazy(() =>
  import('./PaperRadarPanel').then((module) => ({ default: module.PaperRadarPanel }))
)

export type PaperRadarRightPanelRenderProps = DomainWorkbenchRightPanelRenderContext

/** Structural renderer value consumed by the host Workbench right-panel slot. */
export type PaperRadarRightPanelContribution = Readonly<{
  id: string
  mode: 'paper'
  title: string
  resourceKind: string
  render: (props: PaperRadarRightPanelRenderProps) => ReactElement
}>

export type PaperRadarToolbarActionContribution = Readonly<{
  icon: typeof Newspaper
  isAvailable: () => boolean
}>

export type PaperRadarRendererContribution =
  | PaperRadarRightPanelContribution
  | PaperRadarToolbarActionContribution
  | PaperRadarI18nResourceContribution

export function createPaperRadarRightPanelContribution(
  host: DomainRendererHost
): PaperRadarRightPanelContribution {
  const capabilityClient = createPaperRadarCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    id: PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    mode: 'paper',
    title: 'Paper radar',
    resourceKind: 'paper-radar',
    render: ({ className, onCollapse }): ReactElement => (
      <PaperRadarPanel
        capabilityClient={capabilityClient}
        openExternal={host.openExternal}
        className={className}
        onCollapse={onCollapse}
      />
    )
  })
}

export function createPaperRadarToolbarActionContribution():
PaperRadarToolbarActionContribution {
  return Object.freeze({
    icon: Newspaper,
    isAvailable: () => true
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<PaperRadarRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<PaperRadarRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        value: createPaperRadarRightPanelContribution(host)
      },
      {
        ...PAPER_RADAR_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: PAPER_RADAR_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: createPaperRadarToolbarActionContribution()
      },
      {
        ...PAPER_RADAR_RENDERER_I18N_CONTRIBUTION,
        value: paperRadarI18nResourceContribution
      }
    ]
  })
}
