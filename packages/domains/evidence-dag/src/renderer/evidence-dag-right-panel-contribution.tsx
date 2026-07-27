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
  label: string
  icon: typeof Network
  title: string
  resourceKind: typeof EVIDENCE_DAG_RESOURCE_KIND
  isAvailable: () => boolean
  render: (context: DomainWorkbenchRightPanelRenderContext) => ReactElement
}>

export type EvidenceDagRendererContribution =
  | EvidenceDagRightPanelContribution
  | EvidenceDagI18nResourceContribution

export function createEvidenceDagRightPanelContribution(
  host: DomainRendererHost
): EvidenceDagRightPanelContribution {
  const client = createEvidenceDagCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    id: EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    mode: 'evidence-dag',
    label: 'rightPanelEvidenceDag',
    icon: Network,
    title: 'Evidence DAG',
    resourceKind: EVIDENCE_DAG_RESOURCE_KIND,
    isAvailable: () => true,
    render: (context) => (
      <EvidenceDagPanel
        {...context}
        client={client}
        workspacePreview={host.workspacePreview}
      />
    )
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
        ...EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
        value: evidenceDagI18nResourceContribution
      }
    ]
  })
}
