import React, { lazy, type ReactElement } from 'react'
import { Newspaper } from 'lucide-react'
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
  PAPER_RADAR_RENDERER_COMMAND_CONTRIBUTION,
  PAPER_RADAR_RENDERER_I18N_CONTRIBUTION,
  PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRACT,
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

export type PaperRadarRightPanelRenderProps =
  DomainRendererWorkbenchRightPanelRenderContext

/** Structural renderer value consumed by the host Workbench right-panel slot. */
export type PaperRadarRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>

export type PaperRadarToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof Newspaper>

export type PaperRadarRendererContribution =
  | PaperRadarRightPanelContribution
  | DomainRendererCommandHandler
  | PaperRadarToolbarActionContribution
  | PaperRadarI18nResourceContribution

export function createPaperRadarRightPanelContribution(
  host: DomainRendererHost
): PaperRadarRightPanelContribution {
  const capabilityClient = createPaperRadarCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
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

export function createPaperRadarCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  return createOpenRightPanelCommand(host, PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION.id)
}

export function createPaperRadarToolbarActionContribution():
PaperRadarToolbarActionContribution {
  return Object.freeze({ icon: Newspaper })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<PaperRadarRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<PaperRadarRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: PAPER_RADAR_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createPaperRadarRightPanelContribution(host)
      },
      {
        ...PAPER_RADAR_RENDERER_COMMAND_CONTRIBUTION,
        value: createPaperRadarCommand(host)
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
