import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/renderer'
import type { DomainRendererChatResultPanelRenderContext } from '@sciforge/domain-sdk/renderer-contributions'
import { createElement, type ReactElement } from 'react'
import {
  DATASET_API_CREATE_LOOP_RESOURCES_CONTRACT,
  DATASET_API_CREATE_LOOP_RESOURCES_CONTRIBUTION,
  DATASET_API_RENDERER_I18N_CONTRIBUTION,
  DATASET_API_TIMELINE_RESULTS_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import type { CreateLoopResourceProvider } from '@sciforge/domain-create-loop/resource-provider'
import { createDatasetApiCreateLoopResourceProvider } from './CreateLoopDatasetResourceProvider.js'
import {
  datasetApiI18nResourceContribution,
  type DatasetApiI18nResourceContribution
} from './messages.js'
import {
  TimelineDatasetResultsPanel,
  type DatasetTimelineBlock
} from './DatasetTimelinePanel.js'

export type DatasetTimelineContribution = Readonly<{
  id: 'dataset-api.timeline-results'
  render: (context: DomainRendererChatResultPanelRenderContext) => ReactElement | null
}>

type DatasetRendererContribution =
  | DatasetTimelineContribution
  | CreateLoopResourceProvider
  | DatasetApiI18nResourceContribution

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedDomainProcessEntryInput<DatasetRendererContribution> {
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...DATASET_API_TIMELINE_RESULTS_CONTRIBUTION,
        value: Object.freeze({
          id: 'dataset-api.timeline-results' as const,
          render: (context: DomainRendererChatResultPanelRenderContext) => createElement(
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
      },
      {
        ...DATASET_API_CREATE_LOOP_RESOURCES_CONTRIBUTION,
        contract: DATASET_API_CREATE_LOOP_RESOURCES_CONTRACT,
        value: createDatasetApiCreateLoopResourceProvider(host.capabilityInvoker)
      },
      {
        ...DATASET_API_RENDERER_I18N_CONTRIBUTION,
        value: datasetApiI18nResourceContribution
      }
    ]
  }
}

export * from './DatasetTimelinePanel.js'
export * from './CreateLoopDatasetResourceProvider.js'
