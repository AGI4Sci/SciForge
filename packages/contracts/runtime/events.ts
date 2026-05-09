import type { RuntimeArtifact } from './artifacts';
import type { RuntimeExecutionUnit } from './execution';
import type { ObjectReference } from './references';

export type BackgroundCompletionEventType =
  | 'background-initial-response'
  | 'background-stage-update'
  | 'background-finalization';

export type BackgroundCompletionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundCompletionRef {
  ref: string;
  kind: 'run' | 'stage' | 'message' | 'artifact' | 'execution-unit' | 'verification' | 'work-evidence' | 'file' | 'url';
  runId: string;
  stageId?: string;
  title?: string;
}

export interface BackgroundCompletionRuntimeEvent {
  contract: 'sciforge.background-completion.v1';
  type: BackgroundCompletionEventType;
  runId: string;
  stageId?: string;
  ref?: string;
  status: BackgroundCompletionStatus;
  prompt?: string;
  message?: string;
  finalResponse?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  cancellationReason?: string;
  failureReason?: string;
  recoverActions?: string[];
  nextStep?: string;
  refs?: BackgroundCompletionRef[];
  artifacts?: RuntimeArtifact[];
  executionUnits?: RuntimeExecutionUnit[];
  verificationResults?: Array<Record<string, unknown>>;
  workEvidence?: Array<Record<string, unknown>>;
  objectReferences?: ObjectReference[];
  raw?: unknown;
}
