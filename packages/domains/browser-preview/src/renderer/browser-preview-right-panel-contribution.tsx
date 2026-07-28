import { lazy, type ReactElement } from 'react'
import { Globe2 } from 'lucide-react'
import type {
  DomainRendererHost,
  DomainWorkbenchRightPanelRenderContext
} from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  BROWSER_PREVIEW_RENDERER_I18N_CONTRIBUTION,
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

export type BrowserPreviewRightPanelContribution = Readonly<{
  id: string
  mode: 'browser'
  title: string
  resourceKind: string
  render: (context: DomainWorkbenchRightPanelRenderContext) => ReactElement
}>

export type BrowserPreviewToolbarActionContribution = Readonly<{
  icon: typeof Globe2
  isAvailable: () => boolean
}>

type BrowserPreviewRendererContribution =
  | BrowserPreviewRightPanelContribution
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
    id: BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    mode: 'browser',
    title: 'Playwright browser',
    resourceKind: 'browser-page',
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

export function createBrowserPreviewToolbarActionContribution():
BrowserPreviewToolbarActionContribution {
  return Object.freeze({
    icon: Globe2,
    isAvailable: () => true
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<BrowserPreviewRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<BrowserPreviewRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        value: createBrowserPreviewRightPanelContribution(host)
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
