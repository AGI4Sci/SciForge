import React, { lazy, type ReactElement } from 'react'
import { ListTree } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  RENDERER_EXTENSION_CONTRIBUTION_KIND,
  domainRendererAuditWorkspaceContractSchema,
  isDomainRendererAuditWorkspaceValue,
  type DomainRendererResearchContentRenderContext,
  type DomainRendererWorkbenchSurfaceValue,
  type DomainRendererAuditWorkspaceValue,
  type DomainRendererCommandHandler,
  type DomainRendererWorkbenchToolbarActionValue,
  type DomainRendererResourceNavigationValue,
  type DomainRendererResearchWorkspaceValue,
  type DomainRendererResearchSummaryValue,
  type DomainRendererWorkbenchRightPanelValue,
  type DomainRendererWorkbenchGlobalOverlayValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'
import {
  EVIDENCE_DAG_RENDERER_AUDIT_COMMAND_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_AUDIT_TOOLBAR_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_AUDIT_TOOLBAR_CONTRACT,
  EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RESEARCH_WORKSPACE_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RESEARCH_WORKSPACE_CONTRACT,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RESEARCH_SUMMARY_CONTRACT,
  EVIDENCE_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
  EVIDENCE_DAG_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_GLOBAL_OVERLAY_CONTRACT,
  domainPackageDefinition
} from '../definition'
import { createEvidenceDagCapabilityClient } from './evidence-dag-capability-client'
import { createResearchRecordPresentationRegistry, researchRecordSurfaceScope } from './research-record-presentation'
import {
  evidenceDagI18nResourceContribution,
  type EvidenceDagI18nResourceContribution
} from './evidence-dag-messages'

const EvidenceDagPanel = lazy(() =>
  import('./EvidenceWorkspacePanel').then((module) => ({
    default: module.EvidenceWorkspacePanel
  }))
)

export type EvidenceDagRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>

export type EvidenceDagRendererContribution =
  | DomainRendererCommandHandler
  | DomainRendererWorkbenchToolbarActionValue
  | EvidenceDagRightPanelContribution
  | DomainRendererResearchWorkspaceValue<ReactElement>
  | DomainRendererResearchSummaryValue
  | DomainRendererResourceNavigationValue
  | EvidenceDagI18nResourceContribution
  | DomainRendererWorkbenchGlobalOverlayValue<ReactElement>

export function createEvidenceDagRightPanelContribution(
  host: DomainRendererHost,
  getPresentation = createResearchRecordPresentationRegistry(),
  returnContributionId: string = EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
): DomainRendererWorkbenchSurfaceValue<DomainRendererResearchContentRenderContext, ReactElement> {
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
        invoker={host.capabilityInvoker}
        workbench={host.workbench}
        workspacePreview={host.workspacePreview}
        visibleContext={host.visibleContext}
        getPresentation={getPresentation}
        returnContributionId={returnContributionId}
        embedded={returnContributionId !== EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id}
        sourcePresentation={context.sourcePresentation}
        {...(host.workbench?.toggleGlobalOverlay && context.sourcePresentation !== 'global-overlay' ? { onExpand: (scope: import('../research-record-contract').ResearchRecordScope) => {
          host.workbench!.toggleGlobalOverlay!({ contributionId: EVIDENCE_DAG_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION.id,
            sessionId: scope.threadId, open: true, activation: { revision: Date.now(), payload: { recordScope: scope, returnContributionId } } })
          context.onCollapse()
        } } : {})}
      />
    )
  })
}

export function createEvidenceDagGlobalOverlayContribution(
  host: DomainRendererHost
): DomainRendererWorkbenchGlobalOverlayValue<ReactElement> {
  return {
    placement: 'workspace',
    render: context => {
      const scope = researchRecordSurfaceScope(context.activation?.payload, {
        runtimeId: context.session.runtimeId, threadId: context.session.id, workspaceRoot: context.session.workspaceRoot
      })
      if (!scope) return <section className={`${context.className} z-20 bg-ds-main p-4 text-ds-ink`}><p className="text-ds-sm">选择带工作区的会话以查看研究记录。</p><button onClick={context.onClose}>关闭</button></section>
      const shell = (host.contributions?.list(RENDERER_EXTENSION_CONTRIBUTION_KIND) ?? []).flatMap(contribution => {
        const contract = domainRendererAuditWorkspaceContractSchema.safeParse(contribution.contract)
        return contract.success && isDomainRendererAuditWorkspaceValue(contribution.value)
          ? [{id:contribution.id,contract:contract.data,value:contribution.value as DomainRendererAuditWorkspaceValue<ReactElement>}] : []
      }).sort((a,b)=>a.contract.order-b.contract.order || a.id.localeCompare(b.id))[0]
      if (!shell) return <section className={`${context.className} z-20 bg-ds-main p-4 text-ds-ink`}><p role="status">审计工作区当前不可用，请确认研究工作区组件已启用。</p><button onClick={context.onClose}>关闭</button></section>
      const payload = context.activation?.payload
      const returnContributionId = payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.returnContributionId === 'string'
        ? payload.returnContributionId : shell.contract.sideContributionId
      const back = async () => {
        if (!host.workbench?.openSession || !await host.workbench.openSession({ runtimeId: scope.runtimeId, threadId: scope.threadId, focusComposer: false, readOnly: true })) throw new Error('来源会话当前不可用，审计内容仍保留。')
        host.workbench.openRightPanel({ contributionId: returnContributionId,
          sessionId: scope.threadId, activation: { contributionId: returnContributionId,
            revision: Date.now(), payload: { recordScope: scope } } })
        context.onClose()
      }
      return shell.value.render({ ...context,
        session: {...context.session,id:scope.threadId,runtimeId:scope.runtimeId,workspaceRoot:scope.workspaceRoot},
        onReturnToSide: back
      })
    }
  }
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
      if (resource.integrity && resource.integrity.expectedDigest !== resourceId && ['evidence-closure', 'evidence-snapshot'].includes(resource.resourceKind)) return null
      const payload = resource.resourceKind === 'evidence-claim'
        ? { view: 'graph' as const, nodeId: resourceId }
        : resource.resourceKind === 'evidence-closure'
          ? { view: 'closure' as const, closureDigest: resourceId }
          : resource.resourceKind === 'evidence-snapshot'
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

export function createResearchAuditCommand(host: DomainRendererHost): DomainRendererCommandHandler {
  return {
    execute: ({ sessionId, runtimeId, workspaceRoot }) => {
      if (!sessionId?.trim() || !runtimeId?.trim() || !workspaceRoot?.trim() || !host.workbench?.toggleGlobalOverlay) return
      host.workbench.toggleGlobalOverlay({ contributionId: EVIDENCE_DAG_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION.id, sessionId, open: true,
        activation: { revision: Date.now(), payload: { recordScope: { runtimeId, threadId: sessionId, workspaceRoot } } } })
    },
    isAvailable: ({ sessionId, runtimeId, workspaceRoot }) => Boolean(host.workbench?.toggleGlobalOverlay && sessionId?.trim() && runtimeId?.trim() && workspaceRoot?.trim()),
    isActive: ({ activeSurface }) => activeSurface?.kind === 'global-overlay' && activeSurface.contributionId === EVIDENCE_DAG_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION.id
  }
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<EvidenceDagRendererContribution> {
  const getPresentation = createResearchRecordPresentationRegistry()
  return defineTrustedRendererDomainPackageEntry<EvidenceDagRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      { ...EVIDENCE_DAG_RENDERER_AUDIT_COMMAND_CONTRIBUTION, value: createResearchAuditCommand(host) },
      { ...EVIDENCE_DAG_RENDERER_AUDIT_TOOLBAR_CONTRIBUTION, contract: EVIDENCE_DAG_RENDERER_AUDIT_TOOLBAR_CONTRACT, value: { icon: ListTree } },
      {
        ...EVIDENCE_DAG_RENDERER_RESEARCH_WORKSPACE_CONTRIBUTION,
        contract: EVIDENCE_DAG_RENDERER_RESEARCH_WORKSPACE_CONTRACT,
        value: { render: (context: Parameters<DomainRendererResearchWorkspaceValue<ReactElement>['render']>[0]) =>
          createEvidenceDagRightPanelContribution(host, getPresentation, context.returnContributionId).render(context) }
      },
      {
        ...EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createEvidenceDagRightPanelContribution(host, getPresentation)
      },
      {
        ...EVIDENCE_DAG_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION,
        contract: EVIDENCE_DAG_RENDERER_GLOBAL_OVERLAY_CONTRACT,
        value: createEvidenceDagGlobalOverlayContribution(host)
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
