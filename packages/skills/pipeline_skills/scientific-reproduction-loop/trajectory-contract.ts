export const SCIENTIFIC_REPRODUCTION_TRAJECTORY_SCHEMA_VERSION =
  'sciforge.scientific-reproduction-trajectory.v1' as const;

export type StepKind =
  | 'open-app'
  | 'select-workspace'
  | 'attach-reference'
  | 'prompt'
  | 'inspect-artifact'
  | 'computer-use-action'
  | 'repair'
  | 'self-prompt-recommendation'
  | 'verdict';

export type ActionModality = 'human-prompt' | 'mouse' | 'keyboard' | 'vision-sense' | 'workspace' | 'backend';

export type ResearchFailureKind = 'product-capability-failure' | 'scientific-negative-result' | 'blocked-missing-evidence';

export interface WorkspaceRef {
  ref: string;
  kind: 'workspace-file' | 'artifact' | 'trace' | 'screen' | 'execution-unit' | 'audit' | 'ledger';
  description?: string;
}

export interface PromptRecord {
  text: string;
  role: 'human-researcher' | 'self-prompt-shadow' | 'system';
  selectedRefs: WorkspaceRef[];
  intent: string;
}

export interface ScreenStateRef {
  ref: string;
  captureKind: 'screenshot' | 'vision-summary' | 'browser-state' | 'window-metadata';
  summary: string;
}

export interface UiActionRecord {
  modality: ActionModality;
  command: string;
  target?: string;
  inputSummary?: string;
  screenBeforeRefs: ScreenStateRef[];
  screenAfterRefs: ScreenStateRef[];
  traceRefs: WorkspaceRef[];
}

export interface ObservationRecord {
  summary: string;
  toolResultRefs: WorkspaceRef[];
  artifactRefs: WorkspaceRef[];
  stdoutRef?: WorkspaceRef;
  stderrRef?: WorkspaceRef;
}

export interface RepairRecord {
  failureKind: ResearchFailureKind;
  symptom: string;
  diagnosis: string;
  repairAction: string;
  retestPrompt?: PromptRecord;
  retestObservationRefs: WorkspaceRef[];
  outcome: 'recovered' | 'still-blocked' | 'converted-to-negative-result';
}

export interface DecisionRationale {
  question: string;
  reason: string;
  alternativesConsidered: string[];
  evidenceRefs: WorkspaceRef[];
}

export interface SelfPromptRecommendation {
  nextPrompt: string;
  requiredRefs: WorkspaceRef[];
  stopCondition: string;
  qualityGate: string;
  budget?: {
    maxShadowRounds: number;
    maxAutoSubmitRounds: number;
    maxToolCalls?: number;
    maxRuntimeMinutes?: number;
    stopOnRepeatedFailure: boolean;
    reviewRequiredBeforeSubmit: boolean;
  };
  humanConfirmationPoint?: string;
  reviewChecklist?: string[];
  mode: 'shadow-only' | 'human-review-required' | 'auto-submit-eligible';
}

export interface TrajectoryStep {
  id: string;
  kind: StepKind;
  timestamp: string;
  prompt?: PromptRecord;
  action?: UiActionRecord;
  observation: ObservationRecord;
  rationale?: DecisionRationale;
  repair?: RepairRecord;
  selfPromptRecommendation?: SelfPromptRecommendation;
}

export interface ScientificReproductionTrajectory {
  schemaVersion: typeof SCIENTIFIC_REPRODUCTION_TRAJECTORY_SCHEMA_VERSION;
  attemptRef: string;
  runbookRef: string;
  workspaceRef: string;
  subject: {
    title: string;
    paperRefs: WorkspaceRef[];
    scenarioId?: string;
    topic?: string;
  };
  actors: Array<{
    id: string;
    role: 'human-operator' | 'codex-worker' | 'sciforge-backend' | 'computer-use-bridge';
  }>;
  steps: TrajectoryStep[];
  repairHistory: RepairRecord[];
  selfPromptRecommendations: SelfPromptRecommendation[];
  finalVerdict: 'not-started' | 'in-progress' | 'reproduced' | 'partially-reproduced' | 'not-reproduced' | 'contradicted';
  exportNotes: {
    redactionPolicy: string;
    replayInstructions: string[];
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateScientificReproductionTrajectory(
  record: ScientificReproductionTrajectory,
): ValidationResult {
  const errors: string[] = [];
  if (record.schemaVersion !== SCIENTIFIC_REPRODUCTION_TRAJECTORY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCIENTIFIC_REPRODUCTION_TRAJECTORY_SCHEMA_VERSION}`);
  }
  requireText(record.attemptRef, 'attemptRef', errors);
  requireText(record.runbookRef, 'runbookRef', errors);
  requireText(record.workspaceRef, 'workspaceRef', errors);
  requireText(record.subject?.title, 'subject.title', errors);
  if (!Array.isArray(record.subject?.paperRefs) || record.subject.paperRefs.length === 0) {
    errors.push('subject.paperRefs must contain at least one workspace ref');
  }
  if (!Array.isArray(record.actors) || record.actors.length === 0) {
    errors.push('actors must contain at least one actor');
  }
  if (!Array.isArray(record.steps) || record.steps.length === 0) {
    errors.push('steps must contain at least one replayable step');
  }
  for (const [index, step] of record.steps.entries()) {
    validateStep(step, `steps[${index}]`, errors);
  }
  const hasPrompt = record.steps.some((step) => step.prompt?.text);
  const hasScreenRef = record.steps.some((step) => (step.action?.screenBeforeRefs.length ?? 0) > 0);
  const hasArtifactRef = record.steps.some((step) => step.observation.artifactRefs.length > 0);
  if (!hasPrompt) errors.push('trajectory must include at least one human-like prompt');
  if (!hasScreenRef) errors.push('trajectory must include at least one screen state ref');
  if (!hasArtifactRef) errors.push('trajectory must include at least one artifact ref');
  if (!record.exportNotes?.redactionPolicy) errors.push('exportNotes.redactionPolicy is required');
  return { ok: errors.length === 0, errors };
}

export function sanitizeTrajectoryForExport(
  record: ScientificReproductionTrajectory,
): ScientificReproductionTrajectory {
  return JSON.parse(
    JSON.stringify(record)
      .replace(/((?:api[_-]?key|token|secret)=)[^\s"']+/gi, '$1[redacted-secret]')
      .replace(/\/(?:Users|Applications|private|tmp|var)\/[A-Za-z0-9._~/% -]+/g, '[workspace-ref]')
      .replace(/[A-Za-z0-9_=-]{20,}\.[A-Za-z0-9_=-]{20,}\.[A-Za-z0-9_=-]{20,}/g, '[redacted-token]')
  ) as ScientificReproductionTrajectory;
}

function validateStep(step: TrajectoryStep, path: string, errors: string[]): void {
  requireText(step.id, `${path}.id`, errors);
  requireText(step.kind, `${path}.kind`, errors);
  requireText(step.timestamp, `${path}.timestamp`, errors);
  if (!step.observation) {
    errors.push(`${path}.observation is required`);
    return;
  }
  requireText(step.observation.summary, `${path}.observation.summary`, errors);
  if (step.prompt) {
    requireText(step.prompt.text, `${path}.prompt.text`, errors);
    requireText(step.prompt.intent, `${path}.prompt.intent`, errors);
  }
  if (step.action) {
    requireText(step.action.modality, `${path}.action.modality`, errors);
    requireText(step.action.command, `${path}.action.command`, errors);
  }
  if (step.repair) {
    requireText(step.repair.symptom, `${path}.repair.symptom`, errors);
    requireText(step.repair.diagnosis, `${path}.repair.diagnosis`, errors);
    requireText(step.repair.repairAction, `${path}.repair.repairAction`, errors);
  }
  if (step.selfPromptRecommendation) {
    requireText(step.selfPromptRecommendation.nextPrompt, `${path}.selfPromptRecommendation.nextPrompt`, errors);
    requireText(step.selfPromptRecommendation.stopCondition, `${path}.selfPromptRecommendation.stopCondition`, errors);
    requireText(step.selfPromptRecommendation.qualityGate, `${path}.selfPromptRecommendation.qualityGate`, errors);
    if (!Array.isArray(step.selfPromptRecommendation.requiredRefs) || step.selfPromptRecommendation.requiredRefs.length === 0) {
      errors.push(`${path}.selfPromptRecommendation.requiredRefs must contain at least one workspace ref`);
    }
    validateSelfPromptBudget(step.selfPromptRecommendation.budget, `${path}.selfPromptRecommendation.budget`, errors);
  }
}

function validateSelfPromptBudget(
  budget: SelfPromptRecommendation['budget'] | undefined,
  path: string,
  errors: string[],
): void {
  if (!budget) return;
  if (!Number.isInteger(budget.maxShadowRounds) || budget.maxShadowRounds < 1) {
    errors.push(`${path}.maxShadowRounds must be a positive integer`);
  }
  if (!Number.isInteger(budget.maxAutoSubmitRounds) || budget.maxAutoSubmitRounds < 0) {
    errors.push(`${path}.maxAutoSubmitRounds must be a non-negative integer`);
  }
  if (budget.maxToolCalls !== undefined && (!Number.isInteger(budget.maxToolCalls) || budget.maxToolCalls < 0)) {
    errors.push(`${path}.maxToolCalls must be a non-negative integer when present`);
  }
  if (budget.maxRuntimeMinutes !== undefined && (!Number.isInteger(budget.maxRuntimeMinutes) || budget.maxRuntimeMinutes < 0)) {
    errors.push(`${path}.maxRuntimeMinutes must be a non-negative integer when present`);
  }
  if (typeof budget.stopOnRepeatedFailure !== 'boolean') {
    errors.push(`${path}.stopOnRepeatedFailure must be boolean`);
  }
  if (typeof budget.reviewRequiredBeforeSubmit !== 'boolean') {
    errors.push(`${path}.reviewRequiredBeforeSubmit must be boolean`);
  }
}

function requireText(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}
