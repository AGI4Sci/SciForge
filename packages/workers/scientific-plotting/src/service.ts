export * from './visual-style-extractor.js'
export * from './scientific-plotting-engine.js'
export * from './scientific-skills-index.js'
export * from './scientific-skills-installer.js'

import {
  compareScientificPlotVersions,
  getScientificPlottingStatus,
  mapScientificPlottingData,
  renderScientificPlot,
  rerunScientificPlot
} from './scientific-plotting-engine.js'
import type {
  ScientificPlottingCompareRequest,
  ScientificPlottingCompareResult,
  ScientificPlottingDataMappingRequest,
  ScientificPlottingDataMappingResult,
  ScientificPlottingEngineDependencies,
  ScientificPlottingRenderRequest,
  ScientificPlottingRenderResult,
  ScientificPlottingRerunRequest,
  ScientificPlottingRerunResult,
  ScientificPlottingStatusResult
} from './types.js'

/**
 * An explicit plotting facade. The artifact version commit port is injected by
 * the composition root; this worker never imports a registry or hidden global.
 */
export type ScientificPlottingService = Readonly<{
  status(): Promise<ScientificPlottingStatusResult>
  mapData(request: ScientificPlottingDataMappingRequest): Promise<ScientificPlottingDataMappingResult>
  render(request: ScientificPlottingRenderRequest): Promise<ScientificPlottingRenderResult>
  rerun(request: ScientificPlottingRerunRequest): Promise<ScientificPlottingRerunResult>
  compare(request: ScientificPlottingCompareRequest): Promise<ScientificPlottingCompareResult>
}>

export function createScientificPlottingService(
  dependencies: ScientificPlottingEngineDependencies = {}
): ScientificPlottingService {
  const injectedDependencies = Object.freeze({ ...dependencies })
  return Object.freeze({
    status: () => getScientificPlottingStatus(),
    mapData: (request) => mapScientificPlottingData(request),
    render: (request) => renderScientificPlot(request, injectedDependencies),
    rerun: (request) => rerunScientificPlot(request, injectedDependencies),
    compare: (request) => compareScientificPlotVersions(request, injectedDependencies)
  })
}
