import { lazy, type ReactElement } from 'react'
import { CloudCog } from 'lucide-react'

import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'

import {
  OPENCONTENT_RENDERER_COMMAND_CONTRIBUTION,
  OPENCONTENT_RENDERER_RIGHT_PANEL_CONTRACT,
  OPENCONTENT_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  OPENCONTENT_RENDERER_TOOLBAR_ACTION_CONTRACT,
  OPENCONTENT_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createOpenContentConnectionRendererClient } from './client.js'

const OpenContentConnectionPanel = lazy(() => import('./OpenContentConnectionPanel.js').then(
  (module) => ({ default: module.OpenContentConnectionPanel })
))

type OpenContentRendererContribution =
  | DomainRendererWorkbenchRightPanelValue<ReactElement>
  | DomainRendererWorkbenchToolbarActionValue<typeof CloudCog>
  | DomainRendererCommandHandler

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<OpenContentRendererContribution> {
  const client = createOpenContentConnectionRendererClient(host.capabilityInvoker)
  const panel: DomainRendererWorkbenchRightPanelValue<ReactElement> = Object.freeze({
    render: ({ className, onCollapse }) => (
      <OpenContentConnectionPanel client={client} className={className} onCollapse={onCollapse} />
    )
  })
  const command: DomainRendererCommandHandler = Object.freeze({
    execute: ({ sessionId }) => {
      if (!sessionId || !host.workbench) return
      host.workbench.openRightPanel({
        contributionId: OPENCONTENT_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
        sessionId
      })
    },
    isAvailable: ({ sessionId }) => Boolean(host.workbench && sessionId?.trim()),
    isActive: ({ activeSurface }) => activeSurface?.kind === 'right-panel' &&
      activeSurface.contributionId === OPENCONTENT_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  })

  return defineTrustedRendererDomainPackageEntry<OpenContentRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...OPENCONTENT_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: OPENCONTENT_RENDERER_RIGHT_PANEL_CONTRACT,
        value: panel
      },
      { ...OPENCONTENT_RENDERER_COMMAND_CONTRIBUTION, value: command },
      {
        ...OPENCONTENT_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: OPENCONTENT_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: Object.freeze({ icon: CloudCog })
      }
    ]
  })
}

export * from './client.js'
