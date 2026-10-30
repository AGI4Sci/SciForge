import type { DomainCapabilityContract } from '@sciforge/domain-sdk/host'
import {
  scientificPlottingCompareRequestSchema,
  scientificPlottingCompareResultSchema,
  scientificPlottingMapDataRequestSchema,
  scientificPlottingMapDataResultSchema,
  scientificPlottingRenderRequestSchema,
  scientificPlottingRenderResultSchema,
  scientificPlottingRerunRequestSchema,
  scientificPlottingRerunResultSchema,
  scientificPlottingStatusResultSchema,
  type ScientificPlottingCompareInput,
  type ScientificPlottingCompareResult,
  type ScientificPlottingDataMappingResult,
  type ScientificPlottingMapDataInput,
  type ScientificPlottingRenderInput,
  type ScientificPlottingRenderResult,
  type ScientificPlottingRerunInput,
  type ScientificPlottingRerunResult,
  type ScientificPlottingStatusResult
} from '@sciforge/scientific-plotting/contract'
import { z } from 'zod'

export * from '@sciforge/scientific-plotting/contract'

export const SCIENTIFIC_PLOTTING_CAPABILITY_IDS = Object.freeze({
  status: 'scientific-plotting.status',
  mapData: 'scientific-plotting.map-data',
  render: 'scientific-plotting.render',
  rerun: 'scientific-plotting.rerun',
  compare: 'scientific-plotting.compare'
} as const)

export const scientificPlottingStatusInputSchema = z.object({}).strict()

export const SCIENTIFIC_PLOTTING_STATUS_CONTRACT: DomainCapabilityContract<
  Record<string, never>,
  ScientificPlottingStatusResult
> = Object.freeze({
  actionId: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status,
  effect: 'read',
  inputSchema: scientificPlottingStatusInputSchema,
  outputSchema: scientificPlottingStatusResultSchema
})

export const SCIENTIFIC_PLOTTING_MAP_DATA_CONTRACT: DomainCapabilityContract<
  ScientificPlottingMapDataInput,
  ScientificPlottingDataMappingResult
> = Object.freeze({
  actionId: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.mapData,
  effect: 'compute',
  inputSchema: scientificPlottingMapDataRequestSchema,
  outputSchema: scientificPlottingMapDataResultSchema
})

export const SCIENTIFIC_PLOTTING_RENDER_CONTRACT: DomainCapabilityContract<
  ScientificPlottingRenderInput,
  ScientificPlottingRenderResult
> = Object.freeze({
  actionId: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render,
  effect: 'workspace-write',
  inputSchema: scientificPlottingRenderRequestSchema,
  outputSchema: scientificPlottingRenderResultSchema
})

export const SCIENTIFIC_PLOTTING_RERUN_CONTRACT: DomainCapabilityContract<
  ScientificPlottingRerunInput,
  ScientificPlottingRerunResult
> = Object.freeze({
  actionId: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.rerun,
  effect: 'workspace-write',
  inputSchema: scientificPlottingRerunRequestSchema,
  outputSchema: scientificPlottingRerunResultSchema
})

export const SCIENTIFIC_PLOTTING_COMPARE_CONTRACT: DomainCapabilityContract<
  ScientificPlottingCompareInput,
  ScientificPlottingCompareResult
> = Object.freeze({
  actionId: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.compare,
  effect: 'read',
  inputSchema: scientificPlottingCompareRequestSchema,
  outputSchema: scientificPlottingCompareResultSchema
})
