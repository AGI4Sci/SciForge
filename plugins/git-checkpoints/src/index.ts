export * from './contract.js'
export * from './ports/vcs.js'
export {
  GitCheckpointService,
  type GitCheckpointServiceOptions
} from './core/service.js'
export {
  GitCheckpointAutoCapture,
  shouldCaptureTurnEvent,
  turnEventKey,
  type GitCheckpointAutoCaptureOutcome,
  type GitCheckpointTurnEvent
} from './core/auto-capture.js'
export {
  createCheckpoint,
  listCheckpoints,
  previewCheckpoint,
  restoreCheckpoint
} from './core/operations.js'
export { createLocalGitVcs } from './fixture/local-git-vcs.js'
