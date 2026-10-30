export * from './contract.js'
export * from './ports/agent-threads.js'
export {
  ChangeInspectorService,
  changeInspectorResourceId,
  normalizePath,
  type ChangeInspectorServiceOptions
} from './core/service.js'
export {
  extractUnifiedDiffCandidates,
  projectSessionChangeSnapshot
} from './core/change-observation.js'
export {
  openSession,
  type ChangeInspectorOperationResult
} from './core/operations.js'
export {
  changeInspectorFixtureConfigSchema,
  createConfigAgentThreads,
  type ChangeInspectorFixtureConfig
} from './fixture/config-agent-threads.js'
