export * from './contract.js'
export type { ScientificPlottingCapabilitiesPort } from './ports/capabilities.js'
export {
  createScientificPlottingServiceFactory,
  type ScientificPlottingServiceFactory
} from './core/service-factory.js'
export {
  comparePlots,
  mapData,
  plottingStatus,
  renderPlot,
  rerunPlot,
  type ScientificPlottingOperationResult
} from './core/operations.js'
export {
  scientificPlottingConfigSchema,
  type ScientificPlottingConfig
} from './fixture/config.js'
export {
  EXPECTED_HOST_GRANTS,
  registerScientificPlottingTools,
  scientificPlottingTools,
  type DshToolDefinition,
  type DshToolParameter
} from './dsh-adapter/tools.js'
