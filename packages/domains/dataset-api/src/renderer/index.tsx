import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/renderer'
import { createElement, type ReactElement } from 'react'
import {
  DATASET_API_TIMELINE_RESULTS_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import {
  TimelineDatasetResultsPanel,
  type DatasetTimelineBlock
} from './DatasetTimelinePanel.js'

type DatasetTimelineRenderContext = Readonly<{
  blocks: readonly unknown[]
  workspaceRoot?: string
  sessionId?: string
  onContinuePrompt?: (prompt: string) => void
}>

export type DatasetTimelineContribution = Readonly<{
  id: 'dataset-api.timeline-results'
  render: (context: DatasetTimelineRenderContext) => ReactElement | null
}>

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedDomainProcessEntryInput<DatasetTimelineContribution> {
  return {
    definition: domainPackageDefinition,
    contributions: [{
      ...DATASET_API_TIMELINE_RESULTS_CONTRIBUTION,
      value: Object.freeze({
        id: 'dataset-api.timeline-results' as const,
        render: (context: DatasetTimelineRenderContext) => createElement(
          TimelineDatasetResultsPanel,
          {
            blocks: context.blocks as readonly DatasetTimelineBlock[],
            workspaceRoot: context.workspaceRoot,
            onContinuePrompt: context.onContinuePrompt,
            ...(host.workspacePreview && context.sessionId
              ? {
                  onOpenArtifact: (path: string) => host.workspacePreview?.open({
                    path,
                    sessionId: context.sessionId!,
                    workspaceRoot: context.workspaceRoot,
                    kind: 'file'
                  })
                }
              : {})
          }
        )
      })
    }]
  }
}

export * from './DatasetTimelinePanel.js'
