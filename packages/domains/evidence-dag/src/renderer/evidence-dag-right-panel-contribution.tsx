import React, { lazy, type ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererResourceNavigationValue,
  type DomainRendererResearchSummaryValue,
  type DomainRendererWorkbenchRightPanelValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RESEARCH_SUMMARY_CONTRACT,
  EVIDENCE_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
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

export type EvidenceDagRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>

export type EvidenceDagRendererContribution =
  | EvidenceDagRightPanelContribution
  | DomainRendererResearchSummaryValue
  | DomainRendererResourceNavigationValue
  | EvidenceDagI18nResourceContribution

export function createEvidenceDagRightPanelContribution(
  host: DomainRendererHost
): EvidenceDagRightPanelContribution {
  const client = createEvidenceDagCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ activation, ...context }) => (
      <EvidenceDagPanel
        {...context}
        {...(activation
          ? {
              activation: {
                contributionId: EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
                ...activation
              }
            }
          : {})}
        client={client}
        workspacePreview={host.workspacePreview}
      />
    )
  })
}

export function createEvidenceDagResearchSummaryContribution(
  host: DomainRendererHost
): DomainRendererResearchSummaryValue {
  const client = createEvidenceDagCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    provide: async ({ session, scope }) => {
      const runtimeId = session.runtimeId?.trim()
      const threadId = session.id.trim()
      if (!runtimeId || !threadId || scope.kind !== 'workspace') {
        return { status: 'unavailable' as const, reason: 'Evidence scope is unavailable.' }
      }
      try {
        const status = await client.snapshotStatus({
          runtimeId,
          threadId,
          workspaceRoot: scope.id
        })
        const freshness = status.freshness ?? 'unknown'
        const coverage = status.coverage
        const failure = status.failure
        return {
          status: 'available' as const,
          title: 'Evidence status',
          items: [
            {
              label: 'Freshness',
              value: freshness,
              tone: freshness === 'failed' ? 'critical' as const : freshness === 'fresh' ? 'positive' as const : freshness === 'unknown' ? 'neutral' as const : 'warning' as const
            },
            {
              label: 'Coverage',
              value: coverage ? (coverage.complete ? 'Complete' : `${coverage.gapCount} gap(s)`) : 'Unknown',
              tone: coverage?.complete ? 'positive' as const : 'warning' as const
            },
            {
              label: 'Risk',
              value: failure?.message ?? (status.materialRiskCount ? `${status.materialRiskCount} material risk(s)` : 'No material risk'),
              tone: failure ? 'critical' as const : status.materialRiskCount ? 'warning' as const : 'neutral' as const
            }
          ],
          actions: [{
            label: 'Open evidence',
            resource: {
              resourceKind: 'evidence-dag',
              resourceId: threadId
            }
          }]
        }
      } catch {
        return { status: 'unavailable' as const, reason: 'Evidence owner is unavailable.' }
      }
    }
  })
}

export function createEvidenceDagResourceNavigationContribution(): DomainRendererResourceNavigationValue {
  return Object.freeze({
    resolve: ({ resource }) => {
      const resourceId = resource.resourceId.trim()
      if (!resourceId) return null
      const payload = resource.resourceKind === 'evidence-claim'
        ? { view: 'graph' as const, nodeId: resourceId }
        : resource.resourceKind === 'evidence-closure' || resource.resourceKind === 'evidence-snapshot'
          ? { view: 'graph' as const, snapshotDigest: resourceId }
          : { view: 'graph' as const }
      return Object.freeze({
        activation: Object.freeze({
          revision: 1,
          payload: JSON.parse(JSON.stringify(payload))
        })
      })
    }
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
        contract: EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createEvidenceDagRightPanelContribution(host)
      },
      {
        ...EVIDENCE_DAG_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION,
        contract: EVIDENCE_DAG_RENDERER_RESEARCH_SUMMARY_CONTRACT,
        value: createEvidenceDagResearchSummaryContribution(host)
      },
      {
        ...EVIDENCE_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
        contract: EVIDENCE_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
        value: createEvidenceDagResourceNavigationContribution()
      },
      {
        ...EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
        value: evidenceDagI18nResourceContribution
      }
    ]
  })
}
