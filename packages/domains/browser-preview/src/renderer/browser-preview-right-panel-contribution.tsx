import { lazy, type ReactElement } from 'react'
import { Globe2 } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  BROWSER_PREVIEW_RENDERER_I18N_CONTRIBUTION,
  BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION,
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
  label: string
  icon: typeof Globe2
  title: string
  resourceKind: string
  isAvailable: () => boolean
  render: (props: Readonly<{
    active: boolean
    className: string
    onCollapse: () => void
    sessionId: string
    workspaceRoot: string
  }>) => ReactElement
}>

type BrowserPreviewRendererContribution =
  | BrowserPreviewRightPanelContribution
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
    label: 'browserPreviewRightPanelBrowser',
    icon: Globe2,
    title: 'Playwright browser',
    resourceKind: 'browser-page',
    isAvailable: () => true,
    render: (props) => (
      <BrowserPreviewPanel
        {...props}
        client={client}
        visibleContext={visibleContext}
      />
    )
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
        ...BROWSER_PREVIEW_RENDERER_I18N_CONTRIBUTION,
        value: browserPreviewI18nResourceContribution
      }
    ]
  })
}
