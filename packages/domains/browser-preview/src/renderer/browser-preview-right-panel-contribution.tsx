import React, { lazy, type ReactElement } from 'react'
import { Globe2 } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchToolbarActionValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  BROWSER_PREVIEW_RENDERER_COMMAND_CONTRIBUTION,
  BROWSER_PREVIEW_RENDERER_I18N_CONTRIBUTION,
  BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRACT,
  BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  BROWSER_PREVIEW_RENDERER_TOOLBAR_ACTION_CONTRACT,
  BROWSER_PREVIEW_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import { createBrowserPreviewCapabilityClient } from './browser-preview-capability-client'
import {
  browserPreviewI18nResourceContribution,
  type BrowserPreviewI18nResourceContribution
} from './browser-preview-messages'

const BrowserPreviewPanel = lazy(() =>
  import('./BrowserPreviewPanel').then((module) => ({
    default: module.BrowserPreviewPanel
  }))
)

export type BrowserPreviewRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>

export type BrowserPreviewToolbarActionContribution =
  DomainRendererWorkbenchToolbarActionValue<typeof Globe2>

type BrowserPreviewRendererContribution =
  | BrowserPreviewRightPanelContribution
  | DomainRendererCommandHandler
  | BrowserPreviewToolbarActionContribution
  | BrowserPreviewI18nResourceContribution

export function createBrowserPreviewRightPanelContribution(
  host: DomainRendererHost
): BrowserPreviewRightPanelContribution {
  if (!host.visibleContext) {
    throw new Error('Browser Preview requires the renderer visible-context host contract.')
  }
  const client = createBrowserPreviewCapabilityClient(host.capabilityInvoker)
  const visibleContext = host.visibleContext
  return Object.freeze({
    render: ({ active, className, onCollapse, session }) => (
      <BrowserPreviewPanel
        active={active}
        className={className}
        onCollapse={onCollapse}
        sessionId={session.id}
        workspaceRoot={session.workspaceRoot ?? ''}
        client={client}
        visibleContext={visibleContext}
      />
    )
  })
}

export function createBrowserPreviewCommand(
  host: DomainRendererHost
): DomainRendererCommandHandler {
  return createOpenRightPanelCommand(
    host,
    BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  )
}

export function createBrowserPreviewToolbarActionContribution():
BrowserPreviewToolbarActionContribution {
  return Object.freeze({ icon: Globe2 })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<BrowserPreviewRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<BrowserPreviewRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createBrowserPreviewRightPanelContribution(host)
      },
      {
        ...BROWSER_PREVIEW_RENDERER_COMMAND_CONTRIBUTION,
        value: createBrowserPreviewCommand(host)
      },
      {
        ...BROWSER_PREVIEW_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: BROWSER_PREVIEW_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: createBrowserPreviewToolbarActionContribution()
      },
      {
        ...BROWSER_PREVIEW_RENDERER_I18N_CONTRIBUTION,
        value: browserPreviewI18nResourceContribution
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
