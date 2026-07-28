import { lazy, type ReactElement } from 'react'
import { Network } from 'lucide-react'
import type {
  DomainRendererHost,
  DomainWorkbenchRightPanelRenderContext
} from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import { EVIDENCE_DAG_RESOURCE_KIND } from '../contract'
import {
  EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRACT,
  EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from '../definition'
import { createEvidenceDagCapabilityClient } from './evidence-dag-capability-client'
import {
  evidenceDagI18nResourceContribution,
  type EvidenceDagI18nResourceContribution
} from './evidence-dag-messages'

const EvidenceDagPanel = lazy(() =>
  import('./EvidenceDagPanel').then((module) => ({
    default: module.EvidenceDagPanel
  }))
)

export type EvidenceDagRightPanelContribution = Readonly<{
  id: string
  mode: 'evidence-dag'
  title: string
  resourceKind: typeof EVIDENCE_DAG_RESOURCE_KIND
  render: (context: DomainWorkbenchRightPanelRenderContext) => ReactElement
}>

export type EvidenceDagToolbarActionContribution = Readonly<{
  icon: typeof Network
  isAvailable: () => boolean
}>

export type EvidenceDagRendererContribution =
  | EvidenceDagRightPanelContribution
  | EvidenceDagToolbarActionContribution
  | EvidenceDagI18nResourceContribution

export function createEvidenceDagRightPanelContribution(
  host: DomainRendererHost
): EvidenceDagRightPanelContribution {
  const client = createEvidenceDagCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    id: EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    mode: 'evidence-dag',
    title: 'Evidence DAG',
    resourceKind: EVIDENCE_DAG_RESOURCE_KIND,
    render: (context) => (
      <EvidenceDagPanel
        {...context}
        client={client}
        workspacePreview={host.workspacePreview}
      />
    )
  })
}

export function createEvidenceDagToolbarActionContribution():
EvidenceDagToolbarActionContribution {
  return Object.freeze({
    icon: Network,
    isAvailable: () => true
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<EvidenceDagRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<EvidenceDagRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        value: createEvidenceDagRightPanelContribution(host)
      },
      {
        ...EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
        contract: EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRACT,
        value: createEvidenceDagToolbarActionContribution()
      },
      {
        ...EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
        value: evidenceDagI18nResourceContribution
      }
    ]
  })
}
