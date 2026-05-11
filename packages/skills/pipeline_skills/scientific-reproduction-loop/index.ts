export {
  SCIENTIFIC_REPRODUCTION_TRAJECTORY_SCHEMA_VERSION,
  evaluateSelfPromptAutoSubmitGate,
  sanitizeTrajectoryForExport,
  validateScientificReproductionTrajectory,
  type DecisionRationale,
  type ObservationRecord,
  type PromptRecord,
  type RepairRecord,
  type ScientificReproductionTrajectory,
  type ScreenStateRef,
  type SelfPromptAutoSubmitGate,
  type SelfPromptAutoSubmitGateOptions,
  type SelfPromptRecommendation,
  type TrajectoryStep,
  type UiActionRecord,
  type ValidationResult,
  type WorkspaceRef,
} from './trajectory-contract';
export { buildSampleScientificReproductionTrajectory } from './sample-trajectory';
export {
  auditTrajectoryTrainingRecord,
  buildTrajectoryTrainingRecordFromStoredAttempt,
  type BuildTrajectoryTrainingRecordInput,
  type StoredAttemptLike,
  type TrajectoryAuditIssue,
  type TrajectoryAuditResult,
  type TrajectorySourceSubject,
} from './trajectory-export';
