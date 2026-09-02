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
  PROJECT_DAG_RENDERER_I18N_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
  PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RESEARCH_SUMMARY_CONTRACT,
  PROJECT_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
  domainPackageDefinition
} from '../definition'
import { createProjectDagCapabilityClient } from './project-dag-capability-client'
import {
  projectDagI18nResourceContribution,
  type ProjectDagI18nResourceContribution
} from './project-dag-messages'

const ProjectDagPanel = lazy(() =>
  import('./ProjectDagPanel').then((module) => ({
    default: module.ProjectDagPanel
  }))
)

export type ProjectDagRightPanelContribution =
  DomainRendererWorkbenchRightPanelValue<ReactElement>

export type ProjectDagRendererContribution =
  | ProjectDagRightPanelContribution
  | DomainRendererResearchSummaryValue
  | DomainRendererResourceNavigationValue
  | ProjectDagI18nResourceContribution

export function createProjectDagRightPanelContribution(
  host: DomainRendererHost
): ProjectDagRightPanelContribution {
  const client = createProjectDagCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    render: ({ activation, ...context }) => (
      <ProjectDagPanel
        {...context}
        {...(activation
          ? {
              activation: {
                contributionId: PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
                ...activation
              }
            }
          : {})}
        client={client}
        workspacePreview={host.workspacePreview}
        workbench={host.workbench}
      />
    )
  })
}

export function createProjectDagResearchSummaryContribution(
  host: DomainRendererHost
): DomainRendererResearchSummaryValue {
  const client = createProjectDagCapabilityClient(host.capabilityInvoker)
  return Object.freeze({
    provide: async ({ session, scope }) => {
      if (scope.kind !== 'workspace' || !scope.id.trim()) {
        return { status: 'unavailable' as const, reason: 'Project scope is unavailable.' }
      }
      try {
        const result = await client.view({
          workspaceRoot: scope.id,
          projectRoot: scope.id,
          ...(session.id.trim() ? { sessions: [session.id.trim()] } : {}),
          view: 'home'
        })
        if (!result.ok) return { status: 'unavailable' as const, reason: result.error.message }
        const goal = result.data.goal
        const status = result.data.status
        const scopeCount = status.scope.includedSessions.length
        return {
          status: 'available' as const,
          title: goal?.title ?? 'Research project',
          items: [
            { label: 'Goal', value: goal?.title ?? 'Not set', tone: goal ? 'positive' as const : 'warning' as const },
            { label: 'Scope', value: `${scopeCount} included session${scopeCount === 1 ? '' : 's'}`, tone: scopeCount ? 'positive' as const : 'warning' as const },
            { label: 'Attention', value: String(status.attentionCount), tone: status.attentionCount ? 'warning' as const : 'neutral' as const }
          ],
          actions: [{
            label: 'Open project',
            resource: {
              resourceKind: 'project-dag',
              resourceId: scope.id
            }
          }]
        }
      } catch {
        return { status: 'unavailable' as const, reason: 'Project owner is unavailable.' }
      }
    }
  })
}

export function createProjectDagResourceNavigationContribution(): DomainRendererResourceNavigationValue {
  return Object.freeze({
    resolve: ({ resource }) => {
      const resourceId = resource.resourceId.trim()
      if (!resourceId) return null
      if (resource.resourceKind === 'project-goal') {
        return Object.freeze({ activation: Object.freeze({
          revision: 1, payload: { view: 'goals' as const, focus: { nodeId: resourceId } }
        }) })
      }
      if (resource.resourceKind === 'project-snapshot') {
        return Object.freeze({ activation: Object.freeze({
          revision: 1, payload: { view: 'graph' as const, focus: { nodeId: resourceId } }
        }) })
      }
      return Object.freeze({ activation: Object.freeze({
        revision: 1, payload: { view: 'home' as const }
      }) })
    }
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ProjectDagRendererContribution> {
  return defineTrustedRendererDomainPackageEntry<ProjectDagRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
        contract: PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRACT,
        value: createProjectDagRightPanelContribution(host)
      },
      {
        ...PROJECT_DAG_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION,
        contract: PROJECT_DAG_RENDERER_RESEARCH_SUMMARY_CONTRACT,
        value: createProjectDagResearchSummaryContribution(host)
      },
      {
        ...PROJECT_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION,
        contract: PROJECT_DAG_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
        value: createProjectDagResourceNavigationContribution()
      },
      {
        ...PROJECT_DAG_RENDERER_I18N_CONTRIBUTION,
        value: projectDagI18nResourceContribution
      }
    ]
  })
}
