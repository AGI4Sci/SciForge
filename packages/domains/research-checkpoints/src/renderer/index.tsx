import { createElement, type ReactElement } from 'react'

import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererChatResultPanelRenderContext,
  type DomainRendererChatResultPanelValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'

import type {
  ResearchCheckpointCommittedTurnStatusV1
} from '../contract.js'
import {
  RESEARCH_CHECKPOINTS_CHAT_RESULT_PANEL_CONTRIBUTION,
  RESEARCH_CHECKPOINTS_I18N_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { ResearchCheckpointTimelinePanel } from './ResearchCheckpointTimelinePanel.js'
import { createResearchCheckpointsRendererClient } from './research-checkpoints-capability-client.js'
import {
  researchCheckpointsI18nResourceContribution,
  type ResearchCheckpointsI18nResourceContribution
} from './research-checkpoints-messages.js'

export type ResearchCheckpointsTimelineContribution =
  DomainRendererChatResultPanelValue<ReactElement | null>
export type ResearchCheckpointsRendererContribution =
  | ResearchCheckpointsTimelineContribution
  | ResearchCheckpointsI18nResourceContribution

export function canOpenCommittedResearchCheckpoint(
  host: DomainRendererHost,
  sessionId: string | undefined
): boolean {
  return Boolean(
    sessionId?.trim() &&
    host.workbench?.canOpenResource?.('artifact-version') &&
    host.workbench.openResource
  )
}

export function openCommittedResearchCheckpoint(
  host: DomainRendererHost,
  sessionId: string | undefined,
  status: ResearchCheckpointCommittedTurnStatusV1
): boolean {
  const exactSessionId = sessionId?.trim()
  const openResource = host.workbench?.openResource
  if (
    !exactSessionId ||
    !openResource ||
    !host.workbench?.canOpenResource?.('artifact-version')
  ) return false
  return openResource({
    sessionId: exactSessionId,
    resource: {
      resourceKind: 'artifact-version',
      resourceId: status.artifactRef.versionId,
      integrity: {
        algorithm: 'sha256',
        expectedDigest: `sha256:${status.artifactRef.contentDigest}`
      }
    }
  })
}

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<ResearchCheckpointsRendererContribution> {
  const client = createResearchCheckpointsRendererClient(host.capabilityInvoker)
  const timeline = Object.freeze({
    id: 'research-checkpoints.timeline-status',
    render: (context: DomainRendererChatResultPanelRenderContext) => createElement(
      ResearchCheckpointTimelinePanel,
      {
        client,
        workspaceRoot: context.workspaceRoot,
        runtimeId: context.runtimeId,
        threadId: context.threadId,
        turnId: context.turnId,
        turnLifecycle: context.turnLifecycle,
        ...(canOpenCommittedResearchCheckpoint(host, context.sessionId)
          ? {
              onOpenExact: (status: ResearchCheckpointCommittedTurnStatusV1) => {
                openCommittedResearchCheckpoint(host, context.sessionId, status)
              }
            }
          : {})
      }
    )
  }) satisfies ResearchCheckpointsTimelineContribution

  return defineTrustedRendererDomainPackageEntry<ResearchCheckpointsRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        ...RESEARCH_CHECKPOINTS_CHAT_RESULT_PANEL_CONTRIBUTION,
        value: timeline
      },
      {
        ...RESEARCH_CHECKPOINTS_I18N_CONTRIBUTION,
        value: researchCheckpointsI18nResourceContribution
      }
    ]
  })
}

export * from './ResearchCheckpointTimelinePanel.js'
export * from './research-checkpoints-capability-client.js'
export * from './research-checkpoints-messages.js'
